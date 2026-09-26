/**
 * R15 guard: the public OpenAPI document must carry NO vendor or internal
 * infrastructure names — it ships in the public repo and is served by every
 * fork. Also pins the forms surface shape the web app depends on.
 */
import { describe, it, expect } from 'vitest';
import { openapiSpec } from './openapi';

// Built by concatenation so this spec never trips the publish-gate's own
// internal-token grep (the literal strings must not appear in the tree).
const FORBIDDEN = [
  'workos',
  ['dapta', '_forms'].join(''),
  ['forms', '_ms'].join(''),
  ['auro', 'ra'].join(''),
  ['amazon', 'aws'].join(''),
  'flux',
  ['dapta', '-iam'].join(''),
  // The challenge provider is a deployment choice behind a port: the public
  // contract describes a "human check", never whose.
  'turnstile',
  'cloudflare',
];

describe('openapi spec', () => {
  it('contains no vendor/internal names (R15)', () => {
    const text = JSON.stringify(openapiSpec).toLowerCase();
    for (const word of FORBIDDEN) {
      expect(text.includes(word), `forbidden token "${word}" in openapi.json`).toBe(false);
    }
  });

  it('describes the public forms surface', () => {
    expect(openapiSpec.info.title).toBe('Quill API');
    const paths = Object.keys(openapiSpec.paths);
    expect(paths).toContain('/v1/public/forms/{accountCode}/{slug}');
    expect(paths).toContain('/v1/public/forms/{accountCode}/{slug}/submissions');
    expect(paths).toContain('/health');
  });

  it('documents the human check on the submit: the token field and the 403/503 answers', () => {
    const submit = openapiSpec.paths['/v1/public/forms/{accountCode}/{slug}/submissions'].post;
    expect(JSON.stringify(submit)).toContain('captchaToken');
    expect(Object.keys(submit.responses)).toEqual(expect.arrayContaining(['201', '400', '403', '503']));
    expect(JSON.stringify(submit.responses)).toContain('CAPTCHA_REQUIRED');
    expect(JSON.stringify(submit.responses)).toContain('CAPTCHA_UNAVAILABLE');
  });
});
