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

import type {
  FormBackgroundStyle,
  FormButtonStyle,
  FormContentAlign,
  FormContentWidth,
  FormCustomFont,
  FormFont,
  FormLogoPosition,
  FormLogoSize,
  FormProgressStyle,
  FormRadius,
  FormTransition,
} from './form-design';

/**
 * The step kinds a form can contain. `message` is an info step with no input;
 * `reveal` is a timed processing interstitial (V5-B3) — also inputless, but it
 * advances itself after its duration instead of waiting for a click.
 */
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
  'reveal',
  'scheduler',
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/** How a choice step lays its options out. */
export const FORM_OPTION_LAYOUTS = ['list', 'cards'] as const;
export type FormOptionLayout = (typeof FORM_OPTION_LAYOUTS)[number];

/** A single option for a choice/dropdown step; `points` feeds the score. */
export interface FormOption {
  label: string;
  value: string;
  points?: number;
  /**
   * Either an emoji/short glyph or an image URL — `isImageIcon` tells them
   * apart, because the two need opposite treatment when rendered (a glyph
   * centres in a circle; a logo needs a rectangle it can letterbox into).
   */
  icon?: string | null;
}

/** Slider value-range → points (pilot `sliderScoring`). */
export interface SliderScoringRange {
  min: number;
  max: number;
  points: number;
}

/**
 * Comparison operators a visibility condition can use, picked by the referenced
 * field's TYPE (see {@link operatorsForFieldType}). `in` is the legacy
 * "matches any of" set-membership test (choice/text sources); the numeric ops
 * (`eq`/`gt`/`lt`/`between`) compare the answer parsed as a number.
 */
export const CONDITION_OPS = ['in', 'eq', 'gt', 'lt', 'between'] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

/**
 * A visibility condition on the answer to `field`. ADDITIVE + back-compat: with
 * NO `op` (every config authored before operators existed) it is an `in` test —
 * the answer's tokens must intersect `values`. `op` selects the comparison and
 * which operand it reads:
 *  - `in`            → `values` (choice "matches any of"; the default).
 *  - `eq`/`gt`/`lt`  → `value` (the answer parsed as a number, compared to it).
 *  - `between`       → `[min, max]` inclusive (numeric).
 * Operands the active op doesn't use are ignored, so an older `{field, values}`
 * still means exactly what it always did.
 */
export interface StepCondition {
  field: string;
  /** `in` operands ("matches any of"). Optional so a numeric op can omit it. */
  values?: string[];
  /** Operator (absent = `in`, the legacy behavior). */
  op?: ConditionOp;
  /** Operand for `eq` / `gt` / `lt` (the answer is parsed as a number). */
  value?: number;
  /** Lower bound for `between` (inclusive). */
  min?: number;
  /** Upper bound for `between` (inclusive). */
  max?: number;
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
  /**
   * `multiple_choice`: render options as a card grid instead of a radio list.
   * Absent falls back to `showIcons` — see `resolveOptionLayout`.
   */
  optionLayout?: FormOptionLayout;
  /**
   * @deprecated Superseded by `optionLayout` — the flag named its content
   * (icons) rather than what it actually switched (the layout). Still read as
   * the fallback so configs saved before `optionLayout` keep their card grid.
   */
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
  /**
   * Hidden step (additive; back-compat). A hidden step is NEVER rendered as a
   * visible question — {@link visibleSteps} skips it, so it is neither walked nor
   * scored — but its answer can still be SEEDED (e.g. from a matching URL
   * parameter in the public renderer) and carried along into the submission.
   */
  hidden?: boolean;
  /**
   * A value this answer starts with, used only when nothing else supplied one.
   *
   * Precedence is default < URL prefill < what the person types: a link that
   * carries `?email=` must win, or a campaign link would be silently overridden
   * by a default the author set months earlier.
   */
  defaultValue?: string;
  /**
   * Per-question scoring switch (additive; back-compat — V5-B2). `false` makes
   * THIS step contribute nothing to the score while the rest of the form keeps
   * scoring normally; absent/`true` scores as it always has, so every existing
   * config is unchanged. Gated by the form-level `config.scoring.enabled`: with
   * scoring off nothing scores regardless of this flag.
   *
   * Exists because the builder only ever had the FORM-level switch, rendered
   * inside each question's panel — so turning "Scoring" off on one question
   * silently turned it off on all of them.
   */
  scoringEnabled?: boolean;
  /**
   * `phone` step: the ISO 3166-1 alpha-2 country the public phone picker starts
   * on (e.g. "CO"). Absent = the locale-based default (en→US, es→MX). Purely a
   * display default — the stored answer is still a full E.164 string.
   */
  phoneDefaultCountry?: string | null;
  /**
   * `reveal` step: its own headline / subtitle / duration (V5-B3). Reusing the
   * `FormReveal` shape means the renderer's existing RevealScreen takes it
   * unchanged, and each reveal step is independently editable — the legacy
   * `config.reveal` + `config.revealAfterStep` pair could only ever describe ONE
   * interstitial for the whole form.
   */
  reveal?: FormReveal | null;
  /**
   * `scheduler` step: the embedded booking config (V6). A required scheduler is
   * "answered" when the respondent books, so validation blocks Continue until a
   * booking is made — see {@link FormScheduler}.
   */
  scheduler?: FormScheduler | null;
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
  /**
   * The body copy shown on the thank-you screen for this outcome (additive;
   * back-compat). When set it replaces the shared thank-you body; `[key]` tokens
   * interpolate from the answers. `label` stays the heading. Absent = the shared
   * thank-you body is used, so every existing outcome renders exactly as before.
   */
  message?: string | null;
  /** Scheduling handoff (HubSpot Meetings / Calendly) shown for this outcome. */
  booking?: OutcomeBooking | null;
  /** Answer-forced rules: any match makes this outcome win over score bucketing. */
  overrides?: OutcomeOverrideRule[];
  /**
   * Hold the thank-you screen this long before this outcome's redirect fires
   * (additive — V5-B1). Absent = inherit `config.ending.redirectDelayMs`.
   */
  redirectDelayMs?: number;
}

/** A client logo chip on the cover marquee (image `src`, or the `name` as text). */
export interface FormClientLogo {
  name: string;
  src?: string | null;
}

/** Where the cover's promo banner is allowed to render. */
export const FORM_BANNER_SCOPES = ['form', 'cover'] as const;
export type FormBannerScope = (typeof FORM_BANNER_SCOPES)[number];

export interface FormCover {
  enabled?: boolean;
  /** A sticky banner line (promo strip) shown above the form — see `bannerScope`. */
  bannerText?: string | null;
  /**
   * Where `bannerText` shows: `'form'` pins it above every screen (the legacy
   * behaviour, and the default when absent), `'cover'` limits it to the cover.
   */
  bannerScope?: FormBannerScope;
  eyebrow?: string | null;
  /** Alias for eyebrow (pilot `badge`); eyebrow wins when both are set. */
  badge?: string | null;
  headline?: string | null;
  subheadline?: string | null;
  ctaText?: string | null;
  trustBadge?: string | null;
  /**
   * The COVER SCREEN's logo — see `resolveFormLogos`. `null` means "none here";
   * absent inherits the form's own (`branding.logo`).
   */
  logo?: string | null;
  /** Optional "trusted by" marquee shown on the cover. */
  clientLogos?: FormClientLogo[];
  /**
   * Whether the "trusted by" marquee renders. Absent means shown (the legacy
   * behaviour), so the logos can be switched off without deleting them.
   */
  showClientLogos?: boolean;
}

/** Per-form branding — the accent color threads the banner/CTA/selected states. */
/**
 * Per-form branding. `primaryColor`, `logo` and `clientLogos` are the original
 * three; everything below is the design system (`form-design.ts`), where every
 * field is optional and its absence resolves to the pre-design look — so a form
 * published before these existed renders exactly as it always did.
 *
 * `background`/`foreground` are the pair that matters most: setting them LOCKS
 * the form's theme (it stops following the viewer's light/dark preference),
 * because a page can't honour both an author's chosen palette and a visitor's
 * OS setting without one of them being wrong. See `resolveThemeMode` in
 * `@quill/shared/branding`.
 */
export interface FormBranding {
  primaryColor?: string | null;
  /**
   * The FORM's logo — every question screen, and the one-page hero when there
   * is no cover — see `resolveFormLogos`. Also where a workspace brand kit
   * snapshots its logo, so it must stay editable per form: `null` means "none".
   */
  logo?: string | null;
  clientLogos?: FormClientLogo[];

  // --- Color -------------------------------------------------------------
  background?: string | null;
  foreground?: string | null;
  backgroundStyle?: FormBackgroundStyle;
  backgroundImage?: string | null;
  /** 0–100: how heavily the readability scrim covers a background image. */
  backgroundOverlay?: number;

  // --- Typography --------------------------------------------------------
  fontFamily?: FormFont;
  customFont?: FormCustomFont | null;

  // --- Shape & controls --------------------------------------------------
  radius?: FormRadius;
  buttonStyle?: FormButtonStyle;
  buttonFullWidth?: boolean;
  progressStyle?: FormProgressStyle;

  // --- Layout ------------------------------------------------------------
  logoSize?: FormLogoSize;
  logoPosition?: FormLogoPosition;
  contentAlign?: FormContentAlign;
  contentWidth?: FormContentWidth;
  transition?: FormTransition;

  /**
   * Which preset was last applied — an editor affordance only. Nothing at
   * render time reads it; the preset's values live in the fields above.
   */
  themePreset?: string | null;
  /** Social-share card image. Absent = generated from the branding above. */
  ogImage?: string | null;
}

/** A `scheduler` step's embedded booking config (Calendly in v1). */
export interface FormScheduler {
  /** Scheduling provider. v1 ships Calendly; the embed also supports HubSpot Meetings. */
  provider?: 'calendly' | 'hubspot_meetings';
  /** The picked Calendly event type's stable URI (builder reference). */
  eventTypeUri?: string | null;
  /** Its display name, stored so the builder can label it without a lookup. */
  eventTypeName?: string | null;
  /** The public scheduling page embedded in the form (the event type's scheduling_url). */
  url?: string | null;
  /** Hide the event-type details panel in the embed ("Show event details? → No"). */
  hideEventDetails?: boolean;
  /** Prefill the booking form from collected answers (name/email/phone). */
  prefill?: boolean;
  /**
   * Which earlier question feeds each field the booking page asks for, keyed by
   * Calendly's own prefill id (`name`, `email`, or `a1`/`a2`/… for the event
   * type's custom questions; legacy configs may still say `phone`). Values are
   * step keys; absent entries fall back to the conventional answer keys.
   */
  prefillMap?: Record<string, string | null>;
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

/**
 * What happens when the form finishes, at the FORM level (additive — V5-B1).
 *
 * Until now there was no such thing: the generic thank-you copy was hardcoded
 * i18n with no way to edit it, and a redirect could only be set per outcome —
 * so sending everyone to one URL meant typing it into every range, and a form
 * with scoring off could not redirect at all.
 *
 * Every field is optional and every field is a DEFAULT: an outcome that sets the
 * same field overrides it. See {@link resolveEnding} for the resolution order.
 */
export interface FormEnding {
  /** Thank-you heading. Absent = the built-in localized title. */
  headline?: string | null;
  /** Thank-you body; `[key]` tokens interpolate. Absent = the built-in copy. */
  body?: string | null;
  /** Send respondents here instead of showing the thank-you screen. */
  redirectUrl?: string | null;
  /**
   * Show the thank-you screen for this long BEFORE redirecting. Only meaningful
   * alongside a redirect URL; 0/absent redirects immediately.
   */
  redirectDelayMs?: number;
}

/**
 * How the public form presents its steps (additive — absent = `'slides'`, so
 * every form published before this field existed renders exactly as it did):
 *  - `'slides'`   — one question per screen, walked step by step (the original).
 *  - `'vertical'` — every visible question on one page, answered in any order
 *    and submitted once. Skip-logic still applies live: `runtimeSteps` is
 *    recomputed on every answer, so questions show/hide as the respondent types.
 */
export const FORM_LAYOUTS = ['slides', 'vertical'] as const;
export type FormLayout = (typeof FORM_LAYOUTS)[number];

/**
 * The title to show the PUBLIC — `config.title` when the author set one, else
 * the form's internal name. One resolver so the tab, the OG/Twitter cards, the
 * generated share image, the cover heading and the profile listing can never
 * disagree about what a form is called.
 */
export function publicTitle(config: { title?: string | null } | null | undefined, name: string): string {
  const t = config?.title?.trim();
  return t ? t : name;
}

export interface FormConfig {
  version: 1;
  /**
   * The form's PUBLIC title — the browser tab, the share cards, and the cover
   * heading. Separate from `form.name`, which stays the private label the author
   * picked at creation and only ever shows inside the dashboard. Absent falls
   * back to `name`, so every form authored before this field keeps its exact
   * current title. See {@link publicTitle}.
   */
  title?: string | null;
  branding?: FormBranding | null;
  cover?: FormCover | null;
  /** Presentation layout for the public form. Absent = `'slides'` (back-compat). */
  layout?: FormLayout;
  steps: FormStep[];
  scoring?: { enabled?: boolean } | null;
  outcomes?: FormOutcome[];
  /**
   * BUILDER-ONLY node positions for the Logic canvas, keyed by step key.
   *
   * The engine never reads this — it is presentation state, and nothing about
   * how a form RUNS may depend on where its author dragged a box. It lives on
   * the config rather than in browser storage so an arrangement survives a
   * different machine and reaches a teammate opening the same form.
   *
   * An absent entry is the normal case: the canvas auto-lays-out from step
   * order, and a stored position is only ever an OVERRIDE of that. Because the
   * key is a step key, it is a pointer like any other and moves with a rename
   * (see {@link renameStepKey}) and is pruned for deleted steps (see
   * `normalizeConfig`) — a stale entry would pin a node where its step no
   * longer belongs, which is the exact lie the canvas exists to remove.
   */
  logicLayout?: Record<string, { x: number; y: number }>;
  /** Form-level ending, overridable per outcome (V5-B1). */
  ending?: FormEnding | null;
  reveal?: FormReveal | null;
  /**
   * Persist a partial submission once the step at this 1-based position in
   * `steps` is completed (typically just past the lead-capture email). Absent =
   * no partial save.
   */
  partialSubmitAfterStep?: number;
  /**
   * WHERE the reveal interstitial plays: the reveal fires after the step at this
   * 1-based position in `steps` (additive; back-compat). Absent = fall back to
   * the legacy per-step `triggersReveal`, then default to AFTER THE LAST step, so
   * an enabled reveal never plays mid-form by accident. See {@link revealAfterKey}.
   */
  revealAfterStep?: number;
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

/**
 * The layout the public form renders with. Pure resolver shared by the
 * renderer and the builder so both always agree — and the single place the
 * `absent = 'slides'` back-compat default lives.
 */
export function resolveFormLayout(config: Pick<FormConfig, 'layout'> | null | undefined): FormLayout {
  return config?.layout ?? 'slides';
}

/** Normalize an answer to the set of string tokens it represents (for matching). */
function tokens(value: AnswerValue): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

/**
 * Parse an answer to a finite number, or `null` when it isn't numeric. Only a
 * number or a non-blank numeric string qualifies — booleans/arrays/objects
 * (which `Number()` would coerce) do not. Shared by the numeric condition ops.
 */
function numericAnswer(value: AnswerValue): number | null {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * The reserved condition source meaning "the running score at this point in the
 * form" — the total over the steps ALREADY on the runtime path, before the step
 * being decided.
 *
 * Why a prefix and not the final score: a step's visibility cannot depend on a
 * total that includes the step itself, or `computeScore -> runtimeSteps ->
 * visibleSteps -> conditionHolds -> computeScore` never terminates. A prefix is
 * both non-circular and what the respondent actually experiences — by the time
 * they reach step N they have answered 1..N-1, and N is still unanswered, so it
 * could not have contributed anyway. No step's points are ever discarded: they
 * simply count from the next step onward.
 *
 * `@` is outside the step-key grammar (`sanitizeStepKey` keeps `[a-z0-9_]`), so
 * this token can never collide with a real key.
 */
export const SCORE_FIELD = '@score';

/** Is this condition sourced from the running score rather than an answer? */
export function isScoreCondition(cond: Pick<StepCondition, 'field'>): boolean {
  return cond.field === SCORE_FIELD;
}

/**
 * Does the current answer to `cond.field` satisfy the condition? The operator
 * (`cond.op`, default `in` for back-compat) selects the comparison:
 *  - `in`   — the answer's tokens intersect `values` (the legacy choice match).
 *  - `eq`/`gt`/`lt` — the answer, parsed as a number, compares to `value`.
 *  - `between` — the numeric answer lies within `[min, max]` inclusive.
 * A numeric op whose operand is missing, or whose answer isn't numeric, never
 * holds (the step stays in its default visibility).
 *
 * `scoreSoFar` is the running score (see `SCORE_FIELD`). It is only read when
 * the condition names that reserved source; an `in` op against it never holds,
 * because a score is a number and has no tokens to intersect.
 */
function conditionHolds(cond: StepCondition, answers: Answers, scoreSoFar = 0): boolean {
  const op = cond.op ?? 'in';
  if (op === 'in') {
    if (isScoreCondition(cond)) return false;
    const got = new Set(tokens(answers[cond.field]));
    return (cond.values ?? []).some((v) => got.has(v));
  }
  const n = isScoreCondition(cond) ? scoreSoFar : numericAnswer(answers[cond.field]);
  if (n == null) return false;
  switch (op) {
    case 'eq':
      return cond.value != null && n === cond.value;
    case 'gt':
      return cond.value != null && n > cond.value;
    case 'lt':
      return cond.value != null && n < cond.value;
    case 'between':
      return cond.min != null && cond.max != null && n >= cond.min && n <= cond.max;
    default:
      return false;
  }
}

/**
 * The steps to show given the answers so far, in config order. A step appears
 * when it is not `hidden`, its `showWhen` holds (or is absent) AND its `hideWhen`
 * does not hold — and, for a personal-email-only branch step, only when the
 * email is personal.
 *
 * This is a FORWARD walk, not a filter, because a condition may read the running
 * score (`SCORE_FIELD`): each step is decided against the total over the steps
 * already admitted ahead of it. That ordering is what keeps the score and the
 * visibility from depending on each other — see `SCORE_FIELD`.
 *
 * The running score here is the pre-`goto` prefix. A forward jump is applied
 * afterwards (`runtimeSteps`), so a step that a branch skips can still have
 * contributed to a gate upstream of the jump — but only if it carries a STALE
 * answer, since a step the respondent never saw is unanswered and scores 0.
 */
export function visibleSteps(config: FormConfig, answers: Answers): FormStep[] {
  const scored = config.scoring?.enabled !== false;
  const out: FormStep[] = [];
  let scoreSoFar = 0;
  for (const step of config.steps) {
    // A hidden step is never rendered as a question — it is skipped in the walk
    // (and therefore never scored). Its answer can still be seeded (e.g. from a
    // URL parameter) and rides along into the submission via the answers map.
    if (step.hidden) continue;
    if (step.showWhen && !conditionHolds(step.showWhen, answers, scoreSoFar)) continue;
    if (step.hideWhen && conditionHolds(step.hideWhen, answers, scoreSoFar)) continue;
    if (step.showForPersonalEmailOnly) {
      const emailKey = findEmailKey(config);
      if (!emailKey || !isPersonalEmail(answers[emailKey])) continue;
    }
    out.push(step);
    if (scored) scoreSoFar += stepScore(step, answers);
  }
  return out;
}

/** The first `email`-typed step's key (the branch pivot for personal-email logic). */
function findEmailKey(config: FormConfig): string | null {
  return config.steps.find((s) => s.type === 'email')?.key ?? null;
}

/**
 * Answer keys carrying what the SCHEDULING PROVIDER collected from the invitee,
 * for forms that do not ask for those details themselves.
 *
 * A booking form always collects a name and an email, and often a phone. Only
 * the email was ever used — to key the contact — and the rest was discarded, so
 * a form whose booking is its only contact step produced CRM records with an
 * address and no name. The gap was invisible because most accounts also run the
 * provider's own CRM integration, which writes those fields independently; a
 * customer without it silently got nameless contacts.
 *
 * These ride in the submission `data` at delivery time, so they map to CRM
 * properties through the ordinary `fieldMappings` — the same mechanism as an
 * answer, with no special case in any adapter.
 *
 * `@` is outside the step-key grammar (`sanitizeStepKey` keeps `[a-z0-9_]`), so
 * these can never collide with a real question's key — same guarantee as
 * {@link SCORE_FIELD}.
 */
export const INVITEE_FIELDS = {
  /** Full name as the provider recorded it (often the only one populated). */
  name: '@invitee_name',
  first_name: '@invitee_first_name',
  last_name: '@invitee_last_name',
  /** Only present when the booking page asked for a number. */
  phone: '@invitee_phone',
} as const;

/** Where a HubSpot sync could get the address it keys the contact on. */
export type EmailSource =
  /** An `email`-typed question this form asks directly. */
  | { kind: 'question'; key: string }
  /** A scheduler: Calendly's own booking form always collects an invitee email. */
  | { kind: 'scheduler'; key: string }
  | null;

/**
 * Can this form give HubSpot an email to key on?
 *
 * HubSpot upserts a contact by email — it looks one up by address and creates it
 * when absent — so a form with no address reaches the CRM with nothing to
 * identify. That delivery resolves as a permanent no-op, which means the lead is
 * quietly never synced. This is the check that lets the editor say so BEFORE a
 * respondent is lost, rather than after.
 *
 * A question wins over a scheduler because it is unconditional: the scheduler
 * path only yields an address once someone actually books, and only when
 * Calendly is connected for the enrichment call. Callers that care about that
 * difference should combine this with the account's Calendly status.
 *
 * Pure and config-only, like everything else here.
 */
export function emailSourceFor(config: FormConfig): EmailSource {
  // A HIDDEN email step counts: it is never drawn, but it still captures an
  // answer from `?email=` and that answer reaches the submission.
  const question = config.steps.find((s) => s.type === 'email');
  if (question) return { kind: 'question', key: question.key };
  const scheduler = config.steps.find((s) => s.type === 'scheduler');
  if (scheduler) return { kind: 'scheduler', key: scheduler.key };
  return null;
}

/** Why a form cannot give the CRM an address to key its contact on. */
export type ContactKeyBlocker =
  /** It asks for no address and books nothing — there is no source at all. */
  | 'no_source'
  /**
   * A scheduler WOULD supply it, but the account has not connected that
   * provider — so nothing can read the invitee back and the sync dies with
   * "no respondent email resolvable", silently, after a booking that looked
   * perfectly successful to the respondent.
   */
  | 'scheduler_disconnected';

/** Whether a form can key a CRM contact, and what is missing when it cannot. */
export type ContactKeyReadiness =
  | { ok: true; source: NonNullable<EmailSource> }
  | { ok: false; blocker: ContactKeyBlocker; source: EmailSource };

/**
 * Can this form actually identify a contact at delivery time?
 *
 * {@link emailSourceFor} answers the CONFIG half — is there anything that could
 * produce an address. That is necessary and not sufficient: a scheduler only
 * yields one if the account has connected the provider, because the address
 * comes from reading the invitee back over that provider's API. A form can
 * therefore be perfectly configured and still sync nothing.
 *
 * Both halves belong together in one answer so the builder, the Connect screen
 * and publish cannot disagree about whether a form is ready — and so the screen
 * stops promising "contacts will be keyed on the address the booking collects"
 * without checking that anyone can read it.
 *
 * Stays pure: the connection state is passed IN, never fetched here.
 */
export function contactKeyReadiness(
  config: FormConfig,
  connected: { scheduler: boolean },
): ContactKeyReadiness {
  const source = emailSourceFor(config);
  if (!source) return { ok: false, blocker: 'no_source', source: null };
  if (source.kind === 'scheduler' && !connected.scheduler) {
    return { ok: false, blocker: 'scheduler_disconnected', source };
  }
  return { ok: true, source };
}

/**
 * Does this destination's mapping fight the scheduler for the contact key?
 *
 * The booking path only runs when the ADAPTER cannot resolve an address on its
 * own (`adapterResolvableEmail`). Pointing any question at the `email` property
 * satisfies it, so the answers stop syncing at booking and the submit-time
 * delivery tries to identify the contact with that answer instead. The lead
 * quietly stops arriving.
 *
 * Returns the offending step keys so the editor can name them.
 */
export function emailMappingsConflictingWithScheduler(
  source: EmailSource,
  fieldMappings: Record<string, string | string[]> | undefined,
): string[] {
  if (source?.kind !== 'scheduler' || !fieldMappings) return [];
  const targets = (v: string | string[]): string[] => (Array.isArray(v) ? v : [v]);
  return Object.entries(fieldMappings)
    .filter(([, target]) => targets(target).some((p) => p.trim().toLowerCase() === 'email'))
    .map(([stepKey]) => stepKey);
}

/** Which fact of a booking a {@link BookingField} carries. */
export type BookingFieldKind = 'start_time' | 'name' | 'first_name' | 'last_name' | 'phone';

/** One fact a booking produces, as the key it arrives under in the submission. */
export interface BookingField {
  /** The submission-data key — exactly what `fieldMappings` is keyed by. */
  key: string;
  kind: BookingFieldKind;
}

/**
 * Everything a booking on `schedulerKey` can send to a CRM.
 *
 * A scheduler's OWN step key holds the meeting start time; {@link INVITEE_FIELDS}
 * hold who booked. Both already reach the CRM through the ordinary `fieldMappings`
 * — but nothing ever said so. The builder offered one unlabelled picker on the
 * scheduler's key, so an author could map "the booking" without learning the value
 * behind it is a timestamp, and the invitee's name and phone were reachable only
 * from the Connect screen. One list here so the two screens cannot drift on what a
 * booking actually offers.
 *
 * The invitee's EMAIL is deliberately absent: it is the contact key the booking
 * supplies, and pointing any field at `email` takes that role over and stops the
 * sync — see {@link emailMappingsConflictingWithScheduler}.
 *
 * `kind` names the fact and the CALLER supplies the label: this package holds no
 * user-facing copy.
 */
export function bookingFieldsFor(schedulerKey: string): BookingField[] {
  return [
    { key: schedulerKey, kind: 'start_time' },
    { key: INVITEE_FIELDS.name, kind: 'name' },
    { key: INVITEE_FIELDS.first_name, kind: 'first_name' },
    { key: INVITEE_FIELDS.last_name, kind: 'last_name' },
    { key: INVITEE_FIELDS.phone, kind: 'phone' },
  ];
}

/**
 * The visibility operators offered for a referenced field's TYPE — the builder
 * shows exactly these in the operator dropdown, and they are the only ops the
 * engine is asked to evaluate for that source. Numeric fields (`slider`) get the
 * comparison set; every other type keeps the legacy "matches any of" (`in`).
 * Shared so the editor and the engine can never drift on which op is valid where.
 */
export function operatorsForFieldType(type: FormFieldType | typeof SCORE_FIELD): ConditionOp[] {
  // The running score is a number, so it gets the comparison set and never `in`
  // — a score has no tokens for a set-membership test to intersect.
  if (type === SCORE_FIELD) return ['gt', 'lt', 'eq', 'between'];
  return type === 'slider' ? ['eq', 'gt', 'lt', 'between'] : ['in'];
}

/**
 * A numeric condition's satisfying set as an interval with inclusivity flags
 * (`±Infinity` for the open ends of `gt`/`lt`), or `null` when the condition is
 * not a well-formed numeric op. Used only by the contradiction guard.
 */
interface NumInterval {
  lo: number;
  loInc: boolean;
  hi: number;
  hiInc: boolean;
}

function numInterval(cond: StepCondition): NumInterval | null {
  switch (cond.op) {
    case 'eq':
      return cond.value == null ? null : { lo: cond.value, loInc: true, hi: cond.value, hiInc: true };
    case 'gt':
      return cond.value == null ? null : { lo: cond.value, loInc: false, hi: Infinity, hiInc: false };
    case 'lt':
      return cond.value == null ? null : { lo: -Infinity, loInc: false, hi: cond.value, hiInc: false };
    case 'between':
      return cond.min == null || cond.max == null
        ? null
        : { lo: cond.min, loInc: true, hi: cond.max, hiInc: true };
    default:
      return null;
  }
}

/** Is numeric interval `a` fully contained in `b` (a ⊆ b)? */
function intervalSubset(a: NumInterval, b: NumInterval): boolean {
  // b's bounds must be no stricter than a's on each side (equal bound ⇒ b must be
  // inclusive whenever a is, i.e. a-inclusive can't stick out past b-exclusive).
  const lowerOk = b.lo < a.lo || (b.lo === a.lo && (b.loInc || !a.loInc));
  const upperOk = b.hi > a.hi || (b.hi === a.hi && (b.hiInc || !a.hiInc));
  return lowerOk && upperOk;
}

/** Is the choice condition `a`'s value-set a non-empty subset of `b`'s? */
function choiceSubset(a: StepCondition, b: StepCondition): boolean {
  const av = a.values ?? [];
  if (av.length === 0) return false;
  const bv = new Set(b.values ?? []);
  return av.every((v) => bv.has(v));
}

/**
 * True when a step's `showWhen` and `hideWhen` are mutually contradictory — the
 * step could NEVER be visible because every answer that satisfies `showWhen`
 * also satisfies `hideWhen` (hide always wins in {@link visibleSteps}). Detects
 * the trivial, SAME-FIELD cases the builder guards against:
 *  - both `in` and show's values are a subset of hide's (identical or fully
 *    overlapping choice sets, e.g. show ⊇ requires `a`, hide swallows `a`);
 *  - both numeric and show's interval is contained in hide's (e.g. show `eq 5`
 *    with hide `eq 5`, or show `between [50,80]` inside hide `between [40,100]`).
 * Conservative by design: returns `false` for anything it cannot PROVE empties
 * the visible set (different fields, mixed choice/numeric ops, partial overlaps),
 * so it never blocks a legitimate rule. Pure — no I/O, safe for client + server.
 */
export function conditionsContradict(
  showWhen: StepCondition | null | undefined,
  hideWhen: StepCondition | null | undefined,
): boolean {
  if (!showWhen || !hideWhen) return false;
  if (showWhen.field !== hideWhen.field) return false;
  const showOp = showWhen.op ?? 'in';
  const hideOp = hideWhen.op ?? 'in';
  if (showOp === 'in' && hideOp === 'in') return choiceSubset(showWhen, hideWhen);
  const s = numInterval(showWhen);
  const h = numInterval(hideWhen);
  if (s && h) return intervalSubset(s, h);
  return false;
}

/**
 * Why a visibility rule can never hold, or `null` when it is well formed
 * (V5-QA). Both cases silently make the owning question unreachable for every
 * respondent, and neither shows anything in the builder today:
 *  - `missing_operand`: a numeric op with no value typed yet (`gt` with no
 *    number, `between` with only one bound). `conditionHolds` returns false for
 *    every answer, so the question never appears — an unfinished rule reads as a
 *    configured one.
 *  - `empty_interval`: `between` with min > max, which no value can satisfy.
 *  - `no_values`: an `in` rule with nothing selected.
 * A SHOW rule that can never hold hides the question; a HIDE rule that can never
 * hold is merely inert, so callers report them differently.
 */
export type BrokenCondition = 'missing_operand' | 'empty_interval' | 'no_values';

export function conditionNeverHolds(
  cond: StepCondition | null | undefined,
): BrokenCondition | null {
  if (!cond) return null;
  switch (cond.op) {
    case 'eq':
    case 'gt':
    case 'lt':
      return cond.value == null || !Number.isFinite(cond.value) ? 'missing_operand' : null;
    case 'between':
      if (cond.min == null || cond.max == null) return 'missing_operand';
      return cond.min > cond.max ? 'empty_interval' : null;
    default:
      // `in` against the running score can never hold — a number has no tokens.
      // The builder only offers numeric ops for it, so this catches a config
      // written by hand or migrated from an answer source.
      if (isScoreCondition(cond)) return 'missing_operand';
      return (cond.values ?? []).length === 0 ? 'no_values' : null;
  }
}

/**
 * What a `hideWhen` rule leaves of a `showWhen` rule when the two overlap only
 * PARTIALLY — the case {@link conditionsContradict} deliberately stays silent on
 * because the step CAN still appear (V5-A6).
 *
 * `conditionsContradict` answers "is this impossible?"; this answers "is this
 * what you meant?". Show `between 200..500` + hide `gt 201` is perfectly legal
 * and leaves the step visible for 200..201 only — almost certainly not what the
 * author intended, and invisible in a UI that shows the two rules in separate
 * boxes. Returns the surviving window so the builder can name the actual numbers
 * back to the author.
 *
 * Returns `null` when there is nothing to say: different fields, no overlap at
 * all (the hide rule is inert), a FULL contradiction (that is the hard error, not
 * this warning), or non-numeric operands. Choice rules are excluded — a partial
 * choice overlap reads unambiguously off the value chips, so a warning there is
 * noise. Pure — no I/O, safe for client + server.
 */
export function conditionsNarrow(
  showWhen: StepCondition | null | undefined,
  hideWhen: StepCondition | null | undefined,
): { lo: number; hi: number } | null {
  if (!showWhen || !hideWhen) return null;
  if (showWhen.field !== hideWhen.field) return null;
  if ((showWhen.op ?? 'in') === 'in' || (hideWhen.op ?? 'in') === 'in') return null;
  const s = numInterval(showWhen);
  const h = numInterval(hideWhen);
  if (!s || !h) return null;
  // A full contradiction is reported by conditionsContradict as an error.
  if (intervalSubset(s, h)) return null;
  // No overlap ⇒ the hide rule removes nothing from the show window.
  const overlapLo = Math.max(s.lo, h.lo);
  const overlapHi = Math.min(s.hi, h.hi);
  if (overlapLo > overlapHi) return null;
  // The surviving window: show's interval minus hide's. A hide rule that clips
  // exactly one end leaves ONE interval, which is what we can name back to the
  // author. A hide strictly INSIDE show (e.g. show 0..100, hide 40..60) punches a
  // hole and leaves two — not expressible as a single window, so stay silent
  // rather than report a range that wrongly reads as "nothing was removed".
  const clipsLow = h.lo <= s.lo;
  const clipsHigh = h.hi >= s.hi;
  if (!clipsLow && !clipsHigh) return null;
  // The new bound is the hide interval's far edge — but only reportable when
  // that edge is EXCLUSIVE, i.e. the value itself survives. `hide lt 50` leaves
  // 50 visible, so "from 50" is true; `hide eq 200` hides 200 itself, so the
  // window starts just above it, which no integer bound can state. Naming 200
  // there would print a bound the rule specifically removes.
  if (clipsLow && h.hiInc) return null;
  if (clipsHigh && h.loInc) return null;
  // The UNclipped bound is inherited from the SHOW interval and printed as an
  // inclusive "lo–hi". That is only truthful when the show bound is itself
  // inclusive: an OPEN show interval (`gt`/`lt`) EXCLUDES its own edge, so naming
  // it would print a value the rule removes (V4-08). `show gt 200` + `hide gt
  // 500` survives 201..500 — reporting "200–500" names 200, which `gt 200`
  // hides. Stay silent, symmetric to the hide-side guards above, rather than
  // name a bound off by one.
  if (clipsLow && !s.hiInc) return null;
  if (clipsHigh && !s.loInc) return null;
  const lo = clipsLow ? h.hi : s.lo;
  const hi = clipsHigh ? h.lo : s.hi;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) return null;
  // Nothing was actually removed — saying "only appears for X–Y" when X–Y IS
  // the show rule reads as a warning about a rule that is doing nothing wrong.
  if (lo === s.lo && hi === s.hi) return null;
  return { lo, hi };
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
    // `*` = "any answer at all" (V6). Choice steps branch on their option
    // values, but a step whose answer is free-form — a scheduler stores the
    // booked timestamp — has no fixed value to list, so routing after it needs
    // a catch-all. Option values are slugified, so `*` can never collide with
    // one. An unanswered step still matches nothing.
    const matched = rule.values.includes('*')
      ? got.size > 0
      : rule.values.some((v) => got.has(v));
    if (matched) return rule;
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

/**
 * Steps that collect nothing — they are shown, then the flow moves on. `message`
 * waits for a click; `reveal` (V5-B3) advances itself after its duration. Both
 * are excluded from validation, scoring and the recall-token list, since there
 * is no answer to validate, score, or interpolate.
 */
export function isInputlessStep(step: Pick<FormStep, 'type'>): boolean {
  return step.type === 'message' || step.type === 'reveal';
}

/** Validate one answer against its step. Pure; used on both client and server. */
export function validateAnswer(step: FormStep, value: AnswerValue): ValidationResult {
  // Info + reveal steps never carry input.
  if (isInputlessStep(step)) return { ok: true };

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

/**
 * Sanitize a typed field key to the grammar the engine's token syntax accepts
 * (`[a-zA-Z0-9_]`), lowercased and length-capped. Empty input returns `''` so
 * the caller can reject it rather than invent a key.
 */
export function sanitizeStepKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .slice(0, 64);
}

/**
 * Rename a step's `key` and every reference to it, in one pure pass (V5-A10).
 *
 * The key is the answer's field name: it names the column in the submission, the
 * `?key=value` URL parameter that seeds a hidden step, and the `[key]` token
 * other questions interpolate. Letting the builder edit it means every pointer
 * has to move with it, or the form silently loses a branch:
 *  - `showWhen.field` / `hideWhen.field` on any step
 *  - `goto[].target` (forward jumps name a step key)
 *  - `questionField` (dynamic-variant source)
 *  - `outcomes[].overrides[].field`
 *  - `[oldKey]` tokens in question/helper text, variant copy, reveal copy, and
 *    outcome messages
 *
 * `name` steps are the exception: they store one answer per SUBFIELD
 * (`nameFields`) and never under their own key, so renaming one moves the step
 * pointers but leaves tokens alone — there were never any pointing at it.
 *
 * Returns the config unchanged when the rename is a no-op, the new key is empty,
 * or it would collide with another step. Destination property maps live outside
 * this config and are migrated by the caller.
 */
export function renameStepKey(config: FormConfig, oldKey: string, newKey: string): FormConfig {
  if (!newKey || oldKey === newKey) return config;
  if (config.steps.some((s) => s.key === newKey)) return config;
  // `name` steps store answers under their SUBFIELD keys (firstname/lastname),
  // not their own key — so those are taken too. Renaming onto one would make two
  // steps write the same answer slot and the name answer would be overwritten.
  for (const s of config.steps) {
    if (s.key === oldKey) continue;
    if (s.type === 'name' && nameFields(s).includes(newKey)) return config;
  }
  const target = config.steps.find((s) => s.key === oldKey);
  if (!target) return config;

  // Only a step that actually captures under `oldKey` can have tokens aimed at
  // it — a `name` step's answers live under its subfield keys instead.
  const retoken =
    target.type === 'name'
      ? (text: string) => text
      : (text: string) => text.split(`[${oldKey}]`).join(`[${newKey}]`);
  const retokenNullable = <T extends string | null | undefined>(text: T): T =>
    typeof text === 'string' ? (retoken(text) as T) : text;
  const retokenMap = (map: Record<string, string> | undefined): Record<string, string> | undefined =>
    map == null ? undefined : Object.fromEntries(Object.entries(map).map(([k, v]) => [k, retoken(v)]));
  const repoint = (field: string | null | undefined): string | null | undefined =>
    field === oldKey ? newKey : field;

  const steps = config.steps.map((s) => {
    const next: FormStep = { ...s };
    if (s.key === oldKey) next.key = newKey;
    if (s.showWhen) next.showWhen = { ...s.showWhen, field: repoint(s.showWhen.field) as string };
    if (s.hideWhen) next.hideWhen = { ...s.hideWhen, field: repoint(s.hideWhen.field) as string };
    if (s.goto) next.goto = s.goto.map((r) => ({ ...r, target: repoint(r.target) ?? null }));
    if (s.questionField != null) next.questionField = repoint(s.questionField);
    next.question = retokenNullable(s.question);
    next.helper = retokenNullable(s.helper);
    if (s.questionVariants) next.questionVariants = retokenMap(s.questionVariants);
    if (s.sliderLabelVariants) next.sliderLabelVariants = retokenMap(s.sliderLabelVariants);
    return next;
  });

  const outcomes = config.outcomes?.map((o) => ({
    ...o,
    label: retoken(o.label),
    message: retokenNullable(o.message),
    overrides: o.overrides?.map((r) => ({ ...r, field: repoint(r.field) as string })),
  }));

  const reveal = config.reveal
    ? {
        ...config.reveal,
        headline: retokenNullable(config.reveal.headline),
        subtitle: retokenNullable(config.reveal.subtitle),
        subtitleTemplate: retokenNullable(config.reveal.subtitleTemplate),
      }
    : config.reveal;

  // The form-level ending copy interpolates tokens too, so it has to move with
  // the key — otherwise a rename silently blanks the answer on the thank-you
  // screen of every live form that recalls it.
  const ending = config.ending
    ? {
        ...config.ending,
        headline: retokenNullable(config.ending.headline),
        body: retokenNullable(config.ending.body),
      }
    : config.ending;

  // The Logic canvas's node positions are keyed by step key, so they are
  // pointers too — without this a rename orphans the entry and the node snaps
  // back to its auto-layout slot, silently discarding an arrangement the author
  // made on purpose.
  const logicLayout = config.logicLayout
    ? Object.fromEntries(
        Object.entries(config.logicLayout).map(([key, pos]) => [repoint(key) as string, pos]),
      )
    : config.logicLayout;

  return {
    ...config,
    steps,
    ...(outcomes ? { outcomes } : {}),
    ...(reveal ? { reveal } : {}),
    ...(ending ? { ending } : {}),
    ...(logicLayout ? { logicLayout } : {}),
  };
}

/**
 * A slider step's effective bounds, normalized so `min <= max` even when the
 * stored config has them inverted (nothing stops an author typing max below min
 * mid-edit). Defaults mirror `createEmptyStep`: 0..100.
 */
export function sliderHasNoTravel(step: FormStep): boolean {
  // A zero-width slider ships `<input type=range min=5 max=5>`: the handle
  // cannot move and the question can only ever answer one value. Nobody
  // configures that on purpose, and the existing max<min warning stops one step
  // short of it.
  const { min, max } = sliderBounds(step);
  return min === max;
}

export function sliderBounds(step: FormStep): { min: number; max: number } {
  const a = step.min ?? 0;
  const b = step.max ?? 100;
  return a <= b ? { min: a, max: b } : { min: b, max: a };
}

/**
 * A slider value forced inside the step's bounds (V5-A2).
 *
 * The builder lets you type any number into Default, and the config schema has
 * no cross-field rule tying it to min/max — so `min 0, max 5, default 878` saves
 * happily and then renders a track filled to 17560%, blowing the value straight
 * out of the card. Every surface that turns a slider value into geometry runs it
 * through here, so a config that is already stored bad still renders sanely.
 */
export function clampSliderValue(step: FormStep, value: number): number {
  const { min, max } = sliderBounds(step);
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * True when a scoring range can never be reached because it falls entirely
 * outside the slider's own bounds (V5-A3) — e.g. a 0..2000 slider with a
 * 5000..6000 range, which silently awards nothing. Partial overlap is fine (the
 * reachable part still scores), so only a fully disjoint range is flagged.
 * Advisory: the builder marks the row, it does not block saving, because min/max
 * are often edited after the ranges.
 */
export function sliderRangeUnreachable(step: FormStep, range: SliderScoringRange): boolean {
  // An INVERTED range is unreachable on its own terms: `sliderPoints` matches
  // `n >= min && n <= max`, which is the empty set when min > max — no slider
  // value can satisfy it whatever the bounds are.
  if (range.min > range.max) return true;
  const { min, max } = sliderBounds(step);
  return range.max < min || range.min > max;
}

/**
 * Indexes of scoring ranges that OVERLAP an earlier range (V5-QA). `sliderPoints`
 * returns on the first match, so an overlapped row awards nothing for the shared
 * values while the builder's "highest possible" still counts it — two screens
 * disagreeing about the same number. Reported, not blocked: an overlap is legal
 * and sometimes deliberate, it just has to be visible.
 */
export function overlappingSliderRanges(step: FormStep): number[] {
  const ranges = step.sliderScoring ?? [];
  const out: number[] = [];
  for (let i = 1; i < ranges.length; i++) {
    const r = ranges[i]!;
    if (r.min > r.max) continue; // an inverted range is reported separately
    for (let j = 0; j < i; j++) {
      const prev = ranges[j]!;
      if (prev.min > prev.max) continue;
      if (r.min <= prev.max && prev.min <= r.max) {
        out.push(i);
        break;
      }
    }
  }
  return out;
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
 * The total score from the answers: option points (choice) + slider-range points
 * (slider), over the QUALIFICATION steps only (lead-capture fields such as
 * name/email/phone never contribute). Hidden steps (failed skip-logic) are
 * excluded — a branch the respondent never saw can't score.
 *
 * Only choice and slider steps score — the two types with a builder UI to attach
 * points to (option chips, slider ranges). A free-text step has neither, so it
 * must not contribute: the legacy flat `step.points` used to add here for ANY
 * type, silently scoring a `text`/`textarea` answer that the builder could not
 * set and the Results breakdown never listed, so "Highest possible" did not add
 * up (V4-17). No builder path writes `step.points`; it is ignored now, matching
 * `maxStepPoints` and `scoringSteps`.
 */
/**
 * One step's contribution to the score, ignoring visibility (the caller decides
 * that). Shared by `computeScore` and the running-score prefix in
 * `visibleSteps`, so a gate and the final total can never disagree about what a
 * step is worth. Lead-capture fields, per-question opt-outs, unanswered steps,
 * and every non-scoring type all contribute 0.
 */
function stepScore(step: FormStep, answers: Answers): number {
  if (step.flowGroup === 'lead_capture') return 0;
  if (step.scoringEnabled === false) return 0; // per-question opt-out (V5-B2)
  const value = answers[step.key];
  if (value == null || value === '') return 0;
  if (step.type === 'dropdown' || step.type === 'multiple_choice') return optionPoints(step, value);
  if (step.type === 'slider') return sliderPoints(step, value);
  return 0;
}

export function computeScore(config: FormConfig, answers: Answers): number {
  if (config.scoring && config.scoring.enabled === false) return 0;
  // The runtime PATH (visibility + forward goto jumps) — a step jumped over by a
  // branch is never shown and must never score.
  const visible = new Set(runtimeSteps(config, answers).map((s) => s.key));
  let score = 0;
  for (const step of config.steps) {
    if (!visible.has(step.key)) continue;
    score += stepScore(step, answers);
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
 *
 * Scoring OFF short-circuits to `null` (V5-A1). Outcomes are the score's routing
 * table: with scoring disabled every submission scores 0, so a `minScore: 0`
 * bucket used to match everyone and silently replace the form's own thank-you
 * screen. Disabling scoring now disables the whole outcome layer — buckets AND
 * answer-forced overrides — and the ending falls back to the form-level copy.
 * The stored buckets are untouched, so re-enabling scoring restores them.
 */
export function resolveOutcome(
  config: FormConfig,
  score: number,
  answers?: Answers,
): FormOutcome | null {
  if (config.scoring?.enabled === false) return null;
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

/** What the renderer should actually do when the form finishes (V5-B1). */
export interface ResolvedEnding {
  /** Heading, or `null` to use the renderer's built-in localized title. */
  headline: string | null;
  /** Body copy (still un-interpolated), or `null` for the built-in copy. */
  body: string | null;
  /** Where to send the respondent, or `null` to show the thank-you screen. */
  redirectUrl: string | null;
  /** How long to show the thank-you screen first. 0 = redirect immediately. */
  redirectDelayMs: number;
}

/**
 * The ending for a resolved outcome: per-outcome value, else the form-level
 * default, else nothing (the renderer's built-in copy) — V5-B1.
 *
 * One inheritance rule covers every ending shape the builder needs, with no
 * mode selector to choose between them:
 *  - a different thank-you per outcome → fill the outcome's fields;
 *  - one thank-you for everyone → fill only the form's;
 *  - redirect everyone → a form-level `redirectUrl`;
 *  - thank-you, then redirect → a form-level URL plus a delay;
 *  - any of the above overridden for one bucket → set it on that outcome.
 *
 * A field is "set" only when it is a non-empty string, so clearing an outcome's
 * box falls back to the form default rather than blanking the screen. The
 * outcome's `label` doubles as its heading (it always has) — inheriting the
 * form headline only when the label is empty.
 */
export function resolveEnding(config: FormConfig, outcome: FormOutcome | null): ResolvedEnding {
  const e = config.ending ?? null;
  const pick = (a: string | null | undefined, b: string | null | undefined): string | null => {
    const first = typeof a === 'string' ? a.trim() : '';
    if (first) return a as string;
    const second = typeof b === 'string' ? b.trim() : '';
    return second ? (b as string) : null;
  };
  const redirectUrl = pick(outcome?.redirectUrl, e?.redirectUrl);
  // A delay without a destination is meaningless — report 0 so the renderer
  // never holds the screen waiting for a redirect that is not coming.
  const delaySource = outcome?.redirectDelayMs ?? e?.redirectDelayMs ?? 0;
  return {
    headline: pick(outcome?.label, e?.headline),
    body: pick(outcome?.message, e?.body),
    redirectUrl,
    redirectDelayMs: redirectUrl && Number.isFinite(delaySource) ? Math.max(0, delaySource) : 0,
  };
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
  if (isInputlessStep(step)) return { ok: true };

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

/** A comma-separated variant key as a set of trimmed, non-empty values. */
function variantKeySet(key: string): Set<string> {
  return new Set(
    key
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  );
}

/**
 * The variant text for an answer, or `undefined` when no row matches (V5-A7).
 *
 * Multi-select answers are arrays, and {@link variantKey} joins them in the
 * order the respondent ticked the boxes — so an exact string lookup makes a
 * `"a,b"` row miss the answer `['b','a']`, and there was no way to author a
 * multi-value row at all. Resolution is now, in order:
 *  1. exact key match (unchanged — every existing config keeps its behavior);
 *  2. for an array answer, the first row whose comma-separated values are the
 *     SAME SET as the answer, order-insensitive.
 * Single-value answers only ever take path 1, so nothing about single-choice,
 * text, or slider sources changes.
 */
function resolveVariant(variants: Record<string, string>, raw: AnswerValue): string | undefined {
  // An EMPTY row is an unfinished draft, not an instruction to ask nothing: it
  // used to publish a question with no text at all — a bare input and a Submit
  // button. Treat it as "no row" so the `*` fallback (then the base question)
  // takes over.
  const usable = (text: string | undefined): string | undefined =>
    typeof text === 'string' && text.trim() ? text : undefined;
  // A non-array answer has exactly one spelling, so an exact lookup IS the set
  // comparison. An array answer must go through the set scan alone: trying the
  // exact key first would let the respondent's tick order pick between two rows
  // that describe the same set ("crm,ads" vs "ads,crm"), which is the
  // non-determinism this scan exists to remove.
  if (!Array.isArray(raw)) return usable(variants[variantKey(raw)]);
  const answer = variantKeySet(raw.join(','));
  if (answer.size === 0) return undefined;
  // Sorted so two rows describing the SAME set resolve to the same winner no
  // matter which the author typed first — otherwise the respondent's click
  // ORDER decided which variant they saw.
  for (const [key, text] of Object.entries(variants).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (key === '*') continue;
    const set = variantKeySet(key);
    if (set.size !== answer.size) continue;
    let same = true;
    for (const v of set) {
      if (!answer.has(v)) {
        same = false;
        break;
      }
    }
    if (same) return usable(text);
  }
  return undefined;
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
    const fallback = step.questionVariants['*'];
    text =
      resolveVariant(step.questionVariants, answers[step.questionField]) ??
      (typeof fallback === 'string' && fallback.trim() ? fallback : text);
  }
  return interpolate(text, answers);
}

/**
 * Resolve a step for display against the answers: pick the dynamic question
 * variant (via `resolveQuestion`), interpolate `[key]` tokens in the question
 * AND the `helper`/description (both with the same orphaned-punctuation sweep),
 * and resolve the slider unit label variant. Returns a shallow copy — never
 * mutates the config. A null/undefined helper is left untouched.
 */
export function resolveStepDisplay(step: FormStep, answers: Answers): FormStep {
  const question = resolveQuestion(step, answers);
  const helper = typeof step.helper === 'string' ? interpolate(step.helper, answers) : step.helper;
  let sliderUnitLabel = step.sliderUnitLabel ?? null;
  if (step.questionField && step.sliderLabelVariants) {
    const label = resolveVariant(step.sliderLabelVariants, answers[step.questionField]);
    if (label) sliderUnitLabel = label;
  }
  return { ...step, question, helper, sliderUnitLabel };
}

/**
 * The ordered, visible, display-resolved steps the renderer walks — the single
 * source of truth for the public flow. The AUTHORED `config.steps` order is
 * authoritative (WYSIWYG: the public form walks the exact order the editor
 * shows — `flowGroup` only affects scoring, never sequencing). Composes
 * `visibleSteps` (skip-logic + personal-email branch) + `resolveStepDisplay`
 * (dynamic variants + interpolation) + `applyGoto` (forward jumps).
 */
export function runtimeSteps(config: FormConfig, answers: Answers): FormStep[] {
  const visible = visibleSteps(config, answers).map((s) => resolveStepDisplay(s, answers));
  return applyGoto(visible, answers);
}

/** The key of the step at `partialSubmitAfterStep` (1-based over `steps`), or null. */
export function partialSubmitKey(config: FormConfig): string | null {
  const n = config.partialSubmitAfterStep;
  if (n == null || n < 1) return null;
  return config.steps[n - 1]?.key ?? null;
}

/**
 * The key of the step AFTER which the reveal interstitial plays, or `null` when
 * the reveal is disabled/absent or the form has no steps. Position resolves in
 * priority order (additive + back-compat), so the renderer and the builder agree
 * on where the reveal fires:
 *  1. `revealAfterStep` (1-based over `steps`) when set + in range — the
 *     authoritative draggable-marker position.
 *  2. else the first step flagged `triggersReveal` — the legacy per-step boolean
 *     (configs published before the marker existed still play in place).
 *  3. else the LAST step — the safe default so an ENABLED reveal plays right
 *     before the result (thank-you / outcome), never mid-form by accident.
 * The renderer decides "play then continue" vs "play then finalize" from whether
 * the resolved step is the last VISIBLE step at runtime.
 */
export function revealAfterKey(config: FormConfig): string | null {
  const reveal = config.reveal;
  if (!reveal || reveal.enabled === false) return null;
  const { steps } = config;
  if (steps.length === 0) return null;
  const n = config.revealAfterStep;
  if (n != null && n >= 1 && n <= steps.length) return steps[n - 1]?.key ?? null;
  const triggered = steps.find((s) => s.triggersReveal);
  if (triggered) return triggered.key;
  return steps[steps.length - 1]?.key ?? null;
}

// ---------------------------------------------------------------------------
// Cover presentation. Both helpers answer "should this chrome render on this
// screen?" and both default to the pre-toggle behaviour, so a config saved
// before the toggles existed renders exactly as it always did.
// ---------------------------------------------------------------------------

/**
 * Whether the promo banner renders on a given screen. `bannerScope: 'cover'`
 * confines it to the cover; anything else (including absent) keeps the legacy
 * behaviour of pinning it above every screen in the flow.
 */
export function showBanner(cover: FormCover | null | undefined, isCover: boolean): boolean {
  if (!cover?.bannerText) return false;
  return isCover || cover.bannerScope !== 'cover';
}

/**
 * Whether the "trusted by" marquee renders. Only an explicit `false` hides it,
 * so the logos can be switched off without deleting them — and a config saved
 * before the toggle existed still shows them.
 */
export function showClientLogos(cover: FormCover | null | undefined): boolean {
  return cover?.showClientLogos !== false;
}

/** The logo each surface of a form shows. `null` on either axis means "none". */
export interface FormLogos {
  /** The form's own logo — the top bar on slides, the hero on one page. */
  form: string | null;
  /** The cover screen's logo. */
  cover: string | null;
}

/**
 * Resolve the two logos a form can show.
 *
 * They are INDEPENDENT axes with their own editor controls: `branding.logo` is
 * the form's logo and `cover.logo` is the cover screen's. The distinction that
 * makes this work is `null` (explicitly cleared — show NOTHING) versus ABSENT
 * (never set — inherit). Without it, clearing a logo fell through to the other
 * one and the old image came back, with no control anywhere that could remove
 * it: `branding.logo` is written by the workspace brand-kit snapshot, so a form
 * carried a logo that neither the Design tab (which showed `cover.logo`) nor the
 * brand kit (which shows the ACCOUNT kit, not the form's copy of it) displayed.
 *
 * ABSENT inheriting is what keeps every config written before the two fields
 * were separately editable rendering exactly as it always did: those carry only
 * `cover.logo`, and it still reaches every screen. The first edit to either
 * field takes ownership of that axis.
 */
export function resolveFormLogos(config: {
  cover?: FormCover | null;
  branding?: FormBranding | null;
}): FormLogos {
  const coverLogo = config.cover?.logo;
  const brandingLogo = config.branding?.logo;
  const form = brandingLogo !== undefined ? brandingLogo : (coverLogo ?? null);
  return { form: form ?? null, cover: (coverLogo !== undefined ? coverLogo : form) ?? null };
}

// ---------------------------------------------------------------------------
// Choice-option presentation. An option's `icon` may be an emoji OR an image
// URL, and the two render differently, so the renderer asks here rather than
// sniffing the string in JSX.
// ---------------------------------------------------------------------------

/**
 * How a choice step lays its options out. `optionLayout` wins; absent, the
 * deprecated `showIcons` still selects the card grid, so a config saved before
 * `optionLayout` existed renders exactly as it always did.
 */
export function resolveOptionLayout(
  step: Pick<FormStep, 'optionLayout' | 'showIcons'> | null | undefined,
): FormOptionLayout {
  if (step?.optionLayout) return step.optionLayout;
  return step?.showIcons ? 'cards' : 'list';
}

/**
 * True when an option's `icon` is an image reference rather than an emoji or
 * letter: http(s), protocol-relative, a root path, or a `data:image/…` URI.
 * Safety is a SEPARATE question — pair this with `isSafeImageUrl` before the
 * value reaches an `<img src>`.
 */
export function isImageIcon(icon: string | null | undefined): boolean {
  if (!icon) return false;
  return /^(?:https?:\/\/|\/\/|\/|data:image\/)/i.test(icon.trim());
}

/** Longest glyph an option icon may be: an emoji, or initials like "HS". */
export const OPTION_ICON_GLYPH_MAX = 2;

/**
 * The initials a label falls back to when it has no icon: up to two letters,
 * taken from the first two words ("HubSpot Sales" → "HS", "Hubspot" → "H").
 */
export function optionInitials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return (words[0]?.charAt(0) ?? '').toUpperCase();
  return words
    .slice(0, OPTION_ICON_GLYPH_MAX)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

/** What an option's icon resolves to on a given layout. */
export type ResolvedOptionIcon =
  | { kind: 'image'; src: string }
  | { kind: 'glyph'; text: string };

/**
 * The single answer to "what do I draw for this option?", shared by the public
 * renderer, the builder canvas and the live preview so all three agree.
 *
 * An image is a CARD-ONLY affordance. A list row gives an icon 38px of height
 * and sits inline with the label, where a wordmark renders as an illegible
 * sliver — so under `list` an image URL degrades to the label's initials rather
 * than drawing badly. That also means an OLD config pairing a URL with a list
 * can't produce the broken combination.
 */
export function resolveOptionIcon(
  option: Pick<FormOption, 'icon' | 'label'>,
  layout: FormOptionLayout,
): ResolvedOptionIcon {
  const icon = option.icon?.trim() ?? '';
  if (icon && isImageIcon(icon)) {
    if (layout === 'cards' && isSafeImageUrl(icon)) return { kind: 'image', src: icon };
    return { kind: 'glyph', text: optionInitials(option.label) };
  }
  if (icon) return { kind: 'glyph', text: icon };
  return { kind: 'glyph', text: optionInitials(option.label) };
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
