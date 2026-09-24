/**
 * The challenge verifier behind spam protection, with the provider's verify
 * endpoint replaced by an injected fetch: no network in this file.
 *
 * What it pins:
 *   1. which provider answers are a pass, a refusal (the respondent's token is
 *      bad) or an outage (we could not tell), because the service turns the
 *      first into a 403 that writes nothing and the last into a saved partial;
 *   2. the one retry an outage gets, with the SAME idempotency key, inside a
 *      bounded time budget;
 *   3. that a token minted for another session, another action or another host
 *      is refused, and that the provider's public test keys are recognised;
 *   4. the deployment switch: both keys or none, and `none` as a kill switch;
 *   5. that the token never reaches a log line.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { loadServerEnv, type ServerEnv } from '@quill/config/env';
import { createDb, migrate, seed, type Db } from '@quill/db';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { AuthService } from './auth.service';
import { LocalAuthProvider } from './auth.provider';
import { PublicController } from './public.controller';
import {
  NoopCaptchaVerifier,
  TurnstileVerifier,
  captchaActive,
  captchaStrict,
  createCaptchaVerifier,
  idempotencyKeyFor,
  publicRemoteIp,
  type CaptchaVerifier,
} from './captcha';

const SESSION = '3f1b3d7e-2b9a-4c7e-9e3a-6f0d2a1c5b44';
const TOKEN = 'token-value-that-must-never-be-logged';

interface Call {
  url: string;
  body: Record<string, unknown>;
}

/** A fake verify endpoint: answers each call with the next scripted reply. */
function scriptedFetch(calls: Call[], replies: Array<() => Promise<Response> | Response>): typeof fetch {
  let i = 0;
  return (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    const reply = replies[Math.min(i, replies.length - 1)]!;
    i += 1;
    return reply();
  }) as unknown as typeof fetch;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** What the provider answers for a real, valid token minted on our page. */
const passed = (over: Record<string, unknown> = {}) =>
  json({
    success: true,
    'error-codes': [],
    hostname: 'forms.example.com',
    action: 'submit',
    cdata: SESSION,
    challenge_ts: '2026-09-24T00:00:00.000Z',
    ...over,
  });

function verifier(fetchImpl: typeof fetch, over: Partial<ConstructorParameters<typeof TurnstileVerifier>[0]> = {}) {
  return new TurnstileVerifier({
    siteKey: 'site-key',
    secretKey: 'secret-key',
    expectedHostname: 'forms.example.com',
    timeoutMs: 50,
    budgetMs: 200,
    retryDelayMs: 1,
    fetchImpl,
    ...over,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TurnstileVerifier: verdicts', () => {
  it('passes a valid token and sends the secret, the token, the idempotency key and a public IP', async () => {
    const calls: Call[] = [];
    const v = verifier(scriptedFetch(calls, [() => passed()]));
    const verdict = await v.verify({ token: TOKEN, sessionId: SESSION, remoteIp: '203.0.113.9' });
    expect(verdict).toEqual({ outcome: 'passed' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(calls[0]!.body).toEqual({
      secret: 'secret-key',
      response: TOKEN,
      idempotency_key: idempotencyKeyFor(SESSION, TOKEN),
      remoteip: '203.0.113.9',
    });
  });

  it('refuses a token the provider calls invalid, and does not retry it', async () => {
    const calls: Call[] = [];
    const v = verifier(
      scriptedFetch(calls, [() => json({ success: false, 'error-codes': ['invalid-input-response'] })]),
    );
    const verdict = await v.verify({ token: TOKEN, sessionId: SESSION });
    expect(verdict.outcome).toBe('failed');
    expect(calls).toHaveLength(1);
  });

  it('refuses a token already spent or expired (timeout-or-duplicate)', async () => {
    const v = verifier(
      scriptedFetch([], [() => json({ success: false, 'error-codes': ['timeout-or-duplicate'] })]),
    );
    expect((await v.verify({ token: TOKEN, sessionId: SESSION })).outcome).toBe('failed');
  });

  it('refuses a token minted for another action, another session or another host', async () => {
    const wrongAction = verifier(scriptedFetch([], [() => passed({ action: 'login' })]));
    const wrongSession = verifier(scriptedFetch([], [() => passed({ cdata: 'another-session' })]));
    const wrongHost = verifier(scriptedFetch([], [() => passed({ hostname: 'evil.example.net' })]));
    for (const v of [wrongAction, wrongSession, wrongHost]) {
      expect((await v.verify({ token: TOKEN, sessionId: SESSION })).outcome).toBe('failed');
    }
  });

  it('does not check the host when the deployment has no public URL to compare it with', async () => {
    const v = verifier(scriptedFetch([], [() => passed({ hostname: 'anything.example.org' })]), {
      expectedHostname: null,
    });
    expect(await v.verify({ token: TOKEN, sessionId: SESSION })).toEqual({ outcome: 'passed' });
  });

  it('accepts a result produced by the provider test keys, which echo no action or session', async () => {
    // What the public test secret really answers (checked against the live
    // endpoint on 24 Sep 2026): no `action`, no `cdata`, `example.com`.
    const v = verifier(
      scriptedFetch([], [
        () =>
          json({
            success: true,
            'error-codes': [],
            hostname: 'example.com',
            metadata: { result_with_testing_key: true },
          }),
      ]),
    );
    expect(await v.verify({ token: 'XXXX.DUMMY.TOKEN.XXXX', sessionId: SESSION })).toEqual({
      outcome: 'passed',
    });
  });
});

describe('TurnstileVerifier: outages', () => {
  it('retries an internal error ONCE with the same idempotency key, and passes when the retry does', async () => {
    const calls: Call[] = [];
    const v = verifier(
      scriptedFetch(calls, [() => json({ success: false, 'error-codes': ['internal-error'] }), () => passed()]),
    );
    expect(await v.verify({ token: TOKEN, sessionId: SESSION })).toEqual({ outcome: 'passed' });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body.idempotency_key).toBe(calls[0]!.body.idempotency_key);
  });

  it('reports unavailable when both attempts hit an internal error', async () => {
    const calls: Call[] = [];
    const v = verifier(scriptedFetch(calls, [() => json({ success: false, 'error-codes': ['internal-error'] })]));
    expect((await v.verify({ token: TOKEN, sessionId: SESSION })).outcome).toBe('unavailable');
    expect(calls).toHaveLength(2);
  });

  it('reports unavailable on a 5xx and on a network error', async () => {
    const down = verifier(scriptedFetch([], [() => new Response('bad gateway', { status: 502 })]));
    expect((await down.verify({ token: TOKEN, sessionId: SESSION })).outcome).toBe('unavailable');
    const offline = verifier(
      scriptedFetch([], [
        () => {
          throw new TypeError('fetch failed');
        },
      ]),
    );
    expect((await offline.verify({ token: TOKEN, sessionId: SESSION })).outcome).toBe('unavailable');
  });

  it('gives up on a hung endpoint inside its time budget', async () => {
    const calls: Call[] = [];
    const hung = verifier(scriptedFetch(calls, [() => new Promise<Response>(() => {})]), {
      timeoutMs: 30,
      budgetMs: 80,
    });
    const started = Date.now();
    const verdict = await hung.verify({ token: TOKEN, sessionId: SESSION });
    expect(verdict.outcome).toBe('unavailable');
    expect(Date.now() - started).toBeLessThan(500);
    // One retry at most, never a loop.
    expect(calls.length).toBeLessThanOrEqual(2);
  });

  it('treats a secret the provider rejects as an outage of ours, never as the respondent’s fault', async () => {
    const v = verifier(
      scriptedFetch([], [() => json({ success: false, 'error-codes': ['invalid-input-secret'] })]),
    );
    expect((await v.verify({ token: TOKEN, sessionId: SESSION })).outcome).toBe('unavailable');
  });
});

describe('TurnstileVerifier: the token stays out of the logs', () => {
  it('never writes the token to any log level, whatever the verdict', async () => {
    const lines: string[] = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      });
    }
    const replies = [
      () => passed(),
      () => json({ success: false, 'error-codes': ['invalid-input-response'] }),
      () => json({ success: false, 'error-codes': ['internal-error'] }),
      () => json({ success: false, 'error-codes': ['invalid-input-secret'] }),
      () => new Response('down', { status: 503 }),
    ];
    for (const reply of replies) {
      await verifier(scriptedFetch([], [reply])).verify({ token: TOKEN, sessionId: SESSION });
    }
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes(TOKEN))).toBe(false);
  });
});

describe('idempotencyKeyFor', () => {
  it('is a stable UUID per session and token, and differs when either changes', () => {
    const key = idempotencyKeyFor(SESSION, TOKEN);
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(idempotencyKeyFor(SESSION, TOKEN)).toBe(key);
    expect(idempotencyKeyFor('other-session', TOKEN)).not.toBe(key);
    expect(idempotencyKeyFor(SESSION, 'other-token')).not.toBe(key);
  });
});

describe('publicRemoteIp', () => {
  it('keeps a public address and drops the ones that cannot be the visitor', () => {
    expect(publicRemoteIp('203.0.113.9')).toBe('203.0.113.9');
    expect(publicRemoteIp('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(publicRemoteIp('2001:db8::1')).toBe('2001:db8::1');
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.1.4', 'fd00::1', 'fe80::1', 'unknown', '', null, undefined]) {
      expect(publicRemoteIp(ip)).toBeUndefined();
    }
  });
});

describe('captchaActive / captchaStrict', () => {
  const on = new TurnstileVerifier({ siteKey: 's', secretKey: 'k' });
  const off = new NoopCaptchaVerifier();

  it('is active only when the deployment has keys AND the form turned it on', () => {
    expect(captchaActive({ spamProtection: { captcha: true } }, on)).toBe(true);
    expect(captchaActive({ spamProtection: { captcha: true } }, off)).toBe(false);
    expect(captchaActive({ spamProtection: { captcha: true } }, undefined)).toBe(false);
    expect(captchaActive({ spamProtection: { captcha: false } }, on)).toBe(false);
    expect(captchaActive({ spamProtection: null }, on)).toBe(false);
    expect(captchaActive({ version: 1, steps: [] }, on)).toBe(false);
    expect(captchaActive(null, on)).toBe(false);
  });

  it('strict needs the switch on as well: strict alone is ignored', () => {
    expect(captchaStrict({ spamProtection: { captcha: true, strict: true } }, on)).toBe(true);
    expect(captchaStrict({ spamProtection: { strict: true } }, on)).toBe(false);
    expect(captchaStrict({ spamProtection: { captcha: true } }, on)).toBe(false);
    expect(captchaStrict({ spamProtection: { captcha: true, strict: true } }, off)).toBe(false);
  });
});

describe('the deployment switch (env)', () => {
  const env = (vars: Record<string, string>): ServerEnv =>
    loadServerEnv({ NODE_ENV: 'test', ...vars } as unknown as NodeJS.ProcessEnv);

  it('with nothing set the check does not exist, and the app boots', () => {
    const v = createCaptchaVerifier(env({}));
    expect(v.enabled).toBe(false);
    expect(v.siteKey).toBeNull();
  });

  it('both keys turn it on with the provider named by default', () => {
    const v = createCaptchaVerifier(env({ CAPTCHA_SITE_KEY: 'site', CAPTCHA_SECRET_KEY: 'secret' }));
    expect(v.enabled).toBe(true);
    expect(v.provider).toBe('turnstile');
    expect(v.siteKey).toBe('site');
  });

  it('`none` is a kill switch that keeps the keys loaded', () => {
    const v = createCaptchaVerifier(
      env({ CAPTCHA_PROVIDER: 'none', CAPTCHA_SITE_KEY: 'site', CAPTCHA_SECRET_KEY: 'secret' }),
    );
    expect(v.enabled).toBe(false);
  });

  it('refuses to boot with only one of the two keys', () => {
    expect(() => env({ CAPTCHA_SITE_KEY: 'site' })).toThrow(/CAPTCHA_SECRET_KEY/);
    expect(() => env({ CAPTCHA_SECRET_KEY: 'secret' })).toThrow(/CAPTCHA_SITE_KEY/);
  });

  it('refuses to boot when the provider is named without its keys', () => {
    expect(() => env({ CAPTCHA_PROVIDER: 'turnstile' })).toThrow(/CAPTCHA_SITE_KEY/);
  });

  it('treats an empty value as unset, the way a blank line in .env reads', () => {
    expect(createCaptchaVerifier(env({ CAPTCHA_SITE_KEY: '', CAPTCHA_SECRET_KEY: '' })).enabled).toBe(false);
  });

  it('compares the token host with the deployment public URL', async () => {
    const calls: Call[] = [];
    const v = createCaptchaVerifier(
      env({
        CAPTCHA_SITE_KEY: 'site',
        CAPTCHA_SECRET_KEY: 'secret',
        PUBLIC_APP_URL: 'https://forms.example.com',
      }),
      { fetchImpl: scriptedFetch(calls, [() => passed({ hostname: 'forms.example.com' }), () => passed({ hostname: 'evil.example.net' })]) },
    );
    expect(await v.verify({ token: TOKEN, sessionId: SESSION })).toEqual({ outcome: 'passed' });
    expect((await v.verify({ token: TOKEN, sessionId: SESSION })).outcome).toBe('failed');
  });
});

describe('GET /v1/me reports whether this deployment can run the check', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
  });
  afterEach(async () => {
    await db.close();
  });

  function meController(captcha: CaptchaVerifier | undefined) {
    const provider = new LocalAuthProvider(db, {
      NODE_ENV: 'test',
      DEV_LOGIN_EMAIL: undefined,
      AUTH_LOCAL_STRICT: undefined,
      SEED_DEMO_FORM: false,
      ONBOARDING_WIZARD: false,
    });
    return new AdminCrudController(
      db,
      new AuthService(db, provider),
      new AdminService(db),
      {} as never,
      {} as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      captcha,
    );
  }

  it('available with keys, unavailable without them (the editor disables the switch)', async () => {
    const withKeys = await meController(new TurnstileVerifier({ siteKey: 's', secretKey: 'k' })).me({ headers: {} });
    expect(withKeys?.captcha).toEqual({ available: true });
    const noKeys = await meController(new NoopCaptchaVerifier()).me({ headers: {} });
    expect(noKeys?.captcha).toEqual({ available: false });
    const unwired = await meController(undefined).me({ headers: {} });
    expect(unwired?.captcha).toEqual({ available: false });
  });
});

describe('the public controller hands the service the address the rate limiter trusts', () => {
  it('takes the entry the trusted proxy appended, never a spoofed one on the left', async () => {
    const seen: unknown[] = [];
    const svc = {
      submit: async (...args: unknown[]) => {
        seen.push(args[3]);
        return { id: 'x', score: 0, outcome: null };
      },
    };
    const env = { PUBLIC_APP_URL: 'https://forms.example.com' } as unknown as ServerEnv;
    const controller = new PublicController(svc as never, {} as never, env);
    await controller.submit('acme', 'form', { sessionId: 's', data: {} }, {
      headers: { 'x-forwarded-for': '198.51.100.66, 203.0.113.9' },
      ip: '10.0.0.2',
    });
    expect(seen).toEqual([{ remoteIp: '203.0.113.9' }]);
  });

  it('with no proxy configured, trusts the socket peer only', async () => {
    const seen: unknown[] = [];
    const svc = {
      submit: async (...args: unknown[]) => {
        seen.push(args[3]);
        return { id: 'x', score: 0, outcome: null };
      },
    };
    const controller = new PublicController(svc as never, {} as never, { PUBLIC_APP_URL: '' } as never);
    await controller.submit('acme', 'form', { sessionId: 's', data: {} }, {
      headers: { 'x-forwarded-for': '198.51.100.66' },
      ip: '203.0.113.20',
    });
    expect(seen).toEqual([{ remoteIp: '203.0.113.20' }]);
  });
});
