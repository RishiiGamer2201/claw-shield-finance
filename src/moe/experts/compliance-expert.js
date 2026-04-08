// src/moe/experts/compliance-expert.js
// Expert Agent 1: Regulatory Compliance
// Evaluates ticker allowlist, side restrictions, order types.
// ALL rules loaded from policy JSON — no hardcoded limits.

export class ComplianceExpert {
  constructor(policy) {
    this.policy = policy;
    this.name = "ComplianceExpert";
    this.domain = "compliance";
  }

  enforce(tool, args, _sessionContext) {
    const t = this.policy.trading;

    if (tool === "place_order") {
      // 1. Ticker allowlist
      if (args.symbol && !t.allowedTickers.includes(args.symbol.toUpperCase())) {
        return this._veto(
          `Ticker '${args.symbol}' not in regulatory watchlist [${t.allowedTickers.join(", ")}]`,
          "compliance.allowedTickers"
        );
      }
      // 2. Side restriction — no short selling
      if (args.side && !t.allowedSides.includes(args.side)) {
        return this._veto(
          `Side '${args.side}' violates compliance rules. Allowed: [${t.allowedSides.join(", ")}]. Short selling is prohibited.`,
          "compliance.allowedSides"
        );
      }
      // 3. Order type
      if (args.order_type && !t.allowedOrderTypes.includes(args.order_type)) {
        return this._veto(
          `Order type '${args.order_type}' not permitted. Allowed: [${t.allowedOrderTypes.join(", ")}]`,
          "compliance.allowedOrderTypes"
        );
      }
      // 4. Time-in-force
      if (args.time_in_force && !t.allowedTimeInForce.includes(args.time_in_force)) {
        return this._veto(
          `Time-in-force '${args.time_in_force}' not permitted. Allowed: [${t.allowedTimeInForce.join(", ")}]`,
          "compliance.allowedTimeInForce"
        );
      }
      // 5. Leverage / options guard
      if (t.leverageAllowed === false && args.order_type === "options") {
        return this._veto("Options trading is not permitted (leverageAllowed = false)", "compliance.leverageAllowed");
      }
      return this._allow("All regulatory compliance checks passed");
    }

    // Quote lookups — ticker check for watchlist awareness (advisory, no veto)
    if (tool === "get_quote" || tool === "get_bars") {
      if (args.symbol && !t.allowedTickers.includes(args.symbol.toUpperCase())) {
        return this._warn(
          `Ticker '${args.symbol}' is outside the approved watchlist (read-only advisory)`,
          "compliance.allowedTickers"
        );
      }
      return this._allow("Read-only quote within compliance scope");
    }

    // Tools not in this expert's domain
    return this._abstain("Not within compliance domain");
  }

  _allow(reason)            { return { allowed: true,  confidence: 1.00, reason, rule: null, expert: this.name, hardVeto: false }; }
  _warn(reason, rule)       { return { allowed: true,  confidence: 0.55, reason, rule,       expert: this.name, hardVeto: false }; }
  _veto(reason, rule)       { return { allowed: false, confidence: 0.00, reason, rule,       expert: this.name, hardVeto: true  }; }
  _abstain(reason = "N/A")  { return { allowed: true,  confidence: 1.00, reason,  rule: null, expert: this.name, hardVeto: false, abstained: true }; }
}
