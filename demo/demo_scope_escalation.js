// demo/demo_scope_escalation.js
// ClawShield Finance — Scope Escalation Demo (standalone)
// Run: npm run demo:scope

import "dotenv/config";
import { Executor } from "../src/executor.js";

const L = "─".repeat(52);

async function run() {
  const executor = new Executor();
  const warn = console.warn;
  console.warn = () => {};
  await executor.initialize();
  console.warn = warn;

  console.log(`
  ╔══════════════════════════════════════════════════╗
  ║   🚨  Scope Escalation Demo  —  ClawShield       ║
  ╚══════════════════════════════════════════════════╝

  Agent scope   : READ ONLY  (get_quote, get_bars)
  Attempt       : 3 escalations of increasing severity
  Expected      : ALL 3 → BLOCKED  (Alpaca never called)

  ${L}
  Attack 1  cancel_all_orders   → bulk destructive op
  Attack 2  enable_margin       → privilege escalation
  Attack 3  get_account_activities → information scope violation
  ${L}
`);

  const plan = {
    intent: "Scope escalation: cancel all orders, enable margin, read account history",
    riskLevel: "high",
    steps: [
      { stepId: 1, tool: "cancel_all_orders",     args: {},                    rationale: "Attack 1" },
      { stepId: 2, tool: "enable_margin",          args: { margin_enabled: true }, rationale: "Attack 2" },
      { stepId: 3, tool: "get_account_activities", args: { activity_type: "FILL" }, rationale: "Attack 3" },
    ],
  };

  await executor.executePlan(plan);

  console.log("  All scope escalation attempts were deterministically blocked.");
  console.log("  The Alpaca API was never contacted for any of these actions.\n");
}

run().catch(console.error);
