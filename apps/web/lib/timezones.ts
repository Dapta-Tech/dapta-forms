/**
 * Browser-side helpers for IANA timezone pickers. Advisory only: the SERVER's
 * ICU data decides what a zone means; these keep the UI honest at the moment
 * of typing and give a searchable list where the runtime can enumerate one.
 */

/** Whether this browser can resolve the IANA zone name. Blank is always fine (UTC). */
export function isKnownTimezone(value: string): boolean {
  const zone = value.trim();
  if (!zone) return true;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The IANA zones this browser can enumerate. Computed once: the list is static
 * for the life of the page. A runtime without `Intl.supportedValuesOf` yields
 * null, and callers fall back to a free-text input.
 */
let cachedTimezones: string[] | null | undefined;
export function browserTimezones(): string[] | null {
  if (cachedTimezones !== undefined) return cachedTimezones;
  try {
    const zones = Intl.supportedValuesOf("timeZone");
    cachedTimezones = zones.length > 0 ? zones : null;
  } catch {
    cachedTimezones = null;
  }
  return cachedTimezones;
}

/** The zone this browser runs in, or null when the runtime will not say. */
export function browserTimezone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isKnownTimezone(zone) ? zone : null;
  } catch {
    return null;
  }
}
