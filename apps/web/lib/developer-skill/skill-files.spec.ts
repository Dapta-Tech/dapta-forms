import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { interpolate, resolveOutcome, computeScore, visibleSteps } from '@quill/engine';
import { buildSkillFiles, SKILL_DIR } from './skill-files';
import { EXAMPLE_CONFIGS, SCORE_GATE_CONFIG } from '@quill/mcp/guide';

const urls = { apiUrl: 'https://api.forms.example.com', appUrl: 'https://forms.example.com' };
const files = new Map(buildSkillFiles(urls).map((f) => [f.path, f.content]));

/** Every host-looking token of the vendor's own domains, built so this file does not contain one. */
const VENDOR = new RegExp(['[a-z0-9-]+\\.', 'dap', 'ta\\.(ai|dev|com)'].join(''), 'i');
const VENDOR_WORDS = new RegExp(['dap', 'tatech|amazon', 'aws|dap', 'ta_forms|forms', '_ms'].join(''), 'i');
const DASHES = /\u2014|\u2015|\u2013/;

describe('buildSkillFiles', () => {
  it('ships every file the ticket lists, inside one folder', () => {
    expect([...files.keys()].sort()).toEqual(
      [
        'INSTALL.md',
        'SKILL.md',
        'recipes/analytics-and-csv.md',
        'recipes/edit-a-step.md',
        'recipes/gate-a-step-by-score.md',
        'recipes/publish-and-revert.md',
        'recipes/quiz-with-scoring.md',
        'recipes/responses-with-filters.md',
        'reference/endpoints.md',
        'reference/errors.md',
        'reference/form-config.schema.json',
      ].map((p) => `${SKILL_DIR}/${p}`),
    );
  });

  it('opens SKILL.md with frontmatter that says when to use it', () => {
    const skill = files.get(`${SKILL_DIR}/SKILL.md`)!;
    const front = /^---\nname: dforms-api\ndescription: (.+)\n---\n/.exec(skill);
    expect(front).not.toBeNull();
    expect(front![1]).toMatch(/Use it whenever/);
  });

  it('states the rules the agent must follow', () => {
    const skill = files.get(`${SKILL_DIR}/SKILL.md`)!;
    expect(skill).toContain('GET /v1/forms'); // list before retrying a POST
    expect(skill).toContain('`steps`');
    expect(skill).toContain('expectedUpdatedAt');
    expect(skill).toContain('UNSUPPORTED_FIELD');
    expect(skill).toContain('`publicUrl` exactly as the API returns it');
    expect(skill).toContain('Retry-After');
  });

  it('injects the environment URLs and leaves no placeholder behind', () => {
    const skill = files.get(`${SKILL_DIR}/SKILL.md`)!;
    expect(skill).toContain('`https://api.forms.example.com`');
    expect(skill).toContain('https://forms.example.com/admin/developers/connect');
    expect(skill).toContain('https://forms.example.com/admin/developers/tools');
    const install = files.get(`${SKILL_DIR}/INSTALL.md`)!;
    expect(install).toContain('https://forms.example.com/admin/developers/connect');
    expect(install).toContain('https://forms.example.com/admin/developers/tools');
    // The old address only redirects; the skill names the pages themselves.
    for (const [path, content] of files) expect(content, path).not.toMatch(/\/admin\/developers(?!\/(connect|tools))/);
    for (const [path, content] of files) {
      expect(content, path).not.toMatch(/\$\{|undefined|null\/v1|localhost/);
    }
    for (const path of ['endpoints.md'].map((p) => `${SKILL_DIR}/reference/${p}`)) {
      expect(files.get(path)).toContain('https://api.forms.example.com');
    }
    for (const [path, content] of files) {
      if (path.includes('/recipes/')) expect(content, path).toContain('https://api.forms.example.com/v1/');
    }
  });

  it('documents every route a key can reach, including responses, analytics, CSV, me and revert', () => {
    const endpoints = files.get(`${SKILL_DIR}/reference/endpoints.md`)!;
    for (const route of [
      '/v1/me',
      '/v1/forms/{id}/revert',
      '/v1/forms/{id}/publish',
      '/v1/forms/{id}/discard-draft',
      '/v1/forms/{id}/submissions',
      '/v1/forms/{id}/analytics',
      '/v1/forms/{id}/submissions.csv',
      '/v1/forms/{id}/destinations',
      '/v1/folders',
      'scoreMin',
      'answers',
      'KEY_NOT_ALLOWED',
    ]) {
      expect(endpoints, route).toContain(route);
    }
  });

  it('documents the error format and the spec codes', () => {
    const errors = files.get(`${SKILL_DIR}/reference/errors.md`)!;
    for (const code of [
      'issues',
      'BAD_REQUEST',
      'STEPS_REQUIRED',
      'INVALID_API_KEY',
      'KEY_NOT_ALLOWED',
      'WORKSPACE_FORBIDDEN',
      'STALE',
      'NOTHING_TO_REVERT',
      'RATE_LIMITED',
      'UNSUPPORTED_FIELD',
      'EMPTY_QUESTION',
    ]) {
      expect(errors, code).toContain(code);
    }
  });

  it('gives error paths with the body prefix, on both routes', () => {
    const skill = files.get(`${SKILL_DIR}/SKILL.md`)!;
    const errors = files.get(`${SKILL_DIR}/reference/errors.md`)!;
    for (const doc of [skill, errors]) {
      expect(doc).toContain('`config.steps.2.flowGroup`');
      expect(doc).toContain('`destinations.0.settings.timeoutMs`');
    }
  });

  it('says which editor defaults are accepted and which steps need no question', () => {
    const skill = files.get(`${SKILL_DIR}/SKILL.md`)!;
    for (const token of ['`flowGroup`', '`buttonText` `"Continue"`', '`reveal.enabled`', '`scheduler.prefill`']) {
      expect(skill, token).toContain(token);
    }
    expect(skill).toContain('`reveal`, `message` and `scheduler` steps');
    const errors = files.get(`${SKILL_DIR}/reference/errors.md`)!;
    expect(errors).toContain('`reveal`, `message` and `scheduler` steps');
  });

  it('says which step type asks for a name, and the quiz recipe shows one', () => {
    const skill = files.get(`${SKILL_DIR}/SKILL.md`)!;
    expect(skill).toContain('## Step types');
    expect(skill).toMatch(/\| `name` \| The person's name\. Always this type/);
    const quiz = EXAMPLE_CONFIGS.quiz!;
    expect(quiz.steps.some((s) => s.type === 'name')).toBe(true);
    expect(quiz.steps.some((s) => s.type === 'email')).toBe(true);
  });

  it('names the responses and analytics routes in SKILL.md itself', () => {
    const skill = files.get(`${SKILL_DIR}/SKILL.md`)!;
    expect(skill).toContain('`GET /v1/forms/{id}/submissions` (there is no `/responses` route)');
    expect(skill).toContain('`GET /v1/forms/{id}/analytics`');
  });

  it('says PUT /v1/forms/{id} ignores destinations', () => {
    expect(files.get(`${SKILL_DIR}/SKILL.md`)).toContain('`PUT /v1/forms/{id}` ignores `destinations`');
    expect(files.get(`${SKILL_DIR}/reference/endpoints.md`)).toContain('ignores `destinations`');
  });

  it('teaches discard-draft, not revert, to throw away a draft', () => {
    for (const path of ['SKILL.md', 'reference/endpoints.md', 'recipes/publish-and-revert.md']) {
      expect(files.get(`${SKILL_DIR}/${path}`)!, path).toContain('/v1/forms/{id}/discard-draft'.replace('{id}', path.startsWith('recipes') ? '$FORM_ID' : '{id}'));
    }
  });

  it('documents previousPublishedAt and a revert with no body that answers 200 with the form', () => {
    for (const path of ['SKILL.md', 'reference/endpoints.md', 'recipes/publish-and-revert.md']) {
      const doc = files.get(`${SKILL_DIR}/${path}`)!;
      expect(doc, path).toContain('previousPublishedAt');
      expect(doc, path).toMatch(/no body/i);
      expect(doc, path).toContain('200');
    }
  });

  it('ships a JSON Schema that parses', () => {
    const schema = JSON.parse(files.get(`${SKILL_DIR}/reference/form-config.schema.json`)!);
    expect(schema.properties.steps).toBeDefined();
  });

  it('prints the example configs verbatim in the recipes', () => {
    const quiz = files.get(`${SKILL_DIR}/recipes/quiz-with-scoring.md`)!;
    const block = /~~~json\n([\s\S]+?)\n~~~/.exec(quiz)![1]!;
    expect(JSON.parse(block).config).toEqual(EXAMPLE_CONFIGS.quiz);
  });

  it('documents @score, the order of the screens and the placeholders in SKILL.md', () => {
    const skill = files.get(`${SKILL_DIR}/SKILL.md`)!;
    expect(skill).toContain('## Order, logic and placeholders');
    expect(skill).toContain('`@score`');
    expect(skill).toMatch(
      /running score: the points of the steps shown before this one, without counting the step itself/,
    );
    expect(skill).toContain('after the last scored question');
    expect(skill).toMatch(/steps show in the order of `steps`.+skipped.+outcome comes last/);
    for (const token of [
      '`[firstname]`',
      '`[lastname]`',
      '`[name]`, the full name',
      '`{{respondentName}}`',
    ]) {
      expect(skill, token).toContain(token);
    }
    expect(skill).toContain('`recipes/gate-a-step-by-score.md`');
    // An embedded form's redirect never carries answers.
    expect(skill).toMatch(/embedded .+ a `redirectUrl` never carries answers: every query parameter with a placeholder is dropped/);
  });

  it('describes @score on the condition field of the JSON Schema', () => {
    const schema = JSON.parse(files.get(`${SKILL_DIR}/reference/form-config.schema.json`)!);
    const step = schema.properties.steps.items;
    for (const cond of ['showWhen', 'hideWhen']) {
      const variants = [step.properties[cond], ...(step.properties[cond].anyOf ?? [])];
      const field = variants.find((v: { properties?: { field?: unknown } }) => v.properties?.field)
        .properties.field;
      expect(field.description, cond).toContain('@score');
    }
  });

  it('prints the score gate verbatim, with the gate the ticket names', () => {
    const recipe = files.get(`${SKILL_DIR}/recipes/gate-a-step-by-score.md`)!;
    expect(recipe).toContain('{ "field": "@score", "op": "lt", "value": 14 }');
    const blocks = [...recipe.matchAll(/~~~json\n([\s\S]+?)\n~~~/g)].map((m) => m[1]!);
    expect(JSON.parse(blocks.at(-1)!).config).toEqual(SCORE_GATE_CONFIG);
  });

  it('the score gate behaves as the recipe says', () => {
    const low = {
      team_size: 'solo',
      timeline: 'later',
      firstname: 'Ana',
      lastname: 'Ruiz',
      email: 'ana@example.com',
    };
    const high = { ...low, team_size: 'large', timeline: 'now' };
    const keys = (answers: Record<string, string>) =>
      visibleSteps(SCORE_GATE_CONFIG, answers).map((s) => s.key);
    expect(keys(low)).toEqual(['team_size', 'timeline', 'name', 'email']);
    expect(keys(high)).toEqual(['team_size', 'timeline', 'name', 'email', 'demo']);
    // 6 + 4 = 10 stays below the gate; 10 + 4 = 14 opens it.
    expect(keys({ ...low, team_size: 'small', timeline: 'quarter' })).not.toContain('demo');
    expect(keys({ ...low, team_size: 'large', timeline: 'quarter' })).toContain('demo');
    expect(resolveOutcome(SCORE_GATE_CONFIG, computeScore(SCORE_GATE_CONFIG, low), low)?.id).toBe(
      'p3',
    );
    const p1 = resolveOutcome(SCORE_GATE_CONFIG, computeScore(SCORE_GATE_CONFIG, high), high)!;
    expect(p1.id).toBe('p1');
    expect(interpolate(p1.label, high)).toBe('See you soon, Ana Ruiz');
  });

  it('explains how to install it in Claude Code, Codex and Cursor', () => {
    const install = files.get(`${SKILL_DIR}/INSTALL.md`)!;
    expect(install).toContain('~/.claude/skills/dforms-api/SKILL.md');
    expect(install).toContain('AGENTS.md');
    expect(install).toContain('.cursor/rules/dforms-api.mdc');
  });

  it('carries no vendor host, no internal name and no dash in any file', () => {
    for (const [path, content] of files) {
      expect(content, path).not.toMatch(VENDOR);
      expect(content, path).not.toMatch(VENDOR_WORDS);
      expect(content, path).not.toMatch(DASHES);
    }
  });
});

describe('skill sources', () => {
  /** The skill and the docs section, as written in the repository. */
  const roots = [
    fileURLToPath(new URL('.', import.meta.url)),
    fileURLToPath(new URL('../../app/admin/developers', import.meta.url)),
    fileURLToPath(new URL('../../app/api/developers', import.meta.url)),
  ];
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? sources(full) : [full];
    });

  it('hardcode no vendor host: the URLs only arrive at request time', () => {
    for (const file of roots.flatMap(sources)) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(VENDOR);
    }
  });
});
