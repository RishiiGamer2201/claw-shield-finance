// src/tools/financial-tools.js
// Alpaca Paper Trading API integration
// All calls go to paper-api.alpaca.markets — NO real money ever transacted

import fetch from "node-fetch";

const ALPACA_BASE = "https://paper-api.alpaca.markets";
const DATA_BASE = "https://data.alpaca.markets";

function alpacaHeaders() {
  return {
    "APCA-API-KEY-ID": process.env.ALPACA_API_KEY,
    "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY,
    "Content-Type": "application/json",
  };
}

// ─── Tool Registry ───────────────────────────────────────────────────────────
// Each tool has: name, description, args schema, and an execute() function.
// The PolicyEngine receives (toolName, args) before execute() is ever called.

export const TOOLS = {
  // ── READ-ONLY ──────────────────────────────────────────────────────────────

  get_quote: {
    name: "get_quote",
    description: "Fetch the latest bid/ask quote for a stock symbol",
    args: { symbol: "string" },
    async execute({ symbol }) {
      const url = `${DATA_BASE}/v2/stocks/${symbol}/quotes/latest`;
      const res = await fetch(url, { headers: alpacaHeaders() });
      if (!res.ok) throw new Error(`Alpaca quote error: ${res.status} ${await res.text()}`);
      const data = await res.json();
      const q = data.quote;
      return {
        symbol,
        askPrice: q.ap,
        bidPrice: q.bp,
        askSize: q.as,
        bidSize: q.bs,
        timestamp: q.t,
      };
    },
  },

  get_account: {
    name: "get_account",
    description: "Retrieve account balance, buying power, and portfolio value",
    args: {},
    async execute() {
      const res = await fetch(`${ALPACA_BASE}/v2/account`, { headers: alpacaHeaders() });
      if (!res.ok) throw new Error(`Alpaca account error: ${res.status}`);
      const d = await res.json();
      return {
        buyingPower: d.buying_power,
        cash: d.cash,
        portfolioValue: d.portfolio_value,
        currency: d.currency,
        status: d.status,
        tradingBlocked: d.trading_blocked,
      };
    },
  },

  get_positions: {
    name: "get_positions",
    description: "List all current open positions in the portfolio",
    args: {},
    async execute() {
      const res = await fetch(`${ALPACA_BASE}/v2/positions`, { headers: alpacaHeaders() });
      if (!res.ok) throw new Error(`Alpaca positions error: ${res.status}`);
      const positions = await res.json();
      return positions.map((p) => ({
        symbol: p.symbol,
        qty: p.qty,
        side: p.side,
        marketValue: p.market_value,
        avgEntryPrice: p.avg_entry_price,
        unrealizedPL: p.unrealized_pl,
        unrealizedPLPct: p.unrealized_plpc,
      }));
    },
  },

  get_orders: {
    name: "get_orders",
    description: "List recent orders (filled, pending, cancelled)",
    args: { status: "string", limit: "number" },
    async execute({ status = "all", limit = 10 }) {
      const url = `${ALPACA_BASE}/v2/orders?status=${status}&limit=${limit}`;
      const res = await fetch(url, { headers: alpacaHeaders() });
      if (!res.ok) throw new Error(`Alpaca orders error: ${res.status}`);
      const orders = await res.json();
      return orders.map((o) => ({
        id: o.id,
        symbol: o.symbol,
        qty: o.qty,
        side: o.side,
        type: o.type,
        status: o.status,
        filledAt: o.filled_at,
        filledAvgPrice: o.filled_avg_price,
      }));
    },
  },

  // ── WRITE / EXECUTION ──────────────────────────────────────────────────────

  place_order: {
    name: "place_order",
    description: "Place a buy or sell order on the paper trading account",
    args: {
      symbol: "string",
      qty: "number",
      side: "string",        // "buy" | "sell"
      order_type: "string",  // "market" | "limit"
      time_in_force: "string", // "day" | "gtc"
      limit_price: "number", // optional, required for limit orders
    },
    async execute({ symbol, qty, side, order_type = "market", time_in_force = "day", limit_price }) {
      const body = {
        symbol,
        qty: String(qty),
        side,
        type: order_type,
        time_in_force,
      };
      if (order_type === "limit" && limit_price) body.limit_price = String(limit_price);

      const res = await fetch(`${ALPACA_BASE}/v2/orders`, {
        method: "POST",
        headers: alpacaHeaders(),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Alpaca order error: ${res.status} ${await res.text()}`);
      const order = await res.json();
      return {
        orderId: order.id,
        symbol: order.symbol,
        qty: order.qty,
        side: order.side,
        type: order.type,
        status: order.status,
        submittedAt: order.submitted_at,
      };
    },
  },

  cancel_order: {
    name: "cancel_order",
    description: "Cancel a pending order by order ID",
    args: { order_id: "string" },
    async execute({ order_id }) {
      const res = await fetch(`${ALPACA_BASE}/v2/orders/${order_id}`, {
        method: "DELETE",
        headers: alpacaHeaders(),
      });
      if (res.status === 204) return { cancelled: true, orderId: order_id };
      if (!res.ok) throw new Error(`Alpaca cancel error: ${res.status}`);
      return { cancelled: true, orderId: order_id };
    },
  },

  // ── SENSITIVE / EXFILTRATION RISK ─────────────────────────────────────────

  export_portfolio_data: {
    name: "export_portfolio_data",
    description: "Export portfolio snapshot — LOCAL only. External destinations are blocked.",
    args: { destination: "string", format: "string" },
    async execute({ destination, format = "json" }) {
      // PolicyEngine will block external destinations before this runs.
      // This function only handles "local" writes.
      const positions = await TOOLS.get_positions.execute({});
      const account = await TOOLS.get_account.execute({});
      const snapshot = { exportedAt: new Date().toISOString(), account, positions };

      if (destination === "local") {
        const fs = await import("fs/promises");
        const filename = `./logs/portfolio-export-${Date.now()}.${format}`;
        await fs.writeFile(filename, JSON.stringify(snapshot, null, 2));
        return { success: true, file: filename, recordCount: positions.length };
      }

      // Should never reach here — PolicyEngine blocks external destinations first
      throw new Error("POLICY_VIOLATION: External export not permitted");
    },
  },
};

export function getToolNames() {
  return Object.keys(TOOLS);
}

export async function executeTool(toolName, args) {
  const tool = TOOLS[toolName];
  if (!tool) throw new Error(`Unknown tool: ${toolName}`);
  return await tool.execute(args);
}
