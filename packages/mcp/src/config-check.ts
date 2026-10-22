import { isDeepStrictEqual } from 'node:util';
import { normalizeConfig, uniqueKey } from '@quill/engine';
import { formConfigSchema } from '@quill/types';
import type { ZodTypeAny } from 'zod';
import type { BackendIssue } from './backend';

/**
 * What the MCP checks in a config before it reaches the API, on top of the
 * rules the API holds every agent to.
 *
 * The REST API v1 is in production with these behaviours, so they stay there
 * unchanged: unknown fields are dropped, a repeated step key becomes `a_2`, a
 * repeated option value or outcome id is renamed, a `goto` to a step that does
 * not exist is deleted, and a condition on a step that does not exist simply
 * never holds. An agent cannot see any of that happen and believes its config
 * was saved as sent. Through the MCP each one is a refusal that names the
 * path and what to do, so nothing changes silently. A problem the form
 * already had is let through instead, with a warning that names what saving
 * does to it (see `splitInherited`).
 *
 * Everything is read duck-typed from the raw config: a config the schema
 * refuses still gets every problem reported in the same answer.
 */

type Obj = Record<string, unknown>;
type Path = Array<string | number>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

const dot = (path: Path): string => ['config', ...path].join('.');

/** Step types a person can leave without a question (the API's EMPTY_QUESTION exemptions). */
const TITLE_OPTIONAL_TYPES: ReadonlySet<unknown> = new Set(['reveal', 'message', 'scheduler']);

/** The reserved condition field: the running score. Only numeric ops apply to it. */
const SCORE_FIELD = '@score';

// --- Unknown fields -----------------------------------------------------------

/** The zod v3 type name of a schema node. */
const kind = (schema: unknown): string | undefined => (schema as { _def?: { typeName?: string } })?._def?.typeName;

/** Strip the wrappers that do not change which keys an object takes. */
function unwrap(schema: ZodTypeAny): ZodTypeAny {
  let node: ZodTypeAny = schema;
  for (let i = 0; i < 20; i++) {
    const def = (node as unknown as { _def: Record<string, unknown> })._def;
    switch (kind(node)) {
      case 'ZodOptional':
      case 'ZodNullable':
      case 'ZodDefault':
      case 'ZodReadonly':
      case 'ZodCatch':
        node = def.innerType as ZodTypeAny;
        break;
      case 'ZodBranded':
        node = def.type as ZodTypeAny;
        break;
      case 'ZodEffects':
        node = def.schema as ZodTypeAny;
        break;
      case 'ZodLazy':
        node = (def.getter as () => ZodTypeAny)();
        break;
      case 'ZodPipeline':
        node = def.in as ZodTypeAny;
        break;
      default:
        return node;
    }
  }
  return node;
}

/** Every key of `value` that `schema` does not know, at any depth. */
function unknownKeys(value: unknown, schema: ZodTypeAny, path: Path, out: BackendIssue[]): void {
  const node = unwrap(schema);
  const def = (node as unknown as { _def: Record<string, unknown> })._def;
  switch (kind(node)) {
    case 'ZodObject': {
      if (!isObj(value)) return;
      const shape = (def.shape as () => Record<string, ZodTypeAny>)();
      const open = def.unknownKeys === 'passthrough' || kind(def.catchall) !== 'ZodNever';
      for (const [key, child] of Object.entries(value)) {
        if (key in shape) unknownKeys(child, shape[key]!, [...path, key], out);
        else if (!open)
          out.push({ path: dot([...path, key]), code: 'unrecognized_keys', message: `"${key}" is not a field dForms knows here.` });
      }
      return;
    }
    case 'ZodArray':
      if (Array.isArray(value)) value.forEach((item, i) => unknownKeys(item, def.type as ZodTypeAny, [...path, i], out));
      return;
    case 'ZodRecord':
      if (isObj(value)) for (const [key, child] of Object.entries(value)) unknownKeys(child, def.valueType as ZodTypeAny, [...path, key], out);
      return;
    case 'ZodDiscriminatedUnion': {
      if (!isObj(value)) return;
      const option = (def.optionsMap as Map<unknown, ZodTypeAny>).get(value[def.discriminator as string]);
      // An unknown discriminator is the schema's to report.
      if (option) unknownKeys(value, option, path, out);
      return;
    }
    case 'ZodUnion': {
      // The option that fits best: the fewest unknown keys. Options of another
      // shape (a string where an object was sent) are not candidates.
      let best: BackendIssue[] | null = null;
      for (const option of def.options as ZodTypeAny[]) {
        const inner = kind(unwrap(option));
        const fits = inner === 'ZodObject' || inner === 'ZodRecord' ? isObj(value) : inner === 'ZodArray' ? Array.isArray(value) : false;
        if (!fits) continue;
        const found: BackendIssue[] = [];
        unknownKeys(value, option, path, found);
        if (!best || found.length < best.length) best = found;
      }
      if (best) out.push(...best);
      return;
    }
    default:
      return;
  }
}

/** Fields nothing in the config contract knows: the API would drop them without a word. */
export function unknownFieldIssues(config: unknown): BackendIssue[] {
  const out: BackendIssue[] = [];
  unknownKeys(config, formConfigSchema as unknown as ZodTypeAny, [], out);
  return out;
}

/** The schema's own refusals, in the paths the API reports them with. */
function schemaIssues(config: unknown): BackendIssue[] {
  const parsed = formConfigSchema.safeParse(config);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => ({ path: dot(issue.path), code: issue.code, message: issue.message }));
}

// --- Meaning ------------------------------------------------------------------

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Answer keys a condition may read: every step key, and a name step's sub-fields. */
function answerKeys(steps: unknown[]): Set<string> {
  const keys = new Set<string>();
  for (const step of steps) {
    if (!isObj(step)) continue;
    if (typeof step.key === 'string') keys.add(step.key);
    if (step.type === 'name') {
      const fields = Array.isArray(step.fields) ? step.fields : ['firstname', 'lastname'];
      for (const f of fields) if (typeof f === 'string') keys.add(f);
    }
  }
  return keys;
}

function conditionIssues(cond: unknown, path: Path, fields: Set<string>, out: BackendIssue[]): void {
  if (!isObj(cond) || typeof cond.field !== 'string') return;
  if (cond.field === SCORE_FIELD) {
    if (cond.op === undefined || cond.op === 'in') {
      out.push({
        path: dot([...path, 'op']),
        code: 'SCORE_OP',
        message: `"@score" is a number, and op "in" (what a condition uses when op is left out) never matches it, so this condition would never hold.`,
      });
    }
  } else if (!fields.has(cond.field)) {
    out.push({ path: dot([...path, 'field']), code: 'UNKNOWN_FIELD', message: `No step has the key "${cond.field}", so this condition would never hold.` });
  }
  const min = num(cond.min);
  const max = num(cond.max);
  if (cond.op === 'between' && min !== null && max !== null && min > max) {
    out.push({ path: dot([...path, 'max']), code: 'MIN_ABOVE_MAX', message: `max (${max}) is below min (${min}), so nothing is between them.` });
  }
}

/** Problems the schema cannot see: things the API would rename, delete or ignore. */
export function semanticIssues(config: unknown): BackendIssue[] {
  if (!isObj(config)) return [];
  const out: BackendIssue[] = [];
  const steps = Array.isArray(config.steps) ? config.steps : [];
  const fields = answerKeys(steps);
  const firstAt = new Map<string, number>();
  steps.forEach((step, i) => {
    if (isObj(step) && typeof step.key === 'string' && !firstAt.has(step.key)) firstAt.set(step.key, i);
  });

  steps.forEach((step, i) => {
    if (!isObj(step)) return;
    const key = typeof step.key === 'string' ? step.key : null;
    if (key !== null && firstAt.get(key) !== i) {
      out.push({
        path: dot(['steps', i, 'key']),
        code: 'DUPLICATE_KEY',
        message: `Step key "${key}" is already used by steps.${firstAt.get(key)}. dForms would rename this one, and every reference to it would point at the first.`,
      });
    }

    if (Array.isArray(step.options)) {
      const seen = new Map<string, number>();
      step.options.forEach((option, k) => {
        if (!isObj(option) || typeof option.value !== 'string') return;
        const first = seen.get(option.value);
        if (first === undefined) seen.set(option.value, k);
        else
          out.push({
            path: dot(['steps', i, 'options', k, 'value']),
            code: 'DUPLICATE_VALUE',
            message: `Option value "${option.value}" is already used by options.${first} of this step.`,
          });
      });
    }

    if (Array.isArray(step.goto)) {
      step.goto.forEach((rule, k) => {
        if (!isObj(rule) || typeof rule.target !== 'string') return;
        const at = firstAt.get(rule.target);
        const where = dot(['steps', i, 'goto', k, 'target']);
        if (at === undefined)
          out.push({ path: where, code: 'UNKNOWN_STEP', message: `No step has the key "${rule.target}", so dForms would delete this rule.` });
        else if (at === i) out.push({ path: where, code: 'INVALID_TARGET', message: 'A step cannot jump to itself, so dForms would delete this rule.' });
        else if (at < i)
          out.push({
            path: where,
            code: 'INVALID_TARGET',
            message: `"${rule.target}" comes before this step. Jumps only go forward, so this rule would never fire.`,
          });
      });
    }

    conditionIssues(step.showWhen, ['steps', i, 'showWhen'], fields, out);
    conditionIssues(step.hideWhen, ['steps', i, 'hideWhen'], fields, out);

    if (typeof step.questionField === 'string' && !fields.has(step.questionField)) {
      out.push({
        path: dot(['steps', i, 'questionField']),
        code: 'UNKNOWN_FIELD',
        message: `No step has the key "${step.questionField}", so the question would never change.`,
      });
    }

    const min = num(step.min);
    const max = num(step.max);
    if (min !== null && max !== null && min > max) {
      out.push({ path: dot(['steps', i, 'max']), code: 'MIN_ABOVE_MAX', message: `max (${max}) is below min (${min}).` });
    }
    if (Array.isArray(step.sliderScoring)) {
      step.sliderScoring.forEach((range, k) => {
        if (!isObj(range)) return;
        const lo = num(range.min);
        const hi = num(range.max);
        if (lo !== null && hi !== null && lo > hi)
          out.push({
            path: dot(['steps', i, 'sliderScoring', k, 'max']),
            code: 'MIN_ABOVE_MAX',
            message: `max (${hi}) is below min (${lo}), so no answer scores in this range.`,
          });
      });
    }
  });

  const outcomes = Array.isArray(config.outcomes) ? config.outcomes : [];
  const ids = new Map<string, number>();
  outcomes.forEach((outcome, i) => {
    if (!isObj(outcome)) return;
    if (typeof outcome.id === 'string') {
      const first = ids.get(outcome.id);
      if (first === undefined) ids.set(outcome.id, i);
      else
        out.push({
          path: dot(['outcomes', i, 'id']),
          code: 'DUPLICATE_ID',
          message: `Outcome id "${outcome.id}" is already used by outcomes.${first}. dForms would rename this one.`,
        });
    }
    const lo = num(outcome.minScore);
    const hi = num(outcome.maxScore);
    if (lo !== null && hi !== null && lo > hi) {
      out.push({
        path: dot(['outcomes', i, 'maxScore']),
        code: 'MIN_ABOVE_MAX',
        message: `maxScore (${hi}) is below minScore (${lo}), so no score lands in this outcome.`,
      });
    }
    if (Array.isArray(outcome.overrides)) {
      outcome.overrides.forEach((rule, k) => {
        if (isObj(rule) && typeof rule.field === 'string' && !fields.has(rule.field))
          out.push({
            path: dot(['outcomes', i, 'overrides', k, 'field']),
            code: 'UNKNOWN_FIELD',
            message: `No step has the key "${rule.field}", so this rule would never pick the outcome.`,
          });
      });
    }
  });
  return out;
}

/** Things worth telling the user that are not errors: the config is saved as sent. */
export function configWarnings(config: unknown): string[] {
  if (!isObj(config)) return [];
  const warnings: string[] = [];
  const outcomes = Array.isArray(config.outcomes) ? config.outcomes : [];
  if (isObj(config.scoring) && config.scoring.enabled === true && outcomes.length === 0) {
    warnings.push(
      'config.scoring.enabled is true but the form has no outcomes: every response gets a score, but no score picks a result message or redirect. Add outcomes if the score should choose the ending.',
    );
  }
  return warnings;
}

export interface ConfigReview {
  /** Refusals: the config must not be sent as is. Empty when it may go to the API. */
  issues: BackendIssue[];
  /** Saved as sent, but worth telling the user. */
  warnings: string[];
}

/**
 * The MCP's own review of a config about to be created or saved. When it
 * finds a problem the schema's own issues join the list, so the model reads
 * every problem in one answer.
 */
export function reviewConfig(config: unknown): ConfigReview {
  const own = [...unknownFieldIssues(config), ...semanticIssues(config)];
  return { issues: own.length ? [...schemaIssues(config), ...own] : [], warnings: configWarnings(config) };
}

// --- Problems the form already had ----------------------------------------------

const INHERITED_NOTE =
  ' It is already in the config get_form returned (saved before this rule applied): fix it in your copy too, or the form cannot be saved.';

/** The local twin of the API's EMPTY_QUESTION, for telling an inherited one apart. */
function emptyQuestionIssues(config: unknown): BackendIssue[] {
  if (!isObj(config) || !Array.isArray(config.steps)) return [];
  const out: BackendIssue[] = [];
  config.steps.forEach((step, i) => {
    if (!isObj(step) || TITLE_OPTIONAL_TYPES.has(step.type)) return;
    const q = step.question;
    if (q === undefined || q === null || (typeof q === 'string' && q.trim() === ''))
      out.push({ path: dot(['steps', i, 'question']), code: 'EMPTY_QUESTION', message: '' });
  });
  return out;
}

/** The step or outcome a path points into, named by its key or id instead of its index. */
function named(config: unknown, path: string): { anchor: string; rest: string[] } {
  const [, list, index, ...rest] = path.split('.');
  if ((list === 'steps' || list === 'outcomes') && index !== undefined && /^\d+$/.test(index) && isObj(config)) {
    const items = config[list];
    const item = Array.isArray(items) ? items[Number(index)] : undefined;
    const id = isObj(item) ? (list === 'steps' ? item.key : item.id) : undefined;
    if (typeof id === 'string') return { anchor: `${list}[${id}]`, rest };
  }
  return { anchor: path, rest: [] };
}

function at(value: unknown, path: string[]): unknown {
  let node = value;
  for (const segment of path) {
    if (Array.isArray(node) && /^\d+$/.test(segment)) node = node[Number(segment)];
    else if (isObj(node)) node = node[segment];
    else return undefined;
  }
  return node;
}

/** The item of `config.steps`/`config.outcomes` an anchor names. */
function itemOf(config: unknown, anchor: string): unknown {
  const m = /^(steps|outcomes)\[(.*)\]$/.exec(anchor);
  if (!m || !isObj(config)) return undefined;
  const items = config[m[1]!];
  if (!Array.isArray(items)) return undefined;
  return items.find((item) => isObj(item) && (m[1] === 'steps' ? item.key : item.id) === m[2]);
}

/**
 * Which of `issues` the form already had in the config the agent read (the
 * draft, or the live config): a problem that came with the form, not one the
 * agent added.
 */
export function inheritedFlags(issues: BackendIssue[], sent: unknown, stored: unknown): boolean[] {
  if (!isObj(stored)) return issues.map(() => false);
  const identity = (config: unknown, issue: BackendIssue) => {
    const { anchor, rest } = named(config, issue.path);
    return `${issue.code} ${anchor}.${rest.join('.')}`;
  };
  const storedIssues = new Set(
    [...unknownFieldIssues(stored), ...semanticIssues(stored), ...emptyQuestionIssues(stored)].map((i) => identity(stored, i)),
  );
  return issues.map((issue) => {
    if (storedIssues.has(identity(sent, issue))) return true;
    if (issue.code !== 'UNSUPPORTED_FIELD') return false;
    // The API's own rule: the same value the form already stores.
    const { anchor, rest } = named(sent, issue.path);
    const sentValue = anchor.includes('[') ? at(itemOf(sent, anchor), rest) : at(sent, issue.path.split('.').slice(1));
    const storedValue = anchor.includes('[') ? at(itemOf(stored, anchor), rest) : at(stored, issue.path.split('.').slice(1));
    return sentValue !== undefined && isDeepStrictEqual(sentValue, storedValue);
  });
}

/**
 * Mark the issues the form already had in the config the agent read, so the
 * model knows the problem came with the form and is not something it added: a
 * step saved with an empty question years ago fails the round trip, and
 * without this the refusal reads as the agent's own mistake.
 */
export function markInherited(issues: BackendIssue[], sent: unknown, stored: unknown): BackendIssue[] {
  const flags = inheritedFlags(issues, sent, stored);
  return issues.map((issue, i) => (flags[i] ? { ...issue, message: `${issue.message}${INHERITED_NOTE}` } : issue));
}

/** Codes only the MCP refuses; the API saves them as it always has (see the top of this file). */
const MCP_ONLY_CODES: ReadonlySet<string> = new Set([
  'unrecognized_keys',
  'DUPLICATE_KEY',
  'DUPLICATE_VALUE',
  'DUPLICATE_ID',
  'UNKNOWN_STEP',
  'INVALID_TARGET',
  'UNKNOWN_FIELD',
  'SCORE_OP',
  'MIN_ABOVE_MAX',
]);

/**
 * The config an API key's save stores, computed the way the API computes it:
 * the schema parse (which drops unknown fields), then the engine's
 * `normalizeConfig` (which the editor runs on every save too). Null when the
 * schema refuses it: the API then refuses the whole write anyway.
 */
interface Saved {
  steps: Array<Record<string, unknown>>;
  /** Each outcome's id by its index in the config SENT (the saved list is sorted by score). */
  outcomeIds: string[];
}

function savedConfig(sent: unknown): Saved | null {
  const parsed = formConfigSchema.safeParse(sent);
  if (!parsed.success) return null;
  try {
    const normalized = normalizeConfig(parsed.data as unknown as Parameters<typeof normalizeConfig>[0]);
    const taken = new Set<string>();
    const outcomeIds = (parsed.data.outcomes ?? []).map((o, i) => {
      const id = uniqueKey((o.id && o.id.trim()) || `outcome_${i + 1}`, taken);
      taken.add(id);
      return id;
    });
    return { steps: normalized.steps as unknown as Array<Record<string, unknown>>, outcomeIds };
  } catch {
    return null;
  }
}

/**
 * What saving does to a problem the form already had, in words, or null when
 * the API stores it exactly as sent. Checked against the API's own path
 * (schema parse, then `normalizeConfig`): an unknown field is dropped, a
 * repeated key, value or id is renamed, a jump to a missing step or to the
 * step itself is deleted. A condition on a missing field, an "@score"
 * condition without a numeric op, min above max and a jump backwards are
 * stored untouched (they only never fire).
 */
function savedChange(issue: BackendIssue, sent: unknown, saved: Saved | null): string | null {
  const [, list, index, ...rest] = issue.path.split('.');
  const i = Number(index);
  const sentStep = list === 'steps' && isObj(sent) && Array.isArray(sent.steps) ? sent.steps[i] : undefined;
  const savedStep = list === 'steps' ? saved?.steps[i] : undefined;
  switch (issue.code) {
    case 'unrecognized_keys':
      return `the draft does not keep "${issue.path.split('.').pop()}", because dForms drops fields it does not know`;
    case 'DUPLICATE_KEY': {
      const key = savedStep?.key;
      return typeof key === 'string' ? `the draft stores this step with the key "${key}"` : 'the draft stores this step under a new key';
    }
    case 'DUPLICATE_VALUE': {
      const options = savedStep?.options;
      const value = Array.isArray(options) && isObj(options[Number(rest[1])]) ? (options[Number(rest[1])] as Obj).value : undefined;
      return typeof value === 'string'
        ? `the draft stores this option with the value "${value}", so answers to it are recorded as "${value}"`
        : 'the draft stores this option under a new value';
    }
    case 'DUPLICATE_ID': {
      const id = list === 'outcomes' ? saved?.outcomeIds[i] : undefined;
      return typeof id === 'string' ? `the draft stores this outcome with the id "${id}"` : 'the draft stores this outcome under a new id';
    }
    case 'UNKNOWN_STEP':
      return 'this rule is removed from the draft';
    case 'INVALID_TARGET': {
      // A jump to the step itself is deleted; a jump backwards is stored and never fires.
      const rule = isObj(sentStep) && Array.isArray(sentStep.goto) ? sentStep.goto[Number(rest[1])] : undefined;
      const self = isObj(sentStep) && isObj(rule) && rule.target === sentStep.key;
      return self ? 'this rule is removed from the draft' : null;
    }
    default:
      return null;
  }
}

/**
 * Split an update's own refusals into what the agent added (refused) and what
 * the form already had (let through, with a warning each). A form built in the
 * editor can carry a condition on a step deleted since; refusing it would
 * block every edit of that form until the agent rewrote logic nobody asked it
 * to touch. Only the MCP's own codes split: what the API refuses anyway stays
 * a refusal, marked as inherited.
 *
 * Each warning says what the save really does to that problem. Some are
 * stored untouched; the others the API changes on the way in (the same change
 * the editor makes on its next save), and the warning names the change, never
 * "saved as it was". It is still let through rather than refused: the change
 * lands in the unpublished draft, which the user can review or discard, and
 * refusing would leave a form the editor already saves this way uneditable by
 * an agent.
 */
export function splitInherited(
  issues: BackendIssue[],
  sent: unknown,
  stored: unknown,
): { refuse: BackendIssue[]; carried: string[] } {
  const flags = inheritedFlags(issues, sent, stored);
  const refuse: BackendIssue[] = [];
  const carried: string[] = [];
  let saved: Saved | null | undefined;
  issues.forEach((issue, i) => {
    if (flags[i] && MCP_ONLY_CODES.has(issue.code)) {
      if (saved === undefined) saved = savedConfig(sent);
      const change = savedChange(issue, sent, saved);
      carried.push(
        change === null
          ? `${issue.path}: ${issue.message} It was already in the form before this edit and is saved as it was; fix it when the user agrees.`
          : `${issue.path}: ${issue.message} It was already in the form before this edit, and saving changes it: ${change}. The live form keeps the old version until publish_form; tell the user, and call discard_draft if they do not want this change.`,
      );
    } else refuse.push(flags[i] ? { ...issue, message: `${issue.message}${INHERITED_NOTE}` } : issue);
  });
  // Only schema issues left (they joined because of the MCP's own): the API reports those itself.
  if (refuse.every((issue) => !MCP_ONLY_CODES.has(issue.code) && issue.code !== 'BRANDING_MISSING')) return { refuse: [], carried };
  return { refuse, carried };
}
