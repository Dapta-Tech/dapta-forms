/**
 * Pure config authoring helpers — the builder's counterpart to form-logic. No
 * DB, no I/O, no framework. The admin editor and the API both lean on these so
 * a saved config is always canonical: unique step keys, a stable derived flow
 * group per step, sorted/id'd outcomes, and clean option values. Kept here (not
 * in the UI) so it's fully unit-tested and identical on client and server.
 */

import type {
  FormConfig,
  FormStep,
  FormFieldType,
  FormOption,
  FormOutcome,
  Answers,
  AnswerValue,
} from './form-logic';

/** Field kinds that capture the lead and therefore never score. */
const LEAD_CAPTURE_TYPES: ReadonlySet<FormFieldType> = new Set<FormFieldType>([
  'name',
  'email',
  'phone',
]);

/** slugify to a safe key/value token; falls back when nothing usable remains. */
export function slugify(text: string, fallback = 'item'): string {
  const slug = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || fallback;
}

/** Make `base` unique against `taken` by appending `_2`, `_3`, … (deterministic). */
export function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}

/** The default flow group for a step type when the author hasn't set one. */
export function defaultFlowGroup(type: FormFieldType): FormStep['flowGroup'] {
  return LEAD_CAPTURE_TYPES.has(type) ? 'lead_capture' : 'qualification';
}

let stepSeq = 0;
/**
 * A fresh, valid step of `type` with a unique key. Sensible per-type defaults
 * mirror the pilot (choice steps start with one option; sliders get a 0–100
 * range). `taken` guarantees the generated key doesn't collide.
 */
export function createEmptyStep(
  type: FormFieldType,
  taken: ReadonlySet<string> = new Set(),
): FormStep {
  stepSeq += 1;
  const key = uniqueKey(`${type}_${stepSeq}`, taken);
  const base: FormStep = {
    key,
    type,
    question: '',
    required: !(type === 'message'),
    flowGroup: defaultFlowGroup(type),
  };

  if (type === 'dropdown' || type === 'multiple_choice') {
    base.options = [{ label: 'Option 1', value: 'option_1', points: 0 }];
  }
  if (type === 'slider') {
    base.min = 0;
    base.max = 100;
    base.step = 1;
    base.default = 50;
    base.sliderScoring = [];
  }
  if (type === 'message') {
    base.buttonText = 'Continue';
  }
  return base;
}

/** A blank outcome bucket with a unique id. */
export function createEmptyOutcome(taken: ReadonlySet<string> = new Set()): FormOutcome {
  stepSeq += 1;
  return { id: uniqueKey(`outcome_${stepSeq}`, taken), label: '', minScore: 0 };
}

/** Normalize a single step's options: fill values from labels, dedupe values. */
function normalizeOptions(options: FormOption[] | undefined): FormOption[] | undefined {
  if (!options || options.length === 0) return options;
  const taken = new Set<string>();
  return options.map((o, i) => {
    const base = (o.value && o.value.trim()) || slugify(o.label ?? '', `option_${i + 1}`);
    const value = uniqueKey(base, taken);
    taken.add(value);
    return {
      label: o.label ?? value,
      value,
      ...(o.points != null ? { points: o.points } : {}),
      ...(o.icon ? { icon: o.icon } : {}),
    };
  });
}

/** True when the config carries any scoring signal (points / ranges / outcomes). */
export function hasScoringSignal(config: FormConfig): boolean {
  if ((config.outcomes ?? []).length > 0) return true;
  return config.steps.some(
    (s) =>
      (s.points ?? 0) !== 0 ||
      (s.sliderScoring ?? []).length > 0 ||
      (s.options ?? []).some((o) => (o.points ?? 0) !== 0),
  );
}

/**
 * Return a canonical, save-ready config:
 *  - every step has a unique, non-empty `key` (collisions get `_2`, `_3`…),
 *  - references (`showWhen`/`hideWhen`/`questionField`) are rewritten to follow
 *    any key that had to change, so skip-logic never dangles,
 *  - each step gets a derived `flowGroup` when absent (lead-capture fields
 *    never score),
 *  - options get filled/deduped values,
 *  - outcomes are sorted by `minScore` ascending with unique ids,
 *  - `scoring.enabled` is derived when the author left it unset but the form
 *    clearly scores.
 * Pure and idempotent: normalizing an already-canonical config is a no-op.
 */
export function normalizeConfig(config: FormConfig): FormConfig {
  const taken = new Set<string>();
  const assigned: string[] = [];
  const preserved = new Set<string>();

  const steps: FormStep[] = config.steps.map((step, i) => {
    const desired =
      (step.key && step.key.trim()) || slugify(step.question ?? '', `step_${i + 1}`);
    const key = uniqueKey(desired, taken);
    taken.add(key);
    assigned.push(key);
    if (step.key && step.key === key) preserved.add(step.key);
    return { ...step, key };
  });

  // Build the rename map only for keys that actually changed and weren't kept
  // by an earlier step (a reference to a duplicated key resolves to the first,
  // preserved occurrence — never to the suffixed later one).
  const rename = new Map<string, string>();
  config.steps.forEach((step, i) => {
    if (step.key && step.key !== assigned[i] && !preserved.has(step.key) && !rename.has(step.key)) {
      rename.set(step.key, assigned[i]);
    }
  });

  const remap = (field: string): string => rename.get(field) ?? field;

  const normalized = steps.map((step) => {
    const next: FormStep = {
      ...step,
      flowGroup: step.flowGroup ?? defaultFlowGroup(step.type),
    };
    if (step.options) next.options = normalizeOptions(step.options);
    if (step.showWhen) next.showWhen = { ...step.showWhen, field: remap(step.showWhen.field) };
    if (step.hideWhen) next.hideWhen = { ...step.hideWhen, field: remap(step.hideWhen.field) };
    if (step.questionField) next.questionField = remap(step.questionField);
    return next;
  });

  const outcomeIds = new Set<string>();
  const outcomes = (config.outcomes ?? [])
    .map((o, i) => {
      const id = uniqueKey((o.id && o.id.trim()) || `outcome_${i + 1}`, outcomeIds);
      outcomeIds.add(id);
      return { ...o, id };
    })
    .sort((a, b) => (a.minScore ?? 0) - (b.minScore ?? 0));

  const next: FormConfig = {
    version: 1,
    steps: normalized,
    ...(config.cover != null ? { cover: config.cover } : {}),
    ...(config.branding != null ? { branding: config.branding } : {}),
    ...(outcomes.length ? { outcomes } : {}),
  };

  // Derive scoring only when the author never spoke to it.
  if (config.scoring != null) {
    next.scoring = config.scoring;
  } else if (hasScoringSignal(next)) {
    next.scoring = { enabled: true };
  }

  return next;
}

/** Replace `[field]` tokens with the respondent's answer to that field. */
export function interpolate(template: string, answers: Answers): string {
  return template.replace(/\[([a-zA-Z0-9_]+)\]/g, (_, field: string) => {
    const value: AnswerValue = answers[field];
    if (value == null) return '';
    return Array.isArray(value) ? value.join(', ') : String(value);
  });
}

/**
 * The question to show for a step given the answers so far: a `questionVariants`
 * match on `questionField` (falling back to `*` then the plain `question`), with
 * `[field]` interpolation applied to the result.
 */
export function resolveQuestion(step: FormStep, answers: Answers): string {
  let text = step.question ?? '';
  if (step.questionField && step.questionVariants) {
    const raw = answers[step.questionField];
    const key = raw == null ? '' : Array.isArray(raw) ? raw.join(',') : String(raw);
    text = step.questionVariants[key] ?? step.questionVariants['*'] ?? text;
  }
  return interpolate(text, answers);
}
