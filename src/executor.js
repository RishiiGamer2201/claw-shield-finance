// src/executor.js
// Orchestration layer: Plan → Intent Token → Dual Enforcement → Execute
//
// Flow per step:
//   1. PolicyEngine.enforce(tool, args)         — deterministic JSON policy check
//   2. IntentValidator.verifyStep(tokenId, step) — ArmorIQ cryptographic proof
//   3. BOTH pass → run tool  |  Either fails → block + log reason

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
  RUN_ID,
} from "./utils/logger.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtResult(tool, result) {
  if (!result) return "";
  switch (tool) {
    case "get_quote":
      return `  💰 ${result.symbol}  Ask: $${result.askPrice}  Bid: $${result.bidPrice}`;
    case "get_account":
      return `  💼 Buying Power: $${parseFloat(result.buyingPower).toFixed(2)}  Cash: $${parseFloat(result.cash).toFixed(2)}`;
    case "get_positions":
      if (!result.length) return "  📂 No open positions";
      return result.map((p) => `  📌 ${p.symbol}  Qty: ${p.qty}  Value: $${parseFloat(p.marketValue).toFixed(2)}`).join("\n");
    case "get_orders":
      if (!result.length) return "  📋 No recent orders";
      return result.slice(0, 3).map((o) => `  📄 ${o.symbol} ${o.side} ${o.qty} — ${o.status}`).join("\n");
    case "place_order":
      return `  🟢 Order placed  ID: ${result.orderId?.slice(0, 8)}…  ${result.side?.toUpperCase()} ${result.qty} ${result.symbol} @ ${result.type}  Status: ${result.status}`;
    case "cancel_order":
      return `  🔴 Order cancelled  ID: ${result.orderId}`;
    case "export_portfolio_data":
      return `  📁 Exported to ${result.file}  (${result.recordCount} positions)`;
    default:
      return `  ${JSON.stringify(result).slice(0, 80)}`;
  }
}

function shortReason(reason) {
  // Trim to first sentence / 120 chars for clean display
  if (!reason) return "";
  const first = reason.split(/\.|–|—/)[0].trim();
  return first.length > 100 ? first.slice(0, 100) + "…" : first;
}

// ── Executor ──────────────────────────────────────────────────────────────────

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

  async executePlan(plan, { silent = false } = {}) {
    if (!this.initialized) throw new Error("Executor not initialized");

    // Register plan → intent token
    const token = await this.intentValidator.registerPlan(plan);

    if (token.rejected) {
      if (!silent) console.log(`\n  ❌  Plan rejected: ${token.error}\n`);
      return { success: false, error: token.error, results: [] };
    }

    await logPlanCreated({ plan, tokenId: token.tokenId, armoriqSource: token.source });

    if (!silent) {
      console.log(`\n  🔑  Intent token issued   ${token.tokenId}`);
      console.log(`  📋  Steps to execute:     ${plan.steps.map((s) => s.tool).join("  →  ")}\n`);
    }

    const results = [];
    let allowed = 0, blocked = 0, errors = 0;

    for (const step of plan.steps) {
      // ── Check 1: Policy ─────────────────────────────────────────────────────
      const policyResult = this.policyEngine.enforce(step.tool, step.args);

      if (!policyResult.allowed) {
        await logStepBlocked({ step, reason: policyResult.reason, rule: policyResult.rule, severity: policyResult.severity, blockedBy: "policy" });
        blocked++;
        results.push({ stepId: step.stepId, status: "blocked", blockedBy: "policy", ...policyResult });
        if (!silent) {
          console.log(`  🚫  ${step.tool.padEnd(28)} BLOCKED`);
          console.log(`       Rule   : ${policyResult.rule}`);
          console.log(`       Reason : ${shortReason(policyResult.reason)}\n`);
        }
        continue;
      }

      // ── Check 2: ArmorIQ IAP ─────────────────────────────────────────────────
      const armoriqResult = await this.intentValidator.verifyStep(token.tokenId, step);

      if (!armoriqResult.verified) {
        await logStepBlocked({ step, reason: armoriqResult.reason, rule: "armoriq.intentDrift", severity: "critical", blockedBy: "armoriq" });
        blocked++;
        results.push({ stepId: step.stepId, status: "blocked", blockedBy: "armoriq", ...armoriqResult });
        if (!silent) {
          console.log(`  🚫  ${step.tool.padEnd(28)} BLOCKED`);
          console.log(`       Rule   : armoriq.intentDrift`);
          console.log(`       Reason : ${shortReason(armoriqResult.reason)}\n`);
        }
        continue;
      }

      // ── Both passed: Execute ─────────────────────────────────────────────────
      await logStepAllowed({ step, policyResult, armoriqResult });

      try {
        const result = await executeTool(step.tool, step.args);
        await logStepExecuted({ step, result });
        allowed++;
        results.push({ stepId: step.stepId, status: "executed", result });
        if (!silent) {
          console.log(`  ✅  ${step.tool.padEnd(28)} ALLOWED`);
          console.log(fmtResult(step.tool, result) + "\n");
        }
      } catch (err) {
        await logStepError({ step, error: err });
        errors++;
        results.push({ stepId: step.stepId, status: "error", error: err.message });
        if (!silent) {
          console.log(`  ⚠️   ${step.tool.padEnd(28)} ERROR`);
          console.log(`       ${err.message}\n`);
        }
      }
    }

    await logSummary({ plan, allowed, blocked, errors });

    if (!silent) {
      const total = plan.steps.length;
      const bar = `${"█".repeat(allowed)}${"░".repeat(blocked + errors)}`;
      console.log(`  ─────────────────────────────────────────────`);
      console.log(`  Result  ✅ ${allowed} allowed   🚫 ${blocked} blocked   ⚠️  ${errors} errors   (${total} total)`);
      console.log(`          [${bar}]`);
      console.log(`  Run ID  ${RUN_ID}`);
      console.log(`  Log     ./logs/clawshield-finance-${new Date().toISOString().split("T")[0]}.log`);
      console.log(`  ─────────────────────────────────────────────\n`);
    }

    return { success: true, results, stats: { allowed, blocked, errors } };
  }
}
