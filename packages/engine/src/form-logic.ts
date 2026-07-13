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
  /** Flat points awarded just for answering (rare; most points come from options). */
  points?: number;
  flowGroup?: FlowGroup;
  /** Email validation: reject public/personal domains. */
  corporateEmailOnly?: boolean;
  /** Phone validation: minimum digit count. */
  phoneMinDigits?: number;
}

export interface FormOutcome {
  id: string;
  label: string;
  /** Inclusive lower score bound for this bucket (highest matching wins). */
  minScore?: number;
  redirectUrl?: string | null;
}

export interface FormCover {
  enabled?: boolean;
  eyebrow?: string | null;
  headline?: string | null;
  subheadline?: string | null;
  ctaText?: string | null;
  trustBadge?: string | null;
}

export interface FormConfig {
  version: 1;
  cover?: FormCover | null;
  steps: FormStep[];
  scoring?: { enabled?: boolean } | null;
  outcomes?: FormOutcome[];
}

export type AnswerValue = string | string[] | number | boolean | null | undefined;
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
 * when its `showWhen` holds (or is absent) AND its `hideWhen` does not hold.
 */
export function visibleSteps(config: FormConfig, answers: Answers): FormStep[] {
  return config.steps.filter((step) => {
    if (step.showWhen && !conditionHolds(step.showWhen, answers)) return false;
    if (step.hideWhen && conditionHolds(step.hideWhen, answers)) return false;
    return true;
  });
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
      if (step.corporateEmailOnly) {
        const domain = email.split('@')[1] ?? '';
        if (PERSONAL_EMAIL_DOMAINS.has(domain))
          return { ok: false, error: 'Please use your work email address.' };
      }
      return { ok: true };
    }
    case 'phone': {
      const digits = String(value).replace(/\D/g, '');
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
  const visible = new Set(visibleSteps(config, answers).map((s) => s.key));
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

/** The outcome bucket for a score: the highest `minScore` the score clears. */
export function resolveOutcome(config: FormConfig, score: number): FormOutcome | null {
  const buckets = (config.outcomes ?? [])
    .filter((o) => (o.minScore ?? 0) <= score)
    .sort((a, b) => (b.minScore ?? 0) - (a.minScore ?? 0));
  return buckets[0] ?? null;
}
