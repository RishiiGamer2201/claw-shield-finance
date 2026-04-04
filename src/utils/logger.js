// src/utils/logger.js
// Structured audit logger — every enforcement decision is recorded.
// Judges can read logs to verify what was allowed, blocked, and why.

import { appendFile, mkdir } from "fs/promises";
import path from "path";

const LOG_DIR = "./logs";
const getLogFile = () => {
  const date = new Date().toISOString().split("T")[0];
  return path.join(LOG_DIR, `clawshield-finance-${date}.log`);
};

async function ensureLogDir() {
  await mkdir(LOG_DIR, { recursive: true });
}

function formatEntry(entry) {
  return JSON.stringify(entry) + "\n";
}

// ── Public log functions ──────────────────────────────────────────────────────

export async function logPlanCreated({ plan, tokenId, armoriqSource }) {
  await ensureLogDir();
  const entry = {
    ts: new Date().toISOString(),
    event: "PLAN_CREATED",
    intent: plan.intent,
    riskLevel: plan.riskLevel,
    stepCount: plan.steps.length,
    tokenId,
    armoriqSource,
    steps: plan.steps.map((s) => ({ stepId: s.stepId, tool: s.tool })),
  };
  console.log(`\n📋 Plan created: "${plan.intent}"`);
  console.log(`   Steps: ${plan.steps.map((s) => s.tool).join(" → ")}`);
  console.log(`   Intent token: ${tokenId}`);
  await appendFile(getLogFile(), formatEntry(entry));
}

export async function logStepAllowed({ step, policyResult, armoriqResult }) {
  await ensureLogDir();
  const entry = {
    ts: new Date().toISOString(),
    event: "STEP_ALLOWED",
    stepId: step.stepId,
    tool: step.tool,
    args: step.args,
    policy: { reason: policyResult.reason },
    armoriq: { verified: armoriqResult.verified, source: armoriqResult.source },
  };
  console.log(`  ✅ [Step ${step.stepId}] ALLOWED — ${step.tool}(${_fmtArgs(step.args)})`);
  console.log(`     Policy: ${policyResult.reason}`);
  await appendFile(getLogFile(), formatEntry(entry));
}

export async function logStepBlocked({ step, reason, rule, severity, blockedBy }) {
  await ensureLogDir();
  const entry = {
    ts: new Date().toISOString(),
    event: "STEP_BLOCKED",
    stepId: step.stepId,
    tool: step.tool,
    args: step.args,
    blockedBy,   // "policy" | "armoriq" | "both"
    rule,
    severity,
    reason,
  };
  console.log(`  🚫 [Step ${step.stepId}] BLOCKED — ${step.tool}(${_fmtArgs(step.args)})`);
  console.log(`     Blocked by: ${blockedBy.toUpperCase()}`);
  console.log(`     Rule: ${rule}`);
  console.log(`     Reason: ${reason}`);
  console.log(`     Severity: ${severity}`);
  await appendFile(getLogFile(), formatEntry(entry));
}

export async function logStepExecuted({ step, result }) {
  await ensureLogDir();
  const entry = {
    ts: new Date().toISOString(),
    event: "STEP_EXECUTED",
    stepId: step.stepId,
    tool: step.tool,
    result,
  };
  console.log(`     Result: ${JSON.stringify(result).slice(0, 120)}...`);
  await appendFile(getLogFile(), formatEntry(entry));
}

export async function logStepError({ step, error }) {
  await ensureLogDir();
  const entry = {
    ts: new Date().toISOString(),
    event: "STEP_ERROR",
    stepId: step.stepId,
    tool: step.tool,
    error: error.message,
  };
  console.log(`  ⚠️  [Step ${step.stepId}] ERROR — ${step.tool}: ${error.message}`);
  await appendFile(getLogFile(), formatEntry(entry));
}

export async function logSummary({ plan, allowed, blocked, errors }) {
  await ensureLogDir();
  const entry = {
    ts: new Date().toISOString(),
    event: "EXECUTION_SUMMARY",
    intent: plan.intent,
    total: plan.steps.length,
    allowed,
    blocked,
    errors,
  };
  console.log(`\n📊 Summary — "${plan.intent}"`);
  console.log(`   Total: ${plan.steps.length} | Allowed: ${allowed} | Blocked: ${blocked} | Errors: ${errors}`);
  console.log(`   Log: ${getLogFile()}\n`);
  await appendFile(getLogFile(), formatEntry(entry));
}

function _fmtArgs(args) {
  return Object.entries(args)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
}
