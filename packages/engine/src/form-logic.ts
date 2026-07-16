/**
 * The pure forms core — no DB, no I/O, no framework. Given a form config and the
 * answers collected so far, it decides which steps are visible (skip-logic),
 * validates a single answer, and computes the quiz score. These mirror the
 * pilot's `showWhen`/`hideWhen` conditions, per-field validation, and the option-
 * points + slider-range scoring model, distilled to a small, fully-tested unit.
 *
 * The web renderer and the API both call these so client and server agree on the
 * same flow and the same score (never trust the client; recompute on submit).
 */

/** The 9 step kinds the pilot supports (`message` is an info step with no input). */
export const FORM_FIELD_TYPES = [
  'text',
  'name',
  'email',
  'phone',
  'dropdown',
  'multiple_choice',
  'slider',
  'textarea',
  'message',
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/** A single option for a choice/dropdown step; `points` feeds the score. */
export interface FormOption {
  label: string;
  value: string;
  points?: number;
  icon?: string | null;
}

/** Slider value-range → points (pilot `sliderScoring`). */
export interface SliderScoringRange {
  min: number;
  max: number;
  points: number;
}

/** A visibility condition: the answer to `field` must (not) be one of `values`. */
export interface StepCondition {
  field: string;
  values: string[];
}

/**
 * A forward branching rule (additive; back-compat). When the answer to the
 * OWNING step intersects `values`, the flow jumps: `target` is the step key to
 * jump to, or `null` to skip straight to the end (finish the form). Rules run
 * top-to-bottom and the first match wins. Only FORWARD jumps take effect (a
 * missing/backward target is ignored) so the flow can never loop. Complements
 * the declarative `showWhen`/`hideWhen` model — both are honored together.
 */
export interface GotoRule {
  /** Answer values that trigger the jump (intersection with the answer tokens). */
  values: string[];
  /** Step key to jump to, or `null` to skip to the end. */
  target: string | null;
}

/** Which phase a step belongs to — lead-capture fields never score. */
export type FlowGroup = 'qualification' | 'lead_capture';

export interface FormStep {
  /** Stable key used as the answer field name. */
  key: string;
  type: FormFieldType;
  question?: string;
  helper?: string | null;
  placeholder?: string | null;
  required?: boolean;
  buttonText?: string | null;
  /** Choice/dropdown options. */
  options?: FormOption[];
  /** Slider bounds. */
  min?: number;
  max?: number;
  step?: number;
  default?: number;
  sliderScoring?: SliderScoringRange[];
  /** Skip-logic: show only when this condition holds. */
  showWhen?: StepCondition | null;
  /** Skip-logic: hide when this condition holds (evaluated after showWhen). */
  hideWhen?: StepCondition | null;
  /**
   * Forward branching rules on THIS step's answer (additive). When a rule's
   * `values` match, the flow jumps to `target` (a step key) or skips to the end
   * (`target: null`). First match wins; only forward jumps apply (loop-safe).
   * Resolved by `runtimeSteps` so client and server walk the same path.
   */
  goto?: GotoRule[];
  /**
   * Choice select mode (additive; `multiple_choice` only). `'multiple'` lets the
   * respondent pick several (checkboxes); anything else — including absent, for
   * back-compat with every existing form — is a single pick (radios). `dropdown`
   * is unaffected (it is always single).
   */
  selectionMode?: 'single' | 'multiple';
  /** Flat points awarded just for answering (rare; most points come from options). */
  points?: number;
  flowGroup?: FlowGroup;
  /** Email validation: reject public/personal domains. */
  corporateEmailOnly?: boolean;
  /** Phone validation: minimum digit count. */
  phoneMinDigits?: number;
  // --- Builder + runtime extensions (all optional; back-compat) -------------
  /** `name` step: the two fields collected on one slide (default firstname+lastname). */
  fields?: string[];
  /** `name` step: per-field placeholders keyed by field name. */
  placeholders?: Record<string, string>;
  /**
   * Dynamic question variants: pick the question text from the answer to
   * `questionField`. `questionVariants[value]` overrides `question` when the
   * respondent's answer to that earlier field matches a key; a `*` key (or the
   * plain `question`) is the fallback. Lets one step ask a tailored question.
   */
  questionField?: string | null;
  /** Question text per value of `questionField` (falls back to `question`). */
  questionVariants?: Record<string, string>;
  /** Slider unit label per value of `questionField` (falls back to `sliderUnitLabel`). */
  sliderLabelVariants?: Record<string, string>;
  /** Static unit label shown next to the slider value (e.g. "leads / mo"). */
  sliderUnitLabel?: string | null;
  /** `multiple_choice`: render as an icon grid instead of a radio list. */
  showIcons?: boolean;
  /**
   * Branch insertion: show this step ONLY when the `email` answer is a personal/
   * free-mail domain (the pilot's "ask for company/website when email is personal").
   */
  showForPersonalEmailOnly?: boolean;
  /**
   * Terminal step (disqualify path): completing it ends the flow — the submission
   * is finalized and the outcome resolved, skipping any reveal screen.
   */
  terminal?: boolean;
  /** Show the processing/reveal interstitial after this step completes. */
  triggersReveal?: boolean;
}

/**
 * An answer-forced outcome rule (additive; back-compat). When the answer to
 * `field` matches, the owning outcome wins REGARDLESS of score — e.g. a slider
 * answer <= 0 forces the disqualify outcome. All SPECIFIED clauses must hold
 * (values intersection, numeric bounds); a non-numeric answer fails a numeric
 * clause. Evaluated by `resolveOutcome` before score bucketing.
 */
export interface OutcomeOverrideRule {
  /** The step key whose answer this rule inspects. */
  field: string;
  /** Match when the (string/array) answer intersects these values. */
  values?: string[];
  /** Match when the numeric answer is <= this bound. */
  maxValue?: number;
  /** Match when the numeric answer is >= this bound. */
  minValue?: number;
}

/** Scheduling handoff for an outcome (additive; mirrors the config schema). */
export interface OutcomeBooking {
  provider: 'hubspot_meetings' | 'calendly';
  url: string;
  prefill?: boolean;
}

export interface FormOutcome {
  id: string;
  label: string;
  /** Inclusive lower score bound for this bucket (highest matching wins). */
  minScore?: number;
  redirectUrl?: string | null;
  /** Scheduling handoff (HubSpot Meetings / Calendly) shown for this outcome. */
  booking?: OutcomeBooking | null;
  /** Answer-forced rules: any match makes this outcome win over score bucketing. */
  overrides?: OutcomeOverrideRule[];
}

/** A client logo chip on the cover marquee (image `src`, or the `name` as text). */
export interface FormClientLogo {
  name: string;
  src?: string | null;
}

export interface FormCover {
  enabled?: boolean;
  /** A sticky banner line (promo strip) shown above every screen throughout the flow. */
  bannerText?: string | null;
  eyebrow?: string | null;
  /** Alias for eyebrow (pilot `badge`); eyebrow wins when both are set. */
  badge?: string | null;
  headline?: string | null;
  subheadline?: string | null;
  ctaText?: string | null;
  trustBadge?: string | null;
  /** Cover logo image URL (falls back to branding.logo, then the product mark). */
  logo?: string | null;
  /** Optional "trusted by" marquee shown on the cover. */
  clientLogos?: FormClientLogo[];
}

/** Per-form branding — the accent color threads the banner/CTA/selected states. */
export interface FormBranding {
  primaryColor?: string | null;
  logo?: string | null;
  clientLogos?: FormClientLogo[];
}

/** Optional processing/result-reveal interstitial (generic, templated copy). */
export interface FormReveal {
  enabled?: boolean;
  headline?: string | null;
  subtitle?: string | null;
  /** How long the processing interstitial plays before the result (ms). */
  durationMs?: number;
  /** Outcome subtitle template; `[key]` tokens interpolate from the answers. */
  subtitleTemplate?: string | null;
  /** Pre-warm the booking embed while the interstitial plays. */
  prewarm?: boolean;
}

export interface FormConfig {
  version: 1;
  branding?: FormBranding | null;
  cover?: FormCover | null;
  steps: FormStep[];
  scoring?: { enabled?: boolean } | null;
  outcomes?: FormOutcome[];
  reveal?: FormReveal | null;
  /**
   * Persist a partial submission once the step at this 1-based position in
   * `steps` is completed (typically just past the lead-capture email). Absent =
   * no partial save.
   */
  partialSubmitAfterStep?: number;
}

export type AnswerValue =
  | string
  | string[]
  | number
  | boolean
  | Record<string, string>
  | null
  | undefined;
export type Answers = Record<string, AnswerValue>;

/** Normalize an answer to the set of string tokens it represents (for matching). */
function tokens(value: AnswerValue): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

/** Does the current answer to `cond.field` intersect `cond.values`? */
function conditionHolds(cond: StepCondition, answers: Answers): boolean {
  const got = new Set(tokens(answers[cond.field]));
  return cond.values.some((v) => got.has(v));
}

/**
 * The steps to show given the answers so far, in config order. A step appears
 * when its `showWhen` holds (or is absent) AND its `hideWhen` does not hold —
 * and, for a personal-email-only branch step, only when the email is personal.
 */
export function visibleSteps(config: FormConfig, answers: Answers): FormStep[] {
  return config.steps.filter((step) => {
    if (step.showWhen && !conditionHolds(step.showWhen, answers)) return false;
    if (step.hideWhen && conditionHolds(step.hideWhen, answers)) return false;
    if (step.showForPersonalEmailOnly) {
      const emailKey = findEmailKey(config);
      if (!emailKey || !isPersonalEmail(answers[emailKey])) return false;
    }
    return true;
  });
}

/** The first `email`-typed step's key (the branch pivot for personal-email logic). */
function findEmailKey(config: FormConfig): string | null {
  return config.steps.find((s) => s.type === 'email')?.key ?? null;
}

/**
 * True when a choice step collects MULTIPLE answers (checkboxes). Only a
 * `multiple_choice` step with `selectionMode === 'multiple'` is multi-select;
 * everything else (absent mode, `'single'`, `dropdown`) is a single pick. Shared
 * by the renderer and the builder so both agree on radios-vs-checkboxes.
 */
export function isMultiSelect(step: FormStep): boolean {
  return step.type === 'multiple_choice' && step.selectionMode === 'multiple';
}

/**
 * The first goto rule on `step` whose values intersect the step's own answer,
 * or `null` when none match. First match wins (rules run top to bottom).
 */
function resolveGoto(step: FormStep, answers: Answers): GotoRule | null {
  if (!step.goto || step.goto.length === 0) return null;
  const got = new Set(tokens(answers[step.key]));
  for (const rule of step.goto) {
    if (rule.values.some((v) => got.has(v))) return rule;
  }
  return null;
}

/**
 * Walk an ordered, visible step list applying forward `goto` jumps: at each
 * step, a matching rule jumps to its target (skipping the steps in between) or
 * ends the flow (`target: null`). Only forward targets take effect — a missing
 * or backward target is ignored (the walk continues linearly) — and a `seen`
 * guard makes the walk provably terminate, so no configuration can loop. Steps
 * jumped over are absent from the returned path (never shown, never scored).
 */
function applyGoto(steps: FormStep[], answers: Answers): FormStep[] {
  const indexByKey = new Map(steps.map((s, i) => [s.key, i] as const));
  const path: FormStep[] = [];
  const seen = new Set<string>();
  let i = 0;
  while (i < steps.length) {
    const step = steps[i];
    if (!step || seen.has(step.key)) break;
    seen.add(step.key);
    path.push(step);
    const rule = resolveGoto(step, answers);
    if (rule) {
      if (rule.target == null) break; // skip to end
      const target = indexByKey.get(rule.target);
      if (target != null && target > i) {
        i = target; // forward jump — skip the steps in between
        continue;
      }
      // Missing or backward target: ignore and continue linearly (loop-safe).
    }
    i += 1;
  }
  return path;
}

/**
 * True when the answer looks like a personal/free-mail address. Accepts an
 * answer value (or a raw string); non-strings and empties are never personal.
 */
export function isPersonalEmail(value: AnswerValue): boolean {
  if (typeof value !== 'string') return false;
  const domain = value.trim().toLowerCase().split('@')[1] ?? '';
  if (!domain) return false;
  const base = domain.split('.')[0] ?? '';
  return PERSONAL_EMAIL_DOMAINS.has(domain) || FREE_EMAIL_BASES.has(base);
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Common personal/free email domains rejected when `corporateEmailOnly`. */
const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'hotmail.com',
  'outlook.com',
  'yahoo.com',
  'icloud.com',
  'live.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
]);
/** Domain "base" tokens (before the first dot) also treated as free-mail. */
const FREE_EMAIL_BASES = new Set([
  'gmail',
  'hotmail',
  'outlook',
  'yahoo',
  'icloud',
  'live',
  'aol',
  'msn',
  'proton',
  'protonmail',
]);

/**
 * ITU E.164 country calling codes (without '+') — the SAME dial set as
 * `@quill/shared`'s country list. Embedded here rather than imported so the
 * engine stays a dependency-free pure leaf. E.164 codes are prefix-free, so the
 * longest leading match on a '+<code><number>' value is the exact dial code. A
 * code missing from this set only makes the subscriber count more LENIENT (it
 * can never over-strip), so validation never wrongly rejects a real number.
 */
const E164_DIAL_CODES: ReadonlySet<string> = new Set([
  '1', '7', '20', '27', '30', '31', '32', '33', '34', '36', '39', '40',
  '41', '43', '44', '45', '46', '47', '48', '49', '51', '52', '53', '54',
  '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '81',
  '82', '84', '86', '90', '91', '92', '93', '94', '95', '98', '211', '212',
  '213', '216', '218', '220', '221', '222', '223', '224', '225', '226', '227', '228',
  '229', '230', '231', '232', '233', '234', '235', '236', '237', '238', '239', '240',
  '241', '242', '243', '244', '245', '248', '249', '250', '251', '252', '253', '254',
  '255', '256', '257', '258', '260', '261', '262', '263', '264', '265', '266', '267',
  '268', '269', '291', '297', '298', '299', '350', '351', '352', '353', '354', '355',
  '356', '357', '358', '359', '370', '371', '372', '373', '374', '375', '376', '377',
  '378', '380', '381', '382', '385', '386', '387', '389', '420', '421', '423', '500',
  '501', '502', '503', '504', '505', '506', '507', '508', '509', '590', '591', '592',
  '593', '594', '595', '596', '597', '598', '599', '670', '673', '674', '675', '676',
  '677', '678', '679', '680', '681', '682', '683', '685', '686', '687', '688', '689',
  '690', '691', '692', '850', '852', '853', '855', '856', '880', '886', '960', '961',
  '962', '963', '964', '965', '966', '967', '968', '970', '971', '972', '973', '974',
  '975', '976', '977', '992', '993', '994', '995', '996', '998',
]);

/**
 * The SUBSCRIBER digits of a phone answer — the national number with the dial
 * code excluded. For an E.164 value ('+<dial><number>', the shape the public
 * phone field stores) the leading dial code is stripped; any other value (a bare
 * number or a legacy free-text phone) contributes all of its digits. This is
 * what `phoneMinDigits` counts, so a country prefix never pads the length.
 */
export function phoneSubscriberDigits(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (!value.trimStart().startsWith('+')) return digits;
  // Longest leading dial code (1–3 digits); prefix-free ⇒ the match is exact.
  for (let len = Math.min(3, digits.length); len >= 1; len -= 1) {
    if (E164_DIAL_CODES.has(digits.slice(0, len))) return digits.slice(len);
  }
  return digits;
}

/** Validate one answer against its step. Pure; used on both client and server. */
export function validateAnswer(step: FormStep, value: AnswerValue): ValidationResult {
  // Info steps never carry input.
  if (step.type === 'message') return { ok: true };

  const empty =
    value == null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0);

  if (empty) {
    return step.required ? { ok: false, error: 'This field is required.' } : { ok: true };
  }

  switch (step.type) {
    case 'email': {
      const email = String(value).trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return { ok: false, error: 'Enter a valid email address.' };
      // Use the SAME personal-email test as validateAnswerCode (domain list +
      // free-mail bases) so both validators agree on any given address.
      if (step.corporateEmailOnly && isPersonalEmail(email))
        return { ok: false, error: 'Please use your work email address.' };
      return { ok: true };
    }
    case 'phone': {
      // Count SUBSCRIBER digits (dial code excluded) so a country prefix on an
      // E.164 value ('+525512345678') never pads the length past the minimum.
      const digits = phoneSubscriberDigits(String(value));
      const min = step.phoneMinDigits ?? 7;
      if (digits.length < min) return { ok: false, error: 'Enter a valid phone number.' };
      return { ok: true };
    }
    case 'slider': {
      const n = Number(value);
      if (Number.isNaN(n)) return { ok: false, error: 'Enter a number.' };
      if (step.min != null && n < step.min) return { ok: false, error: 'Value is too low.' };
      if (step.max != null && n > step.max) return { ok: false, error: 'Value is too high.' };
      return { ok: true };
    }
    case 'dropdown':
    case 'multiple_choice': {
      const allowed = new Set((step.options ?? []).map((o) => o.value));
      const picked = tokens(value);
      if (picked.some((p) => !allowed.has(p)))
        return { ok: false, error: 'Choose one of the available options.' };
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}

/** Points for a single choice/dropdown answer (sum across multi-select). */
function optionPoints(step: FormStep, value: AnswerValue): number {
  const byValue = new Map((step.options ?? []).map((o) => [o.value, o.points ?? 0]));
  return tokens(value).reduce((sum, t) => sum + (byValue.get(t) ?? 0), 0);
}

/** Points for a slider answer via its scoring ranges. */
function sliderPoints(step: FormStep, value: AnswerValue): number {
  const n = Number(value);
  if (Number.isNaN(n)) return 0;
  for (const r of step.sliderScoring ?? []) {
    if (n >= r.min && n <= r.max) return r.points;
  }
  return 0;
}

/**
 * The total score from the answers: option points + slider-range points + any
 * flat step points, over the QUALIFICATION steps only (lead-capture fields such
 * as name/email/phone never contribute). Hidden steps (failed skip-logic) are
 * excluded — a branch the respondent never saw can't score.
 */
export function computeScore(config: FormConfig, answers: Answers): number {
  if (config.scoring && config.scoring.enabled === false) return 0;
  // The runtime PATH (visibility + forward goto jumps) — a step jumped over by a
  // branch is never shown and must never score.
  const visible = new Set(runtimeSteps(config, answers).map((s) => s.key));
  let score = 0;
  for (const step of config.steps) {
    if (step.flowGroup === 'lead_capture') continue;
    if (!visible.has(step.key)) continue;
    const value = answers[step.key];
    if (value == null || value === '') continue;
    if (step.type === 'dropdown' || step.type === 'multiple_choice') score += optionPoints(step, value);
    else if (step.type === 'slider') score += sliderPoints(step, value);
    if (step.points) score += step.points;
  }
  return score;
}

/**
 * Does one override rule match the answers? The answer for `rule.field` must
 * EXIST (a missing/empty answer never matches) and every SPECIFIED clause must
 * hold: `values` intersects the string/array answer; `maxValue`/`minValue`
 * bound the numeric answer. A non-numeric answer fails a numeric clause; a rule
 * with no clauses (malformed) never matches.
 */
function overrideRuleMatches(rule: OutcomeOverrideRule, answers: Answers): boolean {
  const value = answers[rule.field];
  const missing = value == null || value === '' || (Array.isArray(value) && value.length === 0);
  if (missing) return false;

  let hasClause = false;
  if (rule.values !== undefined) {
    hasClause = true;
    const got = new Set(tokens(value));
    if (!rule.values.some((v) => got.has(v))) return false;
  }
  if (rule.maxValue !== undefined || rule.minValue !== undefined) {
    hasClause = true;
    // Only a number or a numeric string is numeric — booleans/arrays/objects
    // (which Number() would happily coerce) fail the clause.
    const n =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() !== ''
          ? Number(value)
          : NaN;
    if (Number.isNaN(n)) return false;
    if (rule.maxValue !== undefined && n > rule.maxValue) return false;
    if (rule.minValue !== undefined && n < rule.minValue) return false;
  }
  return hasClause;
}

/**
 * The outcome for a score: the highest `minScore` bucket the score clears.
 * When `answers` are supplied (additive; back-compat), answer-forced `overrides`
 * are evaluated FIRST — outcomes are scanned in declared order and the first
 * outcome with any matching override rule wins regardless of score (e.g. a
 * slider answer <= 0 forces the disqualify outcome over a higher-scoring bucket).
 */
export function resolveOutcome(
  config: FormConfig,
  score: number,
  answers?: Answers,
): FormOutcome | null {
  const outcomes = config.outcomes ?? [];
  if (answers) {
    for (const outcome of outcomes) {
      if (outcome.overrides?.some((rule) => overrideRuleMatches(rule, answers))) return outcome;
    }
  }
  const buckets = outcomes
    .filter((o) => (o.minScore ?? 0) <= score)
    .sort((a, b) => (b.minScore ?? 0) - (a.minScore ?? 0));
  return buckets[0] ?? null;
}

// ---------------------------------------------------------------------------
// Phase-1 runtime helpers (pure; unit-tested). The renderer walks these so the
// public experience is fully engine-driven — client and server agree on flow,
// score, and outcome. Existing signatures above are untouched; these are new.
// ---------------------------------------------------------------------------

/** Stable-code validation for localized inline errors (renderer maps code→copy). */
export type ValidationCode =
  | 'required'
  | 'email'
  | 'work_email'
  | 'phone'
  | 'number'
  | 'too_low'
  | 'too_high'
  | 'option';

export type ValidationCodeResult = { ok: true } | { ok: false; code: ValidationCode };

/**
 * Like `validateAnswer` but returns a stable machine code instead of English
 * copy — the renderer resolves the code to a localized message. For a `name`
 * step, pass the full answers object so both sub-fields are checked.
 */
export function validateAnswerCode(
  step: FormStep,
  value: AnswerValue,
  answers: Answers = {},
): ValidationCodeResult {
  if (step.type === 'message') return { ok: true };

  if (step.type === 'name') {
    const fields = nameFields(step);
    for (const f of fields) {
      const v = answers[f];
      const empty = v == null || String(v).trim() === '';
      if (empty && step.required) return { ok: false, code: 'required' };
    }
    return { ok: true };
  }

  const empty =
    value == null || value === '' || (Array.isArray(value) && value.length === 0);
  if (empty) return step.required ? { ok: false, code: 'required' } : { ok: true };

  switch (step.type) {
    case 'email': {
      const email = String(value).trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return { ok: false, code: 'email' };
      if (step.corporateEmailOnly && isPersonalEmail(email))
        return { ok: false, code: 'work_email' };
      return { ok: true };
    }
    case 'phone': {
      const digits = phoneSubscriberDigits(String(value));
      if (digits.length < (step.phoneMinDigits ?? 7)) return { ok: false, code: 'phone' };
      return { ok: true };
    }
    case 'slider': {
      const n = Number(value);
      if (Number.isNaN(n)) return { ok: false, code: 'number' };
      if (step.min != null && n < step.min) return { ok: false, code: 'too_low' };
      if (step.max != null && n > step.max) return { ok: false, code: 'too_high' };
      return { ok: true };
    }
    case 'dropdown':
    case 'multiple_choice': {
      const allowed = new Set((step.options ?? []).map((o) => o.value));
      if (tokens(value).some((t) => !allowed.has(t))) return { ok: false, code: 'option' };
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}

/** The sub-fields a `name` step collects (default firstname + lastname). */
export function nameFields(step: FormStep): string[] {
  if (step.type === 'name') return step.fields ?? ['firstname', 'lastname'];
  return [step.key];
}

/**
 * Two-phase order: qualification steps first, then lead-capture — a stable
 * partition that preserves each step's relative order within its phase. Steps
 * with no `flowGroup` are treated as qualification.
 */
export function orderSteps(steps: FormStep[]): FormStep[] {
  const qualification = steps.filter((s) => s.flowGroup !== 'lead_capture');
  const leadCapture = steps.filter((s) => s.flowGroup === 'lead_capture');
  return [...qualification, ...leadCapture];
}

/** Resolve one `[field]` token to its substitution text (arrays join with `, `). */
function resolveToken(value: AnswerValue): string {
  if (value == null) return '';
  return Array.isArray(value) ? value.join(', ') : String(value);
}

/**
 * Replace `[key]` tokens in copy with the corresponding answer. A token whose
 * answer is missing/empty resolves to nothing AND the connector that joined it to
 * the rest of the sentence is swept up with it, so no dangling *joining* punctuation
 * or whitespace is left behind (a connector that only *follows* the token belongs to
 * the next clause and is kept):
 *  - a **leading** empty token takes its trailing `,`/`:`/`;`/`-` + spaces with
 *    it and the sentence is re-capitalized — `"[firstname], what problem…"` with
 *    no firstname reads `"What problem…"`, `"[firstname] how are you"` → `"How
 *    are you"`;
 *  - an **embedded/trailing** empty token takes the space *and* an orphaned
 *    connector *in front of* it — `"Hi [firstname]!"` → `"Hi!"`,
 *    `"What is your role, [firstname]?"` → `"What is your role?"`; a connector
 *    *after* the token belongs to the following clause and is kept —
 *    `"Hi [firstname], welcome"` → `"Hi, welcome"`;
 *  - duplicate spaces a removal creates are collapsed and the ends trimmed.
 *
 * Copy with **no empty tokens** is substituted verbatim — byte-for-byte identical
 * to a plain replace — so the all-resolved path (including a resolved token's own
 * spacing) is unchanged. Pure and deterministic; every regex is linear (no
 * catastrophic backtracking).
 */
export function interpolate(template: string, answers: Answers): string {
  // Private-use sentinel marks where an empty token stood, so the cleanup pass can
  // find the orphaned connector without disturbing any resolved text around it.
  const EMPTY = '\uE000';
  let hadEmpty = false;
  const substituted = template.replace(/\[([a-zA-Z0-9_]+)\]/g, (_m, field: string) => {
    const resolved = resolveToken(answers[field]);
    if (resolved === '') {
      hadEmpty = true;
      return EMPTY;
    }
    return resolved;
  });
  // Fast path: nothing empty → behave exactly like the original plain replace.
  if (!hadEmpty) return substituted;

  // The copy opened with a token that resolved empty: its first surviving word was
  // mid-sentence a moment ago, so it should be re-capitalized after the cleanup.
  const lead = template.match(/^\s*\[([a-zA-Z0-9_]+)\]/);
  const leadingEmpty = lead != null && resolveToken(answers[lead[1]]) === '';

  let cleaned = substituted;
  if (leadingEmpty) {
    // Leading/flush empty token: also drop an orphaned trailing connector +
    // spaces ('[x], what' becomes 'what', '[x] how' becomes 'how').
    cleaned = cleaned.replace(/^[ \t]*\uE000[ \t]*(?:[,:;-][ \t]*)?/, '');
  }
  cleaned = cleaned
    // Embedded/trailing empty token: drop the space(s) in front of it, plus an
    // orphaned connector that joined it to the preceding clause ('role, [x]?'
    // becomes 'role?'). A connector AFTER the token belongs to the following
    // clause and is kept ('Hi [x], welcome' becomes 'Hi, welcome').
    .replace(/[ \t]*(?:[,:;-][ \t]*)?\uE000/g, '')
    // Any sentinel that survived the pass (defensive) is removed.
    .split(EMPTY)
    .join('')
    // Collapse the double space a removal may have created, then trim the ends.
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return leadingEmpty ? cleaned.replace(/\p{L}/u, (c) => c.toUpperCase()) : cleaned;
}

/** The lookup token a `questionField` answer resolves to for variant selection. */
function variantKey(raw: AnswerValue): string {
  return raw == null ? '' : Array.isArray(raw) ? raw.join(',') : String(raw);
}

/**
 * The question to show for a step given the answers so far: a `questionVariants`
 * match on `questionField` (falling back to `*` then the plain `question`), with
 * `[field]` interpolation applied to the result. Shared by the builder preview
 * and the public renderer so both resolve dynamic questions identically.
 */
export function resolveQuestion(step: FormStep, answers: Answers): string {
  let text = step.question ?? '';
  if (step.questionField && step.questionVariants) {
    const key = variantKey(answers[step.questionField]);
    text = step.questionVariants[key] ?? step.questionVariants['*'] ?? text;
  }
  return interpolate(text, answers);
}

/**
 * Resolve a step for display against the answers: pick the dynamic question
 * variant (via `resolveQuestion`), interpolate `[key]` tokens in the question,
 * and resolve the slider unit label variant. Returns a shallow copy — never
 * mutates the config.
 */
export function resolveStepDisplay(step: FormStep, answers: Answers): FormStep {
  const question = resolveQuestion(step, answers);
  let sliderUnitLabel = step.sliderUnitLabel ?? null;
  if (step.questionField && step.sliderLabelVariants) {
    const key = variantKey(answers[step.questionField]);
    if (step.sliderLabelVariants[key]) sliderUnitLabel = step.sliderLabelVariants[key];
  }
  return { ...step, question, sliderUnitLabel };
}

/**
 * The ordered, visible, display-resolved steps the renderer walks — the single
 * source of truth for the public flow. Composes `orderSteps` (two-phase) +
 * `visibleSteps` (skip-logic + personal-email branch) + `resolveStepDisplay`
 * (dynamic variants + interpolation).
 */
export function runtimeSteps(config: FormConfig, answers: Answers): FormStep[] {
  const ordered: FormConfig = { ...config, steps: orderSteps(config.steps) };
  const visible = visibleSteps(ordered, answers).map((s) => resolveStepDisplay(s, answers));
  return applyGoto(visible, answers);
}

/** The key of the step at `partialSubmitAfterStep` (1-based over `steps`), or null. */
export function partialSubmitKey(config: FormConfig): string | null {
  const n = config.partialSubmitAfterStep;
  if (n == null || n < 1) return null;
  return config.steps[n - 1]?.key ?? null;
}

// ---------------------------------------------------------------------------
// URL safety (XSS). Shared by the zod config schema (server-side validation on
// save) AND the public renderer (a runtime guard before navigating). Belt-and-
// braces: a config could reach the renderer from an older/looser source, so the
// sink is guarded too — never assign a non-http(s) URL to `window.location`.
// ---------------------------------------------------------------------------

/**
 * True only for http(s) URLs — the allowlist for anything assigned to
 * `window.location` (e.g. an outcome `redirectUrl`). Rejects `javascript:`,
 * `data:`, `vbscript:`, etc., which `URL`/zod `.url()` would otherwise accept.
 */
export function isSafeHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

/**
 * True for URLs safe to render into an `<img src>`: http(s), protocol-relative
 * (`//host`), root/relative paths, and `data:image/…` URIs. Rejects script
 * protocols (`javascript:`/`vbscript:`) and non-image `data:` payloads.
 */
export function isSafeImageUrl(url: string): boolean {
  const s = url.trim().toLowerCase();
  if (s.startsWith('javascript:') || s.startsWith('vbscript:')) return false;
  if (s.startsWith('data:') && !s.startsWith('data:image/')) return false;
  return true;
}
