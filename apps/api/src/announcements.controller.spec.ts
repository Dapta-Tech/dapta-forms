/**
 * In-app announcements through the REAL controller on in-memory SQLite, with
 * the local auth provider resolving real member rows (same harness as
 * member-locale.controller.spec.ts). The clock and the list are the only
 * things swapped, so the dates and the session gap can be walked through.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { createDb, migrate, seed, sql, type Db } from '@quill/db';
import {
  ANNOUNCEMENTS,
  ANNOUNCEMENT_MAX_SESSIONS,
  ANNOUNCEMENT_SESSION_GAP_MS,
  type Announcement,
} from '@quill/shared';
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

describe('GET /v1/me/announcement', () => {
  it('gives the live announcement with its card and its rail badge', async () => {
    expect(await controller().current(asOwner())).toEqual({
      announcement: {
        id: 'integrations-2026-11',
        copy: 'integrations-2026-11',
        cta: '/admin/integrations',
        visual: { kind: 'video', src: '/announcements/announce-integrations', width: 1280, height: 720 },
        railBadge: 'integrations',
        card: true,
        badge: true,
      },
    });
  });

  it('gives nothing before the start or from the end date on', async () => {
    clock = START - 1;
    expect((await controller().current(asOwner())).announcement).toBeNull();
    clock = START;
    expect((await controller().current(asOwner())).announcement).not.toBeNull();
    clock = END - 1;
    expect((await controller().current(asOwner())).announcement).not.toBeNull();
    clock = END;
    expect((await controller().current(asOwner())).announcement).toBeNull();
  });

  it('hides a Dapta-only announcement on a fork', async () => {
    expect((await controller({ dapta: false }).current(asOwner())).announcement).toBeNull();
    const plain = controller({ dapta: false, list: [announcement({ daptaOnly: false })] });
    expect((await plain.current(asOwner())).announcement?.id).toBe('integrations-2026-11');
  });
});

describe('closing, following, and who else still sees it', () => {
  it('closing the card ends the card for good and keeps the badge', async () => {
    const c = controller();
    await c.record(asOwner(), 'integrations-2026-11', { event: 'seen' });
    await c.record(asOwner(), 'integrations-2026-11', { event: 'dismissed' });

    for (const later of [MID + 1000, MID + 2 * DAY]) {
      clock = later;
      expect((await c.current(asOwner())).announcement).toMatchObject({ card: false, badge: true });
    }
  });

  it('following it (the button, or visiting the page) ends card and badge', async () => {
    const c = controller();
    await c.record(asOwner(), 'integrations-2026-11', { event: 'clicked' });
    expect((await c.current(asOwner())).announcement).toBeNull();

    // Also after the card was closed first.
    const mate = await addMember(accountId, 'mate@example.test');
    await c.record(asMember(accountId, mate), 'integrations-2026-11', { event: 'dismissed' });
    await c.record(asMember(accountId, mate), 'integrations-2026-11', { event: 'clicked' });
    expect((await c.current(asMember(accountId, mate))).announcement).toBeNull();
  });

  it('another person in the same workspace still sees it after one closes it', async () => {
    const c = controller();
    await addMember(accountId, 'mate@example.test');
    await c.record(asOwner(), 'integrations-2026-11', { event: 'dismissed' });
    await c.record(asOwner(), 'integrations-2026-11', { event: 'clicked' });

    expect((await c.current(asOwner())).announcement).toBeNull();
    expect((await c.current(asEmail('mate@example.test'))).announcement).toMatchObject({ card: true, badge: true });
  });

  it('is once per person: closing it in one workspace closes it in the others', async () => {
    const c = controller();
    const other = await addAccount();
    const here = await addMember(accountId, 'same@example.test', 'iam-user-7');
    const there = await addMember(other, 'same@example.test', 'iam-user-7');

    await c.record(asMember(accountId, here), 'integrations-2026-11', { event: 'dismissed' });
    expect((await c.current(asMember(other, there))).announcement).toMatchObject({ card: false });
  });
});

describe('the session cap', () => {
  it(`shows an untouched announcement for ${ANNOUNCEMENT_MAX_SESSIONS} sessions, the last one to its end`, async () => {
    const c = controller();
    for (let i = 0; i < ANNOUNCEMENT_MAX_SESSIONS; i++) {
      expect((await c.current(asOwner())).announcement, `session ${i + 1}`).not.toBeNull();
      await c.record(asOwner(), 'integrations-2026-11', { event: 'seen' });
      // A reload inside the session does not count again.
      clock += 60_000;
      await c.record(asOwner(), 'integrations-2026-11', { event: 'seen' });
      if (i < ANNOUNCEMENT_MAX_SESSIONS - 1) clock += ANNOUNCEMENT_SESSION_GAP_MS;
    }
    // Still inside the fifth session.
    clock += ANNOUNCEMENT_SESSION_GAP_MS - 1;
    expect((await c.current(asOwner())).announcement).not.toBeNull();
    // A sixth session would start: gone, card and badge.
    clock += 1;
    expect((await c.current(asOwner())).announcement).toBeNull();
  });

  it('a closed card leaves a badge the session cap does not end; only the visit does', async () => {
    const c = controller();
    await c.record(asOwner(), 'integrations-2026-11', { event: 'dismissed' });
    for (let i = 0; i < ANNOUNCEMENT_MAX_SESSIONS + 2; i++) {
      await c.record(asOwner(), 'integrations-2026-11', { event: 'seen' });
      clock += ANNOUNCEMENT_SESSION_GAP_MS;
    }
    expect((await c.current(asOwner())).announcement).toMatchObject({ card: false, badge: true });
    await c.record(asOwner(), 'integrations-2026-11', { event: 'clicked' });
    expect((await c.current(asOwner())).announcement).toBeNull();
  });
});

describe('one announcement at a time', () => {
  const older = announcement({ id: 'older', startsAt: START - DAY });
  const newer = announcement({ id: 'newer', startsAt: START + DAY });

  it('the most recent one the person has not closed wins', async () => {
    const c = controller({ list: [older, newer] });
    expect((await c.current(asOwner())).announcement).toMatchObject({ id: 'newer', card: true });

    await c.record(asOwner(), 'newer', { event: 'dismissed' });
    expect((await c.current(asOwner())).announcement).toMatchObject({ id: 'older', card: true });

    await c.record(asOwner(), 'older', { event: 'dismissed' });
    // Both cards closed: the newest badge is what is left.
    expect((await c.current(asOwner())).announcement).toMatchObject({ id: 'newer', card: false, badge: true });
  });

  it('an announcement that has not started yet does not compete', async () => {
    const future = announcement({ id: 'future', startsAt: END, endsAt: END + DAY });
    const c = controller({ list: [announcement(), future] });
    expect((await c.current(asOwner())).announcement?.id).toBe('integrations-2026-11');
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
