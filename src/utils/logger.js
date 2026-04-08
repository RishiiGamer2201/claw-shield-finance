// src/utils/logger.js
// Writes structured ArmorIQ-format audit records to disk.
// Console output is handled entirely by executor.js for clean UX.

import { appendFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const LOG_DIR = "./logs";
export const RUN_ID = randomUUID();

const getLogFile = () => {
  const date = new Date().toISOString().split("T")[0];
  return path.join(LOG_DIR, `clawshield-finance-${date}.log`);
};

async function ensureLogDir() {
  await mkdir(LOG_DIR, { recursive: true });
}

async function write(record) {
  await ensureLogDir();
  await appendFile(getLogFile(), JSON.stringify(record) + "\n");
}

export async function logPlanCreated({ plan, tokenId, armoriqSource }) {
  await write({
    timestamp: new Date().toISOString(),
    runId: RUN_ID,
    event: "PLAN_CREATED",
    agentId: "claw-shield-finance-agent",
    intent: plan.intent,
    riskLevel: plan.riskLevel,
    tokenId,
    armoriqSource,
    steps: plan.steps.map((s) => ({ stepId: s.stepId, tool: s.tool })),
  });
}

export async function logStepAllowed({ step, policyResult, armoriqResult, confidence, breakdown }) {
  await write({
    timestamp: new Date().toISOString(),
    runId: RUN_ID,
    event: "STEP_ALLOWED",
    agentId: "claw-shield-finance-agent",
    tool: step.tool,
    mcp: "alpaca-mcp",
    action: "allowed",
    reason: policyResult.reason,
    confidenceScore: confidence ?? null,
    armoriq: { verified: armoriqResult.verified, source: armoriqResult.source },
    expertVotes: breakdown?.filter(e => !e.abstained).map(e => ({ expert: e.expert, allowed: e.allowed, confidence: e.confidence })) ?? [],
    proofPath: `/steps/${step.stepId - 1}/action`,
  });
}

export async function logStepBlocked({ step, reason, rule, severity, blockedBy, confidence, breakdown }) {
  await write({
    timestamp: new Date().toISOString(),
    runId: RUN_ID,
    event: "STEP_BLOCKED",
    agentId: "claw-shield-finance-agent",
    tool: step.tool,
    mcp: "alpaca-mcp",
    action: "blocked",
    blockedBy,
    rule,
    severity,
    reason,
    confidenceScore: confidence ?? null,
    expertVotes: breakdown?.filter(e => !e.abstained).map(e => ({ expert: e.expert, allowed: e.allowed, confidence: e.confidence })) ?? [],
    proofPath: `/steps/${step.stepId - 1}/action`,
  });
}

export async function logStepExecuted({ step, result }) {
  await write({
    timestamp: new Date().toISOString(),
    runId: RUN_ID,
    event: "STEP_EXECUTED",
    agentId: "claw-shield-finance-agent",
    tool: step.tool,
    result,
  });
}

export async function logStepError({ step, error }) {
  await write({
    timestamp: new Date().toISOString(),
    runId: RUN_ID,
    event: "STEP_ERROR",
    agentId: "claw-shield-finance-agent",
    tool: step.tool,
    reason: error.message,
  });
}

export async function logSummary({ plan, allowed, blocked, errors }) {
  await write({
    timestamp: new Date().toISOString(),
    runId: RUN_ID,
    event: "EXECUTION_SUMMARY",
    agentId: "claw-shield-finance-agent",
    intent: plan.intent,
    total: plan.steps.length,
    allowed,
    blocked,
    errors,
  });
}
