/**
 * Naming the CALENDAR DAY an instant falls on — the one decision a HubSpot
 * `date`-type property forces at write time. A `datetime` property keeps the
 * instant and lets the portal render it in its own zone; a `date` property
 * keeps only the day, so whoever writes it must pick the zone the day is named
 * in. These helpers are that pick, shared by the submit-time adapter and the
 * API's booking sync so both collapse days the same way.
 */

/** UTC-midnight epoch-ms of the calendar day containing `epochMs` (UTC). */
export function utcMidnightMs(epochMs: number): number {
  const d = new Date(epochMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * UTC-midnight epoch-ms of the calendar day `epochMs` falls on **in `timezone`**
 * — the value a HubSpot `date` property takes, for the day a human in that zone
 * would name. Blank/absent zone = UTC (the platform default; this product is
 * self-hosted and has no business assuming anyone's office).
 *
 * An unrecognised zone WARNS and falls back to UTC rather than throwing: a typo
 * in a config field must not turn a delivery into a retry loop, and a day that
 * is off by hours beats no booking record at all.
 */
export function dayMidnightMs(
  epochMs: number,
  timezone?: string,
  warn?: (message: string) => void,
): number {
  const zone = timezone?.trim();
  if (zone) {
    try {
      // `formatToParts` and not a formatted string: reading the parts BY TYPE is
      // locale-independent, where parsing "YYYY-MM-DD" assumes an ICU build that
      // renders `en-CA` in ISO order. On a small-icu Node it does not, and every
      // zone would degrade to UTC without anything looking wrong.
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date(epochMs));
      const at = (type: string) => Number(parts.find((p) => p.type === type)?.value);
      const [y, m, d] = [at('year'), at('month'), at('day')];
      if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
        return Date.UTC(y, m - 1, d);
      }
    } catch {
      // Fall through to UTC.
    }
    warn?.(
      `day timezone: unusable zone ${JSON.stringify(zone)} — calendar day computed in UTC instead`,
    );
  }
  return utcMidnightMs(epochMs);
}
