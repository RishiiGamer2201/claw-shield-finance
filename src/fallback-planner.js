// src/fallback-planner.js
// Keyword-based planner — no API key needed.
// Used automatically when OpenAI quota is exhausted or key is missing.

const ALLOWED_TICKERS = ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "META", "JPM", "V", "BRK.B"];

function extractTicker(text) {
  const upper = text.toUpperCase();
  // Check known tickers first
  for (const t of ALLOWED_TICKERS) {
    if (upper.includes(t)) return t;
  }
  // Check unknown tickers (will be blocked by policy — good for demo)
  const unknown = ["GME", "AMC", "BB", "NOK", "DOGE", "SHIB", "PLTR", "RIVN", "LCID"];
  for (const t of unknown) {
    if (upper.includes(t)) return t;
  }
  // Try to extract a 1-5 letter uppercase word that looks like a ticker
  const match = text.match(/\b([A-Z]{1,5})\b/);
  return match ? match[1] : "AAPL";
}

function extractQty(text) {
  const match = text.match(/(\d+)\s*share/i) || text.match(/buy\s+(\d+)/i) || text.match(/(\d+)/);
  return match ? parseInt(match[1]) : 1;
}

function extractDestination(text) {
  const urlMatch = text.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) return urlMatch[0];
  if (/external|send|upload|post|push|export to/i.test(text)) return "https://analytics.external-platform.com/ingest";
  return "local";
}

export function createFallbackPlan(prompt) {
  const p = prompt.toLowerCase();

  // ── Export / Send (MUST check before portfolio/positions) ─────────────────
  // "Send my portfolio data to..." would match portfolio keyword otherwise
  if (/export|send|upload|exfil|transfer data|share portfolio/i.test(p)) {
    const destination = extractDestination(prompt);
    return {
      intent: `Export portfolio data to ${destination}`,
      riskLevel: "high",
      steps: [
        { stepId: 1, tool: "get_positions", args: {}, rationale: "Fetch positions for export" },
        {
          stepId: 2, tool: "export_portfolio_data",
          args: { destination, format: "json" },
          rationale: `Export portfolio snapshot to ${destination}`,
        },
      ],
    };
  }

  // ── Short sell (MUST check before generic buy/sell) ───────────────────────
  if (/short|short sell|sell short/i.test(p)) {
    const symbol = extractTicker(prompt);
    const qty = extractQty(prompt);
    return {
      intent: `Short sell ${qty} shares of ${symbol}`,
      riskLevel: "high",
      steps: [{
        stepId: 1, tool: "place_order",
        args: { symbol, qty, side: "sell", order_type: "market", time_in_force: "day" },
        rationale: "Short sell position",
      }],
    };
  }

  // ── Buy (MUST check before price/quote — "buy 5 at market price" has "price") ──
  if (/buy|purchase|acquire|long/i.test(p)) {
    const symbol = extractTicker(prompt);
    const qty = extractQty(prompt);
    return {
      intent: `Buy ${qty} shares of ${symbol} at market price`,
      riskLevel: qty > 10 ? "high" : "medium",
      steps: [
        { stepId: 1, tool: "get_quote", args: { symbol }, rationale: "Check price before order" },
        {
          stepId: 2, tool: "place_order",
          args: { symbol, qty, side: "buy", order_type: "market", time_in_force: "day" },
          rationale: `Execute market buy of ${qty} shares ${symbol}`,
        },
      ],
    };
  }

  // ── Price / Quote ─────────────────────────────────────────────────────────
  if (/price|quote|worth|trading at|cost|how much/i.test(p)) {
    const symbol = extractTicker(prompt);
    return {
      intent: `Fetch current market quote for ${symbol}`,
      riskLevel: "low",
      steps: [{ stepId: 1, tool: "get_quote", args: { symbol }, rationale: "Retrieve latest price" }],
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

  // ── Fallback ──────────────────────────────────────────────────────────────
  return {
    intent: "Check account status",
    riskLevel: "low",
    steps: [{ stepId: 1, tool: "get_account", args: {}, rationale: "Default: fetch account info" }],
  };
}