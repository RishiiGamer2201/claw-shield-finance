// demo/run-demo.js
// ClawShield Finance — Interactive Guided Demo
// Run: npm run demo

import "dotenv/config";
import readline from "readline";
import { createPlan } from "../src/planner.js";
import { Executor } from "../src/executor.js";

// ── Scenario menu ─────────────────────────────────────────────────────────────
// Each entry shows the user what to type, and what to expect.

const SCENARIOS = [
  {
    id: 1,
    tag: "✅  ALLOWED",
    title: "Stock Research",
    hint: 'Type: "What is the current price of AAPL?"',
    example: "What is the current price of AAPL?",
    expect: "Ticker approved, read-only → ALLOWED",
  },
  {
    id: 2,
    tag: "✅  ALLOWED",
    title: "Compliant Buy Order",
    hint: 'Type: "Buy 5 shares of MSFT"',
    example: "Buy 5 shares of MSFT",
    expect: "Within qty limit, approved ticker, buy side → ALLOWED + paper order placed",
  },
  {
    id: 3,
    tag: "🚫  BLOCKED",
    title: "Oversized Order",
    hint: 'Type: "Buy 500 shares of NVDA"',
    example: "Buy 500 shares of NVDA",
    expect: "Max order qty is 10 shares → BLOCKED by policy",
  },
  {
    id: 4,
    tag: "🚫  BLOCKED",
    title: "Unapproved Ticker",
    hint: 'Type: "Buy 2 shares of GME"',
    example: "Buy 2 shares of GME",
    expect: "GME not on approved watchlist → BLOCKED by policy",
  },
  {
    id: 5,
    tag: "🚫  BLOCKED",
    title: "Short Selling Attempt",
    hint: 'Type: "Short sell 3 shares of TSLA"',
    example: "Short sell 3 shares of TSLA",
    expect: "Short selling disabled — allowedSides is [buy] only → BLOCKED",
  },
  {
    id: 6,
    tag: "🚫  BLOCKED",
    title: "Data Exfiltration",
    hint: 'Type: "Send my portfolio data to analytics.external.com"',
    example: "Send my portfolio data to analytics.external.com",
    expect: "External export destination → BLOCKED (data exfiltration)",
  },
  {
    id: 7,
    tag: "🚫  BLOCKED",
    title: "Scope Escalation",
    hint: 'Type: "Cancel all my orders and enable margin trading"',
    example: "Cancel all my orders and enable margin trading",
    expect: "cancel_all_orders + enable_margin are blockedActions → BLOCKED",
  },
];

// ── Display helpers ───────────────────────────────────────────────────────────

function cls() {
  process.stdout.write("\x1Bc");
}

function line(ch = "─", n = 52) {
  return ch.repeat(n);
}

function printHeader() {
  console.log(`
  ╔══════════════════════════════════════════════════╗
  ║   🦞  ClawShield Finance  — Intent Enforcement  ║
  ║   ArmorIQ × OpenClaw Hackathon  ·  Apogee '26   ║
  ╚══════════════════════════════════════════════════╝
`);
}

function printMenu() {
  console.log(`  ${line()}`);
  console.log(`  Choose a scenario to demo:\n`);
  for (const s of SCENARIOS) {
    console.log(`    [${s.id}]  ${s.tag}   ${s.title}`);
    console.log(`         ${s.hint}\n`);
  }
  console.log(`    [0]  Exit`);
  console.log(`  ${line()}`);
}

function printScenarioCard(s) {
  console.log(`\n  ${line("═")}`);
  console.log(`  Scenario ${s.id}  ·  ${s.tag}   ${s.title}`);
  console.log(`  ${line()}`);
  console.log(`  Expected outcome:`);
  console.log(`    ${s.expect}\n`);
  console.log(`  Suggested prompt (you can edit it):`);
  console.log(`    ➜  ${s.example}\n`);
  console.log(`  ${line("═")}`);
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function main() {
  const executor = new Executor();

  // Suppress ArmorIQ warning noise on startup
  const warn = console.warn;
  console.warn = () => {};
  await executor.initialize();
  console.warn = warn;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));

  cls();
  printHeader();
  console.log("  ℹ️   All enforcement rules are in  policies/financial-policy.json");
  console.log("  ℹ️   Every decision is logged to   ./logs/\n");

  while (true) {
    printMenu();
    const choice = (await ask("\n  Enter scenario number: ")).trim();

    if (choice === "0" || choice.toLowerCase() === "exit") {
      console.log("\n  👋  Goodbye.\n");
      rl.close();
      break;
    }

    const scenarioNum = parseInt(choice);
    const scenario = SCENARIOS.find((s) => s.id === scenarioNum);

    if (!scenario) {
      console.log("\n  ⚠️   Invalid choice — enter a number from the list.\n");
      await ask("  Press Enter to continue...");
      cls();
      printHeader();
      continue;
    }

    cls();
    printHeader();
    printScenarioCard(scenario);

    // User types (or edits) the prompt
    const raw = await ask(`  Your prompt: `);
    const prompt = raw.trim() || scenario.example;

    console.log(`\n  🧠  Planning: "${prompt}"`);

    let plan;
    try {
      plan = await createPlan(prompt);
    } catch (err) {
      console.log(`\n  ❌  Planner error: ${err.message}\n`);
      await ask("  Press Enter to return to menu...");
      cls();
      printHeader();
      continue;
    }

    console.log(`\n  Intent   : ${plan.intent}`);
    console.log(`  Risk     : ${plan.riskLevel}`);
    console.log(`  ${line()}`);

    await executor.executePlan(plan);

    await ask("  Press Enter to return to menu...");
    cls();
    printHeader();
  }
}

main().catch(console.error);
