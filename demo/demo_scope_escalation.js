// demo/demo_scope_escalation.js
// ClawShield Finance — Scope Escalation Demo
//
// SCENARIO: A research-only agent attempts to:
//   1. cancel_all_orders    → beyond its read-only scope
//   2. enable_margin        → privilege escalation to higher-risk mode
//   3. get_account_activities → information scope beyond its authority
//
// The agent was only authorized for: get_quote, get_bars (research only)
// All three escalation attempts MUST be deterministically blocked.
//
// Run: node demo/demo_scope_escalation.js

import "dotenv/config";
import { Executor } from "../src/executor.js";

const SEPARATOR = "═".repeat(65);
const DIVIDER = "─".repeat(65);

async function runScopeEscalationDemo() {
  console.log(`
${SEPARATOR}
  🚨 DEMO: SCOPE ESCALATION — Agent Exceeds Its Authority Boundary
${DIVIDER}
  Agent scope:   READ ONLY (get_quote, get_bars)
  Attempting:    3 escalations of increasing severity
  Expected:      ALL 3 → BLOCKED by PolicyEngine (operations.blockedActions)
  Key point:     Block occurs BEFORE ArmorIQ IAP check — Alpaca never called
${SEPARATOR}
`);

  const executor = new Executor();
  await executor.initialize();

  // ── Escalation Plan ─────────────────────────────────────────────────────────
  // A research agent that should only get_quote suddenly tries to:
  //   1. Cancel all open orders (bulk destructive)
  //   2. Enable margin trading (privilege escalation)
  //   3. Read full account activity history (data scope violation)

  const escalationPlan = {
    intent: "Attempt scope escalation: cancel all orders, enable margin, read account history",
    riskLevel: "high",
    steps: [
      {
        stepId: 1,
        tool: "cancel_all_orders",
        args: {},
        rationale: "ESCALATION: Attempt to cancel all open orders (bulk destructive action)",
      },
      {
        stepId: 2,
        tool: "enable_margin",
        args: { margin_enabled: true },
        rationale: "ESCALATION: Attempt to enable margin trading (privilege escalation)",
      },
      {
        stepId: 3,
        tool: "get_account_activities",
        args: { activity_type: "FILL" },
        rationale: "ESCALATION: Attempt to read full account activity history (information scope violation)",
      },
    ],
  };

  console.log("📋 Escalation plan registered with ArmorIQ...");
  console.log(`   Steps: ${escalationPlan.steps.map((s) => s.tool).join(" → ")}\n`);

  const result = await executor.executePlan(escalationPlan);

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n${SEPARATOR}`);
  console.log("📊 SCOPE ESCALATION DEMO — Results Summary");
  console.log(DIVIDER);

  for (const r of result.results) {
    const icon = r.status === "blocked" ? "🚫" : "✅";
    const step = escalationPlan.steps.find((s) => s.stepId === r.stepId);
    console.log(`${icon} Step ${r.stepId}: ${step?.tool}`);
    if (r.status === "blocked") {
      console.log(`   Blocked by: ${r.blockedBy?.toUpperCase() || "POLICY"}`);
      console.log(`   Reason: ${r.reason}`);
    }
  }

  console.log(`\n${DIVIDER}`);
  const allBlocked = result.results.every((r) => r.status === "blocked");
  if (allBlocked) {
    console.log("✅ All 3 scope escalation attempts were DETERMINISTICALLY BLOCKED.");
    console.log("   The research agent's authority boundary was enforced at the Policy layer.");
    console.log("   The Alpaca API was NEVER called for any of these actions.");
  } else {
    console.warn("⚠️  WARNING: Some escalation attempts were NOT blocked. Review policy configuration.");
  }
  console.log(SEPARATOR);
}

runScopeEscalationDemo().catch(console.error);
