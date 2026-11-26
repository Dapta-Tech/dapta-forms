/**
 * The playbooks gallery through the REAL controllers on in-memory SQLite, with
 * the local auth provider resolving real member rows (the same harness as
 * announcements.controller.spec.ts). The clock and the list are the only
 * things swapped, so publication dates and "New" can be walked through.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import type { ServerEnv } from '@quill/config/env';
import { createDb, listOutbox, migrate, seed, sql, type Db } from '@quill/db';
import { PLAYBOOKS, type Playbook } from '@quill/shared/playbooks';
import { AnalyticsEffects } from './analytics-effects';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';
import {
  PlaybooksController,
  PublicPlaybooksController,
  type PlaybooksOptions,
} from './playbooks.controller';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-12-01T00:00:00-05:00');

const playbook = (over: Partial<Playbook>): Playbook => ({
  slug: 'manual',
  category: 'ventas',
  title: 'Manual',
  summary: 'Summary',
  publishedAt: T0,
  promisedBy: [],
  template: 'Calificador de leads',
  thumbnailVideo: null,
  thumbnailPoster: null,
  thumbnailMotif: 'A brief nobody reads',
  preview: 'PREVIEW of the playbook',
  rest: 'REST that only signed-in people read',
  ...over,
});

const MANUAL = playbook({ slug: 'manual', category: 'ventas', promisedBy: ['ig_homerovende'] });
const HOOK = playbook({
  slug: 'hook',
  category: 'ads',
  rest: 'HOOK REST, never public',
  thumbnailVideo: '/playbooks/hook.webm',
  thumbnailPoster: '/playbooks/hook.png',
});
const LATER = playbook({ slug: 'later', category: 'agentes', publishedAt: T0 + 2 * DAY });
const LIST = [MANUAL, HOOK, LATER];

let db: Db;
let auth: AuthService;
let analytics: AnalyticsEffects;
let clock: number;
let accountId: string;

/** No identity: the local provider resolves the seeded demo owner. */
const asOwner = (): ReqLike => ({ headers: {} });
const asEmail = (email: string): ReqLike => ({ headers: { 'x-quill-email': email } });
const asMember = (account: string, member: string): ReqLike => ({
  headers: { 'x-quill-account': account, 'x-quill-member': member },
});

function controller(opts: Partial<PlaybooksOptions> = {}): PlaybooksController {
  return new PlaybooksController(db, auth, analytics, { now: () => clock, list: LIST, ...opts });
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

/** Every product event captured so far, oldest first. */
async function events(): Promise<{ event: string; properties: Record<string, unknown> }[]> {
  const rows = await listOutbox(db, { kind: 'analytics' });
  return rows.map((r) => JSON.parse(String(r.payload)) as { event: string; properties: Record<string, unknown> });
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
  analytics = new AnalyticsEffects(db, {
    PRODUCT_ANALYTICS_KEY: 'phc_test',
    PRODUCT_ANALYTICS_HOST: 'https://x.test',
  } as unknown as ServerEnv);
  clock = T0 + DAY;
  accountId = (await auth.resolveHost(asOwner())).accountId;
});

afterEach(async () => {
  await db.close();
});

describe('GET /v1/me/playbooks', () => {
  it('lists the published playbooks with the person state, never the body', async () => {
    const res = await controller().list(asOwner());
    expect(res.playbooks.map((p) => p.slug)).toEqual(['manual', 'hook']);
    expect(res.playbooks[1]).toEqual({
      slug: 'hook',
      category: 'ads',
      title: 'Manual',
      summary: 'Summary',
      publishedAt: T0,
      promisedBy: [],
      template: 'Calificador de leads',
      thumbnailVideo: '/playbooks/hook.webm',
      thumbnailPoster: '/playbooks/hook.png',
      seen: false,
      firstSeenAt: null,
      lastSeenAt: null,
      isNew: true,
    });
    expect(res).toMatchObject({ categories: ['ventas', 'ads'], galleryLastSeenAt: null, newCount: 2 });
    expect(JSON.stringify(res)).not.toContain('REST');
  });

  it('hides a playbook until its publication date', async () => {
    clock = LATER.publishedAt - 1;
    expect((await controller().list(asOwner())).playbooks.map((p) => p.slug)).not.toContain('later');
    await expect(controller().detail(asOwner(), 'later')).rejects.toMatchObject({ status: 404 });
    await expect(controller().seen(asOwner(), 'later')).rejects.toMatchObject({ status: 404 });

    clock = LATER.publishedAt;
    const res = await controller().list(asOwner());
    expect(res.playbooks.map((p) => p.slug)).toEqual(['later', 'manual', 'hook']);
    expect(res.categories).toEqual(['ventas', 'ads', 'agentes']);
  });

  it('filters by category, keeping the tabs and the new count of the whole gallery', async () => {
    const res = await controller().list(asOwner(), 'ads');
    expect(res.playbooks.map((p) => p.slug)).toEqual(['hook']);
    expect(res.categories).toEqual(['ventas', 'ads']);
    expect(res.newCount).toBe(2);
    expect((await controller().list(asOwner(), 'marketing')).playbooks).toEqual([]);
    expect((await controller().list(asOwner(), '')).playbooks).toHaveLength(2);
  });

  it('refuses an unknown category', async () => {
    await expect(controller().list(asOwner(), 'growth')).rejects.toMatchObject({ status: 400 });
  });

  it('records nothing when read', async () => {
    await controller().list(asOwner());
    await controller().detail(asOwner(), 'hook');
    expect(await db.all(sql`SELECT * FROM playbook_state`)).toHaveLength(0);
  });
});

describe('GET /v1/me/playbooks/:slug', () => {
  it('gives the whole body, preview and rest, without the marker', async () => {
    const { playbook: p } = await controller().detail(asOwner(), 'hook');
    expect(p.body).toBe('PREVIEW of the playbook\n\nHOOK REST, never public');
    expect(p).toMatchObject({ slug: 'hook', seen: false, isNew: true });
    expect(p).not.toHaveProperty('thumbnailMotif');
  });

  it('answers 404 for an unknown slug and for the reserved gallery slug', async () => {
    await expect(controller().detail(asOwner(), 'nope')).rejects.toMatchObject({ status: 404 });
    await expect(controller().detail(asOwner(), '_gallery')).rejects.toMatchObject({ status: 404 });
    await expect(controller().seen(asOwner(), '_gallery')).rejects.toMatchObject({ status: 404 });
  });
});

describe('POST /v1/me/playbooks/:slug/seen', () => {
  it('stores the first open once and moves the last open every time', async () => {
    const c = controller();
    expect(await c.seen(asOwner(), 'hook')).toEqual({ ok: true, firstSeenAt: clock, lastSeenAt: clock });
    const first = clock;
    clock += 3600_000;
    expect(await c.seen(asOwner(), 'hook')).toEqual({ ok: true, firstSeenAt: first, lastSeenAt: clock });
    await c.seen(asOwner(), 'hook');

    const card = (await c.list(asOwner())).playbooks.find((p) => p.slug === 'hook');
    expect(card).toMatchObject({ seen: true, firstSeenAt: first, lastSeenAt: clock, isNew: false });
    expect(await db.all(sql`SELECT * FROM playbook_state`)).toHaveLength(1);
  });

  it('captures forms_playbook_viewed with the slug, the category and whether it was the first open', async () => {
    const c = controller();
    await c.seen(asOwner(), 'hook');
    await c.seen(asOwner(), 'hook');
    const viewed = (await events()).filter((e) => e.event === 'forms_playbook_viewed');
    expect(viewed.map((e) => e.properties)).toEqual([
      { slug: 'hook', category: 'ads', first: true },
      { slug: 'hook', category: 'ads', first: false },
    ]);
  });

  it('captures nothing for a playbook that does not exist', async () => {
    await expect(controller().seen(asOwner(), 'nope')).rejects.toMatchObject({ status: 404 });
    expect(await events()).toEqual([]);
  });
});

describe('"New"', () => {
  it('is everything for a person who never opened the gallery, and nothing published before their last visit', async () => {
    const c = controller();
    expect((await c.list(asOwner())).newCount).toBe(2);

    const visit = await c.galleryVisit(asOwner());
    expect(visit).toEqual({ ok: true, galleryLastSeenAt: clock });
    const after = await c.list(asOwner());
    expect(after.galleryLastSeenAt).toBe(clock);
    expect(after.newCount).toBe(0);
    expect(after.playbooks.every((p) => !p.isNew)).toBe(true);

    // A playbook published after that visit is new until the next one.
    clock = LATER.publishedAt + 1;
    const later = await c.list(asOwner());
    expect(later.playbooks.filter((p) => p.isNew).map((p) => p.slug)).toEqual(['later']);
    expect(later.newCount).toBe(1);
    await c.galleryVisit(asOwner());
    expect((await c.list(asOwner())).newCount).toBe(0);
  });

  it('ends for a playbook the person opened straight from a link', async () => {
    const c = controller();
    await c.seen(asOwner(), 'manual');
    const res = await c.list(asOwner());
    expect(res.playbooks.find((p) => p.slug === 'manual')?.isNew).toBe(false);
    expect(res.newCount).toBe(1);
  });

  it('never moves the gallery visit backwards', async () => {
    const c = controller();
    await c.galleryVisit(asOwner());
    const visited = clock;
    clock -= 1000;
    expect(await c.galleryVisit(asOwner())).toEqual({ ok: true, galleryLastSeenAt: visited });
  });
});

describe('per person, across workspaces', () => {
  it('is one state for a person in several workspaces', async () => {
    const c = controller();
    const other = await addAccount();
    const here = await addMember(accountId, 'same@example.test', 'iam-user-7');
    const there = await addMember(other, 'same@example.test', 'iam-user-7');

    await c.seen(asMember(accountId, here), 'hook');
    await c.galleryVisit(asMember(accountId, here));
    const res = await c.list(asMember(other, there));
    expect(res.playbooks.find((p) => p.slug === 'hook')).toMatchObject({ seen: true });
    expect(res.galleryLastSeenAt).toBe(clock);
  });

  it('is not shared with another person in the same workspace', async () => {
    const c = controller();
    await addMember(accountId, 'mate@example.test');
    await c.seen(asOwner(), 'hook');
    await c.galleryVisit(asOwner());
    const mate = await c.list(asEmail('mate@example.test'));
    expect(mate.playbooks.find((p) => p.slug === 'hook')).toMatchObject({ seen: false, isNew: true });
    expect(mate).toMatchObject({ galleryLastSeenAt: null, newCount: 2 });
  });
});

describe('session only', () => {
  it('refuses an API key or an MCP connection on every route, recording nothing', async () => {
    for (const via of ['api_key', 'mcp_connection'] as const) {
      const agentAuth = {
        resolveHost: async (req: ReqLike) => ({ ...(await auth.resolveHost(req)), via }),
      } as unknown as AuthService;
      const c = new PlaybooksController(db, agentAuth, analytics, { now: () => clock, list: LIST });
      await expect(c.list(asOwner())).rejects.toBeInstanceOf(ForbiddenException);
      await expect(c.detail(asOwner(), 'hook')).rejects.toBeInstanceOf(ForbiddenException);
      await expect(c.seen(asOwner(), 'hook')).rejects.toBeInstanceOf(ForbiddenException);
      await expect(c.galleryVisit(asOwner())).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(await db.all(sql`SELECT * FROM playbook_state`)).toHaveLength(0);
    expect(await events()).toEqual([]);
  });
});

describe('GET /v1/public/playbooks', () => {
  const publicList = (list: readonly Playbook[] = LIST) =>
    new PublicPlaybooksController({ now: () => clock, list }).list();

  it('gives the fixture shape: teasers, outline and minutes always, the rest only when a guide promises it', () => {
    expect(publicList()).toEqual({
      playbooks: [
        {
          slug: 'manual',
          category: 'ventas',
          title: 'Manual',
          summary: 'Summary',
          publishedAt: '2026-12-01',
          promisedBy: ['ig_homerovende'],
          readingMinutes: 1,
          teaser: 'PREVIEW of the playbook',
          outline: [],
          rest: 'REST that only signed-in people read',
        },
        {
          slug: 'hook',
          category: 'ads',
          title: 'Manual',
          summary: 'Summary',
          publishedAt: '2026-12-01',
          promisedBy: [],
          readingMinutes: 1,
          teaser: 'PREVIEW of the playbook',
          outline: [],
          thumbnailVideo: '/playbooks/hook.webm',
          thumbnailPoster: '/playbooks/hook.png',
        },
      ],
    });
  });

  it('leaves the optional fields out instead of sending null', () => {
    const [manual, hook] = publicList().playbooks;
    expect(manual).not.toHaveProperty('thumbnailVideo');
    expect(manual).not.toHaveProperty('thumbnailPoster');
    expect(hook).not.toHaveProperty('rest');
    expect(JSON.stringify(publicList())).not.toContain('null');
  });

  it('lists the ## headings of the rest, in order, skipping code blocks and deeper levels', () => {
    const rest = [
      '## Step one: the hook',
      'Text.',
      '### A subsection',
      '```md',
      '## Not a heading, inside a code block',
      '```',
      '##No space, not a heading',
      '## Hazlo con dForms  ',
      '## ',
    ].join('\n');
    const [view] = publicList([playbook({ rest })]).playbooks;
    expect(view?.outline).toEqual(['Step one: the hook', 'Hazlo con dForms']);
  });

  it('gives the outline of an unpromised playbook without any of its text', () => {
    const rest = '## Secret section title\n\nBODY TEXT NOBODY SEES';
    const out = publicList([playbook({ rest, promisedBy: [] })]);
    expect(out.playbooks[0]?.outline).toEqual(['Secret section title']);
    expect(JSON.stringify(out)).not.toContain('BODY TEXT NOBODY SEES');
  });

  it('counts the reading time on the whole body at 200 words a minute, rounded up', () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `palabra${i}`).join(' ');
    const minutes = (preview: string, rest: string) =>
      publicList([playbook({ preview, rest, promisedBy: [] })]).playbooks[0]?.readingMinutes;
    expect(minutes(words(100), words(100))).toBe(1);
    expect(minutes(words(100), words(101))).toBe(2);
    expect(minutes(words(10), words(990))).toBe(5);
    // Accented words count once, and markdown punctuation is not a word.
    expect(minutes('**Cómo**: _vender_', '## Diseño\n\n- ñandú')).toBe(1);
    expect(minutes(`${words(150)} árbol`, `${words(49)} **más**`)).toBe(2);
  });

  it('dates a playbook by its day in Bogota', () => {
    const late = Date.parse('2026-12-01T23:30:00-05:00');
    clock = late;
    expect(publicList([playbook({ publishedAt: late })]).playbooks[0]?.publishedAt).toBe('2026-12-01');
  });

  it('never carries the rest of an unpromised playbook, the template step or the brief', () => {
    const text = JSON.stringify(publicList());
    expect(text).not.toContain('HOOK REST');
    expect(text).not.toContain('Calificador de leads');
    expect(text).not.toContain('A brief nobody reads');
  });

  it('hides a playbook until its publication date', () => {
    expect(publicList().playbooks.map((p) => p.slug)).not.toContain('later');
    clock = LATER.publishedAt;
    expect(publicList().playbooks.map((p) => p.slug)).toContain('later');
  });

  it('on the shipped catalog, exposes no rest of a playbook without promisedBy', () => {
    clock = Math.max(...PLAYBOOKS.map((p) => p.publishedAt));
    const out = publicList(PLAYBOOKS);
    expect(out.playbooks).toHaveLength(PLAYBOOKS.length);
    const text = JSON.stringify(out);
    for (const p of PLAYBOOKS) {
      const view = out.playbooks.find((v) => v.slug === p.slug);
      expect(view?.outline.length, p.slug).toBeGreaterThan(0);
      expect(view?.readingMinutes, p.slug).toBeGreaterThan(1);
      if (p.promisedBy.length > 0) {
        expect(view?.rest, p.slug).toBe(p.rest);
      } else {
        expect(view, p.slug).not.toHaveProperty('rest');
        expect(text.includes(JSON.stringify(p.rest).slice(1, -1)), p.slug).toBe(false);
      }
    }
  });
});
