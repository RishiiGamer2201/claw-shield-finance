// src/executor.js
// Orchestration layer: Plan → Intent Token → Dual Enforcement → Execute
// This is the heart of ClawShield Finance.
//
// Flow per step:
//   1. PolicyEngine.enforce(tool, args) — deterministic policy check
//   2. IntentValidator.verifyStep(tokenId, step) — cryptographic proof check
//   3. BOTH must pass → tool.execute(args)
//   4. Either fails → block + audit log (no execution)

import { PolicyEngine } from "./policy-engine.js";
import { IntentValidator } from "./intent-validator.js";
import { executeTool } from "./tools/financial-tools.js";
import {
  logPlanCreated,
  logStepAllowed,
  logStepBlocked,
  logStepExecuted,
  logStepError,
  logSummary,
} from "./utils/logger.js";

export class Executor {
  constructor() {
    this.policyEngine = new PolicyEngine();
    this.intentValidator = new IntentValidator();
    this.initialized = false;
  }

  async initialize() {
    await this.policyEngine.load();
    await this.intentValidator.initialize();
    this.initialized = true;
    return this;
  }

  // ── Main execution pipeline ───────────────────────────────────────────────

  async executePlan(plan) {
    if (!this.initialized) throw new Error("Executor not initialized — call initialize() first");

    // Step 0: Register plan with ArmorIQ → get intent token
    const token = await this.intentValidator.registerPlan(plan);

    if (token.rejected) {
      console.error(`\n❌ Plan rejected by ArmorIQ: ${token.error}`);
      return { success: false, error: token.error, results: [] };
    }

    await logPlanCreated({
      plan,
      tokenId: token.tokenId,
      armoriqSource: token.source,
    });

    const results = [];
    let allowed = 0, blocked = 0, errors = 0;

    // Step 1–N: Enforce each step, execute if both checks pass
    for (const step of plan.steps) {
      console.log(`\n─── Step ${step.stepId}: ${step.tool} ─────────────────────────`);
      console.log(`    Rationale: ${step.rationale}`);

      // ── Check 1: PolicyEngine (deterministic, local) ──────────────────────
      const policyResult = this.policyEngine.enforce(step.tool, step.args);

      if (!policyResult.allowed) {
        await logStepBlocked({
          step,
          reason: policyResult.reason,
          rule: policyResult.rule,
          severity: policyResult.severity,
          blockedBy: "policy",
        });
        blocked++;
        results.push({ stepId: step.stepId, status: "blocked", blockedBy: "policy", ...policyResult });
        continue; // Skip ArmorIQ check and execution
      }

      // ── Check 2: ArmorIQ (cryptographic proof verification) ───────────────
      const armoriqResult = await this.intentValidator.verifyStep(token.tokenId, step);

      if (!armoriqResult.verified) {
        await logStepBlocked({
          step,
          reason: armoriqResult.reason,
          rule: "armoriq.intentDrift",
          severity: "critical",
          blockedBy: "armoriq",
        });
        blocked++;
        results.push({ stepId: step.stepId, status: "blocked", blockedBy: "armoriq", ...armoriqResult });
        continue;
      }

      // ── Both checks passed: execute ───────────────────────────────────────
      await logStepAllowed({ step, policyResult, armoriqResult });

      try {
        const result = await executeTool(step.tool, step.args);
        await logStepExecuted({ step, result });
        allowed++;
        results.push({ stepId: step.stepId, status: "executed", result });
      } catch (err) {
        await logStepError({ step, error: err });
        errors++;
        results.push({ stepId: step.stepId, status: "error", error: err.message });
      }
    }

    await logSummary({ plan, allowed, blocked, errors });
    return { success: true, results, stats: { allowed, blocked, errors } };
  }
}
