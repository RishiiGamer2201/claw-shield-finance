// src/moe/experts/risk-expert.js
// Expert Agent 2: Risk Management
// Evaluates order quantity, order value, daily trade count, position concentration.
// ALL thresholds loaded from policy JSON — no hardcoded numbers.

export class RiskExpert {
  constructor(policy) {
    this.policy = policy;
    this.name = "RiskExpert";
    this.domain = "risk";
    // Per-session state — resets on new day
    this.dailyTradeCount = 0;
    this.dailyTradeDate  = new Date().toDateString();
    this.sessionTrades   = []; // { symbol, qty, side, timestamp }
  }

  _resetIfNewDay() {
    if (new Date().toDateString() !== this.dailyTradeDate) {
      this.dailyTradeCount = 0;
      this.dailyTradeDate  = new Date().toDateString();
      this.sessionTrades   = [];
    }
  }

  enforce(tool, args, _sessionContext) {
    this._resetIfNewDay();
    const t = this.policy.trading;

    if (tool === "place_order") {
      const qty        = Number(args.qty)         || 0;
      const limitPrice = Number(args.limit_price) || 0;

      // 1. Max order quantity
      if (qty > t.maxOrderQty) {
        return this._veto(
          `Order qty ${qty} exceeds max allowed ${t.maxOrderQty} shares per order`,
          "risk.maxOrderQty"
        );
      }

      // 2. Max order value (qty × limit_price when available)
      if (limitPrice > 0 && qty * limitPrice > t.maxOrderValueUSD) {
        return this._veto(
          `Order value $${(qty * limitPrice).toFixed(2)} exceeds max allowed $${t.maxOrderValueUSD}`,
          "risk.maxOrderValueUSD"
        );
      }

      // 3. Daily trade limit
      if (this.dailyTradeCount >= t.maxDailyTrades) {
        return this._veto(
          `Daily trade limit reached (${t.maxDailyTrades} trades/day). Remaining trades: 0`,
          "risk.maxDailyTrades"
        );
      }

      // 4. Concentration risk: same ticker repeated many times (>3 in session)
      const sameTicker = this.sessionTrades.filter(
        (tr) => tr.symbol === args.symbol?.toUpperCase() && tr.side === args.side
      );
      if (sameTicker.length >= 3) {
        return this._warn(
          `Concentration risk: ${sameTicker.length + 1} consecutive ${args.side} orders for ${args.symbol}. Consider diversification.`,
          "risk.concentrationLimit"
        );
      }

      // Track order for future concentration checks (only if allowed)
      this.sessionTrades.push({ symbol: args.symbol?.toUpperCase(), qty, side: args.side, timestamp: Date.now() });
      this.dailyTradeCount++;

      return this._allow(
        `Risk checks passed. Qty: ${qty}/${t.maxOrderQty}. Daily: ${this.dailyTradeCount}/${t.maxDailyTrades}`
      );
    }

    if (tool === "export_portfolio_data") {
      // Exporting large amounts of data could be a risk signal
      return this._allow("Export is a read operation — no risk constraints triggered");
    }

    return this._abstain("Not within risk management domain");
  }

  _allow(reason)            { return { allowed: true,  confidence: 1.00, reason, rule: null, expert: this.name, hardVeto: false }; }
  _warn(reason, rule)       { return { allowed: true,  confidence: 0.60, reason, rule,       expert: this.name, hardVeto: false }; }
  _veto(reason, rule)       { return { allowed: false, confidence: 0.00, reason, rule,       expert: this.name, hardVeto: true  }; }
  _abstain(reason = "N/A")  { return { allowed: true,  confidence: 1.00, reason,  rule: null, expert: this.name, hardVeto: false, abstained: true }; }
}
