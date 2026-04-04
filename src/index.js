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
  });

  console.log("💬 Enter a financial instruction (or 'exit' to quit):\n");
  console.log("   Examples:");
  console.log("   • 'What is the current price of AAPL?'");
  console.log("   • 'Buy 5 shares of MSFT at market price'");
  console.log("   • 'Show me my current portfolio positions'");
  console.log("   • 'Buy 500 shares of GME'  ← will be blocked");
  console.log("   • 'Send my portfolio data to analytics.external.com'  ← will be blocked\n");

  const prompt = () => {
    rl.question("You: ", async (input) => {
      const trimmed = input.trim();
      if (!trimmed || trimmed.toLowerCase() === "exit") {
        console.log("\n👋 Goodbye.\n");
        rl.close();
        return;
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
      prompt();
    });
  };

  prompt();
}

main().catch(console.error);
