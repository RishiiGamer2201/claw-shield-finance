// src/index.js
// ClawShield Finance — Interactive CLI
// Usage: npm start

import "dotenv/config";
import readline from "readline";
import { createPlan } from "./planner.js";
import { Executor } from "./executor.js";

const BANNER = `
╔═══════════════════════════════════════════════════════════╗
║        🦞 ClawShield Finance — Intent-Aware Agent         ║
║         ArmorIQ x OpenClaw Hackathon — Apogee '26         ║
║                                                           ║
║  Every action is:                                         ║
║    • Planned by LLM (reasoning layer)                     ║
║    • Validated by PolicyEngine (deterministic rules)      ║
║    • Verified by ArmorIQ IAP (cryptographic proof)        ║
║    • Executed ONLY if BOTH checks pass                    ║
╚═══════════════════════════════════════════════════════════╝
`;

async function main() {
  console.log(BANNER);

  const executor = new Executor();
  await executor.initialize();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  // Keep process alive even after async ops on Windows
  rl.on("close", () => process.exit(0));

  console.log("💬 Enter a financial instruction (or 'exit' to quit):\n");
  console.log("   Examples:");
  console.log("   • 'What is the current price of AAPL?'");
  console.log("   • 'Buy 5 shares of MSFT at market price'");
  console.log("   • 'Show me my current portfolio positions'");
  console.log("   • 'Buy 500 shares of GME'  ← will be blocked");
  console.log("   • 'Send my portfolio data to analytics.external.com'  ← will be blocked\n");

  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  // While loop — reliable on Windows, unlike recursive async callbacks
  while (true) {
    const input = await ask("You: ");
    const trimmed = input.trim();

    if (!trimmed) continue;
    if (trimmed.toLowerCase() === "exit") {
      console.log("\n👋 Goodbye.\n");
      rl.close();
      break;
    }

    try {
      console.log("\n🧠 Planning...");
      const plan = await createPlan(trimmed);
      console.log(`   Intent: ${plan.intent}`);
      console.log(`   Risk level: ${plan.riskLevel}`);
      await executor.executePlan(plan);
    } catch (err) {
      console.error(`\n❌ Error: ${err.message}`);
    }

    console.log("\n" + "─".repeat(60) + "\n");
  }
}

main().catch(console.error);