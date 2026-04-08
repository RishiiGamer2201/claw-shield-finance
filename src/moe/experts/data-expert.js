// src/moe/experts/data-expert.js
// Expert Agent 4: Data Governance
// Evaluates all data-movement actions: export destinations, classification levels.
// ALL rules loaded from policy JSON — no hardcoded destination lists.

export class DataExpert {
  constructor(policy) {
    this.policy = policy;
    this.name   = "DataExpert";
    this.domain = "data";
  }

  enforce(tool, args, _sessionContext) {
    const d = this.policy.data;

    if (tool === "export_portfolio_data") {
      const dest = args.destination || "";

      // 1. Check against allowed export destinations list (from policy JSON)
      if (!d.allowedExportDestinations.includes(dest)) {
        return this._veto(
          `Export destination '${dest}' not in allowedExportDestinations ` +
          `[${d.allowedExportDestinations.join(", ")}]. ` +
          `Portfolio data is classified '${d.portfolioDataClassification}'.`,
          "data.allowedExportDestinations"
        );
      }

      // 2. If destination passes, validate it's not an encoded external URL
      if (dest !== "local") {
        return this._veto(
          `External data export violates '${d.portfolioDataClassification}' classification. ` +
          `Only local exports are permitted.`,
          "data.portfolioDataClassification"
        );
      }

      return this._allow(
        `Local export permitted — data remains within authorised boundary. ` +
        `Classification: ${d.portfolioDataClassification}`
      );
    }

    // Read-only data access — not a data governance concern
    if (["get_positions", "get_account", "get_orders", "get_quote"].includes(tool)) {
      return this._allow("Read-only data access permitted");
    }

    return this._abstain("Not within data governance domain");
  }

  _allow(reason)           { return { allowed: true,  confidence: 1.00, reason, rule: null, expert: this.name, hardVeto: false }; }
  _warn(reason, rule)      { return { allowed: true,  confidence: 0.50, reason, rule,       expert: this.name, hardVeto: false }; }
  _veto(reason, rule)      { return { allowed: false, confidence: 0.00, reason, rule,       expert: this.name, hardVeto: true  }; }
  _abstain(reason = "N/A") { return { allowed: true,  confidence: 1.00, reason,  rule: null, expert: this.name, hardVeto: false, abstained: true }; }
}
