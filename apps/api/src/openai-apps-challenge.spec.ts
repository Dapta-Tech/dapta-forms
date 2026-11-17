/**
 * OpenAI's domain check for a ChatGPT app, over HTTP: the whole API on SQLite,
 * fetched the way OpenAI fetches it.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { bootHarness, type Harness } from './mcp-harness';

const open: Harness[] = [];
afterAll(async () => {
  await Promise.all(open.map((h) => h.close()));
});

async function boot(env: Parameters<typeof bootHarness>[0] = {}) {
  const h = await bootHarness(env);
  open.push(h);
  return h;
}

const PATH = '/.well-known/openai-apps-challenge';

describe('GET /.well-known/openai-apps-challenge', () => {
  it('answers the configured token alone, as plain text that is never cached', async () => {
    const h = await boot({ OPENAI_APPS_CHALLENGE_TOKEN: '  spec-challenge-token\n' });
    const res = await fetch(`${h.base}${PATH}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe('spec-challenge-token');
  });

  it('is not found when no token is configured, the default for every fork', async () => {
    const h = await boot();
    expect((await fetch(`${h.base}${PATH}`)).status).toBe(404);
  });

  it('is not found for a blank token', async () => {
    const h = await boot({ OPENAI_APPS_CHALLENGE_TOKEN: '   ' });
    expect((await fetch(`${h.base}${PATH}`)).status).toBe(404);
  });

  it('needs no credential', async () => {
    const h = await boot({ OPENAI_APPS_CHALLENGE_TOKEN: 'spec-challenge-token' });
    const res = await fetch(`${h.base}${PATH}`, { headers: { authorization: 'Bearer not-a-real-token' } });
    expect(res.status).toBe(200);
  });
});
