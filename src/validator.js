// src/validator.js
// Validation Agent — Intent Drift + ConfidenceScore
//
// ConfidenceScore formula (from implementation docs):
//   ConfidenceScore = 0.40 * PolicyConsensus + 0.35 * ArmorIQProof + 0.25 * IntentAlignment
//
// Where:
//   PolicyConsensus  = (allowed_experts / total_experts_consulted) — from Gatekeeper
//   ArmorIQProof     = 1.0 if cryptographically verified, 0.5 if local mode, 0.0 if failed
//   IntentAlignment  = cosine_similarity(intent_anchor_embedding, step_rationale_embedding)
//
// Intent embeddings: OpenAI text-embedding-3-small when available.
// Fallback: Jaccard similarity on tokenised words (deterministic, no API needed).

import fetch from "node-fetch";

const W1 = 0.40; // PolicyConsensus weight
const W2 = 0.35; // ArmorIQProof weight
const W3 = 0.25; // IntentAlignment weight

// ── Embedding helpers ─────────────────────────────────────────────────────────

async function getEmbedding(text, apiKey) {
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// Fallback: Jaccard similarity on meaningful word tokens (stopwords removed)
const STOPWORDS = new Set([
  "a","an","the","is","it","in","of","to","for","at","by","on","as","or","and",
  "get","my","i","me","we","our","with","that","this","from","be","will","can",
  "do","its","per","via","up","let","all","via","not","are","was","has","have",
  "then","current","please","just","show","give","what","how","check",
]);

function jaccardSimilarity(a, b) {
  const tokenise = (s) => new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
  const setA = tokenise(a);
  const setB = tokenise(b);
  if (setA.size === 0 || setB.size === 0) return 0.80; // too short to compare → neutral
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union        = new Set([...setA, ...setB]).size;
  const raw = union === 0 ? 1.0 : intersection / union;
  // Lift: even 1 shared meaningful token is a good signal in financial context
  return Math.min(1.0, raw + (intersection > 0 ? 0.25 : 0));
}

// Read-only tools carry very low drift risk — give alignment floor of 0.85
const READ_ONLY_TOOLS = new Set(["get_quote","get_account","get_positions","get_orders","get_bars"]);

// ── Validator ─────────────────────────────────────────────────────────────────

export class Validator {
  constructor() {
    this.apiKey          = process.env.OPENAI_API_KEY ?? null;
    this.threshold       = 0.70; // overridden from policy in initialize()
    this.intentAnchor    = null; // embedding or raw text for fallback
    this.intentText      = null;
    this.useEmbeddings   = false;
    this.driftLog        = [];   // confidence trajectory across the session
  }

  async initialize(policy) {
    this.threshold = policy?.confidenceThreshold ?? 0.70;
  }

  // Call once per plan — stores intent anchor
  async setIntentAnchor(intentText) {
    this.intentText   = intentText;
    this.intentAnchor = await getEmbedding(intentText, this.apiKey);
    this.useEmbeddings = !!this.intentAnchor;
    this.driftLog     = [];
  }

  // Compute IntentAlignment: how closely does this step's rationale match original intent?
  async computeAlignment(stepRationale, tool = "") {
    if (!this.intentText) return 0.85; // no anchor set — default neutral

    // Read-only tools carry no drift risk — floor at 0.85
    if (READ_ONLY_TOOLS.has(tool)) {
      const base = this.useEmbeddings
        ? (await (async () => {
            const stepEmb = await getEmbedding(stepRationale, this.apiKey);
            const cosine  = cosineSimilarity(this.intentAnchor, stepEmb);
            return cosine !== null ? Math.max(0, Math.min(1, cosine)) : null;
          })()) ?? jaccardSimilarity(this.intentText, stepRationale)
        : jaccardSimilarity(this.intentText, stepRationale);
      return Math.max(0.85, base);
    }

    if (this.useEmbeddings) {
      const stepEmb = await getEmbedding(stepRationale, this.apiKey);
      const cosine  = cosineSimilarity(this.intentAnchor, stepEmb);
      if (cosine !== null) return Math.max(0, Math.min(1, cosine));
    }

    // Fallback: Jaccard similarity (always works, no API)
    return jaccardSimilarity(this.intentText, stepRationale);
  }

  // ── Core scoring ────────────────────────────────────────────────────────────
  // gatekeeperResult: { consensus, hardVeto, ... } from Gatekeeper
  // armoriqResult:    { verified, source }          from IntentValidator

  async score(step, gatekeeperResult, armoriqResult) {
    const policyCons   = gatekeeperResult.consensus ?? 1.0;
    const armoriqProof = armoriqResult.verified
      ? (armoriqResult.source === "armoriq" ? 1.0 : 0.5) // local mode = 0.5
      : 0.0;

    const alignment  = await this.computeAlignment(step.rationale ?? step.tool, step.tool);
    const score      = W1 * policyCons + W2 * armoriqProof + W3 * alignment;
    const finalScore = Math.max(0, Math.min(1, score));

    const entry = {
      stepId:    step.stepId,
      tool:      step.tool,
      score:     parseFloat(finalScore.toFixed(3)),
      breakdown: {
        policyCons:  parseFloat(policyCons.toFixed(3)),
        armoriqProof: parseFloat(armoriqProof.toFixed(3)),
        alignment:   parseFloat(alignment.toFixed(3)),
      },
      embeddingMode: this.useEmbeddings ? "openai" : "jaccard-fallback",
      belowThreshold: finalScore < this.threshold,
    };
    this.driftLog.push(entry);

    return entry;
  }

  getDriftLog()    { return this.driftLog; }
  getThreshold()   { return this.threshold; }
}
