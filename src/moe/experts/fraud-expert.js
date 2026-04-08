// src/moe/experts/fraud-expert.js
// Expert Agent 3: Fraud Detection
// Detects wash trades, unusual velocity, repeated identical orders, prompt injection signatures.
// Maintains session action history — no policy JSON dependencies.

export class FraudExpert {
  constructor(_policy) {
    this.name    = "FraudExpert";
    this.domain  = "fraud";
    this.history = []; // { tool, args, timestamp }
    this.WINDOW_MS      = 60_000; // 60s rolling window for velocity check
    this.MAX_SAME_ACTION = 3;     // Max identical actions in rolling window
    this.WASH_TRADE_WINDOW_MS = 120_000; // 2 min window: buy then sell same symbol = wash trade
  }

  enforce(tool, args, _sessionContext) {
    const now = Date.now();

    // 1. Prompt injection signature detection (attack keyword in args)
    const serialised = JSON.stringify(args).toLowerCase();
    const injectionPatterns = [
      /ignore.{0,20}polic/,         // "ignore all policies"
      /system:\s*(override|bypass)/,  // "[SYSTEM: bypass]"
      /bypass.{0,20}enforce/,
      /disable.{0,20}check/,
      /admin\s*mode/,
    ];
    for (const pattern of injectionPatterns) {
      if (pattern.test(serialised)) {
        return this._veto(
          `Prompt injection detected in args: pattern '${pattern.source}' matched. Action rejected.`,
          "fraud.promptInjection"
        );
      }
    }

    if (tool === "place_order") {
      const symbol = args.symbol?.toUpperCase();
      const side   = args.side;
      const qty    = Number(args.qty) || 0;

      // 2. Wash trade detection: buy then sell (or sell then buy) same symbol within window
      const recentOpposite = this.history.filter(
        (h) =>
          h.tool === "place_order" &&
          h.args.symbol?.toUpperCase() === symbol &&
          h.args.side !== side &&
          now - h.timestamp < this.WASH_TRADE_WINDOW_MS
      );
      if (recentOpposite.length > 0) {
        return this._veto(
          `Wash trade pattern detected: ${symbol} ${recentOpposite[0].args.side}→${side} within ${this.WASH_TRADE_WINDOW_MS / 1000}s window`,
          "fraud.washTrade"
        );
      }

      // 3. Velocity check: same tool+symbol+side repeated too fast
      const recentSame = this.history.filter(
        (h) =>
          h.tool === "place_order" &&
          h.args.symbol?.toUpperCase() === symbol &&
          h.args.side === side &&
          now - h.timestamp < this.WINDOW_MS
      );
      if (recentSame.length >= this.MAX_SAME_ACTION) {
        return this._veto(
          `Velocity limit exceeded: ${recentSame.length + 1} identical ${side} orders for ${symbol} within ${this.WINDOW_MS / 1000}s`,
          "fraud.velocityLimit"
        );
      }

      // 4. Unusually large qty compared to recent session average
      const sessionOrders = this.history.filter((h) => h.tool === "place_order");
      if (sessionOrders.length >= 2) {
        const avgQty = sessionOrders.reduce((s, h) => s + (Number(h.args.qty) || 0), 0) / sessionOrders.length;
        if (qty > avgQty * 5 && qty > 20) {
          return this._warn(
            `Anomalous order size: qty ${qty} is ${(qty / avgQty).toFixed(1)}x session average (${avgQty.toFixed(1)})`,
            "fraud.anomalousSize"
          );
        }
      }
    }

    // 5. Data exfiltration: encoded external URLs in otherwise-local destinations
    if (tool === "export_portfolio_data" && args.format) {
      const fmtLower = String(args.format).toLowerCase();
      if (/http|base64|url|encode|proxy/i.test(fmtLower)) {
        return this._veto(
          `Suspected encoded exfiltration: format field '${args.format}' contains suspicious encoding pattern`,
          "fraud.encodedExfiltration"
        );
      }
    }

    // Record action in history
    this.history.push({ tool, args: { ...args }, timestamp: now });

    return this._allow("No fraud patterns detected");
  }

  _allow(reason)           { return { allowed: true,  confidence: 1.00, reason, rule: null, expert: this.name, hardVeto: false }; }
  _warn(reason, rule)      { return { allowed: true,  confidence: 0.65, reason, rule,       expert: this.name, hardVeto: false }; }
  _veto(reason, rule)      { return { allowed: false, confidence: 0.00, reason, rule,       expert: this.name, hardVeto: true  }; }
  _abstain(reason = "N/A") { return { allowed: true,  confidence: 1.00, reason,  rule: null, expert: this.name, hardVeto: false, abstained: true }; }
}
