/**
 * The public first-name lookup for a referral code
 * (`GET /v1/public/referrals/:code`), end to end on in-memory SQLite. The
 * landing calls it to greet an invitee with "Ana invited you".
 *
 *   1. A known code answers `{ firstName }`: the first word of the referrer's
 *      name, and nothing else (no email, id or workspace).
 *   2. An unknown code, the program switched off, and a referrer with no
 *      usable name all answer the same 404, so the route cannot be used to
 *      tell them apart, and never hands out an email or a part of one.
 *   3. It sits behind the public rate limit like the rest of `/v1/public`.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpException, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { createDb, migrate, seed, sql, type Db } from '@quill/db';
import { PublicController } from './public.controller';
import { RateLimitGuard, TokenBucketRateLimiter } from './rate-limit';
import { ReferralService, type ReferralOptions } from './referral.service';

let db: Db;
let acme: string;

const ON: ReferralOptions = { enabled: true, baseUrl: 'https://landing.example.test' };
const OFF: ReferralOptions = { enabled: false, baseUrl: null };

async function addMember(
  accountId: string,
  email: string,
  opts: { externalId?: string; displayName?: string | null; accessGrant?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO member (id, account_id, email, display_name, role, status, external_id, access_grant, created_at)
        VALUES (${id}, ${accountId}, ${email}, ${opts.displayName ?? null}, ${'member'}, ${'active'},
                ${opts.externalId ?? null}, ${opts.accessGrant ?? null}, ${Date.now()})`,
  );
  return id;
}

/** The person's referral code, issued the way `/v1/me` issues it. */
async function codeFor(memberId: string): Promise<string> {
  const view = await new ReferralService(db, ON).forMember(acme, memberId);
  if (!view.enabled) throw new Error('program off');
  return new URL(view.link).searchParams.get('ref')!;
}

function controller(options: ReferralOptions = ON): PublicController {
  return new PublicController({} as never, {} as never, undefined, undefined, new ReferralService(db, options));
}

async function notFound(p: Promise<unknown>): Promise<unknown> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpException);
  expect((err as HttpException).getStatus()).toBe(404);
  return (err as HttpException).getResponse();
}

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db);
  acme = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code = 'acme' LIMIT 1`))!.id;
});

afterEach(async () => {
  await db.close();
});

describe('GET /v1/public/referrals/:code', () => {
  it('answers the first word of the referrer name for a known code', async () => {
    const ana = await addMember(acme, 'ana.perez@example.com', { externalId: 'user_ana', displayName: 'Ana María Pérez' });
    expect(await controller().referralName(await codeFor(ana))).toEqual({ firstName: 'Ana' });
  });

  it('matches the code whatever its case', async () => {
    const ana = await addMember(acme, 'ana@example.com', { externalId: 'user_ana', displayName: 'Ana Pérez' });
    expect(await controller().referralName((await codeFor(ana)).toUpperCase())).toEqual({ firstName: 'Ana' });
  });

  it('answers exactly { firstName }: no email, id or workspace', async () => {
    const ana = await addMember(acme, 'ana.perez@example.com', { externalId: 'user_ana', displayName: 'Ana Pérez' });
    const body = await controller().referralName(await codeFor(ana));
    expect(Object.keys(body)).toEqual(['firstName']);
    const raw = JSON.stringify(body);
    for (const secret of ['ana.perez', 'example.com', 'user_ana', ana, acme, 'acme']) expect(raw).not.toContain(secret);
  });

  it('takes the name the person was last seen with, across their workspaces', async () => {
    const globex = randomUUID();
    await db.run(sql`INSERT INTO account (id, code, name, created_at) VALUES (${globex}, 'globex', 'globex', ${Date.now()})`);
    const ana = await addMember(acme, 'ana@example.com', { externalId: 'user_ana', displayName: 'Ana Old' });
    await addMember(globex, 'ana@work.example.com', { externalId: 'user_ana', displayName: 'Anita Pérez' });
    await db.run(sql`UPDATE member SET last_seen_at = ${Date.now() + 60_000} WHERE display_name = 'Anita Pérez'`);
    expect(await controller().referralName(await codeFor(ana))).toEqual({ firstName: 'Anita' });
  });

  it('404s an unknown code, and a code that is not a code', async () => {
    await codeFor(await addMember(acme, 'ana@example.com', { externalId: 'user_ana', displayName: 'Ana Pérez' }));
    const miss = { error: 'NOT_FOUND', message: 'Referral not found.' };
    expect(await notFound(controller().referralName('zzzzzzzz'))).toEqual(miss);
    expect(await notFound(controller().referralName("x' OR 1=1 --"))).toEqual(miss);
  });

  it('404s a known code with the program switched off, and on an API without the program wired', async () => {
    const code = await codeFor(await addMember(acme, 'ana@example.com', { externalId: 'user_ana', displayName: 'Ana Pérez' }));
    expect(await notFound(controller(OFF).referralName(code))).toEqual({ error: 'NOT_FOUND', message: 'Referral not found.' });
    const unwired = new PublicController({} as never, {} as never);
    expect(await notFound(unwired.referralName(code))).toEqual({ error: 'NOT_FOUND', message: 'Referral not found.' });
  });

  it('404s a person with no name, and never shows an email or a part of one', async () => {
    const cases: Array<{ email: string; displayName: string | null }> = [
      { email: 'noname@example.com', displayName: null },
      { email: 'blank@example.com', displayName: '   ' },
      // The local development stub stores the email as the name.
      { email: 'dev.person@example.com', displayName: 'dev.person@example.com' },
      // An invited member starts with the email's local part as the name.
      { email: 'jdoe@example.com', displayName: 'jdoe' },
      { email: 'Mixed.Case@example.com', displayName: 'mixed.case' },
    ];
    for (const [i, c] of cases.entries()) {
      const m = await addMember(acme, c.email, { externalId: `user_${i}`, displayName: c.displayName });
      const body = await notFound(controller().referralName(await codeFor(m)));
      expect(JSON.stringify(body)).not.toContain(c.email.split('@')[0]!);
    }
  });

  it('skips a row whose name is an email for one of the person\'s rows with a real name', async () => {
    const globex = randomUUID();
    await db.run(sql`INSERT INTO account (id, code, name, created_at) VALUES (${globex}, 'globex', 'globex', ${Date.now()})`);
    const ana = await addMember(acme, 'ana@example.com', { externalId: 'user_ana', displayName: 'ana@example.com' });
    await addMember(globex, 'ana@work.example.com', { externalId: 'user_ana', displayName: 'Ana Pérez' });
    expect(await controller().referralName(await codeFor(ana))).toEqual({ firstName: 'Ana' });
  });

  it('is behind the public rate limit and answers 429 once the client runs out', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, PublicController) as unknown[];
    expect(guards).toContain(RateLimitGuard);

    const guard = new RateLimitGuard(new TokenBucketRateLimiter(2, 0), { TRUST_PROXY_HOPS: 0, PUBLIC_APP_URL: '' } as never);
    const headers: Record<string, string> = {};
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ url: '/v1/public/referrals/abc', headers: {}, socket: { remoteAddress: '203.0.113.9' } }),
        getResponse: () => ({ setHeader: (k: string, v: string) => (headers[k] = v) }),
      }),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);
    const err = (() => {
      try {
        guard.canActivate(ctx);
      } catch (e) {
        return e;
      }
    })();
    expect((err as HttpException).getStatus()).toBe(429);
    expect(headers['Retry-After']).toBeDefined();
  });
});
