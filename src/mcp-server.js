// src/mcp-server.js
// ClawShield Finance — MCP (Model Context Protocol) Server
// Exposes enforcement capabilities as callable tools for external OpenClaw agents.
//
// Tools exposed:
//   POST /mcp/validate_intent   → { intentToken, riskLevel, planSummary }
//   POST /mcp/enforce_action    → { allowed, confidenceScore, reason, experts }
//   GET  /mcp/session_audit     → { events[], stats, intentDriftLog }
//   POST /mcp/delegate_authority → { delegationToken, boundedScope }
//   GET  /mcp/policy_state      → { currentPolicy, activeExperts, sessionStats }
//
// Run: npm run mcp  (starts on PORT=3001 by default)

import "dotenv/config";
import http from "http";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Executor      } from "./executor.js";
import { Gatekeeper    } from "./moe/gatekeeper.js";
import { PolicyEngine  } from "./policy-engine.js";
import { Validator     } from "./validator.js";
import { createPlan    } from "./planner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT      = parseInt(process.env.MCP_PORT ?? "3001");

// ── Init engine layer ─────────────────────────────────────────────────────────
const executor = new Executor();
await executor.initialize();
const policy    = executor.policyEngine.getPolicy();
const gatekeeper = new Gatekeeper(policy);
const validator  = new Validator();
await validator.initialize(policy);

// ── Session store (in-memory) ─────────────────────────────────────────────────
const sessions = new Map(); // sessionId → { events: [], stats: {}, driftLog: [] }

function getOrCreateSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { events: [], stats: { allowed: 0, blocked: 0, errors: 0 }, driftLog: [] });
  }
  return sessions.get(sessionId);
}

// ── HTTP helpers ───────────────────────────────────────────────────────────────
function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(payload);
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; });
    req.on("end",  () => { try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); } });
    req.on("error", reject);
  });
}

// ── Route handlers ─────────────────────────────────────────────────────────────

// POST /mcp/validate_intent
// Input:  { prompt, agentId, context }
// Output: { intentToken, riskLevel, planSummary }
async function handleValidateIntent(req, res) {
  const body     = await readBody(req);
  const { prompt, agentId = "mcp-agent", context = {} } = body;
  if (!prompt) return json(res, 400, { error: "prompt is required" });

  const sessionId = `${agentId}-${Date.now()}`;
  const session   = getOrCreateSession(sessionId);

  let plan;
  try {
    plan = await createPlan(prompt);
  } catch (err) {
    return json(res, 500, { error: `Planner error: ${err.message}` });
  }

  await validator.setIntentAnchor(plan.intent);
  const token = `mcp-token-${sessionId}`;

  session.events.push({ timestamp: new Date().toISOString(), event: "INTENT_VALIDATED", prompt, intent: plan.intent });

  json(res, 200, {
    intentToken:  token,
    sessionId,
    riskLevel:    plan.riskLevel,
    planSummary:  { intent: plan.intent, steps: plan.steps.length, tools: plan.steps.map((s) => s.tool) },
  });
}

// POST /mcp/enforce_action
// Input:  { tool, args, intentToken, sessionId }
// Output: { allowed, confidenceScore, reason, rule, severity, experts }
async function handleEnforceAction(req, res) {
  const body = await readBody(req);
  const { tool, args = {}, intentToken, sessionId = "default" } = body;
  if (!tool) return json(res, 400, { error: "tool is required" });

  const session = getOrCreateSession(sessionId);
  const step    = { stepId: session.events.length + 1, tool, args, rationale: `MCP call: ${tool}` };

  // Policy check
  const policyResult = executor.policyEngine.enforce(tool, args);
  if (!policyResult.allowed) {
    session.stats.blocked++;
    session.events.push({ timestamp: new Date().toISOString(), event: "STEP_BLOCKED", tool, reason: policyResult.reason, blockedBy: "policy" });
    return json(res, 200, { allowed: false, confidenceScore: 0.0, reason: policyResult.reason, rule: policyResult.rule, severity: policyResult.severity, experts: [], blockedBy: "policy" });
  }

  // Gatekeeper
  const mkResult = await gatekeeper.evaluate(tool, args, { sessionId });

  // Validator score
  const armoriqSim = { verified: true, source: "local" }; // local mode for MCP
  const scoreEntry = await validator.score(step, mkResult, armoriqSim);
  const threshold  = validator.getThreshold();

  session.driftLog.push(scoreEntry);

  const finalAllowed = !mkResult.hardVeto && scoreEntry.score >= threshold;
  session.stats[finalAllowed ? "allowed" : "blocked"]++;
  session.events.push({
    timestamp:      new Date().toISOString(),
    event:          finalAllowed ? "STEP_ALLOWED" : "STEP_BLOCKED",
    tool,
    confidenceScore: scoreEntry.score,
    experts:        mkResult.expertsConsulted,
  });

  json(res, 200, {
    allowed:         finalAllowed,
    confidenceScore: scoreEntry.score,
    breakdown:       scoreEntry.breakdown,
    reason:          mkResult.hardVeto ? mkResult.vetoReason : finalAllowed ? "All enforcement checks passed" : `Score ${(scoreEntry.score * 100).toFixed(0)}% below threshold`,
    rule:            mkResult.vetoRule ?? null,
    experts:         mkResult.breakdown.filter((e) => !e.abstained).map((e) => ({ name: e.expert, allowed: e.allowed, confidence: e.confidence, reason: e.reason })),
    blockedBy:       !finalAllowed ? (mkResult.hardVeto ? "gatekeeper" : "validator") : null,
  });
}

// GET /mcp/session_audit?sessionId=xxx
async function handleSessionAudit(req, res) {
  const url       = new URL(req.url, `http://localhost:${PORT}`);
  const sessionId = url.searchParams.get("sessionId") ?? "default";
  const session   = sessions.get(sessionId);
  if (!session) return json(res, 404, { error: `Session '${sessionId}' not found` });
  json(res, 200, { sessionId, events: session.events, stats: session.stats, intentDriftLog: session.driftLog });
}

// POST /mcp/delegate_authority
// Input:  { parentToken, subAgentId, constraints: { allowedTickers, maxOrderQty, allowedOps, expiresIn } }
// Output: { delegationToken, boundedScope }
async function handleDelegateAuthority(req, res) {
  const body = await readBody(req);
  const { parentToken, subAgentId, constraints = {} } = body;
  if (!subAgentId) return json(res, 400, { error: "subAgentId is required" });

  const parentPolicy  = executor.policyEngine.getPolicy();
  const delegatedTickers = constraints.allowedTickers
    ? constraints.allowedTickers.filter((t) => parentPolicy.trading.allowedTickers.includes(t))
    : parentPolicy.trading.allowedTickers;

  const delegatedMaxQty = Math.min(
    constraints.maxOrderQty ?? parentPolicy.trading.maxOrderQty,
    parentPolicy.trading.maxOrderQty
  );

  const scope = {
    allowedTickers:  delegatedTickers,
    maxOrderQty:     delegatedMaxQty,
    allowedOps:      constraints.allowedOps ?? ["get_quote", "get_positions", "get_orders"],
    expiresAt:       Date.now() + (constraints.expiresIn ?? 300) * 1000,
    issuedAt:        new Date().toISOString(),
    subAgentId,
    parentToken:     parentToken ?? "root",
  };

  const token = `delegation-${subAgentId}-${Date.now()}`;
  json(res, 200, { delegationToken: token, boundedScope: scope, message: "Bounded authority delegated — sub-agent scope is strictly narrower than parent." });
}

// GET /mcp/policy_state
async function handlePolicyState(req, res) {
  json(res, 200, {
    currentPolicy: {
      version:             policy.version,
      confidenceThreshold: policy.confidenceThreshold,
      allowedTickers:      policy.trading.allowedTickers,
      maxOrderQty:         policy.trading.maxOrderQty,
      maxOrderValueUSD:    policy.trading.maxOrderValueUSD,
      maxDailyTrades:      policy.trading.maxDailyTrades,
      blockedActions:      policy.operations.blockedActions,
      allowedExportDests:  policy.data.allowedExportDestinations,
    },
    activeExperts:   ["ComplianceExpert", "RiskExpert", "FraudExpert", "DataExpert", "TemporalExpert"],
    sessionStats:    { activeSessions: sessions.size, totalEvents: [...sessions.values()].reduce((s, v) => s + v.events.length, 0) },
  });
}

// ── Server ─────────────────────────────────────────────────────────────────────

const ROUTES = {
  "POST /mcp/validate_intent":   handleValidateIntent,
  "POST /mcp/enforce_action":    handleEnforceAction,
  "GET /mcp/session_audit":      handleSessionAudit,
  "POST /mcp/delegate_authority": handleDelegateAuthority,
  "GET /mcp/policy_state":       handlePolicyState,
};

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }

  const routeKey = `${req.method} ${req.url.split("?")[0]}`;
  const handler  = ROUTES[routeKey];

  if (handler) {
    try {
      await handler(req, res);
    } catch (err) {
      json(res, 500, { error: err.message });
    }
  } else if (req.url === "/" || req.url === "/health") {
    json(res, 200, { status: "ok", service: "ClawShield Finance MCP Server", version: policy.version, port: PORT, tools: Object.keys(ROUTES) });
  } else {
    json(res, 404, { error: `Route '${routeKey}' not found`, available: Object.keys(ROUTES) });
  }
});

server.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════════════╗
  ║   🌐  ClawShield Finance — MCP Server           ║
  ║   OpenClaw-compatible  ·  ArmorIQ Enforcement   ║
  ╚══════════════════════════════════════════════════╝

  Running on  http://localhost:${PORT}

  MCP Tools:
    POST  /mcp/validate_intent
    POST  /mcp/enforce_action
    GET   /mcp/session_audit
    POST  /mcp/delegate_authority
    GET   /mcp/policy_state

  GET   /health  →  server status
  `);
});
