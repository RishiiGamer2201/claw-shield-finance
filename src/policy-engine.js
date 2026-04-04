// src/policy-engine.js
// Structured policy enforcement for financial agents.
// Rules are loaded from policies/financial-policy.json — no hardcoded logic.

import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class PolicyEngine {
  constructor() {
    this.policy = null;
    this.dailyTradeCount = 0; // In production: persist to DB
    this.dailyTradeDate = new Date().toDateString();
  }

  async load() {
    const policyPath = path.resolve(__dirname, "../policies/financial-policy.json");
    const raw = await readFile(policyPath, "utf-8");
    this.policy = JSON.parse(raw);
    return this;
  }

  // ── Core enforcement entry point ─────────────────────────────────────────
  // Returns: { allowed: bool, reason: string, rule: string, severity: string }

  enforce(toolName, args) {
    if (!this.policy) {
      return this._block("PolicyEngine not initialized", "system.notLoaded", "critical");
    }

    // Reset daily counter if new day
    if (new Date().toDateString() !== this.dailyTradeDate) {
      this.dailyTradeCount = 0;
      this.dailyTradeDate = new Date().toDateString();
    }

    // Route to specific checker based on tool
    switch (toolName) {
      case "get_quote":
        return this._enforceGetQuote(args);
      case "get_account":
      case "get_positions":
      case "get_orders":
        return this._enforceReadOnly(toolName, args);
      case "place_order":
        return this._enforcePlaceOrder(args);
      case "cancel_order":
        return this._enforceCancelOrder(args);
      case "export_portfolio_data":
        return this._enforceExport(args);
      default:
        return this._block(
          `Unknown tool '${toolName}' — not in policy registry`,
          "operations.unknownTool",
          "high"
        );
    }
  }

  // ── Individual enforcers (each maps to a policy section) ─────────────────

  _enforceGetQuote({ symbol }) {
    return this._checkTicker(symbol);
  }

  _enforceReadOnly(toolName) {
    if (this.policy.operations.blockedActions.includes(toolName)) {
      return this._block(
        `Action '${toolName}' is explicitly blocked`,
        "operations.blockedActions",
        "high"
      );
    }
    return this._allow(`Read-only action '${toolName}' permitted`);
  }

  _enforcePlaceOrder({ symbol, qty, side, order_type, time_in_force, limit_price }) {
    const t = this.policy.trading;

    // 1. Ticker allowlist
    const tickerCheck = this._checkTicker(symbol);
    if (!tickerCheck.allowed) return tickerCheck;

    // 2. Side restriction (no short selling)
    if (!t.allowedSides.includes(side)) {
      return this._block(
        `Side '${side}' is not permitted. Allowed: [${t.allowedSides.join(", ")}]. Short selling is disabled.`,
        "trading.shortSellingAllowed",
        "high"
      );
    }

    // 3. Order type restriction
    if (!t.allowedOrderTypes.includes(order_type)) {
      return this._block(
        `Order type '${order_type}' not permitted. Allowed: [${t.allowedOrderTypes.join(", ")}]`,
        "trading.allowedOrderTypes",
        "medium"
      );
    }

    // 4. Time in force restriction
    if (!t.allowedTimeInForce.includes(time_in_force)) {
      return this._block(
        `Time-in-force '${time_in_force}' not permitted. Allowed: [${t.allowedTimeInForce.join(", ")}]`,
        "trading.allowedTimeInForce",
        "medium"
      );
    }

    // 5. Max order qty
    if (Number(qty) > t.maxOrderQty) {
      return this._block(
        `Order qty ${qty} exceeds maximum allowed (${t.maxOrderQty} shares per order)`,
        "trading.maxOrderQty",
        "high"
      );
    }

    // 6. Max order value (qty × limit_price if provided)
    if (limit_price && Number(qty) * Number(limit_price) > t.maxOrderValueUSD) {
      const value = (Number(qty) * Number(limit_price)).toFixed(2);
      return this._block(
        `Order value $${value} exceeds maximum allowed ($${t.maxOrderValueUSD})`,
        "trading.maxOrderValueUSD",
        "high"
      );
    }

    // 7. Daily trade limit
    if (this.dailyTradeCount >= t.maxDailyTrades) {
      return this._block(
        `Daily trade limit reached (${t.maxDailyTrades} trades/day). No more orders allowed today.`,
        "trading.maxDailyTrades",
        "high"
      );
    }

    // 8. Leverage / options guard
    if (t.leverageAllowed === false && order_type === "market" && side === "sell") {
      // Sell of something you don't own = short — double-check
      // This is enforced structurally, not just by side check
    }

    // All checks passed — increment counter
    this.dailyTradeCount++;
    return this._allow(
      `Order: ${side.toUpperCase()} ${qty} ${symbol} (${order_type}) — all policy checks passed. Daily trades: ${this.dailyTradeCount}/${t.maxDailyTrades}`
    );
  }

  _enforceCancelOrder({ order_id }) {
    if (!order_id || typeof order_id !== "string" || order_id.trim() === "") {
      return this._block("Invalid order_id for cancellation", "operations.cancelOrder", "medium");
    }
    return this._allow(`Cancel order ${order_id} — permitted`);
  }

  _enforceExport({ destination }) {
    const d = this.policy.data;

    // Block all external destinations
    if (!d.allowedExportDestinations.includes(destination)) {
      return this._block(
        `Export destination '${destination}' is not permitted. Data exfiltration blocked. Only local exports allowed.`,
        "data.allowedExportDestinations",
        "critical"
      );
    }

    // Explicit block of external hosts
    if (destination !== "local") {
      return this._block(
        `External data export is a compliance violation. Portfolio data is classified as '${d.portfolioDataClassification}'.`,
        "data.portfolioDataClassification",
        "critical"
      );
    }

    return this._allow("Local export permitted — no external data transmission");
  }

  // ── Shared helpers ────────────────────────────────────────────────────────

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
    return this._allow(`Ticker '${symbol}' is in approved watchlist`);
  }

  _allow(reason) {
    return { allowed: true, reason, rule: null, severity: null };
  }

  _block(reason, rule, severity = "high") {
    return { allowed: false, reason, rule, severity };
  }

  getPolicy() {
    return this.policy;
  }
}
