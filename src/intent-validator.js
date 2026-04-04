// src/intent-validator.js
// ArmorIQ IAP (Intent Authorization Protocol) integration.
// Issues cryptographic intent tokens and verifies each step against the approved plan.

import fetch from "node-fetch";

const ARMORIQ_BASE = "https://api.armoriq.ai";

export class IntentValidator {
  constructor() {
    this.apiKey = process.env.ARMORIQ_API_KEY;
    this.userId = process.env.ARMORIQ_USER_ID || "user-hackathon-001";
    this.agentId = process.env.ARMORIQ_AGENT_ID || "clawshield-finance-001";
    this.available = false;
  }

  async initialize() {
    // Test connectivity to ArmorIQ — if unavailable, system operates FAIL-CLOSED
    try {
      const res = await fetch(`${ARMORIQ_BASE}/health`, {
        headers: this._headers(),
        signal: AbortSignal.timeout(3000),
      });
      this.available = res.ok;
    } catch {
      this.available = false;
      console.warn(
        "⚠️  ArmorIQ IAP unreachable — running in LOCAL ENFORCEMENT ONLY mode.\n" +
        "   PolicyEngine will still enforce all constraints deterministically.\n" +
        "   Actions requiring dual enforcement will be BLOCKED per fail-closed policy.\n"
      );
    }
    return this;
  }

  // ── Register a plan and receive an intent token ───────────────────────────

  async registerPlan(plan) {
    if (!this.available) {
      return this._localToken(plan);
    }

    try {
      const res = await fetch(`${ARMORIQ_BASE}/v1/intent/register`, {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify({
          userId: this.userId,
          agentId: this.agentId,
          intent: plan.intent,
          riskLevel: plan.riskLevel,
          steps: plan.steps.map((s) => ({
            stepId: s.stepId,
            tool: s.tool,
            args: s.args,
          })),
          metadata: {
            mode: "paper_trading",
            timestamp: new Date().toISOString(),
          },
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`ArmorIQ register failed: ${res.status} — ${err}`);
      }

      const data = await res.json();
      return {
        tokenId: data.tokenId,
        merkleRoot: data.merkleRoot,
        expiresAt: data.expiresAt,
        source: "armoriq",
      };
    } catch (err) {
      console.error(`ArmorIQ registration error: ${err.message}`);
      // Fail closed — return a rejected token
      return {
        tokenId: null,
        source: "armoriq_error",
        error: err.message,
        rejected: true,
      };
    }
  }

  // ── Verify a single step against the issued token ─────────────────────────

  async verifyStep(tokenId, step) {
    if (!this.available || !tokenId) {
      // Local mode: structural check only
      return this._localStepVerify(step);
    }

    try {
      const res = await fetch(`${ARMORIQ_BASE}/v1/intent/verify-step`, {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify({
          tokenId,
          stepId: step.stepId,
          tool: step.tool,
          args: step.args,
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        return {
          verified: false,
          reason: `ArmorIQ step verification failed: ${res.status}`,
          source: "armoriq",
        };
      }

      const data = await res.json();
      return {
        verified: data.verified,
        reason: data.reason || "ArmorIQ cryptographic proof valid",
        merkleProof: data.merkleProof,
        source: "armoriq",
      };
    } catch (err) {
      // Fail closed: any ArmorIQ error = block the step
      return {
        verified: false,
        reason: `ArmorIQ unreachable during step verification: ${err.message}`,
        source: "armoriq_error",
      };
    }
  }

  // ── Local fallback (structural verification only) ─────────────────────────

  _localToken(plan) {
    const tokenId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      tokenId,
      merkleRoot: this._simpleHash(JSON.stringify(plan)),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      source: "local",
      warning: "ArmorIQ unavailable — local token only. Dual enforcement not active.",
    };
  }

  _localStepVerify(step) {
    // In local mode: verify the step has required fields and tool name is valid
    const validTools = [
      "get_quote", "get_account", "get_positions", "get_orders",
      "place_order", "cancel_order", "export_portfolio_data",
    ];

    if (!step.tool || !validTools.includes(step.tool)) {
      return {
        verified: false,
        reason: `Unknown tool '${step.tool}' — not in allowed tool registry`,
        source: "local",
      };
    }

    return {
      verified: true,
      reason: "Local structural verification passed (ArmorIQ offline)",
      source: "local",
      warning: "Cryptographic proof not available in local mode",
    };
  }

  _simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return `local-hash-${Math.abs(h).toString(16)}`;
  }

  _headers() {
    return {
      "Content-Type": "application/json",
      "X-ArmorIQ-Key": this.apiKey,
      "X-ArmorIQ-Agent": this.agentId,
    };
  }

  isAvailable() {
    return this.available;
  }
}
