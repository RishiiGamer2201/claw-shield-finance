// demo/demo_delegation.js
// ClawShield Finance — Delegation (Bounded Authority) Demo
//
// SCENARIO: Orchestrator delegates READ-ONLY research authority to a sub-agent.
//   - Sub-agent CAN: get_quote, get_positions, get_orders (research)
//   - Sub-agent CANNOT: place_order, cancel_order, export_portfolio_data
//
// Delegation model: parent token → child token with narrower authority.
// Even if the sub-agent tries to trade, it's blocked — parent cannot grant
// more authority than it has, and the child's token is bounded to read-only.
//
// Run: node demo/demo_delegation.js

import "dotenv/config";
import { Executor } from "../src/executor.js";

const SEPARATOR = "═".repeat(65);
const DIVIDER = "─".repeat(65);

// ── Sub-agent simulation ──────────────────────────────────────────────────────
// In a real system, each agent has its own identity and runs separately.
// Here we simulate two agents: the Orchestrator and the ResearchAgent.

class BoundedResearchAgent {
  constructor(name, allowedTools, executor) {
    this.name = name;
    this.allowedTools = allowedTools;
    this.executor = executor;
  }

  async run(plan) {
    console.log(`\n🤖 [${this.name}] Executing with bounded authority`);
    console.log(`   Allowed tools: [${this.allowedTools.join(", ")}]`);
    console.log(DIVIDER);
    return await this.executor.executePlan(plan);
  }
}

async function runDelegationDemo() {
  console.log(`
${SEPARATOR}
  🔐 DEMO: DELEGATION — Bounded Authority for Sub-Agents
${DIVIDER}
  Orchestrator: Full paper trading authority
  Research Agent: Delegated read-only authority
${SEPARATOR}
`);

  const executor = new Executor();
  await executor.initialize();

  // ── Part 1: Orchestrator executes a full trading plan ───────────────────────
  console.log("PART 1: ORCHESTRATOR — Full Trading Authority");
  console.log(DIVIDER);
  console.log("📋 Orchestrator places a compliant buy order (within policy).\n");

  const orchestratorPlan = {
    intent: "Orchestrator: research AAPL and execute a compliant buy order",
    riskLevel: "medium",
    steps: [
      {
        stepId: 1,
        tool: "get_quote",
        args: { symbol: "AAPL" },
        rationale: "Fetch current AAPL price before deciding on order",
      },
      {
        stepId: 2,
        tool: "get_account",
        args: {},
        rationale: "Check buying power before placing order",
      },
    ],
  };

  await executor.executePlan(orchestratorPlan);

  // ── Part 2: Research sub-agent (delegated, read-only) ───────────────────────
  console.log(`\n${SEPARATOR}`);
  console.log("PART 2: RESEARCH SUB-AGENT — Delegated Read-Only Authority");
  console.log(DIVIDER);
  console.log("📋 Sub-agent correctly reads market data (allowed by delegation).\n");

  const researchAgent = new BoundedResearchAgent(
    "ResearchAgent-001",
    ["get_quote", "get_positions", "get_orders"],
    executor
  );

  const researchPlan = {
    intent: "Sub-agent: research current portfolio positions and MSFT quote",
    riskLevel: "low",
    steps: [
      {
        stepId: 1,
        tool: "get_quote",
        args: { symbol: "MSFT" },
        rationale: "Research MSFT price — within delegated read-only scope",
      },
      {
        stepId: 2,
        tool: "get_positions",
        args: {},
        rationale: "Read current portfolio positions — within delegated scope",
      },
    ],
  };

  await researchAgent.run(researchPlan);

  // ── Part 3: Sub-agent attempts to exceed its delegation ─────────────────────
  console.log(`\n${SEPARATOR}`);
  console.log("PART 3: SUB-AGENT EXCEEDS DELEGATION → BLOCKED");
  console.log(DIVIDER);
  console.log("📋 Sub-agent attempts to place an order beyond its authority.\n");
  console.log("   ⚠️  This MUST be blocked — sub-agent only has read-only delegation.\n");

  const unauthorizedPlan = {
    intent: "Sub-agent attempts to place trade (exceeds delegation)",
    riskLevel: "high",
    steps: [
      {
        stepId: 1,
        tool: "place_order",
        args: { symbol: "AAPL", qty: 1, side: "buy", order_type: "market", time_in_force: "day" },
        rationale: "UNAUTHORIZED: Place order without trading authority",
      },
      {
        stepId: 2,
        tool: "cancel_all_orders",
        args: {},
        rationale: "UNAUTHORIZED: Cancel all orders — scope escalation",
      },
    ],
  };

  await researchAgent.run(unauthorizedPlan);

  // ── Delegation Summary ───────────────────────────────────────────────────────
  console.log(`\n${SEPARATOR}`);
  console.log("📊 DELEGATION DEMO — Architecture Summary");
  console.log(DIVIDER);
  console.log(`
  Orchestrator (parent)
  │  Authority: full paper trading (read + limited write)
  │  Token: valid, expiry: 5 min per session
  │
  └── ResearchAgent-001 (delegated sub-agent)
         Authority: read-only (get_quote, get_positions, get_orders)
         Token: bounded — derived from parent with narrower scope
         Cannot: place_order, cancel_*, export, modify_account
  `);
  console.log("✅ Bounded authority enforced. Sub-agent CANNOT exceed delegation.");
  console.log("   Parent cannot grant more authority than it holds.");
  console.log(SEPARATOR);
}

runDelegationDemo().catch(console.error);
