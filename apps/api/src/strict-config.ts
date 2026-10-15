/**
 * The stricter rules a form config is held to when an API KEY writes it.
 *
 * An agent will write any field the schema accepts, so with a key the API
 * refuses what a person could not see or edit afterwards in the builder: the
 * fields that have no control in the editor (UNSUPPORTED_FIELD), steps with no
 * question (EMPTY_QUESTION), and a PUT config without `steps`, which would
 * replace every step with none (STEPS_REQUIRED). What a key saves is the
 * engine's normalized config, the same canonical shape the editor saves.
 *
 * None of this applies to a browser session. The editor saves through the very
 * same routes, and forms built before these fields lost their control still
 * carry them; refusing them there would stop people saving their own forms.
 *
 * The rules read the raw body (duck-typed), not the parsed one, so their
 * issues join the schema's in a single 400 even when the schema refuses too.
 */
import { isDeepStrictEqual } from 'node:util';
import type { Db } from '@quill/db';
import { getAccountBranding, getFormById } from '@quill/db';
import {
  defaultFlowGroup,
  normalizeConfig,
  type FormConfig as EngineConfig,
  type FormFieldType,
} from '@quill/engine';
import { isApiKeyPrincipal, type HostPrincipal } from './auth.provider';
import { dotPath, type ValidationIssue } from './validation';

export const UNSUPPORTED_FIELD = 'UNSUPPORTED_FIELD';
export const EMPTY_QUESTION = 'EMPTY_QUESTION';
export const STEPS_REQUIRED = 'STEPS_REQUIRED';

const UNSUPPORTED_MESSAGE = 'This field has no control in the editor.';
const EMPTY_QUESTION_MESSAGE = 'Every step needs a question.';
const STEPS_REQUIRED_MESSAGE =
  'Send the full steps array: a config without steps would replace every step with none.';

type Path = Array<string | number>;
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
/** `null` stores nothing a person would need a control for, so it reads as absent. */
const isSet = (v: unknown): boolean => v !== undefined && v !== null;

/**
 * A step field with no control in the editor, and the one value the editor
 * itself writes there (`createEmptyStep` and `normalizeConfig`). That value is
 * accepted: every step the builder makes carries it, and so does every config
 * this API answers with, so refusing it would refuse a form read and sent
 * straight back. Any other value is one the builder cannot show.
 *
 * The seeded values pass on ANY step type, not only the type that seeds them:
 * changing a step's type in the builder keeps them (a message turned into a
 * text question still carries `buttonText` "Continue"). `flowGroup` is the
 * exception, because the type change rewrites it to the new type's default.
 */
interface StepField {
  path: Path;
  editorWrites?: (value: unknown, type: unknown) => boolean;
  /**
   * The editor shows the field but cannot change it, and its own templates
   * write it: the value the form already stores on that step (same key, live
   * or draft) passes, so a form made from a template saves as read. A new or
   * changed value is still one nobody could edit afterwards.
   */
  keepsStored?: true;
}

/** The research list of config fields without an editor control (see the API spec). */
const STEP_FIELDS: StepField[] = [
  { path: ['buttonText'], editorWrites: (v) => v === 'Continue' },
  // The templates (and the old demo form) seed it on their sliders and the
  // canvas renders it, but no control edits it.
  { path: ['sliderUnitLabel'], keepsStored: true },
  { path: ['reveal', 'subtitleTemplate'] },
  { path: ['reveal', 'enabled'], editorWrites: (v) => v === true },
  { path: ['scheduler', 'prefill'], editorWrites: (v) => v === true },
  {
    path: ['flowGroup'],
    editorWrites: (v, type) => typeof type === 'string' && v === defaultFlowGroup(type as FormFieldType),
  },
  // Legacy: the single form-level reveal's position, before reveal steps.
  { path: ['triggersReveal'] },
];
const OUTCOME_FIELDS: Path[] = [['booking']];
/** Legacy: the single form-level reveal, before reveal steps. */
const TOP_LEVEL_FIELDS: Path[] = [['reveal'], ['revealAfterStep']];
const WEBHOOK_FIELDS: Path[] = [
  ['settings', 'signatureHeader'],
  ['settings', 'timeoutMs'],
];

/**
 * Step types the editor saves with a blank title on purpose, so a key may too.
 *
 * The editor itself never refuses a blank title (its only gate before saving
 * is `formConfigSchema`, where `question` is optional), and every step the
 * gallery adds starts with `question: ''`. So the line is not "what the editor
 * refuses" but "what still makes a whole screen without a title":
 * - `reveal`: asks nothing and has no title at all; the canvas edits its
 *   headline and subtitle instead (`stepListLabel` names it by its headline).
 * - `message`: an info screen with no input; its copy is the body text the
 *   canvas edits under the title (`helper`, rendered as `pf-message__body`).
 * - `scheduler`: the booking page itself is the content, and the canvas shows
 *   its embed preview with or without a title.
 * Every other type puts an input on screen, and an input with nothing asking
 * for it is the broken form EMPTY_QUESTION exists to stop.
 */
const TITLE_OPTIONAL_TYPES: ReadonlySet<unknown> = new Set(['reveal', 'message', 'scheduler']);

function at(value: unknown, path: Path): unknown {
  let node = value;
  for (const segment of path) {
    if (!isObj(node)) return undefined;
    node = node[segment as string];
  }
  return node;
}

const unsupported = (path: Path): ValidationIssue => ({
  path: dotPath(path),
  message: UNSUPPORTED_MESSAGE,
  code: UNSUPPORTED_FIELD,
});

/** Webhook entries of a `destinations` array carrying fields Connect cannot show. */
export function strictDestinationIssues(destinations: unknown, prefix: Path): ValidationIssue[] {
  if (!Array.isArray(destinations)) return [];
  const issues: ValidationIssue[] = [];
  destinations.forEach((entry, i) => {
    if (!isObj(entry) || entry.type !== 'webhook') return;
    for (const field of WEBHOOK_FIELDS) {
      if (isSet(at(entry, field))) issues.push(unsupported([...prefix, i, ...field]));
    }
  });
  return issues;
}

interface StrictConfigOptions {
  /** Where the config sits in the request body (`['config']`). */
  prefix: Path;
  /**
   * The workspace brand kit's client logos. Creating a form (and applying the
   * kit) copies them into `branding.clientLogos`, so that exact value is the
   * server's own and passes; any other is refused like the rest.
   */
  kitClientLogos?: unknown;
  /**
   * The configs the form already stores (live and draft), on an edit. A value
   * they already hold for a field the editor writes but cannot edit (the kit's
   * logos once the kit moved on, a template's slider unit) is the editor's own
   * and passes, so a form read with a key saves back unchanged.
   */
  stored?: unknown[];
  /**
   * Whether the route stores `config.destinations`. `POST /v1/forms` does;
   * `PUT /v1/forms/:id` drops them from the draft (the integrations screen owns
   * them live), so a webhook field there is never saved and refusing it would
   * refuse every edit of a form whose live webhook already carries one.
   */
  destinations: boolean;
}

/** The steps with this key in each stored config. */
function storedSteps(stored: unknown[] | undefined, key: unknown): unknown[] {
  if (typeof key !== 'string') return [];
  return (stored ?? []).flatMap((c) => {
    const steps = at(c, ['steps']);
    return Array.isArray(steps) ? steps.filter((s) => isObj(s) && s.key === key) : [];
  });
}

/** Every strict-rule issue of one config, steps in order. */
export function strictConfigIssues(config: unknown, opts: StrictConfigOptions): ValidationIssue[] {
  if (!isObj(config)) return [];
  const { prefix } = opts;
  const issues: ValidationIssue[] = [];

  if (Array.isArray(config.steps)) {
    config.steps.forEach((step, i) => {
      if (!isObj(step)) return;
      // A reveal asks nothing: it has no title and plays its own copy.
      // A question of the wrong type is the schema's to report, not ours.
      const question = step.question;
      const blank = !isSet(question) || (typeof question === 'string' && question.trim() === '');
      if (!TITLE_OPTIONAL_TYPES.has(step.type) && blank) {
        issues.push({
          path: dotPath([...prefix, 'steps', i, 'question']),
          message: EMPTY_QUESTION_MESSAGE,
          code: EMPTY_QUESTION,
        });
      }
      for (const field of STEP_FIELDS) {
        const value = at(step, field.path);
        if (!isSet(value) || field.editorWrites?.(value, step.type)) continue;
        const kept = field.keepsStored
          ? storedSteps(opts.stored, step.key).some((s) => isDeepStrictEqual(at(s, field.path), value))
          : false;
        if (kept) continue;
        issues.push(unsupported([...prefix, 'steps', i, ...field.path]));
      }
    });
  }

  if (Array.isArray(config.outcomes)) {
    config.outcomes.forEach((outcome, i) => {
      for (const field of OUTCOME_FIELDS) {
        if (isSet(at(outcome, field))) issues.push(unsupported([...prefix, 'outcomes', i, ...field]));
      }
    });
  }

  const logos = at(config, ['branding', 'clientLogos']);
  // Key order is not part of the value (Postgres jsonb reorders keys).
  const ownLogos = [opts.kitClientLogos, ...(opts.stored ?? []).map((c) => at(c, ['branding', 'clientLogos']))];
  if (isSet(logos) && !ownLogos.some((own) => isSet(own) && isDeepStrictEqual(logos, own))) {
    issues.push(unsupported([...prefix, 'branding', 'clientLogos']));
  }

  for (const field of TOP_LEVEL_FIELDS) {
    if (isSet(at(config, field))) issues.push(unsupported([...prefix, ...field]));
  }

  if (opts.destinations) {
    issues.push(...strictDestinationIssues(config.destinations, [...prefix, 'destinations']));
  }
  return issues;
}

/**
 * The strict-rule issues of a form write's body (`POST /v1/forms`,
 * `PUT /v1/forms/:id`) for this principal: none for a session. `requireSteps`
 * is the PUT's: a `config` without `steps` there replaces every step with none.
 * The PUT's draft also drops `destinations`, so their webhook fields are only
 * checked on create (and on `PUT .../destinations`). `formId` is the PUT's
 * form, whose stored configs vouch for values the editor cannot change.
 */
export async function keyFormBodyIssues(
  db: Db,
  p: HostPrincipal,
  body: unknown,
  opts: { requireSteps: boolean; storesDestinations: boolean; formId?: string },
): Promise<ValidationIssue[]> {
  if (!isApiKeyPrincipal(p) || !isObj(body) || !isObj(body.config)) return [];
  const config = body.config;
  const issues: ValidationIssue[] = [];
  if (opts.requireSteps && config.steps === undefined) {
    issues.push({ path: 'config.steps', message: STEPS_REQUIRED_MESSAGE, code: STEPS_REQUIRED });
  }
  // Only read the kit when there is something to compare it with.
  const hasLogos = isSet(at(config, ['branding', 'clientLogos']));
  const kitClientLogos = hasLogos ? (await getAccountBranding(db, p.accountId))?.config.clientLogos : undefined;
  const hasKeptField =
    Array.isArray(config.steps) &&
    config.steps.some((s) => STEP_FIELDS.some((f) => f.keepsStored && isSet(at(s, f.path))));
  // A form of another account reads as absent: nothing stored vouches.
  const form = opts.formId && (hasLogos || hasKeptField) ? await getFormById(db, p.accountId, opts.formId) : null;
  const stored = form ? [form.config, form.draftConfig].filter(isSet) : [];
  issues.push(
    ...strictConfigIssues(config, {
      prefix: ['config'],
      kitClientLogos,
      stored,
      destinations: opts.storesDestinations,
    }),
  );
  return issues;
}

/** The strict-rule issues of a `PUT /v1/forms/:id/destinations` body: none for a session. */
export function keyDestinationsBodyIssues(p: HostPrincipal, body: unknown): ValidationIssue[] {
  if (!isApiKeyPrincipal(p) || !isObj(body)) return [];
  return strictDestinationIssues(body.destinations, ['destinations']);
}

/**
 * The config an API key saves: the engine's normalized one (unique step keys
 * with references following them, deduped option values, derived flow groups
 * and scoring, sorted outcomes), the same canonical shape the editor saves. A
 * session's config is stored as sent, exactly as before.
 */
export function keyNormalizedConfig<T>(p: HostPrincipal, config: T): T {
  if (!isApiKeyPrincipal(p) || config == null) return config;
  return normalizeConfig(config as unknown as EngineConfig) as unknown as T;
}
