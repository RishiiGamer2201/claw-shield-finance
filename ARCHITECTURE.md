# 🏛️ ClawShield Finance — Architecture

## System Overview

ClawShield Finance enforces **cryptographic intent validation** on autonomous financial agents. Every action passes dual enforcement: structured policy validation and ArmorIQ IAP cryptographic proof verification.

```
User Prompt
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│          OpenClaw Gateway (ClawShield Finance)           │
│                                                         │
│  [1] LLM PLANNER  ─── src/planner.js                   │
│      • Converts natural language → structured plan      │
│      • Reasons about goal, selects tools, sets risk     │
│      • NEVER imports executor or financial-tools        │
│      • Falls back to rule-based planner if no OpenAI    │
│                                                         │
│  [2] ARMORIQ PLUGIN (ArmorClaw) ─── src/executor.js     │
│      • Registers plan → gets cryptographic token        │
│      • Per step: PolicyEngine (local) + IAP (crypto)    │
│      • BOTH must approve → action runs                  │
│      • Either fails → BLOCK + audit log                 │
│                                                         │
│  [3] TOOL EXECUTOR ─── src/tools/financial-tools.js     │
│      • Runs verified Alpaca API calls only              │
│      • Never decides what to run — only executes        │
│      • Paper trading endpoint hardcoded                 │
└─────────────────────────────────────────────────────────┘
    │
    ▼
ArmorIQ IAP (cryptographic verification)
    │
    ▼
Alpaca Paper Trading API (paper-api.alpaca.markets)
    │
    ▼
Audit Logger → ./logs/clawshield-finance-YYYY-MM-DD.log
```

---

## OpenClaw Integration

This system implements the **OpenClaw Gateway + ArmorClaw plugin pattern**:

| Layer | File | Responsibility |
|---|---|---|
| LLM Planner | `src/planner.js` | Reasons about goals, produces structured plans. Never calls APIs. |
| ArmorIQ Plugin (ArmorClaw) | `src/executor.js` + `src/intent-validator.js` | Captures plan, issues intent token, enforces policy before each step. |
| Policy Engine | `src/policy-engine.js` | Deterministic JSON-driven compliance rules. No if-else. |
| Tool Executor | `src/tools/financial-tools.js` | Executes verified actions only. Never decides what to run. |
| MCP Adapter | `src/tools/financial-tools.js` | Wraps Alpaca paper API as an MCP-compatible tool registry. |

**Every tool call flows through:**
```
Planner → IntentEngine (ArmorClaw) → PolicyEngine (JSON rules) → ArmorIQ IAP (crypto) → Tool Executor → Alpaca
```

**No action ever reaches the Tool Executor without:**
1. A valid intent token from ArmorIQ IAP (Merkle proof verified)
2. A green light from the PolicyEngine (JSON policy rules)

---

## Policy Architecture

All enforcement rules live in `policies/financial-policy.json`. No business logic in code.

```
policies/financial-policy.json
├── trading
│   ├── allowedTickers          ← Ticker allowlist
│   ├── allowedSides            ← ["buy"] — short selling disabled
│   ├── maxOrderQty             ← 10 shares per order
│   ├── maxOrderValueUSD        ← $1,500 cap
│   └── maxDailyTrades          ← 5/day
├── data
│   ├── allowedExportDestinations ← ["local"] — exfiltration blocked
│   └── portfolioDataClassification ← "confidential"
└── operations
    └── blockedActions          ← cancel_all, liquidate, enable_margin, etc.
```

---

## Enforcement Flow (Per Step)

```
For each step in plan:
    │
    ├─ PolicyEngine.enforce(tool, args)
    │       Checks: ticker, qty, side, order_type, daily limit, blocked ops
    │       Result: { allowed, reason, rule, severity }
    │
    │   if NOT allowed → BLOCK immediately (Alpaca never called)
    │
    ├─ IntentValidator.verifyStep(tokenId, step)
    │       Sends: tokenId + step to ArmorIQ IAP
    │       Checks: Merkle proof, intent drift, step-in-plan
    │       Result: { verified, reason, merkleProof, source }
    │
    │   if NOT verified → BLOCK (Alpaca never called)
    │
    └─ Tool.execute(args)    ← Only if BOTH pass
            Alpaca API call made here
            Result logged to audit trail
```

---

## Delegation Model

The orchestrator delegates read-only research authority to sub-agents using bounded authority tokens:

```
Orchestrator (full trading authority)
    │
    ├── delegates to Research Agent
    │       Allowed: get_quote, get_positions, get_orders
    │       Blocked: place_order, cancel_order, export_portfolio_data
    │       Token validity: 10 minutes
    │
    └── delegates to Trading Agent
            Allowed: get_quote, place_order (within qty limits)
            Blocked: cancel_all, close_all, export
            Token validity: 5 minutes per trade session
```

---

## Threat Model — Violations Covered

| Attack | Layer That Blocks It | Demo Scenario |
|---|---|---|
| Unauthorized trade (unapproved ticker) | PolicyEngine → `trading.allowedTickers` | Scenario 4 (GME) |
| Oversized order | PolicyEngine → `trading.maxOrderQty` | Scenario 3 (500 shares) |
| Short selling | PolicyEngine → `trading.allowedSides` | Scenario 5 (TSLA) |
| Data exfiltration | PolicyEngine → `data.allowedExportDestinations` | Scenario 6 |
| Scope escalation | PolicyEngine → `operations.blockedActions` | Scenario 7 |
| Intent drift | ArmorIQ IAP → Merkle proof mismatch | All scenarios |
| ArmorIQ offline | Fail-closed → execution-level actions blocked | Default behavior |

---

## Key Design Principles

1. **Fail Closed** — ArmorIQ unreachable → ALL write actions blocked
2. **Reasoning ≠ Execution** — Planner never imports financial tools; Executor never reasons
3. **Defense in Depth** — PolicyEngine + ArmorIQ run independently; both must approve
4. **No Hardcoded Logic** — All rules in `policies/financial-policy.json` — data, not code
5. **Paper Trading Only** — Alpaca endpoint hardcoded to `paper-api.alpaca.markets`
6. **Full Auditability** — Every decision logged with timestamp, tool, reason, rule, severity
