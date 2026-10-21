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

  it('caps the length with an ellipsis', () => {
    const out = untrusted('x'.repeat(1000), 50);
    expect(out).toHaveLength(50);
    expect(out.endsWith('\u2026')).toBe(true);
  });

  it('stays fast on input built to make a backtracking pattern slow', () => {
    const started = Date.now();
    for (const hostile of ['['.repeat(100_000), '<'.repeat(100_000), '[a]('.repeat(30_000), '!['.repeat(50_000)]) {
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
    expect(toFailure(new BackendError(503, 'UNAVAILABLE', 'Storage down, host db-7')).render()).not.toContain('db-7');
    expect(toFailure(new Error('boom')).code).toBe('INTERNAL_ERROR');
    const own = new ToolFailure('X', 'y');
    expect(toFailure(own)).toBe(own);
  });
});
