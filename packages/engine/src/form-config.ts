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
  // A url step hints at the shape it expects; the stored value always carries a
  // scheme (see `normalizeUrl`), so the placeholder shows one too.
  if (type === 'url') {
    base.placeholder = 'https://';
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

/**
 * Does this option's `value` still look derived from its `label`?
 *
 * The builder writes `value` for you and gets out of the way the moment you
 * write it yourself, so every label edit has to answer this first. Three shapes
 * count as "the builder wrote it":
 *
 *  - empty: nothing to protect;
 *  - the slug of the current label: the last thing that wrote it was a label
 *    edit, so the next one may write it again;
 *  - `option_3`: what CREATING an option puts there. This case exists because
 *    the value used to stop following the label, and the forms that came out of
 *    that are exactly the ones this is fixing. Their label reads "More than 50"
 *    while the value still reads `option_3`, so the slug test above calls them
 *    hand-written and would freeze them that way forever. Treating the created
 *    placeholder as unwritten is what lets those heal on the next edit.
 *
 * Someone who deliberately typed `option_3` as their value loses it on their
 * next label edit. That is the trade, and it is the right way round: the
 * placeholder is generated for every option of every form, a hand-typed copy of
 * it is a curiosity, and the recovery is to type it again.
 */
export function isDerivedOptionValue(option: FormOption): boolean {
  const value = (option.value ?? '').trim();
  if (!value) return true;
  if (/^option_\d+$/.test(value)) return true;
  // A blank label proves NOTHING about the value, so it cannot be evidence the
  // author wrote one. `slugify` falls back to 'item' on empty input, so
  // comparing against it would call every value hand-written the moment the
  // field is empty - and emptying the field is how people reword an option.
  // Backspace to nothing and the value freezes wherever it had got to, which is
  // the same label/value divorce this function exists to end, with a stranger
  // token. `setOptionLabel` declines to rename while the label is blank, so
  // answering true here holds the value still and resumes tracking on the next
  // keystroke.
  const derived = slugify(option.label ?? '', '');
  if (!derived) return true;
  return value === derived;
}

/**
 * Move an option's `value`, carrying every pointer aimed at it.
 *
 * An option value is not decoration: it is the token stored as the answer, so
 * everything that reasons about "what did they pick" names it by string. Eight
 * places do, and every one of them is silent when it stops matching, which is
 * why this is a function and not an assignment at a call site:
 *
 *  - `showWhen.values` / `hideWhen.values` on ANY step whose condition reads
 *    this step (`field === stepKey`);
 *  - `goto[].values` on the step that owns the options (a jump is defined by
 *    the answer to its own question);
 *  - the KEYS of `questionVariants` and `sliderLabelVariants` on any step that
 *    sources from this one, including the comma-joined composite keys a
 *    multi-select variant uses;
 *  - `outcomes[].overrides[].values` whose `field` reads this step;
 *  - the owning step's `defaultValue`, which seeds the answer with an option
 *    value and simply stops seeding when it dangles.
 *
 * The eighth lives OUTSIDE this config - a HubSpot destination's
 * `valueMaps[stepKey][value]`, which the draft autosave never writes. It cannot
 * be migrated from here and it is not attempted; the builder refuses to move a
 * value that a CRM mapping depends on instead. See `lockedOptionValues`.
 *
 * A no-op rename, an empty destination, or a value another option on the same
 * step already holds all return the config untouched: a collision would merge
 * two distinct answers into one token, which loses data rather than renaming it.
 * The option is named by INDEX rather than by its current value, because two
 * options can legitimately hold the same one - see the note in the body.
 */
export function renameOptionValue(
  config: FormConfig,
  stepKey: string,
  optionIndex: number,
  newValue: string,
): FormConfig {
  if (!newValue) return config;
  const owner = config.steps.find((s) => s.key === stepKey);
  const target = owner?.options?.[optionIndex];
  if (!owner || !target) return config;
  const oldValue = target.value;
  if (oldValue === newValue) return config;
  if ((owner.options ?? []).some((o, i) => i !== optionIndex && o.value === newValue)) return config;

  // Two options CAN hold the same value: both editors mint `option_${n}` from
  // the list length, so deleting a middle option and adding one mints a value a
  // sibling already has. Renaming every option that matches the string would
  // move a row nobody touched, and `normalizeOptions` would then dedupe the
  // collision into `..._2` on save - a token nothing points at, on an option the
  // author never edited. So the option moves BY POSITION.
  //
  // The pointers are a separate question, because they name a token, not a row.
  // They only follow when the token is actually leaving: if a sibling still
  // holds `oldValue` the answer it names still exists, and repointing would aim
  // a branch at a different option than the one it was authored for.
  const tokenLeaves = !(owner.options ?? []).some((o, i) => i !== optionIndex && o.value === oldValue);

  const repoint = (values: string[] | undefined): string[] | undefined =>
    values == null ? undefined : values.map((v) => (v === oldValue ? newValue : v));

  // Variant maps are keyed BY the answer, and a multi-select key is the answer's
  // values joined with commas — so the rename has to reach inside a composite
  // key rather than only matching a whole one. `*` (the fallback key) contains
  // no value and passes through untouched.
  const rekey = (
    map: Record<string, string> | undefined,
  ): Record<string, string> | undefined =>
    map == null
      ? undefined
      : Object.fromEntries(
          Object.entries(map).map(([key, text]) => [
            key
              .split(',')
              .map((part) => (part === oldValue ? newValue : part))
              .join(','),
            text,
          ]),
        );

  const steps = config.steps.map((s) => {
    const next: FormStep = { ...s };
    if (s.key === stepKey && s.options) {
      next.options = s.options.map((o, i) => (i === optionIndex ? { ...o, value: newValue } : o));
      // A choice step's `defaultValue` seeds the answer with an option value
      // (see apps/web/lib/capture-defaults.ts), so it is a pointer like the
      // rest and stops seeding in silence when it dangles.
      if (tokenLeaves && s.defaultValue === oldValue) next.defaultValue = newValue;
      if (tokenLeaves && s.goto) next.goto = s.goto.map((r) => ({ ...r, values: repoint(r.values) ?? [] }));
    }
    if (!tokenLeaves) return next;
    if (s.showWhen?.field === stepKey) {
      next.showWhen = { ...s.showWhen, values: repoint(s.showWhen.values) };
    }
    if (s.hideWhen?.field === stepKey) {
      next.hideWhen = { ...s.hideWhen, values: repoint(s.hideWhen.values) };
    }
    if (s.questionField === stepKey) {
      if (s.questionVariants) next.questionVariants = rekey(s.questionVariants);
      if (s.sliderLabelVariants) next.sliderLabelVariants = rekey(s.sliderLabelVariants);
    }
    return next;
  });

  const outcomes = tokenLeaves
    ? config.outcomes?.map((o) => ({
        ...o,
        overrides: o.overrides?.map((r) =>
          r.field === stepKey ? { ...r, values: repoint(r.values) } : r,
        ),
      }))
    : config.outcomes;

  return { ...config, steps, ...(outcomes ? { outcomes } : {}) };
}

/**
 * Write an option's label, and let the value follow it when the value is still
 * the builder's to write.
 *
 * The single entry point for editing an option label, so the canvas and the
 * settings panel cannot disagree about when the value moves - they did, and
 * that disagreement IS the bug this fixes: the panel has always kept the value
 * in step, the canvas never did, and the canvas is where people type. The result
 * was a form whose labels read properly and whose stored answers all read
 * `option_1`, `option_2`, `option_3`.
 *
 * `locked` names values that must not move whatever they look like: anything
 * already carried by a published config (renaming those splits the historical
 * answers in two) and anything a HubSpot `valueMaps` entry points at (renaming
 * those unmaps the question from the CRM, and this runs per keystroke, so it
 * cannot migrate the mapping the way a field-key rename does). A locked value
 * simply stays put while the label changes, which is the pre-existing behaviour
 * and never loses anything.
 *
 * The derived value is deduped against its siblings, so two labels that slugify
 * alike get `yes` and `yes_2` rather than one of them silently taking the
 * other's answers.
 */
export function setOptionLabel(
  config: FormConfig,
  stepKey: string,
  optionIndex: number,
  label: string,
  locked: ReadonlySet<string> = new Set(),
): FormConfig {
  const step = config.steps.find((s) => s.key === stepKey);
  const option = step?.options?.[optionIndex];
  if (!step || !option) return config;

  const withLabel: FormConfig = {
    ...config,
    steps: config.steps.map((s) =>
      s.key === stepKey
        ? { ...s, options: s.options!.map((o, i) => (i === optionIndex ? { ...o, label } : o)) }
        : s,
    ),
  };

  if (locked.has(option.value) || !isDerivedOptionValue(option)) return withLabel;

  // An empty label derives nothing usable. Leave the value alone rather than
  // slugifying to a fallback: the author is mid-typing, and swapping the value
  // to `item` on the way through would be a rename nobody asked for.
  const base = slugify(label, '');
  if (!base) return withLabel;
  // Deduped against the siblings AND the locked set. Locked values include ones
  // whose option was deleted from the draft, and those are exactly the tokens
  // that must not be reissued: a new option landing on a retired value would
  // inherit every answer already stored against it and any CRM mapping still
  // pointing at it, which is the whole thing the lock exists to prevent.
  const taken = new Set([
    ...(step.options ?? []).filter((_, i) => i !== optionIndex).map((o) => o.value),
    ...locked,
  ]);
  const nextValue = uniqueKey(base, taken);
  if (nextValue === option.value) return withLabel;

  return renameOptionValue(withLabel, stepKey, optionIndex, nextValue);
}

/**
 * What {@link lockedOptionValues} needs from a stored form.
 *
 * Structural rather than `FormConfig` because `destinations` is not part of the
 * engine's config type at all - it lives in `@quill/types`, which this package
 * must not depend on. Reading it through the narrowest shape that answers the
 * question keeps the engine free of that edge while still seeing the CRM
 * mapping, and an unexpected blob degrades to "nothing is locked" instead of
 * throwing inside the builder's first render.
 */
export interface LockSource {
  steps?: Array<{ key: string; options?: Array<{ value: string }> }>;
  destinations?: unknown;
}

/**
 * The option values on this form that a label edit must NOT move, keyed by step.
 *
 * Read from the LIVE config, never the draft being edited, because both reasons
 * a value becomes untouchable are about what already left the building:
 *
 *  - the live config is what the public URL serves, so a respondent could have
 *    answered with that token already. Renaming it does not relabel the history,
 *    it orphans it;
 *  - a HubSpot destination maps that value to a CRM enum. Renaming it unmaps the
 *    answer silently, and the label edit that would trigger it runs per
 *    keystroke, so it cannot migrate the mapping on the way past.
 *
 * Presence in the live config is the gate rather than a `published_at` stamp,
 * which looks like the obvious test and is not: `publishForm` returns early
 * WITHOUT stamping when no draft is pending, so a form created through the API
 * with a config is publicly serving it while `published_at` is still null.
 * Gating on the stamp would leave exactly those forms editable.
 *
 * It does not over-lock, because the builder creates a form EMPTY: the live
 * config carries no options until the author publishes, so everything built
 * before that first publish is free to follow its label. The same goes for an
 * option added afterwards, which is not in the live config and therefore still
 * follows - that is what stops adding one option to a live form reproducing the
 * confusion this exists to remove. A form started from a template locks the
 * template's own options, and those ship deliberate values (`asap`,
 * `in_person`) nobody wants rewritten into a slug of their own sentence.
 */
export function lockedOptionValues(
  liveConfig: LockSource | null | undefined,
): Record<string, string[]> {
  const locked: Record<string, Set<string>> = {};
  const add = (stepKey: string, value: string) => {
    (locked[stepKey] ??= new Set()).add(value);
  };

  for (const step of liveConfig?.steps ?? []) {
    for (const option of step.options ?? []) add(step.key, option.value);
  }
  const destinations = Array.isArray(liveConfig?.destinations) ? liveConfig.destinations : [];
  for (const raw of destinations) {
    const destination = raw as { type?: unknown; valueMaps?: unknown };
    if (destination.type !== 'hubspot') continue;
    const maps = destination.valueMaps;
    if (maps == null || typeof maps !== 'object') continue;
    for (const [stepKey, map] of Object.entries(maps as Record<string, unknown>)) {
      if (map == null || typeof map !== 'object') continue;
      for (const value of Object.keys(map as Record<string, unknown>)) add(stepKey, value);
    }
  }

  return Object.fromEntries(Object.entries(locked).map(([key, set]) => [key, [...set]]));
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

  // The Logic canvas's stored node positions are keyed by STEP KEY — or, for a
  // terminal node, by `outcome:<id>` — which makes them pointers like
  // `goto[].target` and `showWhen.field`: step keys follow the same rename map,
  // and an entry whose step (or outcome) is gone is dropped. A stale entry
  // would pin a node at coordinates its owner no longer occupies, which is the
  // precise kind of lie the canvas exists to remove. Purely presentational, so
  // it is rebuilt rather than passed through untouched.
  const layout = (config as FormConfig).logicLayout;
  const outcomeIdSet = new Set(outcomes.map((o) => `outcome:${o.id}`));
  const logicLayout = layout
    ? Object.fromEntries(
        Object.entries(layout)
          .map(([key, pos]) =>
            key.startsWith('outcome:') ? ([key, pos] as const) : ([remap(key), pos] as const),
          )
          .filter(([key]) => (key.startsWith('outcome:') ? outcomeIdSet.has(key) : taken.has(key))),
      )
    : undefined;

  const next: FormConfig = {
    ...passthrough,
    version: 1,
    steps: normalized,
    ...(cover != null ? { cover } : {}),
    ...(branding != null ? { branding } : {}),
    ...(outcomes.length ? { outcomes } : {}),
    // An emptied map is dropped entirely rather than stored as `{}` — absent is
    // what "no manual positions" already means everywhere else.
    ...(logicLayout && Object.keys(logicLayout).length ? { logicLayout } : { logicLayout: undefined }),
  };
  if (next.logicLayout == null) delete next.logicLayout;

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
