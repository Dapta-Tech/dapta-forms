/**
 * The MCP QA of 2026-10-21: every input that answered OK while doing
 * something else, reproduced against the package with an in-memory backend.
 * Each `describe` is one finding; the API's side of the same findings (the
 * discard route, the step counts, the answer rows) has its own specs in
 * forms-api.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { BackendError, type FormListItem, type ResponsesPage } from './backend';
import { NOW, analytics, bootHarness, errorText, form, structured, type Harness, type HarnessOptions } from './__tests__/harness';
import { LEAD_CONFIG, QUIZ_CONFIG, SCORE_GATE_CONFIG } from './guide/examples';
import { formGuide } from './guide/guide';
import { reviewConfig, splitInherited } from './config-check';
import { renderIssues } from './support';
import { TOOLS } from './tools';

const open: Harness[] = [];
afterAll(async () => {
  await Promise.all(open.map((h) => h.close()));
});

async function client(opts: HarnessOptions = {}) {
  const h = await bootHarness(opts);
  open.push(h);
  return { h, c: await h.connect(h.key('owner')) };
}

const text = (result: unknown): string => ((result as { content: Array<{ text: string }> }).content[0]!.text);
const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

const step = (key: string, extra: Record<string, unknown> = {}) => ({ key, type: 'text', question: `${key}?`, ...extra });
const config = (steps: unknown[], extra: Record<string, unknown> = {}) => ({ version: 1, steps, ...extra });

describe('revert_form is not "undo my changes": discard_draft is', () => {
  it('says in revert_form when not to use it, and points at discard_draft', () => {
    const description = byName.revert_form!.description;
    expect(description).toMatch(/not the way to undo edits that were saved but not published/);
    expect(description).toContain('discard_draft');
    expect(byName.discard_draft!.description).toMatch(/undo or drop changes that were not published/);
  });

  it('throws away a pending draft, guarded by the stamp it just read', async () => {
    const { h, c } = await client({
      backend: { getForm: async () => form({ hasDraft: true, draftConfig: config([step('a')]), updatedAt: NOW + 7 }) },
    });
    const out = structured<{ discarded: boolean; form: { has_unpublished_draft: boolean } }>(
      await c.callTool({ name: 'discard_draft', arguments: { form_id: 'form-1' } }),
    );
    expect(out.discarded).toBe(true);
    expect(out.form.has_unpublished_draft).toBe(false);
    expect(h.calls.find((x) => x.method === 'discardDraft')!.args).toEqual(['form-1', NOW + 7]);
  });

  it("sends the agent's own stamp when it gives one", async () => {
    const { h, c } = await client({ backend: { getForm: async () => form({ hasDraft: true, draftConfig: config([step('a')]) }) } });
    await c.callTool({ name: 'discard_draft', arguments: { form_id: 'form-1', expected_updated_at: 42 } });
    expect(h.calls.find((x) => x.method === 'discardDraft')!.args).toEqual(['form-1', 42]);
  });

  it('changes nothing, and writes nothing, with no draft pending', async () => {
    const { h, c } = await client();
    const result = await c.callTool({ name: 'discard_draft', arguments: { form_id: 'form-1' } });
    expect(structured<{ discarded: boolean }>(result).discarded).toBe(false);
    expect(text(result)).toContain('nothing to discard');
    expect(h.calls.some((x) => x.method === 'discardDraft')).toBe(false);
  });

  it('is in the lifecycle the guide and the server instructions teach', () => {
    expect(formGuide('rules').lifecycle!.join(' ')).toContain('discard_draft');
  });
});

describe('dates the API cannot read are refused, never ignored', () => {
  const bad: Array<[Record<string, unknown>, string]> = [
    [{ from: '2026-13-45' }, '- from [INVALID_DATE]: "2026-13-45" is not a calendar day.'],
    [{ from: '2026-02-30' }, '- from [INVALID_DATE]: "2026-02-30" is not a calendar day.'],
    [{ to: 'yesterday' }, '- to [INVALID_DATE]: "yesterday" is not a date dForms reads.'],
    [{ from: '1760000000' }, '- from [INVALID_DATE]: 1760000000 reads as epoch seconds, not milliseconds'],
    [{ from: '2026-10-20', to: '2026-10-01' }, '- from [INVALID_RANGE]: from (2026-10-20) is after to (2026-10-01)'],
  ];

  for (const [args, line] of bad) {
    it(`list_responses refuses ${JSON.stringify(args)} and reads nothing`, async () => {
      const { h, c } = await client();
      const error = errorText(await c.callTool({ name: 'list_responses', arguments: { form_id: 'form-1', ...args } }));
      expect(error).toContain('VALIDATION_FAILED');
      expect(error).toContain(line);
      expect(error).toContain(line.includes('INVALID_RANGE') ? 'Swap from and to' : 'YYYY-MM-DD');
      expect(h.calls.some((x) => x.method === 'listResponses')).toBe(false);
    });
  }

  it('get_form_analytics refuses an unknown time zone instead of falling back to the workspace zone', async () => {
    const { h, c } = await client();
    const error = errorText(
      await c.callTool({ name: 'get_form_analytics', arguments: { form_id: 'form-1', time_zone: 'Mars/Olympus', from: 'last week' } }),
    );
    expect(error).toContain('VALIDATION_FAILED: 2 problems');
    expect(error).toContain('- time_zone [INVALID_TIME_ZONE]');
    expect(error).toContain('America/Bogota');
    expect(error).toContain('- from [INVALID_DATE]');
    expect(h.calls.some((x) => x.method === 'formAnalytics')).toBe(false);
  });

  it('passes a day, epoch milliseconds and an ISO instant through untouched', async () => {
    const { h, c } = await client();
    const ms = String(Date.UTC(2026, 9, 1));
    structured(await c.callTool({ name: 'list_responses', arguments: { form_id: 'form-1', from: '2026-10-01', to: ms } }));
    structured(
      await c.callTool({
        name: 'get_form_analytics',
        arguments: { form_id: 'form-1', from: '2026-10-01T00:00:00Z', to: '2026-10-31', time_zone: 'America/Bogota' },
      }),
    );
    expect(h.calls.find((x) => x.method === 'listResponses')!.args[1]).toMatchObject({ from: '2026-10-01', to: ms });
    expect(h.calls.find((x) => x.method === 'formAnalytics')!.args[1]).toEqual({
      from: '2026-10-01T00:00:00Z',
      to: '2026-10-31',
      timeZone: 'America/Bogota',
    });
  });
});

describe('a form never published with a step is not a link to share', () => {
  const empty = form({ config: config([]), hasDraft: true, draftConfig: config([step('a')]) });

  it('get_form says the live version is empty, and not to share the link', async () => {
    const { c } = await client({ backend: { getForm: async () => empty } });
    const result = await c.callTool({ name: 'get_form', arguments: { form_id: 'form-1' } });
    expect(structured(result)).toMatchObject({ is_live: false, live_step_count: 0, has_unpublished_draft: true });
    expect(text(result)).toContain('opens an empty form: do not share it until publish_form');
    expect(text(result)).not.toContain('Public link');
  });

  it('list_forms names the empty ones in its summary and marks them', async () => {
    const items: FormListItem[] = [
      { ...form({ id: 'a', name: 'Agenda una demo' }), liveStepCount: 0 },
      { ...form({ id: 'b', name: 'Contact' }), liveStepCount: 3 },
    ].map(({ config: _c, draftConfig: _d, publishedAt: _p, previousPublishedAt: _pp, ...item }) => item);
    const { c } = await client({ backend: { listForms: async () => items } });
    const result = await c.callTool({ name: 'list_forms', arguments: {} });
    const out = structured<{ forms: Array<{ is_live: boolean; live_step_count: number }> }>(result);
    expect(out.forms.map((f) => [f.is_live, f.live_step_count])).toEqual([
      [false, 0],
      [true, 3],
    ]);
    expect(text(result)).toContain('"Agenda una demo"');
    expect(text(result)).toContain('do not share it');
  });

  it('create_form never calls an empty form live', async () => {
    const { c } = await client({ backend: { createForm: async () => form({ config: config([]) }) } });
    const result = await c.callTool({ name: 'create_form', arguments: { name: 'Empty', config: config([]) } });
    expect(text(result)).not.toContain('It is live now');
    expect(text(result)).toContain('opens an empty form');
  });
});

describe('unknown fields are refused, as the guide promises', () => {
  it('names each unknown field with its path, at any depth, and sends nothing', async () => {
    const { h, c } = await client();
    const bad = config([step('a', { colour: 'red' })], { cover: { enabled: true, headline: 'Hi', subtitle: 'x' }, theme: 'dark' });
    const error = errorText(await c.callTool({ name: 'create_form', arguments: { name: 'X', config: bad } }));
    expect(error).toContain('- config.steps.0.colour [unrecognized_keys]');
    expect(error).toContain('- config.cover.subtitle [unrecognized_keys]');
    expect(error).toContain('- config.theme [unrecognized_keys]');
    expect(error).toContain('config_schema of get_form_guide');
    expect(h.calls.some((x) => x.method === 'createForm')).toBe(false);
  });

  it('accepts every worked example of the guide as it is', async () => {
    const { h, c } = await client();
    for (const example of [LEAD_CONFIG, QUIZ_CONFIG, SCORE_GATE_CONFIG])
      structured(await c.callTool({ name: 'create_form', arguments: { name: 'Example', config: example as unknown as Record<string, unknown> } }));
    expect(h.calls.filter((x) => x.method === 'createForm')).toHaveLength(3);
  });

  it('says in the schema the MCP serves that nothing outside it is saved', () => {
    const schema = formGuide('config_schema').config_schema as { description: string; additionalProperties: unknown };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.description).toContain('create_form and update_form');
    expect(schema.description).not.toContain('POST /v1/forms');
  });
});

describe('what the API would rename or delete is refused instead', () => {
  it('a repeated step key, a repeated option value and a goto to a step that does not exist', async () => {
    const { h, c } = await client();
    const bad = config([
      {
        key: 'plan',
        type: 'multiple_choice',
        question: 'Plan?',
        options: [
          { label: 'A', value: 'a' },
          { label: 'B', value: 'a' },
        ],
        goto: [{ values: ['a'], target: 'nowhere' }],
      },
      step('plan'),
    ]);
    const error = errorText(await c.callTool({ name: 'create_form', arguments: { name: 'X', config: bad } }));
    expect(error).toContain('- config.steps.1.key [DUPLICATE_KEY]: Step key "plan" is already used by steps.0.');
    expect(error).toContain('- config.steps.0.options.1.value [DUPLICATE_VALUE]');
    expect(error).toContain('- config.steps.0.goto.0.target [UNKNOWN_STEP]: No step has the key "nowhere"');
    expect(h.calls.some((x) => x.method === 'createForm')).toBe(false);
  });

  it('a goto backwards or to itself, which would never fire', async () => {
    const { c } = await client();
    const bad = config([step('a'), step('b', { goto: [{ values: ['x'], target: 'a' }, { values: ['y'], target: 'b' }] })]);
    const error = errorText(await c.callTool({ name: 'create_form', arguments: { name: 'X', config: bad } }));
    expect(error).toContain('- config.steps.1.goto.0.target [INVALID_TARGET]: "a" comes before this step');
    expect(error).toContain('- config.steps.1.goto.1.target [INVALID_TARGET]: A step cannot jump to itself');
  });
});

describe('a config that would never behave as written is refused', () => {
  it('names every problem the schema cannot see, each with its fix', async () => {
    const { c } = await client();
    const bad = config(
      [
        { key: 'size', type: 'slider', question: 'Size?', min: 10, max: 1, sliderScoring: [{ min: 5, max: 2, points: 1 }] },
        step('gated', { showWhen: { field: '@score', values: ['10'] } }),
        step('ghost', { hideWhen: { field: 'nope', values: ['x'] } }),
      ],
      {
        scoring: { enabled: true },
        outcomes: [
          { id: 'low', label: 'Low', minScore: 10, maxScore: 0 },
          { id: 'low', label: 'Again', minScore: 11 },
        ],
      },
    );
    const error = errorText(await c.callTool({ name: 'create_form', arguments: { name: 'X', config: bad } }));
    expect(error).toContain('- config.steps.0.max [MIN_ABOVE_MAX]');
    expect(error).toContain('- config.steps.0.sliderScoring.0.max [MIN_ABOVE_MAX]');
    expect(error).toContain('- config.steps.1.showWhen.op [SCORE_OP]');
    expect(error).toContain('With "@score" use op gt, lt or eq');
    expect(error).toContain('- config.steps.2.hideWhen.field [UNKNOWN_FIELD]: No step has the key "nope"');
    expect(error).toContain('- config.outcomes.0.maxScore [MIN_ABOVE_MAX]');
    expect(error).toContain('- config.outcomes.1.id [DUPLICATE_ID]');
  });

  it('saves scoring without outcomes, and says what it means', async () => {
    const { c } = await client();
    const result = await c.callTool({
      name: 'create_form',
      arguments: { name: 'X', config: config([step('a')], { scoring: { enabled: true } }) },
    });
    const out = structured<{ warnings: string[] }>(result);
    expect(out.warnings.join(' ')).toContain('scoring.enabled is true but the form has no outcomes');
  });

  it('accepts a condition on a name step sub-field', async () => {
    const { c } = await client();
    structured(
      await c.callTool({
        name: 'create_form',
        arguments: { name: 'X', config: config([{ key: 'name', type: 'name', question: 'Name?' }, step('b', { showWhen: { field: 'firstname', values: ['Ada'] } })]) },
      }),
    );
  });
});

describe('a publish retried with the stamp from before it went through', () => {
  const stale = async () => {
    throw new BackendError(409, 'STALE', 'This form was saved elsewhere since you loaded it.', [], { updatedAt: NOW + 9 });
  };

  it('is a no-op success when the last write was a publish after the stamp, not a STALE that says to apply the change again', async () => {
    const { c } = await client({
      backend: { publishForm: stale, getForm: async () => form({ updatedAt: NOW + 9, publishedAt: NOW + 9 }) },
    });
    const result = await c.callTool({ name: 'publish_form', arguments: { form_id: 'form-1', expected_updated_at: NOW } });
    expect(structured(result)).toMatchObject({ nothing_published: true });
    expect(text(result)).toContain('nothing was published');
    expect(text(result)).toContain('If that publish was not yours');
  });

  it('is still a STALE when the draft went some other way (discarded, saved over), and says to check the live config', async () => {
    const { c } = await client({ backend: { publishForm: stale, getForm: async () => form({ updatedAt: NOW + 9, publishedAt: null }) } });
    const error = errorText(await c.callTool({ name: 'publish_form', arguments: { form_id: 'form-1', expected_updated_at: NOW } }));
    expect(error).toContain('STALE');
    expect(error).toContain('No draft is pending any more');
    expect(error).toContain('check whether the live config holds your change');
  });

  it('says nothing was published when no draft was pending, instead of "is live"', async () => {
    const { c } = await client({ backend: { publishForm: async () => form({ publishedAt: NOW - 1_000 }) } });
    const result = await c.callTool({ name: 'publish_form', arguments: { form_id: 'form-1' } });
    expect(structured(result)).toMatchObject({ nothing_published: true });
    expect(text(result)).not.toMatch(/"Lead form" is live/);
  });

  it('with a draft still pending, says to review that draft, never to apply the change again', async () => {
    const { c } = await client({
      backend: { publishForm: stale, getForm: async () => form({ hasDraft: true, draftConfig: config([step('a')]), updatedAt: NOW + 9 }) },
    });
    const error = errorText(await c.callTool({ name: 'publish_form', arguments: { form_id: 'form-1', expected_updated_at: NOW } }));
    expect(error).toContain('STALE');
    expect(error).toContain(`Its updated_at is now ${NOW + 9}`);
    expect(error).toContain('review the pending draft');
    expect(error).not.toContain('apply your change again');
  });
});

describe('list_responses says which step each answer belongs to, and keeps answers to removed steps', () => {
  const page: ResponsesPage = {
    items: [
      {
        id: 'r1',
        completedAt: NOW,
        startedAt: NOW - 60_000,
        partialAt: null,
        score: 12,
        outcome: { id: 'hot', label: 'Hot lead' },
        answers: [
          { question: 'Email?', answer: 'ada@example.test', stepKey: 'email', type: 'email' },
          { question: 'old_q', answer: 'kept', stepKey: 'old_q', type: null, stepRemoved: true },
        ],
      },
      { id: 'r2', completedAt: null, startedAt: NOW, partialAt: NOW, score: 0, outcome: null, answers: [] },
    ],
    total: 2,
    limit: 20,
    offset: 0,
  };

  it('returns step_key, type, step_removed and the outcome', async () => {
    const { c } = await client({ backend: { listResponses: async () => page } });
    const result = await c.callTool({ name: 'list_responses', arguments: { form_id: 'form-1' } });
    const out = structured<{ responses: Array<Record<string, unknown>> }>(result);
    expect(out.responses[0]).toMatchObject({
      outcome: { id: 'hot', label: 'Hot lead' },
      respondent_supplied: {
        answers: [
          { question: 'Email?', answer: 'ada@example.test', step_key: 'email', type: 'email', step_removed: false },
          { question: 'old_q', answer: 'kept', step_key: 'old_q', type: null, step_removed: true },
        ],
      },
    });
    expect(out.responses[1]!.outcome).toBeNull();
    expect(text(result)).toContain('step_removed');
  });
});

describe('get_form_analytics says when its numbers cannot be read as a funnel', () => {
  it('warns when there are more submissions than views or starts (responses created through the API)', async () => {
    const { c } = await client({ backend: { formAnalytics: async () => analytics({ views: 1, starts: 1, submissions: 23, completionRate: 100 }) } });
    const result = await c.callTool({ name: 'get_form_analytics', arguments: { form_id: 'form-1' } });
    expect(structured<{ warnings: string[] }>(result).warnings[0]).toContain('The funnel does not add up (1 views, 1 starts, 23 submissions)');
    expect(text(result)).toContain('not reliable');
  });

  it('blames lost view beacons, not the API, when only starts outnumber views', async () => {
    const { c } = await client({ backend: { formAnalytics: async () => analytics({ views: 3, starts: 10, submissions: 2, completionRate: 20 }) } });
    const warnings = structured<{ warnings: string[] }>(await c.callTool({ name: 'get_form_analytics', arguments: { form_id: 'form-1' } })).warnings;
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('more starts than views');
    expect(warnings[0]).toContain('lost view beacon');
    expect(warnings[0]).not.toContain('created through the API');
  });

  it('blames responses created through the API, not lost views, when only submissions outnumber starts', async () => {
    const { c } = await client({ backend: { formAnalytics: async () => analytics({ views: 30, starts: 10, submissions: 23, completionRate: 100 }) } });
    const warnings = structured<{ warnings: string[] }>(await c.callTool({ name: 'get_form_analytics', arguments: { form_id: 'form-1' } })).warnings;
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('created through the API');
    expect(warnings[0]).not.toContain('lost view beacon');
  });

  it('counts the span of an epoch-ms window in local days, as the API does', async () => {
    const day = 86_400_000;
    // 365 days and 23 hours in UTC ms, but 367 calendar days (2025-01-01 to 2026-01-02).
    const from = Date.parse('2025-01-01T10:00:00Z');
    const to = Date.parse('2026-01-02T09:00:00Z');
    const trends = Array.from({ length: 366 }, (_, i) => ({ t: to - i * day, views: 0, starts: 0, submissions: 0, completionRate: null, timeToComplete: null }));
    const { c } = await client({ backend: { formAnalytics: async () => analytics({ trends, range: { from, to, timeZone: 'UTC' } }) } });
    const out = structured<{ daily_truncated: boolean }>(
      await c.callTool({ name: 'get_form_analytics', arguments: { form_id: 'form-1', from: String(from), to: String(to), include_daily: true } }),
    );
    expect(out.daily_truncated).toBe(true);
  });

  it('says nothing when the funnel adds up', async () => {
    const { c } = await client();
    expect(structured(await c.callTool({ name: 'get_form_analytics', arguments: { form_id: 'form-1' } })).warnings).toBeUndefined();
  });

  it('flags a daily series cut to its last 366 days, and only then', async () => {
    const day = 86_400_000;
    const trends = Array.from({ length: 366 }, (_, i) => ({ t: NOW - i * day, views: 0, starts: 0, submissions: 0, completionRate: null, timeToComplete: null }));
    const long = await client({ backend: { formAnalytics: async () => analytics({ trends, range: { from: NOW - 800 * day, to: NOW, timeZone: 'UTC' } }) } });
    const cut = structured<{ daily_truncated: boolean; daily: unknown[]; warnings: string[] }>(
      await long.c.callTool({ name: 'get_form_analytics', arguments: { form_id: 'form-1', include_daily: true } }),
    );
    expect(cut.daily_truncated).toBe(true);
    expect(cut.daily).toHaveLength(366);
    expect(cut.warnings.join(' ')).toContain('most recent 366 days');
    const short = await client();
    const whole = structured<{ daily_truncated: boolean }>(
      await short.c.callTool({ name: 'get_form_analytics', arguments: { form_id: 'form-1', include_daily: true } }),
    );
    expect(whole.daily_truncated).toBe(false);
  });

  it('names the first drop-off row "(form opened)", never as if the cover headline were a question', async () => {
    const { c } = await client({
      backend: {
        formAnalytics: async () =>
          analytics({
            dropoff: [{ stepIndex: -1, key: null, question: 'Welcome to our quiz', isCover: true, views: 10, dropoff: 4, dropoffPercent: 40 }],
          }),
      },
    });
    const out = structured<{ dropoff: { steps: Array<{ question: string }> } }>(
      await c.callTool({ name: 'get_form_analytics', arguments: { form_id: 'form-1' } }),
    );
    expect(out.dropoff.steps[0]!.question).toBe('(form opened: its cover "Welcome to our quiz")');
  });
});

describe('list_forms matches names without regard to accents', () => {
  it('finds "Contáctanos" by "contactanos"', async () => {
    const { c } = await client({ backend: { listForms: async () => [form({ name: 'Contáctanos' }), form({ id: 'b', name: 'Quiz' })] } });
    const out = structured<{ forms: Array<{ name: string }> }>(await c.callTool({ name: 'list_forms', arguments: { query: 'contactanos' } }));
    expect(out.forms.map((f) => f.name)).toEqual(['Contáctanos']);
  });
});

describe('destinations stay out of the config', () => {
  const hook = { id: 'h1', type: 'webhook', enabled: true, settings: { url: 'https://hooks.example.test/in' } };

  it('get_form leaves them out of config and live_config and only counts them', async () => {
    const live = config([step('a')], { destinations: [hook] });
    const { c } = await client({ backend: { getForm: async () => form({ config: live, hasDraft: true, draftConfig: config([step('b')]) }) } });
    const out = structured<{ config: Record<string, unknown>; live_config: Record<string, unknown>; connected_destinations: number }>(
      await c.callTool({ name: 'get_form', arguments: { form_id: 'form-1' } }),
    );
    expect(out.config.destinations).toBeUndefined();
    expect(out.live_config.destinations).toBeUndefined();
    expect(out.connected_destinations).toBe(1);
  });

  it('update_form says it ignored them instead of dropping them silently', async () => {
    const { c } = await client();
    const result = await c.callTool({
      name: 'update_form',
      arguments: { form_id: 'form-1', config: config([step('a')], { destinations: [hook] }), expected_updated_at: NOW },
    });
    expect(structured<{ warnings: string[] }>(result).warnings[0]).toContain('config.destinations was ignored');
    expect(text(result)).toContain('config.destinations was ignored');
  });
});

describe('a problem the form already had says so', () => {
  it('marks an EMPTY_QUESTION that was in the config get_form returned', async () => {
    const stored = config([step('a', { question: '' }), step('b')]);
    const { c } = await client({
      backend: {
        getForm: async () => form({ hasDraft: true, draftConfig: stored }),
        updateForm: async () => {
          throw new BackendError(400, 'BAD_REQUEST', 'Every step needs a question.', [
            { path: 'config.steps.0.question', message: 'Every step needs a question.', code: 'EMPTY_QUESTION' },
            { path: 'config.steps.1.question', message: 'Every step needs a question.', code: 'EMPTY_QUESTION' },
          ]);
        },
      },
    });
    const sent = config([step('a', { question: '' }), step('b', { question: '' })]);
    const error = errorText(await c.callTool({ name: 'update_form', arguments: { form_id: 'form-1', config: sent, expected_updated_at: NOW } }));
    const [first, second] = error.split('\n').filter((l) => l.startsWith('- '));
    expect(first).toContain('config.steps.0.question [EMPTY_QUESTION]');
    expect(first).toContain('already in the config get_form returned');
    expect(second).toContain('config.steps.1.question [EMPTY_QUESTION]');
    expect(second).not.toContain('already in the config get_form returned');
  });

  it('refuses a problem the agent added, and not one an editor-built form already had', async () => {
    const stored = config([step('a', { hideWhen: { field: 'gone', values: ['x'] } }), step('b')]);
    const { h, c } = await client({ backend: { getForm: async () => form({ config: stored }) } });
    const sent = config([step('a', { hideWhen: { field: 'gone', values: ['x'] } }), step('b', { showWhen: { field: 'nope', values: ['y'] } })]);
    const error = errorText(await c.callTool({ name: 'update_form', arguments: { form_id: 'form-1', config: sent, expected_updated_at: NOW } }));
    expect(error).toContain('VALIDATION_FAILED: 1 problem');
    expect(error).toContain('config.steps.1.showWhen.field [UNKNOWN_FIELD]');
    expect(error).not.toContain('steps.0.hideWhen.field');
    expect(h.calls.some((x) => x.method === 'updateForm')).toBe(false);
  });

  it('saves an edit of a form that already had such a problem, and reports it as a warning', async () => {
    const stored = config([step('a', { hideWhen: { field: 'gone', values: ['x'] } }), step('b')]);
    const { h, c } = await client({ backend: { getForm: async () => form({ config: stored }) } });
    const sent = config([step('a', { question: 'Edited?', hideWhen: { field: 'gone', values: ['x'] } }), step('b')]);
    const out = structured<{ warnings: string[] }>(
      await c.callTool({ name: 'update_form', arguments: { form_id: 'form-1', config: sent, expected_updated_at: NOW } }),
    );
    expect(out.warnings.join(' ')).toContain('config.steps.0.hideWhen.field: No step has the key "gone"');
    expect(out.warnings.join(' ')).toContain('already in the form before this edit');
    expect(h.calls.some((x) => x.method === 'updateForm')).toBe(true);
  });

  it('names what the save changes, and says "saved as it was" only for what the API stores untouched', () => {
    const stored = config(
      [
        step('a', { extra: 1 }),
        step('a'),
        step('c', { goto: [{ values: ['x'], target: 'c' }, { values: ['y'], target: 'a' }] }),
        { key: 'pick', type: 'multiple_choice', question: 'Pick?', options: [{ label: 'X', value: 'x' }, { label: 'X2', value: 'x' }] },
      ],
      { outcomes: [{ id: 'hot', minScore: 5, maxScore: 1, label: 'Hot' }, { id: 'hot', minScore: 0, label: 'Hot too' }] },
    );
    const issues = reviewConfig(stored).issues;
    const { refuse, carried } = splitInherited(issues, stored, stored);
    expect(refuse).toEqual([]);
    const about = (path: string) => carried.find((w) => w.startsWith(`${path}:`))!;
    expect(about('config.steps.0.extra')).toContain('the draft does not keep "extra"');
    expect(about('config.steps.1.key')).toContain('the draft stores this step with the key "a_2"');
    expect(about('config.steps.3.options.1.value')).toContain('with the value "x_2"');
    expect(about('config.outcomes.1.id')).toContain('the draft stores this outcome with the id "hot_2"');
    expect(about('config.steps.2.goto.0.target')).toContain('this rule is removed from the draft');
    // Stored untouched: a jump backwards and min above max only never fire.
    expect(about('config.steps.2.goto.1.target')).toContain('is saved as it was');
    expect(about('config.outcomes.0.maxScore')).toContain('is saved as it was');
    for (const w of carried.filter((x) => x.includes('saving changes it'))) expect(w).not.toContain('saved as it was');
  });
});

describe('the brand kit is never applied or dropped without a word', () => {
  const branded = config([step('a')], { branding: { primaryColor: '#3DDC84' } });

  it('create_form says when dForms filled branding in', async () => {
    const { c } = await client({ backend: { createForm: async (_c, input) => form({ id: 'n', name: input.name, config: branded }) } });
    const out = structured<{ warnings: string[] }>(await c.callTool({ name: 'create_form', arguments: { name: 'X', config: config([step('a')]) } }));
    expect(out.warnings.join(' ')).toContain('dForms filled config.branding');
  });

  it('update_form refuses a config that would drop the branding the form has, and writes nothing', async () => {
    const { h, c } = await client({ backend: { getForm: async () => form({ config: branded }) } });
    const error = errorText(
      await c.callTool({ name: 'update_form', arguments: { form_id: 'form-1', config: config([step('a')]), expected_updated_at: NOW } }),
    );
    expect(error).toContain('- config.branding [BRANDING_MISSING]');
    expect(error).toContain('`branding: null`');
    expect(h.calls.some((x) => x.method === 'updateForm')).toBe(false);
  });

  it('update_form takes branding: null as removing it on purpose', async () => {
    const { h, c } = await client({ backend: { getForm: async () => form({ config: branded }) } });
    structured(
      await c.callTool({ name: 'update_form', arguments: { form_id: 'form-1', config: config([step('a')], { branding: null }), expected_updated_at: NOW } }),
    );
    expect(h.calls.some((x) => x.method === 'updateForm')).toBe(true);
  });

  it('is in the guide', () => {
    expect(formGuide('rules').rules!.join(' ')).toContain('BRANDING_MISSING');
  });
});

describe('a refusal says each thing once', () => {
  it('STEPS_REQUIRED does not repeat "Send the full steps array"', () => {
    const line = renderIssues([
      {
        path: 'config.steps',
        code: 'STEPS_REQUIRED',
        message: 'Send the full steps array: a config without steps would replace every step with none.',
      },
    ]);
    expect(line.match(/Send the full steps array/g)).toHaveLength(1);
  });
});
