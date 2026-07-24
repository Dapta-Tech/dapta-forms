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
} from './form-logic';
import { revealAfterKey } from './form-logic';

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
    required: !(type === 'message' || type === 'reveal'),
    flowGroup: defaultFlowGroup(type),
  };

  if (type === 'dropdown' || type === 'multiple_choice') {
    base.options = [{ label: 'Option 1', value: 'option_1', points: 0 }];
  }
  // A bare multiple_choice is single-select by default (radios) — matches every
  // existing form. The builder's gallery overrides this to 'multiple' when the
  // author explicitly picks "Multiple choice".
  if (type === 'multiple_choice') {
    base.selectionMode = 'single';
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
  // A reveal step owns its copy and duration, so a form can hold several with
  // different messages (V5-B3). Seeded enabled — an author who drops one in
  // wants it to play.
  if (type === 'reveal') {
    base.reveal = { enabled: true, headline: '', subtitle: '', durationMs: 2200 };
  }
  // A scheduler embeds a booking page; it starts unconfigured (no event type
  // picked yet) but with prefill on, so once the author picks a Calendly event
  // type the visitor's name/email flow into the widget automatically (V6).
  if (type === 'scheduler') {
    base.scheduler = { provider: 'calendly', prefill: true };
  }
  return base;
}

/** The interstitial's play time when nothing is configured (mirrors the renderer). */
const DEFAULT_REVEAL_MS = 2200;

/**
 * Fold a legacy FORM-LEVEL reveal into a real `reveal` STEP.
 *
 * The reveal used to be a singleton on the config — `config.reveal` for the copy
 * (authored in the Design tab) plus `config.revealAfterStep` (or a step's older
 * `triggersReveal` flag) for the position. It is now an ordinary step type, so a
 * form can carry several with their own copy. Keeping both shapes meant two
 * places to author one thing, which is what this collapses: the legacy copy
 * becomes a `reveal` step inserted exactly where {@link revealAfterKey} said it
 * played, and every legacy field is dropped.
 *
 * A DISABLED legacy reveal contributes no step — it never played.
 *
 * Idempotent, and a no-op on configs that never had a form-level reveal. Only
 * the builder calls this: a PUBLISHED config keeps its legacy shape (and the
 * renderer keeps honoring it) until the form is re-saved.
 */
export function migrateRevealToStep(config: FormConfig): FormConfig {
  const legacy = config.reveal;
  const hasLegacy =
    legacy != null ||
    config.revealAfterStep != null ||
    config.steps.some((s) => s.triggersReveal);
  if (!hasLegacy) return config;

  // `triggersReveal` only ever meant "the reveal plays after me" — the flagged
  // step carries no reveal copy of its own, so it is dead weight the moment the
  // position IS a step in the list.
  let steps: FormStep[] = config.steps.map((s) => {
    if (!s.triggersReveal) return s;
    const { triggersReveal: _dropped, ...rest } = s;
    return rest;
  });

  const anchorKey = revealAfterKey(config);
  if (anchorKey != null) {
    const anchor = steps.findIndex((s) => s.key === anchorKey);
    const at = anchor >= 0 ? anchor + 1 : steps.length;
    const step = createEmptyStep('reveal', new Set(steps.map((s) => s.key)));
    step.reveal = {
      enabled: true,
      headline: legacy?.headline ?? '',
      // `subtitleTemplate` won over `subtitle` at runtime and BOTH interpolate
      // `[key]` tokens, so collapsing them onto one field renders identically.
      subtitle: legacy?.subtitleTemplate || legacy?.subtitle || '',
      durationMs: legacy?.durationMs ?? DEFAULT_REVEAL_MS,
      ...(legacy?.prewarm ? { prewarm: true } : {}),
    };
    steps = [...steps.slice(0, at), step, ...steps.slice(at)];
  }

  const { reveal: _copy, revealAfterStep: _position, ...rest } = config;
  return { ...rest, steps };
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
    // Lock single-select behavior for choice steps that never declared a mode
    // (back-compat: an existing multiple_choice stays radios, not checkboxes).
    if (step.type === 'multiple_choice' && step.selectionMode == null) {
      next.selectionMode = 'single';
    }
    // Rewrite goto targets through the rename map and drop dangling rules (a
    // target that no longer resolves to a step, or that points at THIS step).
    if (step.goto && step.goto.length > 0) {
      const rules = step.goto
        .map((r) => ({ ...r, target: r.target == null ? null : remap(r.target) }))
        .filter((r) => r.target == null || (taken.has(r.target) && r.target !== next.key));
      if (rules.length > 0) next.goto = rules;
      else delete next.goto;
    }
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

  // Preserve every additive top-level field the builder doesn't normalize
  // (reveal, partialSubmitAfterStep, tracking, destinations, …) — normalizing
  // must never drop config it doesn't understand (schema v1 is additive-only).
  const {
    version: _version,
    steps: _steps,
    cover,
    branding,
    outcomes: _outcomes,
    scoring: _scoring,
    ...passthrough
  } = config as FormConfig & Record<string, unknown>;

  const next: FormConfig = {
    ...passthrough,
    version: 1,
    steps: normalized,
    ...(cover != null ? { cover } : {}),
    ...(branding != null ? { branding } : {}),
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

// `interpolate` and `resolveQuestion` are unified in ./form-logic (the core the
// runtime and the builder preview both call) — re-exported via the package index.
