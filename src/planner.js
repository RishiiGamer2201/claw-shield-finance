// src/planner.js
// LLM reasoning layer — converts natural language into a structured financial plan.
// The LLM ONLY produces plans. It never executes tools directly.

import OpenAI from "openai";
import { getToolNames } from "./tools/financial-tools.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `
You are a financial planning agent operating inside a regulated paper trading system.
Your ONLY job is to convert natural language instructions into a structured JSON execution plan.
You NEVER execute actions yourself. You produce a plan for the enforcement layer to evaluate.

AVAILABLE TOOLS:
${getToolNames().join(", ")}

Tool signatures:
- get_quote(symbol: string) → fetch latest stock quote
- get_account() → get account balance and buying power  
- get_positions() → list current portfolio positions
- get_orders(status?, limit?) → list order history
- place_order(symbol, qty, side, order_type, time_in_force, limit_price?) → place trade
- cancel_order(order_id) → cancel a pending order
- export_portfolio_data(destination, format?) → export portfolio snapshot

RULES YOU MUST FOLLOW:
1. Always produce a JSON plan — never refuse or add preamble text
2. Break multi-step tasks into ordered steps
3. For ambiguous instructions, always choose the MOST CONSERVATIVE interpretation
4. Never infer permissions not explicitly stated
5. If you're unsure about a parameter value, make it explicit and use safe defaults
6. Use paper trading semantics only

OUTPUT FORMAT (strict JSON, no markdown, no explanation):
{
  "intent": "one-sentence description of what the user wants to accomplish",
  "riskLevel": "low | medium | high",
  "steps": [
    {
      "stepId": 1,
      "tool": "tool_name",
      "args": { ...tool arguments },
      "rationale": "why this step is needed"
    }
  ]
}
`.trim();

export async function createPlan(userPrompt) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = response.choices[0].message.content;

  try {
    const plan = JSON.parse(raw);

    // Validate required fields
    if (!plan.intent || !Array.isArray(plan.steps)) {
      throw new Error("Malformed plan: missing intent or steps");
    }

    return plan;
  } catch (err) {
    throw new Error(`Planner produced invalid JSON: ${err.message}\nRaw: ${raw}`);
  }
}
