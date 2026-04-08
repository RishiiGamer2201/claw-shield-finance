// src/moe/gatekeeper.js
// MoE (Mixture-of-Experts) Gatekeeper
// Routes each tool call to 1-3 relevant Expert Agents, runs them in parallel,
// aggregates votes into PolicyConsensus, surfaces any hard veto.
//
// Routing logic is data-driven: each domain maps to a set of experts
// based on the tool's category. The policy JSON defines which domains are active.

import { ComplianceExpert } from "./experts/compliance-expert.js";
import { RiskExpert        } from "./experts/risk-expert.js";
import { FraudExpert       } from "./experts/fraud-expert.js";
import { DataExpert        } from "./experts/data-expert.js";
import { TemporalExpert    } from "./experts/temporal-expert.js";

// Tool → which expert domains to consult
// This routing table is the clean separation between "what tools exist" and "who judges them"
const TOOL_DOMAIN_MAP = {
  place_order:          ["compliance", "risk", "fraud", "temporal"],
  cancel_order:         ["compliance", "temporal"],
  get_quote:            ["compliance", "fraud"],
  get_bars:             ["compliance"],
  get_account:          ["fraud"],
  get_positions:        ["fraud"],
  get_orders:           ["fraud"],
  export_portfolio_data:["data", "fraud"],
  // Blocked tools — fraud expert checks for injection patterns
  cancel_all_orders:    ["compliance", "fraud"],
  enable_margin:        ["compliance", "fraud"],
  liquidate_all:        ["compliance", "risk", "fraud"],
  transfer_funds:       ["compliance", "data", "fraud"],
  external_request:     ["data", "fraud"],
  get_account_activities: ["data", "fraud"],
  modify_account_settings:["compliance", "fraud"],
};
const DEFAULT_DOMAINS = ["fraud"]; // Always consult fraud expert as last resort

export class Gatekeeper {
  constructor(policy) {
    this.policy  = policy;
    this.experts = {
      compliance: new ComplianceExpert(policy),
      risk:       new RiskExpert(policy),
      fraud:      new FraudExpert(policy),
      data:       new DataExpert(policy),
      temporal:   new TemporalExpert(policy),
    };
  }

  // ── Main evaluation ─────────────────────────────────────────────────────────
  // Returns: { consensus, breakdown, hardVeto, vetoReason, expertsConsulted }
  // consensus = PolicyConsensus = (allowed_votes / total_consulted)

  async evaluate(tool, args, sessionContext = {}) {
    const domains = TOOL_DOMAIN_MAP[tool] || DEFAULT_DOMAINS;
    const selectedExperts = domains.map((d) => this.experts[d]).filter(Boolean);

    // Run all selected experts in parallel
    const results = await Promise.all(
      selectedExperts.map((expert) =>
        Promise.resolve(expert.enforce(tool, args, sessionContext)).then((r) => ({
          ...r,
          expert: expert.name,
          domain: expert.domain,
        }))
      )
    );

    // Filter out abstentions from vote count
    const voters  = results.filter((r) => !r.abstained);
    const allowed = voters.filter((r) => r.allowed).length;
    const total   = voters.length || 1; // avoid div/0
    const consensus = allowed / total;

    // Any hard veto blocks regardless of consensus
    const vetoed = results.find((r) => r.hardVeto);

    return {
      consensus,                          // 0.0 – 1.0
      breakdown: results,                 // full expert opinions
      hardVeto:  !!vetoed,
      vetoReason: vetoed?.reason ?? null,
      vetoRule:  vetoed?.rule   ?? null,
      vetoExpert: vetoed?.expert ?? null,
      expertsConsulted: selectedExperts.map((e) => e.name),
    };
  }
}
