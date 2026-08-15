/**
 * The public member page (`GET /v1/public/profiles/:accountCode/:handle`).
 *
 * The route shape existed from the first public form URL but nothing was ever
 * built at the handle level, so it was a real 404. These lock the rules that
 * decide whether it stays one:
 *
 *   1. **nothing is published by default.** No profile, and `enabled: false`,
 *      both stay 404 — a member must deliberately turn their page on. A schema
 *      migration must never publish a page about a person as a side-effect.
 *   2. `formSlugs` absent = list every published form; `formSlugs: []` = list
 *      none. The two must stay distinct, or unlisting everything would silently
 *      restore everything.
 *   3. only name and slug cross the boundary — never a form's steps, its
 *      destination config, or a draft.
 *   4. a handle is matched case-insensitively (URLs get typed by hand).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createDb,
  migrate,
  seed,
  getAccountByCode,
  overwriteMemberProfileLegacy,
  sql,
  type Db,
} from '@quill/db';
import { SubmissionService } from './submission.service';
import { EmailEffects } from './email-effects';
import { SubmissionNotifier, LogOnlyEmailProvider } from '@quill/notifications';

describe('public member profile', () => {
  let db: Db;
  let svc: SubmissionService;
  let accountCode: string;
  let accountId: string;
  let memberId: string;
  let handle: string;

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    const account = (await getAccountByCode(db, 'acme'))!;
    accountCode = account.code;
    accountId = account.id;
    const m = await db.get<{ id: string; handle: string }>(
      sql`SELECT id, handle FROM member WHERE account_id = ${accountId} AND handle IS NOT NULL LIMIT 1`,
    );
    memberId = String(m!.id);
    handle = String(m!.handle);
    const provider = new LogOnlyEmailProvider();
    svc = new SubmissionService(db, new EmailEffects(new SubmissionNotifier(provider), db, provider));
  });

  afterEach(async () => {
    await db.close();
  });

  const enable = (extra: Record<string, unknown> = {}) =>
    overwriteMemberProfileLegacy(db, accountId, memberId, { version: 1, enabled: true, ...extra });

  it('is 404 for a member who never set one up', async () => {
    expect(await svc.publicProfile(accountCode, handle)).toBeNull();
  });

  it('is 404 while the page is disabled', async () => {
    await overwriteMemberProfileLegacy(db, accountId, memberId, { version: 1, enabled: false, bio: 'hi' });
    expect(await svc.publicProfile(accountCode, handle)).toBeNull();
  });

  it('is 404 for a handle nobody has', async () => {
    await enable();
    expect(await svc.publicProfile(accountCode, 'nobody-by-this-name')).toBeNull();
  });

  it('serves the page once it is enabled', async () => {
    await enable({ headline: 'I qualify leads', bio: 'Some bio' });
    const p = await svc.publicProfile(accountCode, handle);
    expect(p).not.toBeNull();
    expect(p!.headline).toBe('I qualify leads');
    expect(p!.bio).toBe('Some bio');
  });

  it('matches the handle case-insensitively', async () => {
    await enable();
    expect(await svc.publicProfile(accountCode, handle.toUpperCase())).not.toBeNull();
  });

  it('lists every published form when formSlugs is absent', async () => {
    await enable();
    const p = await svc.publicProfile(accountCode, handle);
    expect(p!.forms.length).toBeGreaterThan(0);
  });

  it('lists NONE for an empty formSlugs — not everything', async () => {
    await enable({ formSlugs: [] });
    const p = await svc.publicProfile(accountCode, handle);
    expect(p!.forms).toEqual([]);
  });

  it('lists only the named slugs', async () => {
    const all = (await svc.publicProfile(accountCode, handle).then(async () => {
      await enable();
      return svc.publicProfile(accountCode, handle);
    }))!.forms;
    await enable({ formSlugs: [all[0]!.slug] });
    const p = await svc.publicProfile(accountCode, handle);
    expect(p!.forms).toHaveLength(1);
    expect(p!.forms[0]!.slug).toBe(all[0]!.slug);
  });

  it('exposes only name and slug — never steps, destinations or drafts', async () => {
    await enable();
    const p = await svc.publicProfile(accountCode, handle);
    for (const f of p!.forms) {
      expect(Object.keys(f).sort()).toEqual(['name', 'slug']);
    }
    const serialized = JSON.stringify(p);
    expect(serialized).not.toContain('destinations');
    expect(serialized).not.toContain('draftConfig');
    expect(serialized).not.toContain('steps');
  });
});
