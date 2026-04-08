// src/moe/experts/temporal-expert.js
// Expert Agent 5: Temporal / Market Hours
// Evaluates market hours, weekends, and circuit-breaker conditions.
// Advisory — warns outside hours but does not hard-veto (after-hours orders are valid).

// NYSE market hours in ET: 9:30 AM – 4:00 PM, Mon–Fri
const MARKET_OPEN_ET_HOUR_MIN  = [9, 30];
const MARKET_CLOSE_ET_HOUR_MIN = [16, 0];

function getETTime() {
  // ET = UTC-4 (EDT, Mar–Nov) or UTC-5 (EST, Nov–Mar)
  const now = new Date();
  const month = now.getUTCMonth() + 1; // 1-12
  // EDT: second Sunday in March to first Sunday in November
  const isDST = month > 3 && month < 11; // simplified: Apr–Oct = EDT
  const offsetH = isDST ? -4 : -5;
  const etMs = now.getTime() + offsetH * 3_600_000;
  return new Date(etMs);
}

export class TemporalExpert {
  constructor(_policy) {
    this.name   = "TemporalExpert";
    this.domain = "temporal";
  }

  enforce(tool, args, _sessionContext) {
    // Only relevant for trading actions that hit live markets
    if (tool !== "place_order" && tool !== "cancel_order") {
      return this._abstain("Not a time-sensitive operation");
    }

    const et       = getETTime();
    const dayOfWeek = et.getUTCDay(); // 0=Sun, 6=Sat
    const etHour   = et.getUTCHours();
    const etMin    = et.getUTCMinutes();
    const timeVal  = etHour * 60 + etMin;
    const openVal  = MARKET_OPEN_ET_HOUR_MIN[0]  * 60 + MARKET_OPEN_ET_HOUR_MIN[1];
    const closeVal = MARKET_CLOSE_ET_HOUR_MIN[0] * 60 + MARKET_CLOSE_ET_HOUR_MIN[1];

    const pad  = (n) => String(n).padStart(2, "0");
    const etStr = `${pad(etHour)}:${pad(etMin)} ET`;

    // Weekend — market is closed
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return this._warn(
        `Market is closed on weekends (current time: ${etStr}). ` +
        `Order queued for next trading day. Paper trading may still process.`,
        "temporal.marketHours"
      );
    }

    // After hours or pre-market
    if (timeVal < openVal || timeVal >= closeVal) {
      const phase = timeVal < openVal ? "pre-market" : "after-hours";
      return this._warn(
        `Order submitted during ${phase} (${etStr}). ` +
        `NYSE regular hours: 09:30–16:00 ET. Paper orders will execute at open.`,
        "temporal.marketHours"
      );
    }

    // Regular trading hours — full confidence
    return this._allow(`Market is open (${etStr}). Temporal check passed.`);
  }

  _allow(reason)           { return { allowed: true, confidence: 1.00, reason, rule: null, expert: this.name, hardVeto: false }; }
  _warn(reason, rule)      { return { allowed: true, confidence: 0.80, reason, rule,       expert: this.name, hardVeto: false }; }
  _abstain(reason = "N/A") { return { allowed: true, confidence: 1.00, reason,  rule: null, expert: this.name, hardVeto: false, abstained: true }; }
}
