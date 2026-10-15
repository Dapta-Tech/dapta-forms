import { formConfigSchema } from '@quill/types';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Config fields the editor has no control for, as dot paths (`[]` = every item
 * of an array). With an API key the API refuses them (`UNSUPPORTED_FIELD`),
 * because a form an agent saves with one of them is a form a person can no
 * longer edit in full. The JSON Schema in the skill leaves them out, so an
 * agent that validates against it never sends one in the first place.
 *
 * The list is the API spec's, from the research on fields without a control.
 * Webhook `signatureHeader` and `timeoutMs` live under the webhook variant of
 * `destinations[]`; the last three are the legacy single-reveal fields that
 * `reveal` steps replaced.
 */
export const UNSUPPORTED_CONFIG_FIELDS = [
  'outcomes.[].booking',
  'steps.[].buttonText',
  'steps.[].sliderUnitLabel',
  'steps.[].reveal.subtitleTemplate',
  'steps.[].reveal.enabled',
  'steps.[].scheduler.prefill',
  'steps.[].flowGroup',
  'branding.clientLogos',
  'destinations.[].settings.signatureHeader',
  'destinations.[].settings.timeoutMs',
  'reveal',
  'revealAfterStep',
  'steps.[].triggersReveal',
] as const;

type JsonSchema = Record<string, unknown>;

/**
 * Of those fields, the ones the editor writes itself, with the only value the
 * API accepts for each. Every step the builder makes carries them and so does
 * every config the API answers with, so a config read and sent straight back
 * must validate. The schema keeps them, pinned to that value, instead of
 * dropping them; any other value still fails, as it does at the API.
 */
export const EDITOR_DEFAULT_FIELDS: Partial<Record<(typeof UNSUPPORTED_CONFIG_FIELDS)[number], JsonSchema>> = {
  'steps.[].flowGroup': {
    type: 'string',
    enum: ['qualification', 'lead_capture'],
    description:
      'Derived from the step type: lead_capture for name, email and phone, qualification for every other type. Leave it out on a new step; on a step you read, send back what it carries.',
  },
  'steps.[].buttonText': {
    const: 'Continue',
    description: 'The editor default on a message step. Leave it out, or send back "Continue" as read.',
  },
  'steps.[].reveal.enabled': {
    const: true,
    description: 'The editor default on a reveal step. Leave it out, or send back true as read.',
  },
  'steps.[].scheduler.prefill': {
    const: true,
    description: 'The editor default on a scheduler step. Leave it out, or send back true as read.',
  },
};

/**
 * Of those fields, the ones a form can already carry without the agent adding
 * them: a template seeds `sliderUnitLabel` on its sliders and the brand kit
 * writes `branding.clientLogos`. The API takes them back when they equal what
 * the form stores, and refuses a new or changed value, which a JSON Schema
 * cannot tell apart. The schema keeps their shape, so a config read and sent
 * straight back validates, and says in `description` not to add or change them.
 */
export const KEPT_AS_READ_FIELDS: Partial<Record<(typeof UNSUPPORTED_CONFIG_FIELDS)[number], string>> = {
  'steps.[].sliderUnitLabel':
    'Only as read: a form made from a template may carry it. Send it back unchanged; never add or change it (UNSUPPORTED_FIELD).',
  'branding.clientLogos':
    'Only as read: the brand kit writes it. Send it back unchanged; never add or change it (UNSUPPORTED_FIELD).',
};

/**
 * Descriptions the generated schema gets on top of the zod contract, for the
 * fields an agent cannot guess from their shape. A condition's `field` takes a
 * step key, or the reserved `@score`, which nothing in the shape would reveal.
 */
const CONDITION_FIELD_DESCRIPTION =
  'The step key whose answer the condition reads, or "@score": the running score of the steps shown before this one, not counting this step (only the ops gt, lt, eq and between apply to it). A step gated by "@score" goes after the last scored question.';

export const FIELD_DESCRIPTIONS: Record<string, string> = {
  'steps.[].showWhen.field': CONDITION_FIELD_DESCRIPTION,
  'steps.[].hideWhen.field': CONDITION_FIELD_DESCRIPTION,
};

/** The schema itself and every object variant of a nullable or union node. */
function variants(node: unknown): JsonSchema[] {
  if (!node || typeof node !== 'object') return [];
  const n = node as JsonSchema;
  const out: JsonSchema[] = [n];
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const list = n[key];
    if (Array.isArray(list)) for (const member of list) out.push(...variants(member));
  }
  return out;
}

/** The nodes a path segment leads to from `nodes`. */
function step(nodes: JsonSchema[], segment: string): JsonSchema[] {
  const next: JsonSchema[] = [];
  for (const node of nodes) {
    for (const v of variants(node)) {
      if (segment === '[]') {
        if (v.items && typeof v.items === 'object') next.push(v.items as JsonSchema);
      } else {
        const props = v.properties as Record<string, JsonSchema> | undefined;
        if (props && props[segment]) next.push(props[segment]);
      }
    }
  }
  return next;
}

/**
 * Remove the field at `path` from every object it can appear in, pin it to
 * `replacement` when one is given, or keep it with `keepWith` as its
 * description. Returns how many properties were touched,
 * so a path that no longer matches the schema (a field renamed in
 * `@quill/types`) is noticed instead of silently ignored.
 */
function removeField(
  root: JsonSchema,
  path: string,
  replacement?: JsonSchema,
  keepWith?: string,
): number {
  const segments = path.split('.');
  const field = segments.pop()!;
  let nodes: JsonSchema[] = [root];
  for (const segment of segments) nodes = step(nodes, segment);
  let removed = 0;
  for (const node of nodes) {
    for (const v of variants(node)) {
      const props = v.properties as Record<string, unknown> | undefined;
      if (props && field in props) {
        if (replacement) props[field] = { ...replacement };
        else if (keepWith !== undefined) props[field] = { ...(props[field] as JsonSchema), description: keepWith };
        else delete props[field];
        if (Array.isArray(v.required)) v.required = v.required.filter((r) => r !== field);
        removed++;
      }
    }
  }
  return removed;
}

/** Set `description` on the field at `path` everywhere it appears; returns how many. */
function describeField(root: JsonSchema, path: string, description: string): number {
  const segments = path.split('.');
  const field = segments.pop()!;
  let nodes: JsonSchema[] = [root];
  for (const segment of segments) nodes = step(nodes, segment);
  let described = 0;
  for (const node of nodes) {
    for (const v of variants(node)) {
      const props = v.properties as Record<string, JsonSchema> | undefined;
      if (props && props[field]) {
        props[field] = { ...props[field], description };
        described++;
      }
    }
  }
  return described;
}

/**
 * The form config as a JSON Schema (draft-07), generated from
 * `formConfigSchema` so it can never drift from what the API parses, minus the
 * fields in `UNSUPPORTED_CONFIG_FIELDS` (the editor defaults among them stay,
 * pinned to the value the editor writes: `EDITOR_DEFAULT_FIELDS`; the fields a
 * form carries from a template or the kit stay as they are:
 * `KEPT_AS_READ_FIELDS`).
 *
 * Every sub-schema is inlined (`$refStrategy: 'none'`): the reveal shape is
 * used both at the top level and inside steps, and a `$ref` from one to the
 * other would dangle once the top-level copy is removed.
 *
 * `steps` is marked required. The zod schema defaults it to `[]`, but a `PUT`
 * with an API key that leaves it out is refused (`STEPS_REQUIRED`), and the
 * skill tells the agent to always send the whole list.
 */
export function formConfigJsonSchema(): JsonSchema {
  const schema = zodToJsonSchema(formConfigSchema, {
    $refStrategy: 'none',
    target: 'jsonSchema7',
  }) as JsonSchema;
  for (const path of UNSUPPORTED_CONFIG_FIELDS) {
    if (removeField(schema, path, EDITOR_DEFAULT_FIELDS[path], KEPT_AS_READ_FIELDS[path]) === 0) {
      throw new Error(`Unsupported config field ${path} is not in formConfigSchema any more.`);
    }
  }
  for (const [path, description] of Object.entries(FIELD_DESCRIPTIONS)) {
    if (describeField(schema, path, description) === 0) {
      throw new Error(`Described config field ${path} is not in formConfigSchema any more.`);
    }
  }
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  required.add('steps');
  return {
    $schema: schema.$schema,
    $id: 'form-config.schema.json',
    title: 'dForms form config (version 1)',
    description:
      'The `config` object of a dForms form, as POST /v1/forms and PUT /v1/forms/{id} accept it. Fields the editor cannot show are left out (the API refuses them with UNSUPPORTED_FIELD), except the defaults the editor writes itself, which only take that value, and the fields a form carries from a template or the brand kit, which only go back as read.',
    ...Object.fromEntries(Object.entries(schema).filter(([k]) => k !== '$schema')),
    required: [...required],
  };
}
