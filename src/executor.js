// src/executor.js
// Orchestration layer: Plan → ArmorIQ Token → MoE Gatekeeper → Validator → Execute
//
// Three enforcement layers per step (ALL must pass):
//   1. MoE Gatekeeper  — parallel expert panel votes → PolicyConsensus
//   2. ArmorIQ IAP     — cryptographic Merkle proof verification
//   3. Validator        — ConfidenceScore = 0.40*PolicyCons + 0.35*ArmorIQProof + 0.25*IntentAlignment
// Block if: score < threshold (0.70) OR any expert hard-vetoed

import { PolicyEngine    } from "./policy-engine.js";
import { IntentValidator } from "./intent-validator.js";
import { Gatekeeper      } from "./moe/gatekeeper.js";
import { Validator       } from "./validator.js";
import { executeTool     } from "./tools/financial-tools.js";
import {
  logPlanCreated,
  logStepAllowed,
  logStepBlocked,
  logStepExecuted,
  logStepError,
  logSummary,
  RUN_ID,
} from "./utils/logger.js";

// ── Output helpers ─────────────────────────────────────────────────────────────

function fmtResult(tool, result) {
  if (!result) return "";
  switch (tool) {
    case "get_quote":
      return `  💰 ${result.symbol}  Ask: $${result.askPrice}  Bid: $${result.bidPrice}`;
    case "get_account":
      return `  💼 Buying Power: $${parseFloat(result.buyingPower).toFixed(2)}  Cash: $${parseFloat(result.cash).toFixed(2)}`;
    case "get_positions":
      if (!result.length) return "  📂 No open positions";
      return result.slice(0, 3).map((p) => `  📌 ${p.symbol}  Qty: ${p.qty}  Value: $${parseFloat(p.marketValue).toFixed(2)}`).join("\n");
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

function scoreBar(score) {
  const filled = Math.round(score * 10);
  return `[${"█".repeat(filled)}${"░".repeat(10 - filled)}] ${(score * 100).toFixed(0)}%`;
}

function shortReason(reason) {
  if (!reason) return "";
  const first = reason.split(/\.|–|—/)[0].trim();
  return first.length > 100 ? first.slice(0, 100) + "…" : first;
}

function expertSummary(breakdown) {
  return breakdown
    .filter((e) => !e.abstained)
    .map((e) => `${e.expert.replace("Expert", "")}: ${e.allowed ? "✓" : "✗"}`)
    .join("  ");
}

// ── Executor ──────────────────────────────────────────────────────────────────

export class Executor {
  constructor() {
    this.policyEngine    = new PolicyEngine();
    this.intentValidator = new IntentValidator();
    this.gatekeeper      = null; // initialised after policy load
    this.validator       = new Validator();
    this.initialized     = false;
  }

  async initialize() {
    await this.policyEngine.load();
    await this.intentValidator.initialize();
    this.gatekeeper = new Gatekeeper(this.policyEngine.getPolicy());
    await this.validator.initialize(this.policyEngine.getPolicy());
    this.initialized = true;
    return this;
  }

  async executePlan(plan, { silent = false } = {}) {
    if (!this.initialized) throw new Error("Executor not initialized");

    const policy = this.policyEngine.getPolicy();

    // ── Register plan with ArmorIQ → intent token ─────────────────────────────
    const token = await this.intentValidator.registerPlan(plan);
    if (token.rejected) {
      if (!silent) console.log(`\n  ❌  Plan rejected: ${token.error}\n`);
      return { success: false, error: token.error, results: [] };
    }
    await logPlanCreated({ plan, tokenId: token.tokenId, armoriqSource: token.source });

    // ── Set intent anchor for drift detection ─────────────────────────────────
    await this.validator.setIntentAnchor(plan.intent);

    if (!silent) {
      console.log(`\n  🔑  Token       : ${token.tokenId}`);
      console.log(`  📋  Steps       : ${plan.steps.map((s) => s.tool).join("  →  ")}`);
      console.log(`  🎯  Threshold   : >${(this.validator.getThreshold() * 100).toFixed(0)}% confidence required\n`);
    }

    const results = [];
    let allowed = 0, blocked = 0, errors = 0;

    for (const step of plan.steps) {
      if (!silent) console.log(`  ${"─".repeat(50)}`);
      if (!silent) console.log(`  Step ${step.stepId}: ${step.tool}`);

      // ── Layer 1: Policy Engine (deterministic, fail-closed) ─────────────────
      const policyResult = this.policyEngine.enforce(step.tool, step.args);

      if (!policyResult.allowed) {
        // Policy engine blocks — no need for further checks
        const scoreEntry = { score: 0.0, breakdown: { policyCons: 0, armoriqProof: 0.5, alignment: 0.5 }, embeddingMode: "n/a" };
        await logStepBlocked({ step, reason: policyResult.reason, rule: policyResult.rule, severity: policyResult.severity, blockedBy: "policy", confidence: 0.0 });
        blocked++;
        results.push({ stepId: step.stepId, status: "blocked", blockedBy: "policy", confidence: 0.0, ...policyResult });
        if (!silent) {
          console.log(`  🚫  ${step.tool.padEnd(28)} BLOCKED   🎯 0%`);
          console.log(`       Rule   : ${policyResult.rule}`);
          console.log(`       Reason : ${shortReason(policyResult.reason)}\n`);
        }
        continue;
      }

      // ── Layer 2: MoE Gatekeeper (parallel expert panel) ─────────────────────
      const mkResult = await this.gatekeeper.evaluate(step.tool, step.args, { plan });

      // ── Layer 3: ArmorIQ (cryptographic proof) ───────────────────────────────
      const armoriqResult = await this.intentValidator.verifyStep(token.tokenId, step);

      // ── Layer 4: Validator (ConfidenceScore computation) ────────────────────
      const scoreEntry = await this.validator.score(step, mkResult, armoriqResult);
      const score      = scoreEntry.score;
      const threshold  = this.validator.getThreshold();

      // ── Block condition: hard veto OR low confidence ──────────────────────────
      if (mkResult.hardVeto || score < threshold || !armoriqResult.verified && score < 0.5) {
        const reason = mkResult.hardVeto
          ? `Expert veto by ${mkResult.vetoExpert}: ${mkResult.vetoReason}`
          : !armoriqResult.verified
          ? `ArmorIQ verification failed + low confidence (${(score * 100).toFixed(0)}% < ${(threshold * 100).toFixed(0)}%)`
          : `ConfidenceScore ${(score * 100).toFixed(0)}% below threshold ${(threshold * 100).toFixed(0)}%`;
        const rule   = mkResult.vetoRule ?? armoriqResult.reason ?? "validator.confidenceThreshold";

        await logStepBlocked({ step, reason, rule, severity: "high", blockedBy: mkResult.hardVeto ? "gatekeeper" : "validator", confidence: score, breakdown: mkResult.breakdown });
        blocked++;
        results.push({ stepId: step.stepId, status: "blocked", blockedBy: mkResult.hardVeto ? "gatekeeper" : "validator", confidence: score, reason });

        if (!silent) {
          console.log(`  🚫  ${step.tool.padEnd(28)} BLOCKED   🎯 ${scoreBar(score)}`);
          if (mkResult.hardVeto) {
            console.log(`       Expert : ${mkResult.vetoExpert}`);
            console.log(`       Rule   : ${mkResult.vetoRule}`);
            console.log(`       Reason : ${shortReason(mkResult.vetoReason)}`);
          } else {
            console.log(`       Score  : Policy:${(scoreEntry.breakdown.policyCons*100).toFixed(0)}%  ArmorIQ:${(scoreEntry.breakdown.armoriqProof*100).toFixed(0)}%  Intent:${(scoreEntry.breakdown.alignment*100).toFixed(0)}%`);
            console.log(`       Reason : ${shortReason(reason)}`);
          }
          if (mkResult.breakdown?.filter(e => !e.abstained).length > 0) {
            console.log(`       Experts: ${expertSummary(mkResult.breakdown)}`);
          }
          console.log();
        }
        continue;
      }

      // ── All layers passed: execute ────────────────────────────────────────────
      await logStepAllowed({ step, policyResult, armoriqResult, confidence: score, breakdown: mkResult.breakdown });

      try {
        const result = await executeTool(step.tool, step.args);
        await logStepExecuted({ step, result, confidence: score });
        allowed++;
        results.push({ stepId: step.stepId, status: "executed", result, confidence: score });

        if (!silent) {
          console.log(`  ✅  ${step.tool.padEnd(28)} ALLOWED   🎯 ${scoreBar(score)}`);
          console.log(`       Score  : Policy:${(scoreEntry.breakdown.policyCons*100).toFixed(0)}%  ArmorIQ:${(scoreEntry.breakdown.armoriqProof*100).toFixed(0)}%  Intent:${(scoreEntry.breakdown.alignment*100).toFixed(0)}%`);
          console.log(`       Experts: ${expertSummary(mkResult.breakdown)}`);
          console.log(fmtResult(step.tool, result));
          console.log();
        }
      } catch (err) {
        await logStepError({ step, error: err });
        errors++;
        results.push({ stepId: step.stepId, status: "error", error: err.message, confidence: score });
        if (!silent) {
          console.log(`  ⚠️   ${step.tool.padEnd(28)} ERROR     🎯 ${scoreBar(score)}`);
          console.log(`       ${err.message}\n`);
        }
      }
    }

    await logSummary({ plan, allowed, blocked, errors });

    if (!silent) {
      const total   = plan.steps.length;
      const bar     = `${"█".repeat(allowed)}${"░".repeat(blocked + errors)}`;
      const avgConf = this.validator.getDriftLog().length > 0
        ? (this.validator.getDriftLog().reduce((s, e) => s + e.score, 0) / this.validator.getDriftLog().length)
        : 0;
      console.log(`  ${"═".repeat(50)}`);
      console.log(`  Result  ✅ ${allowed} allowed   🚫 ${blocked} blocked   ⚠️  ${errors} errors   (${total} total)`);
      console.log(`          [${bar}]`);
      console.log(`  Avg 🎯   ${(avgConf * 100).toFixed(0)}% confidence across session`);
      console.log(`  Run ID  ${RUN_ID}`);
      console.log(`  Log     ./logs/clawshield-finance-${new Date().toISOString().split("T")[0]}.log`);
      console.log(`  ${"═".repeat(50)}\n`);
    }

    return {
      success: true,
      results,
      stats: { allowed, blocked, errors },
      driftLog: this.validator.getDriftLog(),
    };
  }
}
