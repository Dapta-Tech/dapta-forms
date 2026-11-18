/**
 * In-app announcements through the REAL controller on in-memory SQLite, with
 * the local auth provider resolving real member rows (same harness as
 * member-locale.controller.spec.ts). The clock and the list are the only
 * things swapped, so the dates can be walked through.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { createDb, migrate, seed, sql, type Db } from '@quill/db';
import { ANNOUNCEMENTS, type Announcement } from '@quill/shared';
import { AnnouncementsController, isDaptaDeployment, type AnnouncementsOptions } from './announcements.controller';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';

const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse('2026-11-19T00:00:00-05:00');
const END = Date.parse('2026-12-20T00:00:00-05:00');
const MID = START + 3 * DAY;

const announcement = (over: Partial<Announcement> = {}): Announcement => ({
  id: 'integrations-2026-11',
  startsAt: START,
  endsAt: END,
  copy: 'integrations-2026-11',
  cta: '/admin/integrations',
  visual: { kind: 'video', src: '/announcements/announce-integrations', width: 1280, height: 720 },
  railBadge: 'integrations',
  banner: { logos: ['gohighlevel', 'salesforce', 'google-sheets', 'hubspot', 'calendly', 'dcal'] },
  daptaOnly: true,
  ...over,
});

let db: Db;
let auth: AuthService;
let clock: number;
let accountId: string;

/** No identity: the local provider resolves the seeded demo owner. */
const asOwner = (): ReqLike => ({ headers: {} });
const asEmail = (email: string): ReqLike => ({ headers: { 'x-quill-email': email } });
const asMember = (account: string, member: string): ReqLike => ({
  headers: { 'x-quill-account': account, 'x-quill-member': member },
});

function controller(opts: Partial<AnnouncementsOptions> = {}): AnnouncementsController {
  return new AnnouncementsController(db, auth, {
    dapta: true,
    now: () => clock,
    list: [announcement()],
    ...opts,
  });
}

async function addMember(account: string, email: string, externalId: string | null = null): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO member (id, account_id, external_id, display_name, email, role, status, created_at)
        VALUES (${id}, ${account}, ${externalId}, ${'Mate'}, ${email}, ${'member'}, ${'active'}, ${Date.now()})`,
  );
  return id;
}

async function addAccount(): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at) VALUES (${id}, ${`a${id.slice(0, 7)}`}, ${'Other'}, ${Date.now()})`,
  );
  return id;
}

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
  auth = new AuthService(db, provider);
  clock = MID;
  accountId = (await auth.resolveHost(asOwner())).accountId;
});

afterEach(async () => {
  await db.close();
});

const ID = 'integrations-2026-11';
const current = async (c: AnnouncementsController, req: ReqLike = asOwner()) => (await c.current(req)).announcement;

describe('GET /v1/me/announcement', () => {
  it('gives the live announcement with its pop-up, its rail badge and its Home banner', async () => {
    expect(await current(controller())).toEqual({
      id: ID,
      copy: 'integrations-2026-11',
      cta: '/admin/integrations',
      visual: { kind: 'video', src: '/announcements/announce-integrations', width: 1280, height: 720 },
      railBadge: 'integrations',
      banner: { logos: ['gohighlevel', 'salesforce', 'google-sheets', 'hubspot', 'calendly', 'dcal'] },
      modal: true,
      badge: true,
      showBanner: true,
      followed: false,
    });
  });

  it('gives nothing before the start or from the end date on', async () => {
    clock = START - 1;
    expect(await current(controller())).toBeNull();
    clock = START;
    expect(await current(controller())).not.toBeNull();
    clock = END - 1;
    expect(await current(controller())).not.toBeNull();
    clock = END;
    expect(await current(controller())).toBeNull();
  });

  it('hides a Dapta-only announcement on a fork', async () => {
    expect(await current(controller({ dapta: false }))).toBeNull();
    const plain = controller({ dapta: false, list: [announcement({ daptaOnly: false })] });
    expect((await current(plain))?.id).toBe(ID);
  });
});

describe('the pop-up, the badge and the banner', () => {
  it('closing the pop-up ends it for good, in any session, and keeps the badge and the banner', async () => {
    const c = controller();
    await c.record(asOwner(), ID, { event: 'seen' });
    await c.record(asOwner(), ID, { event: 'dismissed' });
    for (const later of [MID + 1000, MID + 2 * DAY, END - 1]) {
      clock = later;
      expect(await current(c)).toMatchObject({ modal: false, badge: true, showBanner: true });
    }
  });

  it('a sighting alone never ends the pop-up: no session cap', async () => {
    const c = controller();
    for (let i = 0; i < 10; i++) {
      await c.record(asOwner(), ID, { event: 'seen' });
      clock += DAY;
    }
    expect(await current(c)).toMatchObject({ modal: true });
  });

  it('reaching the page ends the pop-up and the badge; the banner stays while the announcement runs', async () => {
    const c = controller();
    await c.record(asOwner(), ID, { event: 'clicked' });
    expect(await current(c)).toMatchObject({ modal: false, badge: false, showBanner: true, followed: true });
    clock = END;
    expect(await current(c)).toBeNull();
  });

  it('another person in the same workspace still gets the pop-up after one closes it', async () => {
    const c = controller();
    await addMember(accountId, 'mate@example.test');
    await c.record(asOwner(), ID, { event: 'dismissed' });
    expect(await current(c)).toMatchObject({ modal: false });
    expect(await current(c, asEmail('mate@example.test'))).toMatchObject({ modal: true, badge: true });
  });

  it('is once per person: closing it in one workspace closes it in the others', async () => {
    const c = controller();
    const other = await addAccount();
    const here = await addMember(accountId, 'same@example.test', 'iam-user-7');
    const there = await addMember(other, 'same@example.test', 'iam-user-7');

    await c.record(asMember(accountId, here), ID, { event: 'dismissed' });
    expect(await current(c, asMember(other, there))).toMatchObject({ modal: false, badge: true });
  });

  it('an announcement without a badge or a banner shows only what it has', async () => {
    const c = controller({ list: [announcement({ railBadge: null, banner: null })] });
    expect(await current(c)).toMatchObject({ modal: true, badge: false, showBanner: false, banner: null });
    await c.record(asOwner(), ID, { event: 'dismissed' });
    expect(await current(c)).toBeNull();
  });
});

describe('one announcement at a time', () => {
  const older = announcement({ id: 'older', startsAt: START - DAY });
  const newer = announcement({ id: 'newer', startsAt: START + DAY });

  it('the most recent one the person has not closed wins', async () => {
    const c = controller({ list: [older, newer] });
    expect(await current(c)).toMatchObject({ id: 'newer', modal: true });

    await c.record(asOwner(), 'newer', { event: 'dismissed' });
    expect(await current(c)).toMatchObject({ id: 'older', modal: true });

    await c.record(asOwner(), 'older', { event: 'dismissed' });
    // Both pop-ups closed: the newest badge is what is left, with its banner.
    expect(await current(c)).toMatchObject({ id: 'newer', modal: false, badge: true, showBanner: true });

    await c.record(asOwner(), 'newer', { event: 'clicked' });
    expect(await current(c)).toMatchObject({ id: 'older', modal: false, badge: true });

    await c.record(asOwner(), 'older', { event: 'clicked' });
    // Everything followed: the newest banner runs on.
    expect(await current(c)).toMatchObject({ id: 'newer', modal: false, badge: false, showBanner: true });
  });

  it('an announcement that has not started yet does not compete', async () => {
    const future = announcement({ id: 'future', startsAt: END, endsAt: END + DAY });
    const c = controller({ list: [announcement(), future] });
    expect((await current(c))?.id).toBe(ID);
  });
});

describe('POST /v1/me/announcements/:id', () => {
  it('refuses an unknown announcement and an unknown event', async () => {
    const c = controller();
    await expect(c.record(asOwner(), 'nope', { event: 'seen' })).rejects.toMatchObject({ status: 404 });
    await expect(c.record(asOwner(), 'integrations-2026-11', { event: 'shown' })).rejects.toBeTruthy();
    await expect(c.record(asOwner(), 'integrations-2026-11', {})).rejects.toBeTruthy();
  });

  it('stores nothing for an announcement out of its dates or not allowed here', async () => {
    clock = END;
    await controller().record(asOwner(), 'integrations-2026-11', { event: 'dismissed' });
    clock = MID;
    await controller({ dapta: false }).record(asOwner(), 'integrations-2026-11', { event: 'dismissed' });
    const rows = await db.all(sql`SELECT * FROM announcement_state`);
    expect(rows).toHaveLength(0);
  });
});

describe('session only', () => {
  it('refuses an API key or an MCP connection on both routes', async () => {
    for (const via of ['api_key', 'mcp_connection'] as const) {
      const agentAuth = {
        resolveHost: async (req: ReqLike) => ({ ...(await auth.resolveHost(req)), via }),
      } as unknown as AuthService;
      const c = new AnnouncementsController(db, agentAuth, { dapta: true, now: () => clock });
      await expect(c.current(asOwner())).rejects.toBeInstanceOf(ForbiddenException);
      await expect(c.record(asOwner(), 'integrations-2026-11', { event: 'seen' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    }
  });
});

describe('the shipped list', () => {
  it('is well formed: unique ids, real dates, internal routes', () => {
    const ids = ANNOUNCEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ANNOUNCEMENTS) {
      expect(a.endsAt, a.id).toBeGreaterThan(a.startsAt);
      expect(a.cta, a.id).toMatch(/^\/admin(\/|$)/);
    }
  });

  it('runs the first announcement from November 19 through December 19, Bogota time', () => {
    const a = ANNOUNCEMENTS.find((x) => x.id === 'integrations-2026-11')!;
    expect(new Date(a.startsAt).toISOString()).toBe('2026-11-19T05:00:00.000Z');
    expect(new Date(a.endsAt).toISOString()).toBe('2026-12-20T05:00:00.000Z');
  });
});

describe('isDaptaDeployment', () => {
  it('is Dapta on workos or on a build named dForms, a fork otherwise', () => {
    expect(isDaptaDeployment({ AUTH_PROVIDER: 'workos' }, undefined)).toBe(true);
    expect(isDaptaDeployment({ AUTH_PROVIDER: 'local' }, 'dForms')).toBe(true);
    expect(isDaptaDeployment({ AUTH_PROVIDER: 'local' }, 'Dapta Forms')).toBe(true);
    expect(isDaptaDeployment({ AUTH_PROVIDER: 'local' }, undefined)).toBe(false);
    expect(isDaptaDeployment({ AUTH_PROVIDER: 'local' }, 'Acme Forms')).toBe(false);
  });
});
