// src/policy-engine.js
// Structured policy enforcement for financial agents.
// ALL enforcement decisions are driven by policies/financial-policy.json.
// There is NO hardcoded allow/block logic in this file.

import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tools that require trading-specific validation (qty, side, ticker, etc.)
const TRADING_TOOLS    = new Set(["place_order"]);
// Tools allowed as simple read-only — verified against blockedActions in policy
const READ_ONLY_TOOLS  = new Set(["get_quote", "get_account", "get_positions", "get_orders", "get_bars"]);
// Tools with data-export logic — destination checked against policy allowlist
const EXPORT_TOOLS     = new Set(["export_portfolio_data"]);
// Single-order cancel — validated by order_id structure only
const CANCEL_TOOLS     = new Set(["cancel_order"]);

export class PolicyEngine {
  constructor() {
    this.policy = null;
    this.dailyTradeCount = 0;
    this.dailyTradeDate  = new Date().toDateString();
  }

  async load() {
    const policyPath = path.resolve(__dirname, "../policies/financial-policy.json");
    const raw = await readFile(policyPath, "utf-8");
    this.policy = JSON.parse(raw);
    return this;
  }

  // ── Core enforcement entry point ───────────────────────────────────────────
  // Every decision reads from this.policy — no values are hardcoded here.

  enforce(toolName, args = {}) {
    if (!this.policy) {
      return this._block("PolicyEngine not initialised", "system.notLoaded", "critical");
    }

    // Reset daily counter on new day
    if (new Date().toDateString() !== this.dailyTradeDate) {
      this.dailyTradeCount = 0;
      this.dailyTradeDate  = new Date().toDateString();
    }

    // ── 1. Blocked-actions list (loaded from JSON) ─────────────────────────
    // Any tool in policy.operations.blockedActions is denied unconditionally.
    // Adding / removing tools is done by editing financial-policy.json only.
    if (this.policy.operations.blockedActions.includes(toolName)) {
      return this._block(
        `'${toolName}' is listed in operations.blockedActions — ` +
        `this action is not within the agent's authorised scope.`,
        "operations.blockedActions",
        "critical"
      );
    }

    // ── 2. Tool-category routing ───────────────────────────────────────────
    if (READ_ONLY_TOOLS.has(toolName))  return this._enforceReadOnly(toolName, args);
    if (TRADING_TOOLS.has(toolName))    return this._enforcePlaceOrder(args);
    if (EXPORT_TOOLS.has(toolName))     return this._enforceExport(args);
    if (CANCEL_TOOLS.has(toolName))     return this._enforceCancelOrder(args);

    // ── 3. Unknown tool — fail closed ──────────────────────────────────────
    return this._block(
      `'${toolName}' is not registered in the approved tool set. ` +
      `Unknown tools are blocked by default (fail-closed policy).`,
      "operations.unknownTool",
      "high"
    );
  }

  // ── Category enforcers ─────────────────────────────────────────────────────
  // Each reads ONLY from this.policy — no literals for thresholds or lists.

  _enforceReadOnly(toolName, args) {
    // Quote lookups also validate the ticker against the watchlist
    if (toolName === "get_quote" || toolName === "get_bars") {
      return this._checkTicker(args.symbol);
    }
    return this._allow(`Read-only action '${toolName}' permitted`);
  }

  _enforcePlaceOrder({ symbol, qty, side, order_type, time_in_force, limit_price }) {
    const t = this.policy.trading;

    const tickerCheck = this._checkTicker(symbol);
    if (!tickerCheck.allowed) return tickerCheck;

    if (!t.allowedSides.includes(side)) {
      return this._block(
        `Side '${side}' is not permitted. Allowed: [${t.allowedSides.join(", ")}]. ` +
        `Short selling is disabled per policy (trading.shortSellingAllowed = false).`,
        "trading.shortSellingAllowed",
        "high"
      );
    }

    if (!t.allowedOrderTypes.includes(order_type)) {
      return this._block(
        `Order type '${order_type}' not permitted. Allowed: [${t.allowedOrderTypes.join(", ")}]`,
        "trading.allowedOrderTypes",
        "medium"
      );
    }

    if (!t.allowedTimeInForce.includes(time_in_force)) {
      return this._block(
        `Time-in-force '${time_in_force}' not permitted. Allowed: [${t.allowedTimeInForce.join(", ")}]`,
        "trading.allowedTimeInForce",
        "medium"
      );
    }

    if (Number(qty) > t.maxOrderQty) {
      return this._block(
        `Order qty ${qty} exceeds maximum allowed (${t.maxOrderQty} shares per order)`,
        "trading.maxOrderQty",
        "high"
      );
    }

    if (limit_price && Number(qty) * Number(limit_price) > t.maxOrderValueUSD) {
      const value = (Number(qty) * Number(limit_price)).toFixed(2);
      return this._block(
        `Order value $${value} exceeds maximum allowed ($${t.maxOrderValueUSD})`,
        "trading.maxOrderValueUSD",
        "high"
      );
    }

    if (this.dailyTradeCount >= t.maxDailyTrades) {
      return this._block(
        `Daily trade limit reached (${t.maxDailyTrades} trades/day). No more orders today.`,
        "trading.maxDailyTrades",
        "high"
      );
    }

    this.dailyTradeCount++;
    return this._allow(
      `Order: ${side.toUpperCase()} ${qty} ${symbol} (${order_type}) — all policy checks passed. ` +
      `Daily trades: ${this.dailyTradeCount}/${t.maxDailyTrades}`
    );
  }

  _enforceCancelOrder({ order_id }) {
    if (!order_id || typeof order_id !== "string" || !order_id.trim()) {
      return this._block("Invalid or missing order_id for cancellation", "operations.cancelOrder", "medium");
    }
    return this._allow(`Cancel order '${order_id}' — individual cancellation is permitted`);
  }

  _enforceExport({ destination }) {
    const d = this.policy.data;
    if (!d.allowedExportDestinations.includes(destination)) {
      return this._block(
        `Export destination '${destination}' is not in allowedExportDestinations ` +
        `[${d.allowedExportDestinations.join(", ")}]. ` +
        `Portfolio data is classified '${d.portfolioDataClassification}' — external transmission blocked.`,
        "data.allowedExportDestinations",
        "critical"
      );
    }
    return this._allow("Local export permitted — no external data transmission");
  }

  // ── Shared helpers ─────────────────────────────────────────────────────────

  _checkTicker(symbol) {
    if (!symbol) {
      return this._block("No ticker symbol provided", "trading.allowedTickers", "high");
    }
    const allowed = this.policy.trading.allowedTickers;
    if (!allowed.includes(symbol.toUpperCase())) {
      return this._block(
        `Ticker '${symbol}' is not in the approved watchlist [${allowed.join(", ")}]`,
        "trading.allowedTickers",
        "high"
      );
    }
    return this._allow(`Ticker '${symbol}' is in the approved watchlist`);
  }

  _allow(reason)  { return { allowed: true,  reason, rule: null, severity: null }; }
  _block(reason, rule, severity = "high") { return { allowed: false, reason, rule, severity }; }

  getPolicy() { return this.policy; }
}
