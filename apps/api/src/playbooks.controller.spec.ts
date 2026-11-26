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
import { createDb, listOutbox, migrate, seed, setMemberLocale, sql, type Db } from '@quill/db';
import { PLAYBOOKS, PLAYBOOK_CATALOG, type Playbook, type PlaybookCatalog } from '@quill/shared/playbooks';
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
  locale: 'es',
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
/** The English version of HOOK only: MANUAL and LATER are not translated yet. */
const HOOK_EN = playbook({
  ...HOOK,
  locale: 'en',
  title: 'The pain hook',
  summary: 'In English',
  template: 'Lead qualifier',
  preview: 'ENGLISH PREVIEW',
  rest: 'ENGLISH HOOK REST, never public',
  thumbnailVideo: '/playbooks/en/hook.webm',
  thumbnailPoster: '/playbooks/en/hook.png',
});
const CATALOG: PlaybookCatalog = { es: LIST, en: [HOOK_EN] };

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
  return new PlaybooksController(db, auth, analytics, { now: () => clock, catalog: CATALOG, ...opts });
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
      locale: 'es',
      fallback: false,
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
    expect(res).toMatchObject({ locale: 'es', categories: ['ventas', 'ads'], galleryLastSeenAt: null, newCount: 2 });
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
      { slug: 'hook', category: 'ads', first: true, locale: 'es', requested_locale: 'es', fallback: false },
      { slug: 'hook', category: 'ads', first: false, locale: 'es', requested_locale: 'es', fallback: false },
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
      const c = new PlaybooksController(db, agentAuth, analytics, { now: () => clock, catalog: CATALOG });
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
  const publicList = (list: readonly Playbook[] = LIST, locale?: string) =>
    new PublicPlaybooksController({ now: () => clock, catalog: { es: list, en: list === LIST ? [HOOK_EN] : [] } }).list(locale);

  it('gives the fixture shape: teasers, outline and minutes always, the rest only when a guide promises it', () => {
    expect(publicList()).toEqual({
      locale: 'es',
      playbooks: [
        {
          slug: 'manual',
          locale: 'es',
          fallback: false,
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
          locale: 'es',
          fallback: false,
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

  it('keeps the inline media markers in the teaser and the rest, and never reads them as words or headings', () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `palabra${i}`).join(' ');
    const alt = words(60);
    const anim = `<!-- anim: manual/demo | ${alt} -->`;
    const img = `<!-- img: manual/panel | ## Not a heading | ${alt} -->`;
    const preview = `${words(100)}\n\n${anim}`;
    const rest = `## Paso uno\n\n${img}\n\n${words(100)}`;
    const [view] = publicList([playbook({ preview, rest, promisedBy: ['ig_homerovende'] })]).playbooks;
    // The landing draws them, so they travel exactly as written.
    expect(view?.teaser).toBe(preview);
    expect(view?.rest).toBe(rest);
    expect(view?.outline).toEqual(['Paso uno']);
    // 200 words with or without the markers: the 120 words of their alts would make it two minutes.
    const [bare] = publicList([playbook({ preview: words(100), rest: `## Paso uno\n\n${words(98)}` })]).playbooks;
    expect(bare?.readingMinutes).toBe(1);
    const [marked] = publicList([playbook({ preview: `${words(100)}\n\n${anim}`, rest: `## Paso uno\n\n${img}\n\n${words(98)}` })]).playbooks;
    expect(marked?.readingMinutes).toBe(1);
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
    const out = new PublicPlaybooksController({ now: () => clock }).list();
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

describe('?locale= on the reads', () => {
  const publicList = (locale?: string) => new PublicPlaybooksController({ now: () => clock, catalog: CATALOG }).list(locale);
  const ownerMember = async () => (await auth.resolveHost(asOwner())).memberId;

  it('lists each playbook in the language asked for, or in Spanish with fallback while it is not translated', async () => {
    const res = await controller().list(asOwner(), undefined, 'en');
    expect(res.locale).toBe('en');
    expect(res.playbooks.map((p) => [p.slug, p.locale, p.fallback, p.title])).toEqual([
      ['manual', 'es', true, 'Manual'],
      ['hook', 'en', false, 'The pain hook'],
    ]);
    expect(res.playbooks[1]).toMatchObject({
      summary: 'In English',
      template: 'Lead qualifier',
      thumbnailVideo: '/playbooks/en/hook.webm',
      thumbnailPoster: '/playbooks/en/hook.png',
      publishedAt: HOOK.publishedAt,
      category: 'ads',
    });
    // Same cards, same tabs, same "New": only the words change.
    const es = await controller().list(asOwner(), undefined, 'es');
    expect(es.playbooks.map((p) => [p.slug, p.locale, p.fallback])).toEqual([
      ['manual', 'es', false],
      ['hook', 'es', false],
    ]);
    expect(res.categories).toEqual(es.categories);
    expect(res.newCount).toBe(es.newCount);
  });

  it('defaults to the member platform language, else Spanish', async () => {
    expect((await controller().list(asOwner())).locale).toBe('es');
    await setMemberLocale(db, accountId, await ownerMember(), 'en');
    const res = await controller().list(asOwner());
    expect(res.locale).toBe('en');
    expect(res.playbooks.find((p) => p.slug === 'hook')?.title).toBe('The pain hook');
    const { playbook: p } = await controller().detail(asOwner(), 'hook');
    expect(p).toMatchObject({ locale: 'en', fallback: false });
    // An explicit ?locale= wins over the member's language.
    expect((await controller().list(asOwner(), undefined, 'es')).locale).toBe('es');
    // An empty one is the default.
    expect((await controller().list(asOwner(), undefined, '')).locale).toBe('en');
  });

  it('refuses a language it does not know, on every read', async () => {
    await expect(controller().list(asOwner(), undefined, 'pt')).rejects.toMatchObject({ status: 400 });
    await expect(controller().detail(asOwner(), 'hook', 'EN')).rejects.toMatchObject({ status: 400 });
    await expect(controller().seen(asOwner(), 'hook', 'fr')).rejects.toMatchObject({ status: 400 });
    expect(() => new PublicPlaybooksController({ now: () => clock, catalog: CATALOG }).list('pt')).toThrow(
      /locale must be one of es, en/,
    );
    expect(await db.all(sql`SELECT * FROM playbook_state`)).toHaveLength(0);
  });

  it('gives the whole body in English, or the Spanish one with fallback', async () => {
    const { playbook: hook } = await controller().detail(asOwner(), 'hook', 'en');
    expect(hook).toMatchObject({ slug: 'hook', locale: 'en', fallback: false, title: 'The pain hook' });
    expect(hook.body).toBe('ENGLISH PREVIEW\n\nENGLISH HOOK REST, never public');
    const { playbook: manual } = await controller().detail(asOwner(), 'manual', 'en');
    expect(manual).toMatchObject({ slug: 'manual', locale: 'es', fallback: true, title: 'Manual' });
    expect(manual.body).toBe('PREVIEW of the playbook\n\nREST that only signed-in people read');
  });

  it('serves nothing that only exists in a translation: Spanish decides what exists', async () => {
    const ghost = playbook({ slug: 'ghost', locale: 'en' });
    const c = controller({ catalog: { es: LIST, en: [HOOK_EN, ghost] } });
    expect((await c.list(asOwner(), undefined, 'en')).playbooks.map((p) => p.slug)).not.toContain('ghost');
    await expect(c.detail(asOwner(), 'ghost', 'en')).rejects.toMatchObject({ status: 404 });
  });

  it('keeps one state per slug: read in English, it is read in Spanish, and "New" ends in both', async () => {
    const c = controller();
    await c.seen(asOwner(), 'hook', 'en');
    expect(await db.all(sql`SELECT playbook_slug FROM playbook_state`)).toEqual([{ playbook_slug: 'hook' }]);
    for (const locale of ['es', 'en']) {
      const card = (await c.list(asOwner(), undefined, locale)).playbooks.find((p) => p.slug === 'hook');
      expect(card, locale).toMatchObject({ seen: true, firstSeenAt: clock, lastSeenAt: clock, isNew: false });
    }
    clock += 1000;
    await c.seen(asOwner(), 'hook', 'es');
    expect((await c.detail(asOwner(), 'hook', 'en')).playbook).toMatchObject({ lastSeenAt: clock, firstSeenAt: clock - 1000 });

    await c.galleryVisit(asOwner());
    for (const locale of ['es', 'en']) {
      const res = await c.list(asOwner(), undefined, locale);
      expect(res, locale).toMatchObject({ galleryLastSeenAt: clock, newCount: 0 });
    }
    expect(await db.all(sql`SELECT * FROM playbook_state`)).toHaveLength(2);
  });

  it('puts the language shown, the one asked for and the fallback in forms_playbook_viewed', async () => {
    const c = controller();
    await c.seen(asOwner(), 'hook', 'en');
    await c.seen(asOwner(), 'manual', 'en');
    const viewed = (await events()).filter((e) => e.event === 'forms_playbook_viewed');
    expect(viewed.map((e) => e.properties)).toEqual([
      { slug: 'hook', category: 'ads', first: true, locale: 'en', requested_locale: 'en', fallback: false },
      { slug: 'manual', category: 'ventas', first: true, locale: 'es', requested_locale: 'en', fallback: true },
    ]);
  });

  it('on the public list: Spanish by default, English when asked, Spanish with fallback where missing', () => {
    expect(publicList().playbooks.map((p) => [p.slug, p.locale, p.fallback])).toEqual([
      ['manual', 'es', false],
      ['hook', 'es', false],
    ]);
    const en = publicList('en');
    expect(en.locale).toBe('en');
    const [manual, hook] = en.playbooks;
    expect(manual).toMatchObject({ slug: 'manual', locale: 'es', fallback: true, rest: 'REST that only signed-in people read' });
    expect(hook).toMatchObject({
      slug: 'hook',
      locale: 'en',
      fallback: false,
      title: 'The pain hook',
      teaser: 'ENGLISH PREVIEW',
      publishedAt: '2026-12-01',
      thumbnailVideo: '/playbooks/en/hook.webm',
    });
    // The rest of an unpromised playbook stays private in every language.
    expect(JSON.stringify(en)).not.toContain('ENGLISH HOOK REST');
  });

  it('on the shipped catalog, answers every playbook in English, with no fallback and the same publication', () => {
    clock = Math.max(...PLAYBOOKS.map((p) => p.publishedAt));
    const es = new PublicPlaybooksController({ now: () => clock }).list('es');
    const out = new PublicPlaybooksController({ now: () => clock }).list('en');
    expect(out.playbooks).toHaveLength(PLAYBOOK_CATALOG.en.length);
    expect(out.playbooks.map((v) => v.slug)).toEqual(es.playbooks.map((v) => v.slug));
    for (const [i, view] of out.playbooks.entries()) {
      expect(view, view.slug).toMatchObject({ locale: 'en', fallback: false, publishedAt: es.playbooks[i]!.publishedAt });
      expect(view.thumbnailVideo, view.slug).toBe(`/playbooks/en/${view.slug}.webm`);
    }
  });
});
