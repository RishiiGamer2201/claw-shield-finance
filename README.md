# 🦞 ClawShield Finance — Intent-Aware Financial Agent

### ArmorIQ x OpenClaw Hackathon — Apogee '26, BITS Pilani

An autonomous financial agent that enforces **strict intent boundaries** at runtime. No action executes without passing both a structured compliance policy check **and** cryptographic ArmorIQ IAP verification.

> *"The future risk isn't AI that refuses to act. It's AI that acts without permission."*

---

## What It Does

ClawShield Finance operates on a paper trading account (Alpaca) and demonstrates that an autonomous agent can:
- Research stocks, check positions, and place orders **only within defined intent boundaries**
- **Deterministically block** unauthorized trades, compliance violations, and data exfiltration
- Produce a full **cryptographically-anchored audit trail** of every allowed and blocked action

---

## Quick Start

### 1. Clone & Install
```bash
git clone h[ttps://github.com/RishiiGamer2201/claw-shield](https://github.com/RishiiGamer2201/claw-shield-finance
cd claw-shield
npm install
```

### 2. Configure Keys
```bash
cp .env.example .env
# Fill in: OPENAI_API_KEY, ALPACA_API_KEY, ALPACA_SECRET_KEY, ARMORIQ_API_KEY
```

### 3. Run
```bash
# Interactive agent
npm start

# Full demo (6 scenarios, deterministic output for judges)
npm run demo
```

---

## Architecture

```
User Prompt
    │
    ▼
┌─────────────────────────────────────────────────┐
│  LLM PLANNER (Reasoning Layer)                  │
│  GPT-4o-mini → structured JSON plan             │
│  { intent, riskLevel, steps: [{tool, args}] }   │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  ARMORIQ IAP (Intent Token Issuance)            │
│  • Registers plan + issues cryptographic token  │
│  • Creates Merkle proofs per step               │
└──────────────┬──────────────────────────────────┘
               │
               ▼  (per step)
┌─────────────────────────────────────────────────┐
│  ENFORCEMENT LAYER (Dual Check — BOTH must pass)│
│                                                 │
│  ① PolicyEngine.enforce(tool, args)             │
│     JSON-driven compliance rules:               │
│     • Ticker allowlist                          │
│     • Max order qty / value                     │
│     • Short selling blocked                     │
│     • Data exfiltration blocked                 │
│     • Daily trade limits                        │
│     • Order type restrictions                   │
│                                                 │
│  ② ArmorIQ.verifyStep(tokenId, step)            │
│     • Cryptographic Merkle proof check          │
│     • Intent drift detection                    │
│     • Step matches approved plan                │
│                                                 │
│  BOTH pass → execute  |  Either fails → block   │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  ALPACA PAPER TRADING API                       │
│  get_quote / place_order / get_positions / ...  │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  AUDIT LOGGER                                   │
│  Every decision: event, tool, args, rule,       │
│  severity, reason → ./logs/clawshield-*.log     │
└─────────────────────────────────────────────────┘
```

### Key Design Principles
- **Fail Closed**: ArmorIQ unreachable → ALL execution-level actions blocked
- **Reasoning ≠ Execution**: LLM only produces plans, never touches APIs directly
- **Defense in Depth**: PolicyEngine + ArmorIQ run independently; both must approve
- **No Hardcoded Logic**: All rules in `policies/financial-policy.json` — data, not code

---

## Demo Scenarios

| # | Scenario | Outcome | Blocking Rule |
|---|----------|---------|---------------|
| 1 | Get quote for AAPL | ✅ Allowed | — |
| 2 | Buy 5 shares MSFT | ✅ Allowed | — |
| 3 | Buy 500 shares NVDA | 🚫 Blocked | `trading.maxOrderQty` |
| 4 | Buy 2 shares GME | 🚫 Blocked | `trading.allowedTickers` |
| 5 | Short sell TSLA | 🚫 Blocked | `trading.shortSellingAllowed` |
| 6 | Export portfolio to external API | 🚫 Blocked | `data.allowedExportDestinations` |

---

## Policy (All Rules Are Data)

`policies/financial-policy.json` defines all enforcement constraints:
- **Ticker allowlist**: Only approved symbols can be traded
- **Max order qty**: 10 shares per order
- **Max order value**: $1,500 per order  
- **Short selling**: Disabled
- **Allowed sides**: `buy` only
- **Data export**: Local only — no external endpoints
- **Daily trades**: Max 5/day
- **Blocked operations**: liquidate_all, transfer_funds, enable_margin

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js v22+ |
| LLM (Reasoning) | OpenAI GPT-4o-mini |
| Paper Trading | Alpaca Markets API |
| Intent Enforcement | ArmorIQ IAP + ArmorClaw |
| Policy Engine | Structured JSON + PolicyEngine class |
| Audit Logging | Structured JSON logs |
