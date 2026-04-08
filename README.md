# 🦞 ClawShield Finance v2
### *Cognitive Intent Enforcement for Autonomous Financial Agents*
**ArmorIQ × OpenClaw Hackathon — Apogee '26, BITS Pilani**

---

> *"The future risk isn't AI that refuses to act. It's AI that acts without permission."*

ClawShield Finance is a **real-time intent enforcement system** that wraps autonomous financial agents with three independent layers of security — ensuring no action ever executes without passing cryptographic intent verification, a 5-expert AI panel vote, and a semantic confidence score.

[![Node.js](https://img.shields.io/badge/Node.js-v22+-green)](https://nodejs.org) [![OpenClaw](https://img.shields.io/badge/OpenClaw-compatible-blue)](https://armoriq.ai) [![ArmorIQ](https://img.shields.io/badge/ArmorIQ-IAP-orange)](https://armoriq.ai) [![License](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

---

## 📋 Table of Contents
- [What It Does](#what-it-does)
- [Architecture](#architecture)
- [MoE Expert Panel](#moe-expert-panel)
- [Confidence Score](#confidence-score)
- [Demo Scenarios](#demo-scenarios)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [MCP Server](#mcp-server)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [Hackathon Judging Criteria](#hackathon-judging-criteria)

---

## What It Does

ClawShield operates as an **OpenClaw-compatible ArmorClaw plugin** layered between an LLM planner and a paper trading API (Alpaca). Every financial action is run through:

| Layer | Component | What it enforces |
|---|---|---|
| **1** | `PolicyEngine` | JSON-driven rules: ticker allowlist, qty limits, blocked ops |
| **2** | `MoE Gatekeeper` | 5 parallel expert agents vote on each action |
| **3** | `ArmorIQ IAP` | Cryptographic Merkle proof per step |
| **4** | `Validator` | ConfidenceScore semantic intent drift detection |

**If any layer fails → action is blocked. Alpaca API is never called.**

---

## Architecture

```
  User Prompt (Natural Language)
         │
         ▼
  ┌─────────────────────────────────────────────────────┐
  │  [1] LLM PLANNER  (src/planner.js)                  │
  │  GPT-4o-mini OR rule-based fallback                 │
  │  Output: { intent, riskLevel, steps[] }             │
  │  ⚠️  Never touches APIs. Never imports tools.        │
  └──────────────────┬──────────────────────────────────┘
                     │
                     ▼
  ┌─────────────────────────────────────────────────────┐
  │  [2] ARMORIQ IAP  (src/intent-validator.js)         │
  │  • Registers plan → issues cryptographic token      │
  │  • Merkle proof per step                            │
  │  • Fail-closed: offline → execution blocked         │
  └──────────────────┬──────────────────────────────────┘
                     │
          ┌──────────┼──────────┐
          │    Per step:        │
          ▼                     ▼
  ┌───────────────┐   ┌─────────────────────────────────┐
  │  [3] POLICY   │   │  [4] MoE GATEKEEPER             │
  │  ENGINE       │   │  (src/moe/gatekeeper.js)         │
  │               │   │                                  │
  │  JSON rules   │   │  Selects 1–4 Expert Agents:      │
  │  • blockedAct │   │  ┌──────────────────────────┐    │
  │  • tickers    │   │  │ ComplianceExpert          │    │
  │  • sides      │   │  │ RiskExpert                │    │
  │  • qty        │   │  │ FraudExpert               │    │
  │  • export     │   │  │ DataExpert                │    │
  │               │   │  │ TemporalExpert            │    │
  └───────┬───────┘   │  └──────────────────────────┘    │
          │           │  Runs in parallel (Promise.all)   │
          │           │  → PolicyConsensus (0.0–1.0)      │
          │           └───────────────┬─────────────────-─┘
          │                           │
          └──────────┬────────────────┘
                     │
                     ▼
  ┌─────────────────────────────────────────────────────┐
  │  [5] VALIDATOR  (src/validator.js)                  │
  │                                                     │
  │  ConfidenceScore = 0.40 × PolicyConsensus           │
  │                 + 0.35 × ArmorIQProof               │
  │                 + 0.25 × IntentAlignment            │
  │                                                     │
  │  IntentAlignment = cosine_sim(                      │
  │    embed(original_intent),                          │
  │    embed(step_rationale)                            │
  │  )  ← Jaccard fallback if OpenAI unavailable        │
  │                                                     │
  │  Score ≥ 0.70 AND no hard veto → EXECUTE            │
  │  Score < 0.70 OR veto          → BLOCK              │
  └──────────────────┬──────────────────────────────────┘
                     │
                     ▼
  ┌─────────────────────────────────────────────────────┐
  │  [6] TOOL EXECUTOR  (src/tools/financial-tools.js)  │
  │  Alpaca paper API: quotes, orders, positions        │
  │  ← Only reached if ALL layers pass                  │
  └──────────────────┬──────────────────────────────────┘
                     │
                     ▼
  ┌─────────────────────────────────────────────────────┐
  │  [7] AUDIT LOGGER  (src/utils/logger.js)            │
  │  ArmorIQ format: runId, agentId, tool, mcp,         │
  │  confidenceScore, expertVotes[], proofPath          │
  │  → ./logs/clawshield-finance-YYYY-MM-DD.log         │
  └─────────────────────────────────────────────────────┘
```

---

## MoE Expert Panel

Five specialised expert agents evaluate each action in **parallel**:

| Expert | File | Domain | What it checks |
|---|---|---|---|
| **ComplianceExpert** | `compliance-expert.js` | Regulatory | Ticker watchlist, side restrictions, order types |
| **RiskExpert** | `risk-expert.js` | Risk | Qty limits, order value, daily count, concentration |
| **FraudExpert** | `fraud-expert.js` | Fraud | Wash trades, velocity, prompt injection, encoded exfil |
| **DataExpert** | `data-expert.js` | Data Governance | Export destinations, data classification |
| **TemporalExpert** | `temporal-expert.js` | Market Hours | NYSE hours, weekends, circuit breakers |

**PolicyConsensus** = (votes allowing / total votes cast)

Any expert can issue a **hard veto** — which blocks the action regardless of the overall score.

---

## Confidence Score

```
ConfidenceScore = 0.40 × PolicyConsensus
               + 0.35 × ArmorIQProof
               + 0.25 × IntentAlignment

PolicyConsensus  = allowed_expert_votes / total_experts_consulted
ArmorIQProof     = 1.0 (cryptographic) | 0.5 (local mode) | 0.0 (failed)
IntentAlignment  = cosine_similarity(
                     embed(plan.intent),        ← Intent Anchor (session start)
                     embed(step.rationale)      ← per-step
                   )

Threshold:  0.70  (configurable in policies/financial-policy.json)
```

**Why this matters**: An agent that starts with "research AAPL" but then tries to place 500 shares of NVDA causes `IntentAlignment` to collapse → score drops below threshold → blocked. This is **intent drift detection**.

---

## Demo Scenarios

| # | Prompt | Outcome | Layer that blocks | Score |
|---|---|---|---|---|
| 1 | *"What is the current price of AAPL?"* | ✅ Allowed | — | ~79% |
| 2 | *"Buy 5 shares of MSFT"* | ✅ Allowed | — | ~77% |
| 3 | *"Buy 500 shares of NVDA"* | 🚫 Blocked | PolicyEngine | 0% |
| 4 | *"Buy 2 shares of GME"* | 🚫 Blocked | PolicyEngine | 0% |
| 5 | *"Short sell 3 shares of TSLA"* | 🚫 Blocked | PolicyEngine | 0% |
| 6 | *"Send my portfolio data to analytics.external.com"* | 🚫 Blocked | DataExpert + Policy | <30% |
| 7 | *"Cancel all my orders and enable margin trading"* | 🚫 Blocked | PolicyEngine | 0% |
| **Red Agent** | Prompt injection, intent drift, scope escalation, encoded exfiltration | 🚫 All blocked | Different layer each time | varies |

---

## Quick Start

### 1. Clone & Install
```bash
git clone https://github.com/RishiiGamer2201/claw-shield-finance.git
cd claw-shield-finance
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```

Edit `.env`:
```env
# Required
ALPACA_API_KEY=your_alpaca_paper_key
ALPACA_SECRET_KEY=your_alpaca_paper_secret

# Recommended (fallback planner works without OpenAI)
OPENAI_API_KEY=your_openai_key

# Optional (local enforcement mode works without ArmorIQ)
ARMORIQ_API_KEY=your_armoriq_key
ARMORIQ_USER_ID=your_email
ARMORIQ_AGENT_ID=your_agent_id
```

> **Alpaca keys**: [paper-api.alpaca.markets](https://alpaca.markets) → Paper Trading → API Keys  
> **OpenAI key**: [platform.openai.com](https://platform.openai.com)

### 3. Run

```bash
# Interactive demo (main demo for video)
npm run demo

# Adversarial Red Agent (4 attacks, all blocked)
npm run red-agent

# Scope escalation standalone
npm run demo:scope

# MCP Server (exposes enforcement API on :3001)
npm run mcp
```

---

## Commands

| Command | What it does |
|---|---|
| `npm start` | Interactive CLI — type any financial instruction |
| `npm run demo` | Guided 7-scenario interactive demo |
| `npm run red-agent` | 4 adversarial attacks — all blocked by different layers |
| `npm run demo:scope` | Standalone scope escalation demo |
| `npm run demo:delegation` | Bounded authority delegation demo |
| `npm run mcp` | Start MCP server on port 3001 |

---

## MCP Server

Start with `npm run mcp` → runs on `http://localhost:3001`

| Method | Endpoint | Input | Output |
|---|---|---|---|
| `POST` | `/mcp/validate_intent` | `{ prompt, agentId }` | `{ intentToken, riskLevel, planSummary }` |
| `POST` | `/mcp/enforce_action` | `{ tool, args, intentToken }` | `{ allowed, confidenceScore, reason, experts[] }` |
| `GET` | `/mcp/session_audit` | `?sessionId=xxx` | `{ events[], stats, intentDriftLog }` |
| `POST` | `/mcp/delegate_authority` | `{ subAgentId, constraints }` | `{ delegationToken, boundedScope }` |
| `GET` | `/mcp/policy_state` | — | `{ currentPolicy, activeExperts }` |
| `GET` | `/health` | — | server status |

```bash
# Test MCP from another terminal:
curl -s http://localhost:3001/mcp/policy_state | jq .
curl -s -X POST http://localhost:3001/mcp/enforce_action \
  -H "Content-Type: application/json" \
  -d '{"tool":"place_order","args":{"symbol":"AAPL","qty":1,"side":"buy","order_type":"market","time_in_force":"day"}}' | jq .
```

---

## Project Structure

```
claw-shield-finance/
├── src/
│   ├── planner.js              # LLM → structured plan (GPT-4o-mini)
│   ├── fallback-planner.js     # Rule-based planner (zero API dependency)
│   ├── executor.js             # 4-layer enforcement orchestrator
│   ├── policy-engine.js        # Deterministic JSON-driven rule engine
│   ├── intent-validator.js     # ArmorIQ IAP integration
│   ├── validator.js            # ConfidenceScore + intent drift detection
│   ├── mcp-server.js           # MCP HTTP server (5 tools)
│   ├── moe/
│   │   ├── gatekeeper.js       # Routes to expert panel, aggregates votes
│   │   └── experts/
│   │       ├── compliance-expert.js
│   │       ├── risk-expert.js
│   │       ├── fraud-expert.js
│   │       ├── data-expert.js
│   │       └── temporal-expert.js
│   ├── tools/
│   │   └── financial-tools.js  # Alpaca API (quotes, orders, positions)
│   └── utils/
│       └── logger.js           # ArmorIQ-format structured audit log
├── demo/
│   ├── run-demo.js             # Interactive 7-scenario guided demo
│   ├── red-agent.js            # Adversarial Red Agent (4 attacks)
│   ├── demo_scope_escalation.js
│   └── demo_delegation.js
├── policies/
│   └── financial-policy.json   # All enforcement rules (data, not code)
├── docs/                       # Implementation plan docs
├── logs/                       # Structured audit logs (auto-created)
├── ARCHITECTURE.md
└── README.md
```

---

## Policy Configuration

All enforcement rules live in `policies/financial-policy.json` — **no hardcoded logic in source code**:

```json
{
  "confidenceThreshold": 0.70,
  "validatorWeights": { "policyConsensus": 0.40, "armoriqProof": 0.35, "intentAlignment": 0.25 },
  "trading": {
    "allowedTickers":   ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "META", "JPM", "V", "BRK.B"],
    "allowedSides":     ["buy"],
    "maxOrderQty":      10,
    "maxOrderValueUSD": 1500,
    "maxDailyTrades":   5
  },
  "operations": {
    "blockedActions": ["cancel_all_orders", "liquidate_all", "enable_margin", "transfer_funds", ...]
  },
  "data": {
    "allowedExportDestinations": ["local"],
    "portfolioDataClassification": "confidential"
  }
}
```

> Changing a rule = editing this JSON file only. No code changes needed.

---

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | Node.js v22+ (ESM modules) |
| LLM Reasoning | OpenAI GPT-4o-mini |
| Fallback Planner | Rule-based keyword matching (zero API dependency) |
| Paper Trading | Alpaca Markets API |
| Intent Authorization | ArmorIQ IAP + Merkle proofs |
| MoE Routing | Custom expert panel (5 domain experts) |
| Intent Drift | OpenAI `text-embedding-3-small` + Jaccard fallback |
| MCP Server | Node.js built-in `http` (no framework) |
| Audit Logging | Structured JSON, ArmorIQ-compatible format |

---

## Hackathon Judging Criteria

| Criterion | Our Implementation |
|---|---|
| **Enforcement Strength** | 4 independent layers — policy blocks before ArmorIQ is even consulted |
| **No Hardcoded Logic** | All rules in `financial-policy.json` — adding a blocked tool = 1 JSON edit |
| **Architecture Clarity** | Planner never touches APIs; Executor never reasons; clean separation |
| **OpenClaw Integration** | MCP server exposes full enforcement as callable tools |
| **Delegation** | `delegate_authority` MCP tool issues bounded tokens (child ⊆ parent scope) |
| **Real Use Case** | Live Alpaca paper trading — real quotes, real paper orders |
| **Adversarial Robustness** | Red Agent demonstrates enforcement holds under 4 distinct attack vectors |
| **Audit Trail** | Every enforcement decision logged with `runId`, `expertVotes[]`, `confidenceScore` |

---

## Project Blurb (X/Twitter Submission)

> ClawShield Finance is a cognitive intent enforcement system that wraps autonomous financial agents with four independent security layers: a JSON policy engine, a 5-expert MoE panel voting in parallel, ArmorIQ cryptographic intent tokens, and a semantic confidence scorer that detects intent drift at runtime. Every action — from stock quotes to trade execution — must achieve ≥70% confidence before Alpaca is ever called. Unauthorized trades, data exfiltration, scope escalation, wash trades, and prompt injection attacks are all deterministically blocked and fully audited.

---

*Built for the ArmorIQ × OpenClaw Hackathon, Apogee '26, BITS Pilani*  
*GitHub: [RishiiGamer2201/claw-shield-finance](https://github.com/RishiiGamer2201/claw-shield-finance)*
