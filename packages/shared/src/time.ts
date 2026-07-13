/**
 * Timezone helpers (ported from the original FE utils).
 * All slot instants cross the wire as ISO-8601 UTC; the UI renders them in the
 * visitor's chosen IANA zone. Dependency-free — leans on `Intl.DateTimeFormat`
 * so DST transitions are honored by the platform's IANA database.
 */

/** The visitor's own IANA zone, with a safe fallback when the platform hides it. */
export function detectTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Offset (minutes, east-of-UTC positive) of `instant` in `timeZone`. */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(instant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** Format a UTC instant as the clock time ("9:00 AM") shown in `timeZone`. */
export function formatSlotTime(utcIso: string, timeZone: string, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(utcIso));
}

/** Format a UTC instant as a full, human date+time in `timeZone`. */
export function formatSlotDateTime(utcIso: string, timeZone: string, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(utcIso));
}

/** The civil day ("2026-07-06") a UTC instant falls on when viewed in `timeZone`. */
export function zonedDayKey(utcIso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(utcIso));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** A human day heading ("Mon, Jul 6") for a slot's zoned day. */
export function formatDayHeading(utcIso: string, timeZone: string, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(utcIso));
}

/** A curated, deduplicated list of common IANA zones, always including `includeZone`. */
export function commonTimeZones(includeZone?: string): string[] {
  const withValues = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  let zones: string[];
  if (typeof withValues.supportedValuesOf === 'function') {
    zones = withValues.supportedValuesOf('timeZone');
  } else {
    zones = CURATED_ZONES.slice();
  }
  if (includeZone && !zones.includes(includeZone)) {
    zones = [includeZone, ...zones];
  }
  return zones;
}

const CURATED_ZONES: readonly string[] = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Mexico_City',
  'America/Bogota',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];
