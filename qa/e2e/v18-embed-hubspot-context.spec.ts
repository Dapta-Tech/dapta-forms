import { test, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The page an embedded form is answered on (#199), end to end in a real
 * browser: the landing's URL, title, campaign and HubSpot cookie, read by the
 * landing's `embed.js`, reach the submission, the dashboard, the CSV and the
 * outbox snapshot every destination delivers from.
 *
 * The landing is a page this spec serves itself (`page.route`) on a LOOPBACK
 * origin other than the form's. Loopback, because WebKit refuses a plain-http
 * form inside an https page (mixed content) and treats a plain-http page that
 * is not loopback as no secure context; Chromium, for its part, asks for the
 * local-network-access permission before a page that reached no network
 * address may load one on this machine, so the spec grants it. Nothing here
 * leaves the machine: the webhook points at the QA API's own loopback address
 * and there is no HubSpot connection at all (its delivery is the log-only
 * no-op), so what is asserted is what was ENQUEUED, the snapshot a real
 * delivery sends.
 *
 * Point it at other ports with QA_API_URL (the web side is `baseURL`), and at
 * the API's database file with QA_DB_PATH when it is not `.data/qa.db`. Run it
 * in Chromium AND WebKit.
 *
 * The spam protection block runs only against an API booted with CAPTCHA_*
 * keys (the provider's public test keys). The widget is a stand-in here; so
 * that the API's own token check does not reach the provider either, boot that
 * API with the preload in `qa/fixtures/turnstile-siteverify-stub.mjs`:
 *   NODE_OPTIONS=--import=<repo>/qa/fixtures/turnstile-siteverify-stub.mjs
 * and with RATE_LIMIT_ENABLED=false, or the public surface reads RATE_LIMITED.
 */

const API = process.env.QA_API_URL ?? 'http://localhost:4400';
/** The landing: served by `page.route`, nothing listens there. */
const LANDING = 'http://127.0.0.1:9199';
const LANDING_TITLE = 'Seguro de hogar | Aseguradora Ejemplo';
const CAMPAIGN = { utm_source: 'facebook', utm_medium: 'paid_social', utm_campaign: 'w40-hutk' };
const LANDING_URL = `${LANDING}/seguros/hogar?${new URLSearchParams({ ...CAMPAIGN, fbclid: 'test123' })}`;
/** A HubSpot visitor cookie is 32 hex characters; the landing's tracking code sets it. */
const HUTK = 'f0e1d2c3b4a5968778695a4b3c2d1e0f';
const CHALLENGE_HOST = 'challenges.cloudflare.com';

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.QA_DB_PATH ?? path.resolve(SPEC_DIR, '../../.data/qa.db');
const requireFromDb = createRequire(path.resolve(SPEC_DIR, '../../packages/db/package.json'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Database = requireFromDb('better-sqlite3') as new (
  filename: string,
  options?: { readonly?: boolean },
) => { prepare(sql: string): { all(...p: unknown[]): unknown[] }; close(): void };

function query<T>(sql: string, ...params: unknown[]): T[] {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

const RUN = randomUUID().slice(0, 8);

const STEPS = [
  { key: 'nombre', type: 'text', question: '¿Cómo te llamas?', required: true },
  { key: 'email', type: 'email', question: '¿Cuál es tu correo?', required: true },
];

interface VisitView {
  pageUri: string | null;
  pageName: string | null;
  embedded: boolean;
  hubspotLinked: boolean;
}
interface SubmissionItem {
  id: string;
  data: Record<string, unknown>;
  completedAt: number | null;
  visit?: VisitView | null;
}

async function createForm(
  request: APIRequestContext,
  label: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; path: string; title: string }> {
  const me = (await (await request.get(`${API}/v1/me`)).json()) as { accountCode: string };
  const title = `Cotiza tu seguro ${label} ${RUN}`;
  const res = await request.post(`${API}/v1/forms`, {
    data: {
      name: title,
      config: {
        version: 1,
        language: 'es',
        steps: STEPS,
        // Loopback target: the QA API itself. Delivery is irrelevant; the
        // assertions read the enqueued snapshot.
        destinations: [{ type: 'webhook', enabled: true, settings: { url: `${API}/health` } }],
        ...extra,
      },
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const form = (await res.json()) as { id: string; slug: string };
  return { id: form.id, path: `/${me.accountCode}/f/${form.slug}`, title };
}

/** The landing, with the snippet the editor hands out, or a variant of it. */
async function serveLanding(page: Page, formSrc: string, opts: { script?: boolean; off?: boolean } = {}) {
  const script = opts.script ?? true;
  const origin = new URL(formSrc).origin;
  await page.route(`${LANDING}/**`, (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${LANDING_TITLE}</title></head>
<body><h1>Protege tu hogar</h1>
<iframe data-dapta-forms${opts.off ? ' data-dapta-forms-context="off"' : ''} src="${formSrc}"
        title="Cotiza" loading="lazy" style="width:100%;border:0;min-height:480px;"></iframe>
${script ? `<script src="${origin}/embed.js" async></script>` : ''}
</body></html>`,
    }),
  );
}

async function landingCookies(context: BrowserContext, cookies: Record<string, string>) {
  await context.addCookies(Object.entries(cookies).map(([name, value]) => ({ name, value, url: LANDING })));
}

async function submissions(request: APIRequestContext, formId: string): Promise<SubmissionItem[]> {
  const res = await request.get(`${API}/v1/forms/${formId}/submissions`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { items: SubmissionItem[] }).items;
}

/** The visit each destination row was enqueued with, by kind and phase. */
function outboxVisits(submissionId: string) {
  return query<{ kind: string; action: string; payload: string }>(
    `SELECT kind, action, payload FROM outbox WHERE kind IN ('webhook', 'hubspot') AND subject_uid = ?`,
    submissionId,
  ).map((r) => ({
    kind: r.kind,
    action: r.action,
    visit: (JSON.parse(r.payload) as { ctx: { visit?: Record<string, unknown> } }).ctx.visit,
  }));
}

/**
 * The form is interactive. Typing into the server-rendered markup before React
 * hydrates it loses the keystrokes (WebKit hydrates late enough to show it), so
 * wait for the page and its frame to go quiet first.
 */
async function hydrated(page: Page) {
  await page.waitForLoadState('networkidle');
}

async function answerOnePage(page: Page) {
  const form = page.frameLocator('iframe[data-dapta-forms]');
  const inputs = form.locator('.pf-v__question input');
  await expect(inputs.nth(0)).toBeVisible();
  await hydrated(page);
  await inputs.nth(0).fill('Laura Gómez');
  await inputs.nth(1).fill('laura@example.com');
  await form.locator('.pf-v__footer .pf__btn').click();
  await expect(form.locator('.pf-done__title')).toBeVisible();
}

test.beforeEach(async ({ context, browserName }) => {
  // See the header: a page served by the test itself reached no network
  // address, and Chromium asks before such a page loads one on this machine.
  if (browserName === 'chromium') await context.grantPermissions(['local-network-access']);
});

test.describe('embedded with the full snippet', () => {
  test('one page: the landing, its title, its campaign and its HubSpot cookie reach every surface', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const form = await createForm(request, 'full', { layout: 'vertical' });
    await landingCookies(context, { hubspotutk: HUTK });
    await serveLanding(page, `${baseURL}${form.path}?embed=1`);
    const asked: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes(CHALLENGE_HOST)) asked.push(r.url());
    });
    await page.goto(`${LANDING_URL}#cotiza`);
    await answerOnePage(page);

    await expect.poll(async () => (await submissions(request, form.id)).length).toBe(1);
    const [row] = await submissions(request, form.id);
    // The fragment is not part of the page; the rest is exactly the landing's.
    expect(row!.visit).toEqual({ pageUri: LANDING_URL, pageName: LANDING_TITLE, embedded: true, hubspotLinked: true });
    expect(row!.data.utm).toEqual(CAMPAIGN);
    // The dashboard never sees the cookie, only that one was linked.
    const raw = await (await request.get(`${API}/v1/forms/${form.id}/submissions`)).text();
    expect(raw).not.toContain(HUTK);

    const csv = (await (await request.get(`${API}/v1/forms/${form.id}/submissions.csv`)).text()).trim().split('\r\n');
    expect(csv[0]).toMatch(/,URL de la página$|,Page URL$/);
    expect(csv[1]!.endsWith(`,${LANDING_URL}`)).toBe(true);
    expect(csv.join('\n')).not.toContain(HUTK);

    // What the webhook delivers, and every retry of it: the page and the cookie.
    await expect.poll(() => outboxVisits(row!.id).length).toBeGreaterThan(0);
    expect(outboxVisits(row!.id)).toEqual([
      {
        kind: 'webhook',
        action: 'complete',
        visit: { pageUri: LANDING_URL, pageName: LANDING_TITLE, hutk: HUTK, embedded: true },
      },
    ]);
    expect(asked, 'no human check on a form without one').toEqual([]);
  });

  test('slides: the partial and the complete both carry the visit', async ({ page, context, request, baseURL }) => {
    const form = await createForm(request, 'slides', { partialSubmitAfterStep: 1 });
    await landingCookies(context, { hubspotutk: HUTK });
    await serveLanding(page, `${baseURL}${form.path}?embed=1`);
    await page.goto(LANDING_URL);
    const frame = page.frameLocator('iframe[data-dapta-forms]');
    await expect(frame.locator('.pf__fields input')).toBeVisible();
    await hydrated(page);
    await frame.locator('.pf__fields input').fill('Laura Gómez');
    await frame.locator('.pf__btn--inline').click();
    await frame.locator('input[type="email"]').fill('laura@example.com');
    await frame.locator('.pf__btn--inline').click();
    await expect(frame.locator('.pf-done__title')).toBeVisible();

    await expect.poll(async () => (await submissions(request, form.id))[0]?.completedAt ?? null).not.toBeNull();
    const [row] = await submissions(request, form.id);
    await expect.poll(() => outboxVisits(row!.id).map((d) => d.action).sort()).toEqual(['complete', 'partial']);
    for (const delivery of outboxVisits(row!.id)) {
      expect(delivery.visit, delivery.action).toMatchObject({ pageUri: LANDING_URL, hutk: HUTK, embedded: true });
    }
    expect(row!.data.utm).toEqual(CAMPAIGN);
  });

  test('a visitor who opted out of HubSpot tracking: the page, never the cookie', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const form = await createForm(request, 'optout', { layout: 'vertical' });
    await landingCookies(context, { hubspotutk: HUTK, __hs_opt_out: 'yes' });
    await serveLanding(page, `${baseURL}${form.path}?embed=1`);
    await page.goto(LANDING_URL);
    await answerOnePage(page);
    await expect.poll(async () => (await submissions(request, form.id)).length).toBe(1);
    const [row] = await submissions(request, form.id);
    expect(row!.visit).toEqual({ pageUri: LANDING_URL, pageName: LANDING_TITLE, embedded: true, hubspotLinked: false });
    await expect.poll(() => outboxVisits(row!.id).length).toBe(1);
    expect(outboxVisits(row!.id)[0]!.visit).not.toHaveProperty('hutk');
  });

  test('switched off on the iframe: nothing about the page is sent', async ({ page, context, request, baseURL }) => {
    const form = await createForm(request, 'off', { layout: 'vertical' });
    await landingCookies(context, { hubspotutk: HUTK });
    await serveLanding(page, `${baseURL}${form.path}?embed=1`, { off: true });
    await page.goto(LANDING_URL);
    await answerOnePage(page);
    await expect.poll(async () => (await submissions(request, form.id)).length).toBe(1);
    const [row] = await submissions(request, form.id);
    expect(row!.visit).toBeNull();
    expect(row!.data).not.toHaveProperty('utm');
    await expect.poll(() => outboxVisits(row!.id).length).toBe(1);
    expect(outboxVisits(row!.id)[0]!.visit).toBeUndefined();
  });
});

test.describe('without the full snippet', () => {
  test('a bare iframe: the landing origin from the referrer, no cookie, and the submit still goes', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const form = await createForm(request, 'bare', { layout: 'vertical' });
    await landingCookies(context, { hubspotutk: HUTK });
    await serveLanding(page, `${baseURL}${form.path}?embed=1`, { script: false });
    await page.goto(LANDING_URL);
    await answerOnePage(page);
    await expect.poll(async () => (await submissions(request, form.id)).length).toBe(1);
    const [row] = await submissions(request, form.id);
    // No title crossed: the dashboard names the page by its host.
    expect(row!.visit).toEqual({ pageUri: `${LANDING}/`, pageName: null, embedded: true, hubspotLinked: false });
    expect(row!.data).not.toHaveProperty('utm');
  });

  test('a direct link: the form page itself, without the prefill in its URL', async ({ page, request, baseURL }) => {
    const form = await createForm(request, 'direct', { layout: 'vertical' });
    await page.goto(`${form.path}?email=laura%40example.com&utm_source=newsletter`);
    const inputs = page.locator('.pf-v__question input');
    // The prefill lands with hydration: it is the sign the page is live.
    await expect(inputs.nth(1)).toHaveValue('laura@example.com');
    await inputs.nth(0).fill('Laura Gómez');
    await page.locator('.pf-v__footer .pf__btn').click();
    await expect(page.locator('.pf-done__title')).toBeVisible();
    await expect.poll(async () => (await submissions(request, form.id)).length).toBe(1);
    const [row] = await submissions(request, form.id);
    expect(row!.visit).toEqual({
      pageUri: `${baseURL}${form.path}?utm_source=newsletter`,
      pageName: form.title,
      embedded: false,
      hubspotLinked: false,
    });
  });
});

/** The provider's widget, replaced by one that passes at once (see v17). */
async function stubChallenge(page: Page) {
  await page.route(`https://${CHALLENGE_HOST}/**`, (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.turnstile = {
        render(el, opts) { setTimeout(() => opts.callback('XXXX.DUMMY.TOKEN.XXXX'), 50); return 'stub'; },
        reset() {}, remove() {},
      };`,
    }),
  );
}

test.describe('embedded, with spam protection on', () => {
  test.beforeEach(async ({ request }) => {
    const me = (await (await request.get(`${API}/v1/me`)).json()) as { captcha?: { available: boolean } };
    test.skip(!me.captcha?.available, 'boot the QA API with CAPTCHA_* keys to run this block');
  });

  test('one page, Strict: the check and the visit go in ONE complete, delivered with the visit', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const form = await createForm(request, 'strict', { layout: 'vertical', spamProtection: { captcha: true, strict: true } });
    await landingCookies(context, { hubspotutk: HUTK });
    await stubChallenge(page);
    await serveLanding(page, `${baseURL}${form.path}?embed=1`);
    await page.goto(LANDING_URL);
    // A person's pace: strict mode refuses a complete under 2 s from the view.
    await page.waitForTimeout(2_100);
    await answerOnePage(page);

    await expect.poll(async () => (await submissions(request, form.id))[0]?.completedAt ?? null).not.toBeNull();
    const [row] = await submissions(request, form.id);
    expect(row!.visit).toEqual({ pageUri: LANDING_URL, pageName: LANDING_TITLE, embedded: true, hubspotLinked: true });
    await expect.poll(() => outboxVisits(row!.id).length).toBe(1);
    expect(outboxVisits(row!.id)[0]).toMatchObject({ action: 'complete', visit: { hutk: HUTK, pageUri: LANDING_URL } });
  });

  test('slides, Automatic: the held partial keeps the visit, the verified complete delivers it', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const form = await createForm(request, 'auto', { partialSubmitAfterStep: 1, spamProtection: { captcha: true } });
    await landingCookies(context, { hubspotutk: HUTK });
    await stubChallenge(page);
    await serveLanding(page, `${baseURL}${form.path}?embed=1`);
    await page.goto(LANDING_URL);
    const frame = page.frameLocator('iframe[data-dapta-forms]');
    await expect(frame.locator('.pf__fields input')).toBeVisible();
    await hydrated(page);
    await frame.locator('.pf__fields input').fill('Laura Gómez');
    await frame.locator('.pf__btn--inline').click();
    await expect.poll(async () => (await submissions(request, form.id)).length).toBe(1);
    const [held] = await submissions(request, form.id);
    // Saved with its visit, delivered to nobody: a partial never meets the check.
    expect(held!.visit?.pageUri).toBe(LANDING_URL);
    expect(outboxVisits(held!.id)).toEqual([]);

    await frame.locator('input[type="email"]').fill('laura@example.com');
    await frame.locator('.pf__btn--inline').click();
    await expect(frame.locator('.pf-done__title')).toBeVisible();
    await expect.poll(() => outboxVisits(held!.id).map((d) => d.action)).toEqual(['complete']);
    expect(outboxVisits(held!.id)[0]!.visit).toMatchObject({ pageUri: LANDING_URL, hutk: HUTK });
  });
});
