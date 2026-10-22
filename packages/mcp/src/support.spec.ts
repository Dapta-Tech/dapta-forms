import { describe, expect, it } from 'vitest';
import { BackendError } from './backend';
import { ToolFailure, argsHash, redactArgs, renderIssues, toFailure, untrusted } from './support';

describe('untrusted', () => {
  it('removes control and invisible characters, tags, images and link targets', () => {
    expect(untrusted('a\u0000b\u202Ec\u200Bd')).toBe('a bcd');
    expect(untrusted('<img src=x onerror=alert(1)>Hi <b>there</b>')).toBe('Hi there');
    expect(untrusted('see ![logo](https://evil.test/p.png?d=secret) and [docs](https://evil.test)')).toBe('see and docs');
    expect(untrusted('[not a link] [also](')).toBe('[not a link] [also](');
    expect(untrusted('3 < 5 and 7 > 2')).toBe('3 2');
    expect(untrusted('unclosed < tag')).toBe('unclosed < tag');
    expect(untrusted({ nested: 'x' })).toBe('{"nested":"x"}');
    expect(untrusted(null)).toBe('');
  });

  it('leaves no image or link behind when they are nested, and cleaning twice changes nothing', () => {
    const markdownLink = /!?\[[^\]]*\]\(/;
    for (const hostile of [
      '[![x](a)](https://evil.example/p.png?d=SECRET)',
      '[![](x)](https://evil/q)',
      'before [![x](a)](https://evil.example/p.png?d=SECRET) after',
      '[[[a](b)](c)](https://evil/deep)',
      '<[a](x)b>[![](y)](https://evil/r)',
    ]) {
      const once = untrusted(hostile);
      expect(once, hostile).not.toMatch(markdownLink);
      expect(once, hostile).not.toContain('evil');
      expect(untrusted(once), hostile).toBe(once);
    }
    expect(untrusted('before [![x](a)](https://evil.example/p.png?d=SECRET) after')).toBe('before after');
  });

  it('caps the length with an ellipsis', () => {
    const out = untrusted('x'.repeat(1000), 50);
    expect(out).toHaveLength(50);
    expect(out.endsWith('\u2026')).toBe(true);
  });

  it('stays fast on input built to make a backtracking pattern slow', () => {
    const started = Date.now();
    for (const hostile of ['['.repeat(100_000), '<'.repeat(100_000), '[a]('.repeat(30_000), '!['.repeat(50_000), `${'[!['.repeat(30_000)}x${'](a)](b)'.repeat(30_000)}`]) {
      untrusted(hostile, 500);
    }
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('audit redaction', () => {
  it('replaces every content-bearing argument, keeps ids, and hashes the same shape the same way', () => {
    const args = { form_id: 'f1', name: 'Launch', config: { steps: [{ question: 'Secret?' }] }, from: '2026-10-01', limit: 5 };
    expect(redactArgs(args)).toEqual({ config: '[redacted]', form_id: 'f1', from: '[redacted]', limit: 5, name: '[redacted]' });
    expect(argsHash(args)).toBe(argsHash({ ...args, name: 'Other', config: {} }));
    expect(argsHash(args)).not.toBe(argsHash({ ...args, form_id: 'f2' }));
    expect(argsHash(undefined)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('toFailure', () => {
  it('turns a validation refusal into one actionable line per issue', () => {
    const f = toFailure(
      new BackendError(400, 'STEPS_REQUIRED', 'Send the full steps array.', [
        { path: 'config.steps', message: 'Send the full steps array.', code: 'STEPS_REQUIRED' },
        { path: '', message: 'Expected object, received string', code: 'invalid_type' },
      ]),
    );
    expect(f.code).toBe('VALIDATION_FAILED');
    expect(f.message).toContain('2 problems');
    expect(f.message).toContain('- config.steps [STEPS_REQUIRED]');
    expect(f.message).toContain('- (arguments) [invalid_type]');
  });

  it('sends the model to get_form_guide only for a form config', () => {
    const refusal = () =>
      new BackendError(400, 'VALIDATION_FAILED', 'Invalid.', [
        { path: 'radius', message: 'Invalid enum value.', code: 'invalid_enum_value' },
        { path: 'shade', message: 'Unrecognized key.', code: 'unrecognized_keys' },
      ]);
    for (const tool of ['update_brand_kit', 'update_form_notification', 'set_destinations', undefined]) {
      expect(toFailure(refusal(), 'key', tool).render(), String(tool)).not.toContain('get_form_guide');
    }
    for (const tool of ['create_form', 'update_form']) {
      const text = toFailure(refusal(), 'key', tool).render();
      expect(text).toMatch(/get_form_guide\.$/);
      expect(text).toContain('config_schema of get_form_guide');
    }
  });

  it('lists at most 25 issues and says how many were left out', () => {
    const issues = Array.from({ length: 30 }, (_, i) => ({ path: `config.steps.${i}.question`, message: 'Required', code: 'invalid_type' }));
    const text = renderIssues(issues);
    expect(text.split('\n')).toHaveLength(26);
    expect(text).toContain('...and 5 more.');
  });

  it('maps statuses to stable codes the model can act on', () => {
    expect(toFailure(new BackendError(404, 'NOT_FOUND', 'Not found.')).code).toBe('NOT_FOUND');
    const limited = toFailure(new BackendError(429, 'RATE_LIMITED', 'Slow down.', [], { retryAfterSec: 7 }));
    expect(limited.render()).toContain('Retry after 7s.');
    expect(toFailure(new BackendError(401, 'INVALID_API_KEY', 'This API key is not valid.')).render()).toContain('new key');
    expect(toFailure(new BackendError(409, 'SLUG_TAKEN', 'Taken.')).render()).toContain('another slug');
    const gone = toFailure(new BackendError(401, 'MEMBER_NOT_ACTIVE', 'You are no longer an active member of this workspace.')).render();
    expect(gone).toMatch(/^MEMBER_NOT_ACTIVE: You are no longer an active member of this workspace\. /);
    expect(gone).toContain('list_my_workspaces');
    expect(toFailure(new BackendError(503, 'UNAVAILABLE', 'Storage down, host db-7')).render()).not.toContain('db-7');
    expect(toFailure(new Error('boom')).code).toBe('INTERNAL_ERROR');
    const own = new ToolFailure('X', 'y');
    expect(toFailure(own)).toBe(own);
  });
});

describe('toFailure, by credential', () => {
  it('speaks of the key to an API key and of the member to a signed-in person', () => {
    // What the model is told, past the stable code.
    const said = (f: ToolFailure) => `${f.message} ${f.hint ?? ''}`;
    const key = 'key' as const;
    const person = 'connection' as const;
    const forbidden = new BackendError(403, 'FORBIDDEN', 'You need the admin role.');
    expect(toFailure(forbidden, key).render()).toMatch(/key's owner/);
    const forbiddenPerson = said(toFailure(forbidden, person));
    expect(forbiddenPerson).not.toMatch(/key/i);
    expect(forbiddenPerson).toMatch(/owner or admin/);

    const dead = new BackendError(401, 'INVALID_API_KEY', 'This API key is not valid.');
    expect(toFailure(dead, key).render()).toContain('new key');
    const deadPerson = said(toFailure(dead, person));
    expect(deadPerson).not.toMatch(/key/i);
    expect(deadPerson).toMatch(/connect/i);

    const limited = new BackendError(429, 'RATE_LIMITED', 'Slow down.', [], { retryAfterSec: 3 });
    expect(toFailure(limited, key).render()).toMatch(/API key/);
    expect(said(toFailure(limited, person))).not.toMatch(/key/i);
  });
});
