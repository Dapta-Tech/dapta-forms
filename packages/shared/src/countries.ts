/**
 * ISO 3166-1 alpha-2 country codes with ITU E.164 dialing prefixes — the
 * static input for the public phone field's country selector. Names are NOT
 * stored here: they come from Intl.DisplayNames at render time, which localizes
 * them for free. Flags are derived from the code (regional indicator symbols),
 * so each entry is just [iso2, dial].
 *
 * Dependency-free (only the platform `Intl`): safe to import from any surface,
 * client or server. Ported from Dapta Calendars; the subscriber-digit helpers
 * (`longestDialPrefix`, `phoneSubscriberDigits`, `isPhoneValueTooShort`) are
 * consolidated here so both the phone component and any caller share one source
 * of truth for "what are the SUBSCRIBER digits of this E.164 value".
 */

export interface Country {
  /** ISO 3166-1 alpha-2, uppercase. */
  code: string;
  /** E.164 dialing prefix including '+'. */
  dial: string;
  /** Flag emoji derived from the code. */
  flag: string;
}

/** Unicode flag emoji for an ISO alpha-2 code (regional indicator pair). */
export function countryFlag(iso2: string): string {
  return iso2
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(0x1f1a5 + c.charCodeAt(0)));
}

/** Localized country name (falls back to the code if Intl lacks the region). */
export function countryName(iso2: string, locale = 'en'): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(iso2) ?? iso2;
  } catch {
    return iso2;
  }
}

// [iso2, dial] — full ISO 3166-1 list with ITU prefixes. NANP members share +1.
const RAW: ReadonlyArray<readonly [string, string]> = [
  ['AD', '+376'], ['AE', '+971'], ['AF', '+93'], ['AG', '+1'], ['AI', '+1'],
  ['AL', '+355'], ['AM', '+374'], ['AO', '+244'], ['AR', '+54'], ['AS', '+1'],
  ['AT', '+43'], ['AU', '+61'], ['AW', '+297'], ['AZ', '+994'], ['BA', '+387'],
  ['BB', '+1'], ['BD', '+880'], ['BE', '+32'], ['BF', '+226'], ['BG', '+359'],
  ['BH', '+973'], ['BI', '+257'], ['BJ', '+229'], ['BM', '+1'], ['BN', '+673'],
  ['BO', '+591'], ['BR', '+55'], ['BS', '+1'], ['BT', '+975'], ['BW', '+267'],
  ['BY', '+375'], ['BZ', '+501'], ['CA', '+1'], ['CD', '+243'], ['CF', '+236'],
  ['CG', '+242'], ['CH', '+41'], ['CI', '+225'], ['CK', '+682'], ['CL', '+56'],
  ['CM', '+237'], ['CN', '+86'], ['CO', '+57'], ['CR', '+506'], ['CU', '+53'],
  ['CV', '+238'], ['CW', '+599'], ['CY', '+357'], ['CZ', '+420'], ['DE', '+49'],
  ['DJ', '+253'], ['DK', '+45'], ['DM', '+1'], ['DO', '+1'], ['DZ', '+213'],
  ['EC', '+593'], ['EE', '+372'], ['EG', '+20'], ['ER', '+291'], ['ES', '+34'],
  ['ET', '+251'], ['FI', '+358'], ['FJ', '+679'], ['FK', '+500'], ['FM', '+691'],
  ['FO', '+298'], ['FR', '+33'], ['GA', '+241'], ['GB', '+44'], ['GD', '+1'],
  ['GE', '+995'], ['GF', '+594'], ['GH', '+233'], ['GI', '+350'], ['GL', '+299'],
  ['GM', '+220'], ['GN', '+224'], ['GP', '+590'], ['GQ', '+240'], ['GR', '+30'],
  ['GT', '+502'], ['GU', '+1'], ['GW', '+245'], ['GY', '+592'], ['HK', '+852'],
  ['HN', '+504'], ['HR', '+385'], ['HT', '+509'], ['HU', '+36'], ['ID', '+62'],
  ['IE', '+353'], ['IL', '+972'], ['IN', '+91'], ['IQ', '+964'], ['IR', '+98'],
  ['IS', '+354'], ['IT', '+39'], ['JM', '+1'], ['JO', '+962'], ['JP', '+81'],
  ['KE', '+254'], ['KG', '+996'], ['KH', '+855'], ['KI', '+686'], ['KM', '+269'],
  ['KN', '+1'], ['KP', '+850'], ['KR', '+82'], ['KW', '+965'], ['KY', '+1'],
  ['KZ', '+7'], ['LA', '+856'], ['LB', '+961'], ['LC', '+1'], ['LI', '+423'],
  ['LK', '+94'], ['LR', '+231'], ['LS', '+266'], ['LT', '+370'], ['LU', '+352'],
  ['LV', '+371'], ['LY', '+218'], ['MA', '+212'], ['MC', '+377'], ['MD', '+373'],
  ['ME', '+382'], ['MG', '+261'], ['MH', '+692'], ['MK', '+389'], ['ML', '+223'],
  ['MM', '+95'], ['MN', '+976'], ['MO', '+853'], ['MP', '+1'], ['MQ', '+596'],
  ['MR', '+222'], ['MS', '+1'], ['MT', '+356'], ['MU', '+230'], ['MV', '+960'],
  ['MW', '+265'], ['MX', '+52'], ['MY', '+60'], ['MZ', '+258'], ['NA', '+264'],
  ['NC', '+687'], ['NE', '+227'], ['NG', '+234'], ['NI', '+505'], ['NL', '+31'],
  ['NO', '+47'], ['NP', '+977'], ['NR', '+674'], ['NU', '+683'], ['NZ', '+64'],
  ['OM', '+968'], ['PA', '+507'], ['PE', '+51'], ['PF', '+689'], ['PG', '+675'],
  ['PH', '+63'], ['PK', '+92'], ['PL', '+48'], ['PM', '+508'], ['PR', '+1'],
  ['PS', '+970'], ['PT', '+351'], ['PW', '+680'], ['PY', '+595'], ['QA', '+974'],
  ['RE', '+262'], ['RO', '+40'], ['RS', '+381'], ['RU', '+7'], ['RW', '+250'],
  ['SA', '+966'], ['SB', '+677'], ['SC', '+248'], ['SD', '+249'], ['SE', '+46'],
  ['SG', '+65'], ['SI', '+386'], ['SK', '+421'], ['SL', '+232'], ['SM', '+378'],
  ['SN', '+221'], ['SO', '+252'], ['SR', '+597'], ['SS', '+211'], ['ST', '+239'],
  ['SV', '+503'], ['SX', '+1'], ['SY', '+963'], ['SZ', '+268'], ['TC', '+1'],
  ['TD', '+235'], ['TG', '+228'], ['TH', '+66'], ['TJ', '+992'], ['TK', '+690'],
  ['TL', '+670'], ['TM', '+993'], ['TN', '+216'], ['TO', '+676'], ['TR', '+90'],
  ['TT', '+1'], ['TV', '+688'], ['TW', '+886'], ['TZ', '+255'], ['UA', '+380'],
  ['UG', '+256'], ['US', '+1'], ['UY', '+598'], ['UZ', '+998'], ['VC', '+1'],
  ['VE', '+58'], ['VG', '+1'], ['VI', '+1'], ['VN', '+84'], ['VU', '+678'],
  ['WF', '+681'], ['WS', '+685'], ['YE', '+967'], ['ZA', '+27'], ['ZM', '+260'],
  ['ZW', '+263'],
];

export const COUNTRIES: readonly Country[] = RAW.map(([code, dial]) => ({
  code,
  dial,
  flag: countryFlag(code),
}));

// --- National significant number lengths + display grouping ---

/**
 * Typical national-number digit counts for common destinations. E.164 caps the
 * WHOLE number at 15 digits; this narrows the cap to what the chosen country
 * actually issues so a field can stop input (and validate) per country. Not
 * exhaustive — anything absent falls back to a permissive [6, cap] range.
 * NANP members (+1) are always exactly 10.
 */
const NSN_RANGES: Record<string, readonly [number, number]> = {
  AR: [10, 10], AU: [9, 9], BO: [8, 8], BR: [10, 11], CH: [9, 9], CL: [9, 9],
  CN: [11, 11], CO: [10, 10], CR: [8, 8], CU: [8, 8], DE: [7, 11], DK: [8, 8],
  EC: [9, 9], ES: [9, 9], FR: [9, 9], GB: [9, 10], GT: [8, 8], HN: [8, 8],
  ID: [8, 12], IE: [9, 9], IL: [9, 9], IN: [10, 10], IT: [9, 11], JP: [9, 10],
  KR: [9, 10], MX: [10, 10], NI: [8, 8], NL: [9, 9], NO: [8, 8], NZ: [8, 10],
  PA: [8, 8], PE: [9, 9], PH: [10, 10], PL: [9, 9], PT: [9, 9], PY: [9, 9],
  RU: [10, 10], SE: [7, 10], SG: [8, 8], SV: [8, 8], TR: [10, 10], UA: [9, 9],
  UY: [8, 9], VE: [10, 10], ZA: [9, 9],
};

/** [min, max] national digits for a country — E.164's 15-digit total is the hard cap. */
export function phoneNsnRange(iso2: string, dial: string): readonly [number, number] {
  const cap = 15 - dial.replace(/\D/g, '').length;
  if (dial === '+1') return [10, Math.min(10, cap)];
  const known = NSN_RANGES[iso2.toUpperCase()];
  if (known) return [known[0], Math.min(known[1], cap)];
  return [6, Math.min(12, cap)];
}

/**
 * Display grouping for a national number while typing — visual only, the
 * stored/webhook value stays bare E.164 (`+15106005675`). NANP gets the
 * familiar (XXX) XXX-XXXX; everything else groups in readable chunks.
 */
export function formatPhoneDigits(dial: string, digits: string): string {
  if (!digits) return '';
  if (dial === '+1') {
    const a = digits.slice(0, 3);
    const b = digits.slice(3, 6);
    const c = digits.slice(6, 10);
    if (digits.length <= 3) return `(${a}`;
    if (digits.length <= 6) return `(${a}) ${b}`;
    return `(${a}) ${b}-${c}`;
  }
  // Generic: groups of 2–3–3–…, front-loaded (e.g. 55 123 456 78).
  const groups: string[] = [digits.slice(0, 2)];
  for (let i = 2; i < digits.length; i += 3) groups.push(digits.slice(i, i + 3));
  return groups.filter(Boolean).join(' ');
}

// --- E.164 subscriber-digit extraction (shared by the field + form gates) ---

/**
 * The longest dial code that prefixes an E.164 value — '' when none matches.
 * ITU calling codes are prefix-free, so the longest match is the exact dial
 * (e.g. '+52…' resolves to '+52', never a shorter shared prefix).
 */
export function longestDialPrefix(value: string): string {
  if (!value.startsWith('+')) return '';
  let best = '';
  for (const c of COUNTRIES) {
    if (c.dial.length > best.length && value.startsWith(c.dial)) best = c.dial;
  }
  return best;
}

/** Subscriber digits after the dial code — '' when the value is empty. */
export function phoneSubscriberDigits(value: string): string {
  const dial = longestDialPrefix(value);
  return (dial ? value.slice(dial.length) : value).replace(/\D/g, '');
}

/**
 * True when a value has SOME digits but fewer than the dialing country issues —
 * the same rule the field flags inline, exported so form gates stay in sync.
 * Shared dials (+1) share the same range.
 */
export function isPhoneValueTooShort(value: string): boolean {
  const d = phoneSubscriberDigits(value);
  if (d.length === 0) return false;
  const dial = longestDialPrefix(value);
  const c = COUNTRIES.find((x) => x.dial === dial);
  const [min] = c ? phoneNsnRange(c.code, c.dial) : [4, 14];
  return d.length < min;
}
