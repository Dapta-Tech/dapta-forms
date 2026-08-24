/**
 * PUT /v1/me/locale through the REAL admin controller on in-memory SQLite
 * (same harness as form-slug.controller.spec.ts).
 *
 * The storage itself is covered in `packages/db/src/member-locale.spec.ts`.
 * What this pins is the part of the contract that is a POLICY rather than a
 * write: this is the rare host endpoint that is deliberately NOT admin-gated,
 * and it is scoped to the caller's own membership so that not being gated is
 * safe. Those two facts hold each other up, so they are asserted together.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb, migrate, seed, getMemberLocale, sql, type Db } from '@quill/db';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { AuthService } from './auth.service';
import { LocalAuthProvider } from './auth.provider';
import type { ReqLike } from './auth.provider';

let db: Db;
let controller: AdminCrudController;
let accountId: string;
let ownerId: string;

/** No identity → the local provider resolves the seeded demo owner. */
const asOwner = (): ReqLike => ({ headers: {} });

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db);
  const provider = new LocalAuthProvider(db, {
    NODE_ENV: 'test',
    DEV_LOGIN_EMAIL: undefined,
    AUTH_LOCAL_STRICT: undefined,
    SEED_DEMO_FORM: false,
    ONBOARDING_WIZARD: false,
  });
  const auth = new AuthService(db, provider);
  const admin = new AdminService(db);
  controller = new AdminCrudController(db, auth, admin, {} as never, {} as never);

  const me = await controller.me(asOwner());
  accountId = me!.accountId;
  ownerId = me!.memberId;
});

afterEach(async () => {
  await db.close();
});

describe('PUT /v1/me/locale', () => {
  it('stores the choice against the caller and reports it back', async () => {
    expect(await controller.setMyLocale(asOwner(), { locale: 'es' })).toEqual({ ok: true, locale: 'es' });

    expect(await getMemberLocale(db, accountId, ownerId)).toBe('es');
  });

  it('shows up on /v1/me, which is what seeds a fresh browser at login', async () => {
    expect((await controller.me(asOwner()))!.locale).toBeNull();

    await controller.setMyLocale(asOwner(), { locale: 'es' });
    expect((await controller.me(asOwner()))!.locale).toBe('es');
  });

  it('rejects a locale the product does not ship', async () => {
    // 400, not a silent coercion to English: a client asking for French has a
    // bug, and answering "fine, English" hides it.
    await expect(controller.setMyLocale(asOwner(), { locale: 'fr' })).rejects.toBeTruthy();
    expect(await getMemberLocale(db, accountId, ownerId)).toBeNull();
  });

  it('rejects an empty body without touching the stored value', async () => {
    await controller.setMyLocale(asOwner(), { locale: 'es' });

    await expect(controller.setMyLocale(asOwner(), {})).rejects.toBeTruthy();
    expect(await getMemberLocale(db, accountId, ownerId)).toBe('es');
  });

  it('writes only the caller row, never a teammate in the same account', async () => {
    // The endpoint takes no member id at all, which is the guarantee: there is
    // no parameter through which one person could set another person's language.
    const mate = 'mate-member-id';
    await db.run(
      sql`INSERT INTO member (id, account_id, display_name, email, role, status, created_at)
          VALUES (${mate}, ${accountId}, ${'Mate'}, ${'mate@example.test'}, ${'member'}, ${'active'}, ${Date.now()})`,
    );

    await controller.setMyLocale(asOwner(), { locale: 'es' });

    expect(await getMemberLocale(db, accountId, ownerId)).toBe('es');
    expect(await getMemberLocale(db, accountId, mate)).toBeNull();
  });
});
