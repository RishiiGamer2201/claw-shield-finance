// src/fallback-planner.js
// Keyword-based rule planner — no API key needed.
// Used automatically when OpenAI quota is exhausted or key is missing.
// Converts natural language prompts into structured tool plans.
// The enforcement layer (PolicyEngine + ArmorIQ) validates the plan —
// this planner intentionally produces plans for BOTH allowed and blocked actions.

const ALLOWED_TICKERS = ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "META", "JPM", "V", "BRK.B"];
const UNKNOWN_TICKERS = ["GME", "AMC", "BB", "NOK", "DOGE", "SHIB", "PLTR", "RIVN", "LCID", "BBBY"];

function extractTicker(text) {
  const upper = text.toUpperCase();
  for (const t of ALLOWED_TICKERS) { if (upper.includes(t)) return t; }
  for (const t of UNKNOWN_TICKERS) { if (upper.includes(t)) return t; }
  const match = text.match(/\b([A-Z]{1,5})\b/);
  return match ? match[1] : "AAPL";
}

function extractQty(text) {
  const match =
    text.match(/(\d+)\s*share/i) ||
    text.match(/(?:buy|purchase|sell|short)\s+(\d+)/i) ||
    text.match(/(\d+)/);
  return match ? parseInt(match[1]) : 1;
}

function extractDestination(text) {
  const urlMatch = text.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) return urlMatch[0];
  const domainMatch = text.match(/(?:to|at)\s+([\w.-]+\.(?:com|io|net|org|ai))/i);
  if (domainMatch) return `https://${domainMatch[1]}/ingest`;
  if (/external|send|upload|post|push|export to/i.test(text)) return "https://analytics.external-platform.com/ingest";
  return "local";
}

export function createFallbackPlan(prompt) {
  const p = prompt.toLowerCase();

  // ── Scope escalation / privileged operations ─────────────────────────────
  // Detected BEFORE generic buy/sell/export to avoid misclassification.
  // These produce plans with tools that ARE in policy.operations.blockedActions
  // → enforcement layer will block them deterministically.

  if (/cancel all|cancel every|bulk cancel/i.test(p) && /enable.?margin|margin.?trading|margin.?enabled/i.test(p)) {
    return {
      intent: "Attempt scope escalation: cancel all orders and enable margin trading",
      riskLevel: "high",
      steps: [
        { stepId: 1, tool: "cancel_all_orders", args: {}, rationale: "Bulk cancel all open orders" },
        { stepId: 2, tool: "enable_margin", args: { margin_enabled: true }, rationale: "Enable margin trading mode" },
      ],
    };
  }

  if (/cancel all|cancel every|bulk cancel/i.test(p)) {
    return {
      intent: "Attempt to cancel all open orders (scope escalation)",
      riskLevel: "high",
      steps: [
        { stepId: 1, tool: "cancel_all_orders", args: {}, rationale: "Bulk cancel all open orders" },
      ],
    };
  }

  if (/enable.?margin|margin.?trading|margin.?enabled/i.test(p)) {
    return {
      intent: "Attempt to enable margin trading (privilege escalation)",
      riskLevel: "high",
      steps: [
        { stepId: 1, tool: "enable_margin", args: { margin_enabled: true }, rationale: "Enable margin trading mode" },
      ],
    };
  }

  if (/liquidate.?all|close.?all.?position|sell.?everything/i.test(p)) {
    return {
      intent: "Attempt to liquidate all positions (scope escalation)",
      riskLevel: "high",
      steps: [
        { stepId: 1, tool: "liquidate_all", args: {}, rationale: "Liquidate all open positions" },
      ],
    };
  }

  if (/transfer.?fund|wire.?transfer|withdraw/i.test(p)) {
    return {
      intent: "Attempt to transfer funds (blocked in paper trading mode)",
      riskLevel: "high",
      steps: [
        { stepId: 1, tool: "transfer_funds", args: {}, rationale: "Transfer funds out of account" },
      ],
    };
  }

  // ── Export / Exfiltration (check before portfolio/positions) ─────────────
  if (/export|send|upload|exfil|transfer data|share portfolio/i.test(p)) {
    const destination = extractDestination(prompt);
    return {
      intent: `Export portfolio data to ${destination}`,
      riskLevel: "high",
      steps: [
        { stepId: 1, tool: "get_positions", args: {}, rationale: "Fetch positions for export" },
        { stepId: 2, tool: "export_portfolio_data", args: { destination, format: "json" }, rationale: `Export portfolio to ${destination}` },
      ],
    };
  }

  // ── Short sell (check before generic buy/sell) ────────────────────────────
  if (/short|short.?sell|sell.?short/i.test(p)) {
    const symbol = extractTicker(prompt);
    const qty    = extractQty(prompt);
    return {
      intent: `Short sell ${qty} shares of ${symbol}`,
      riskLevel: "high",
      steps: [{ stepId: 1, tool: "place_order", args: { symbol, qty, side: "sell", order_type: "market", time_in_force: "day" }, rationale: "Short sell position" }],
    };
  }

  // ── Buy / Purchase ────────────────────────────────────────────────────────
  if (/buy|purchase|acquire|long/i.test(p)) {
    const symbol = extractTicker(prompt);
    const qty    = extractQty(prompt);
    return {
      intent: `Buy ${qty} shares of ${symbol} at market price`,
      riskLevel: qty > 10 ? "high" : "medium",
      steps: [
        { stepId: 1, tool: "get_quote",   args: { symbol }, rationale: "Check current price before order" },
        { stepId: 2, tool: "place_order", args: { symbol, qty, side: "buy", order_type: "market", time_in_force: "day" }, rationale: `Execute market buy of ${qty} shares ${symbol}` },
      ],
    };
  }

  // ── Price / Quote ─────────────────────────────────────────────────────────
  if (/price|quote|worth|trading at|cost|how much|current.*stock/i.test(p)) {
    const symbol = extractTicker(prompt);
    return {
      intent: `Fetch current market quote for ${symbol}`,
      riskLevel: "low",
      steps: [{ stepId: 1, tool: "get_quote", args: { symbol }, rationale: "Retrieve latest bid/ask price" }],
    };
  }

  // ── Portfolio / Positions ─────────────────────────────────────────────────
  if (/position|portfolio|holding|what do i own|my stock/i.test(p)) {
    return {
      intent: "Show current portfolio positions",
      riskLevel: "low",
      steps: [{ stepId: 1, tool: "get_positions", args: {}, rationale: "Fetch open positions" }],
    };
  }

  // ── Account / Balance ─────────────────────────────────────────────────────
  if (/account|balance|buying power|cash|funds/i.test(p)) {
    return {
      intent: "Retrieve account balance and buying power",
      riskLevel: "low",
      steps: [{ stepId: 1, tool: "get_account", args: {}, rationale: "Fetch account details" }],
    };
  }

  // ── Order History ─────────────────────────────────────────────────────────
  if (/order history|trade history|recent trades|past order/i.test(p)) {
    return {
      intent: "Retrieve recent order history",
      riskLevel: "low",
      steps: [{ stepId: 1, tool: "get_orders", args: { status: "all", limit: 10 }, rationale: "List recent orders" }],
    };
  }

  // ── Default ───────────────────────────────────────────────────────────────
  return {
    intent: "Check account status",
    riskLevel: "low",
    steps: [{ stepId: 1, tool: "get_account", args: {}, rationale: "Default: fetch account info" }],
  };
}