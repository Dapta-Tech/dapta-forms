import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * N5 — editable email templates (Settings → Notifications).
 *
 * The two submission emails (`submission_received` = owner notice,
 * `submission_confirmed` = respondent receipt) are per-account customizable:
 * a toggle plus an optional subject/body override with `{{token}}` markers.
 * A stored subject/body of `null` means "shipped default" (the send path falls
 * back to the code template). These specs exercise:
 *   1. API contract of GET /v1/notifications (two settings + defaults + tokens).
 *   2. The Settings UI renders both editable cards (toggle/subject/body/chips/
 *      live preview).
 *   3. Editing the owner subject interpolates live, persists across a reload,
 *      and resets cleanly to the shipped default.
 *   4. A custom `submission_confirmed` subject is snapshotted onto the durable
 *      outbox payload when a public submission with an email completes.
 *
 * Notification settings are ACCOUNT-scoped (not per-form), so this spec is the
 * one mutator of the two keys: `beforeAll`/`afterAll` normalize both back to the
 * shipped default (enabled, null override) so reruns are idempotent and the env
 * is left clean for the other specs (which assume default copy).
 */

const API = 'http://localhost:4400';

// EN i18n labels the Settings → Notifications UI renders (packages/shared i18n
// `admin.notifications`; the QA env locale is `en`).
const OWNER_TITLE = 'New submission notice'; // submission_received
const RESPONDENT_TITLE = 'Respondent confirmation'; // submission_confirmed
const SAVE = 'Save changes';
const RESET = 'Reset to default';
const CUSTOMIZED = 'Customized';
const USING_DEFAULT = 'Using default';

// Illustrative preview sample the client renders (apps/web/lib/notification-preview.ts
// NOTIFICATION_SAMPLE). Interpolating a default template must surface these.
const SAMPLE_FORM_NAME = 'Lead Qualifier';
const SAMPLE_FORM_LINK = 'https://forms.example.com/acme/lead-qualifier';
const SAMPLE_RESPONDENT_EMAIL = 'lead@acme.io';

const specDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(specDir, '../..');
const DB_PATH = path.join(repoRoot, '.data', 'qa.db');

// better-sqlite3 is hoisted into packages/db (pnpm), not the repo root — resolve
// it from there. READONLY connections only (never mutate the QA DB directly).
const dbRequire = createRequire(path.join(repoRoot, 'packages/db/package.json'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Database: any = dbRequire('better-sqlite3');

// Per-run identity (NOT Date.now): a random tag makes form names / respondent
// emails / the custom subject unique per run, plus a monotonic counter so each
// created artifact is distinct within the run.
const RUN = randomUUID().slice(0, 8);
let seq = 0;
const uid = (label: string) => `qa-n5-${RUN}-${label}-${++seq}`;

interface EmailOutboxRow {
  id: string;
  kind: string;
  action: string;
  status: string;
  attempts: number;
  payload: string | null;
  last_error: string | null;
}

/** Run a query on a fresh readonly connection (always sees latest commits). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function q<T>(fn: (db: any) => T): T {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** submission_confirmed email outbox rows whose payload references `needle`. */
function confirmedRows(needle: string): EmailOutboxRow[] {
  return q((db) =>
    db
      .prepare(
        `SELECT id, kind, action, status, attempts, payload, last_error
           FROM outbox
          WHERE kind = 'email' AND action = 'submission_confirmed' AND payload LIKE ?
          ORDER BY created_at ASC`,
      )
      .all(`%${needle}%`),
  );
}

/** Single-pass token substitution — mirrors the server's interpolateTokens. */
function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z][A-Za-z0-9_]*)\s*\}\}/g, (whole, name: string) =>
    values[name] === undefined ? whole : values[name],
  );
}

interface NotificationSettingView {
  emailKey: string;
  enabled: boolean;
  subject: string | null;
  body: string | null;
  tokens: string[];
  defaults: { en: { subject: string; body: string }; es: { subject: string; body: string } };
}

async function getNotifications(request: APIRequestContext): Promise<NotificationSettingView[]> {
  const res = await request.get(`${API}/v1/notifications`);
  expect(res.ok(), `GET /v1/notifications ${res.status()}`).toBeTruthy();
  return ((await res.json()) as { settings: NotificationSettingView[] }).settings;
}

async function settingFor(
  request: APIRequestContext,
  key: string,
): Promise<NotificationSettingView> {
  const s = (await getNotifications(request)).find((x) => x.emailKey === key);
  expect(s, `notification setting ${key} missing`).toBeTruthy();
  return s!;
}

/** Force a key back to the shipped default (enabled, no override). */
async function normalize(request: APIRequestContext, key: string): Promise<void> {
  const res = await request.put(`${API}/v1/notifications/${key}`, {
    data: { enabled: true, subject: null, body: null },
  });
  expect(res.ok(), `PUT /v1/notifications/${key} normalize ${res.status()}`).toBeTruthy();
}

/** The public account code for the local-stub principal (never hardcoded). */
async function accountCode(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API}/v1/me`);
  expect(res.ok(), `GET /v1/me ${res.status()}`).toBeTruthy();
  const me = (await res.json()) as { accountCode: string };
  expect(me.accountCode).toBeTruthy();
  return me.accountCode;
}

/** Minimal public form: required email step + a single-select choice. */
function baseConfig() {
  return {
    version: 1,
    cover: { enabled: true, headline: 'QA N5 notifications', ctaText: 'Start' },
    steps: [
      { key: 'email', type: 'email', question: 'Your email?', required: true },
      {
        key: 'pick',
        type: 'multiple_choice',
        question: 'Pick one',
        options: [
          { label: 'Option A', value: 'a' },
          { label: 'Option B', value: 'b' },
        ],
      },
    ],
  };
}

async function createForm(
  request: APIRequestContext,
  name: string,
): Promise<{ id: string; slug: string; name: string }> {
  const res = await request.post(`${API}/v1/forms`, { data: { name, config: baseConfig() } });
  expect(res.ok(), `POST /v1/forms ${res.status()} ${await res.text()}`).toBeTruthy();
  const form = (await res.json()) as { id: string; slug: string };
  return { id: form.id, slug: form.slug, name };
}

/** The editable card for one email, scoped by its (unique) heading. */
function cardByTitle(page: Page, title: string): Locator {
  return page
    .locator('div.p-5')
    .filter({ has: page.getByRole('heading', { level: 3, name: title, exact: true }) });
}

test.beforeAll(async ({ request }) => {
  await normalize(request, 'submission_received');
  await normalize(request, 'submission_confirmed');
});

test.afterAll(async ({ request }) => {
  await normalize(request, 'submission_received');
  await normalize(request, 'submission_confirmed');
});

test('GET /v1/notifications returns the two settings with defaults + token catalog', async ({
  request,
}) => {
  const settings = await getNotifications(request);

  // Exactly the two customizable submission emails.
  expect(settings.map((s) => s.emailKey).sort()).toEqual([
    'submission_confirmed',
    'submission_received',
  ]);

  const expectedTokens = ['formName', 'respondentEmail', 'score', 'outcomeLabel', 'formLink'];
  for (const s of settings) {
    expect(typeof s.enabled, `${s.emailKey}.enabled`).toBe('boolean');
    expect(s.tokens, `${s.emailKey}.tokens`).toEqual(expectedTokens);
    // Both locales' shipped default copy travel with the setting.
    expect(s.defaults.en.subject).toContain('{{formName}}');
    expect(s.defaults.en.body.length).toBeGreaterThan(0);
    expect(s.defaults.es.subject).toContain('{{formName}}');
    expect(s.defaults.es.body.length).toBeGreaterThan(0);
  }

  // Normalized to defaults by beforeAll — no active override.
  const owner = settings.find((s) => s.emailKey === 'submission_received')!;
  const respondent = settings.find((s) => s.emailKey === 'submission_confirmed')!;
  expect(owner.subject).toBeNull();
  expect(owner.body).toBeNull();
  expect(respondent.subject).toBeNull();
  // The two defaults are the shipped English copy.
  expect(owner.defaults.en.subject).toBe('New submission — {{formName}}');
  expect(respondent.defaults.en.subject).toBe('We got your responses — {{formName}}');
});

test('Settings → Notifications renders both cards with toggle, subject, body, chips, preview', async ({
  page,
}) => {
  await page.goto('/admin/settings');

  await expect(page.getByRole('heading', { name: 'Notifications', level: 2 })).toBeVisible();

  for (const { title, defaultSubject } of [
    { title: OWNER_TITLE, defaultSubject: 'New submission — {{formName}}' },
    { title: RESPONDENT_TITLE, defaultSubject: 'We got your responses — {{formName}}' },
  ]) {
    const card = cardByTitle(page, title);
    await expect(card).toBeVisible();

    // Enable toggle.
    await expect(card.getByRole('switch')).toBeVisible();
    // Subject input (hydrated with the shipped default) + body textarea.
    await expect(card.locator('input')).toHaveValue(defaultSubject);
    await expect(card.locator('textarea')).toBeVisible();
    // The five {{token}} chips.
    await expect(card.locator('button[title]')).toHaveCount(5);
    await expect(card.locator('button[title="{{formName}}"]')).toBeVisible();
    // Live preview: the {{formLink}} token interpolated to the sample value.
    await expect(card.getByText('Preview', { exact: true })).toBeVisible();
    await expect(card.getByText(SAMPLE_FORM_LINK)).toBeVisible();
  }

  // The owner preview additionally interpolates {{respondentEmail}} (its default
  // body carries that token; the respondent default does not).
  await expect(cardByTitle(page, OWNER_TITLE).getByText(SAMPLE_RESPONDENT_EMAIL)).toBeVisible();
});

test('editing the owner subject previews live, persists across reload, and resets to default', async ({
  page,
  request,
}) => {
  const defaultSubject = (await settingFor(request, 'submission_received')).defaults.en.subject;
  const customSubject = 'Custom {{formName}} notice';
  const interpolated = interpolate(customSubject, { formName: SAMPLE_FORM_NAME });

  await page.goto('/admin/settings');
  const card = cardByTitle(page, OWNER_TITLE);
  await expect(card).toBeVisible();

  // (3) Edit the subject; the live preview interpolates the sample formName.
  await card.locator('input').fill(customSubject);
  await expect(card.getByText(interpolated)).toBeVisible();

  // Save; the badge flips from "Using default" to "Customized".
  await card.getByRole('button', { name: SAVE }).click();
  await expect(card.getByText(CUSTOMIZED)).toBeVisible({ timeout: 10_000 });

  // The override reached the API.
  await expect
    .poll(async () => (await settingFor(request, 'submission_received')).subject, {
      timeout: 10_000,
      message: 'custom subject never persisted to GET /v1/notifications',
    })
    .toBe(customSubject);

  // (4) Reload — the stored subject re-hydrates the input, still "Customized".
  await page.reload();
  const reloaded = cardByTitle(page, OWNER_TITLE);
  await expect(reloaded.locator('input')).toHaveValue(customSubject);
  await expect(reloaded.getByText(CUSTOMIZED)).toBeVisible();

  // (5) Reset — subject returns to the shipped default (API shows subject null).
  page.once('dialog', (d) => void d.accept()); // confirm() guard on Reset
  await reloaded.getByRole('button', { name: RESET }).click();
  await expect(reloaded.locator('input')).toHaveValue(defaultSubject, { timeout: 10_000 });
  await expect(reloaded.getByText(USING_DEFAULT)).toBeVisible();

  await expect
    .poll(async () => (await settingFor(request, 'submission_received')).subject, {
      timeout: 10_000,
      message: 'reset did not null the override',
    })
    .toBeNull();
});

test('a custom submission_confirmed subject is snapshotted onto the outbox email payload', async ({
  page,
  request,
}) => {
  const code = await accountCode(request);
  const form = await createForm(request, uid('form'));
  const email = `${uid('confirm')}@example.com`;
  const customSubject = `QA confirmed [${RUN}] {{formName}}`;

  // Set the respondent-confirmation subject override via the API.
  const put = await request.put(`${API}/v1/notifications/submission_confirmed`, {
    data: { subject: customSubject },
  });
  expect(put.ok(), `PUT submission_confirmed ${put.status()}`).toBeTruthy();
  const putBody = (await put.json()) as { subject: string | null; enabled: boolean };
  expect(putBody.subject).toBe(customSubject);
  expect(putBody.enabled, 'confirmation email must stay enabled to send').toBe(true);

  // Submit the form on the public side, carrying the respondent email.
  await page.goto(`/${code}/me/${form.slug}`);
  await page.getByRole('button', { name: 'Start' }).click();
  await page.locator('input[type="email"]').fill(email);
  await page.locator('.pf__btn--inline').click();
  await page.getByRole('radio', { name: 'Option A' }).click();
  await expect(page.locator('.pf-done__title')).toBeVisible({ timeout: 15_000 });

  // The confirmation email is enqueued to the durable outbox with the custom copy
  // snapshotted (subjectTemplate + the raw formName it interpolates against).
  await expect
    .poll(() => confirmedRows(email).length, {
      timeout: 15_000,
      message: `no outbox row kind=email action=submission_confirmed referencing ${email}`,
    })
    .toBeGreaterThan(0);

  const rows = confirmedRows(email);
  expect(rows).toHaveLength(1);
  const payload = JSON.parse(rows[0].payload ?? '{}') as {
    subjectTemplate?: string | null;
    bodyTemplate?: string | null;
    formName?: string;
    respondentEmail?: string;
    to?: string[];
  };

  // The payload carries the custom subject and the form name it renders with; the
  // notifier interpolates them at send time to the custom (interpolated) subject.
  expect(payload.subjectTemplate).toBe(customSubject);
  expect(payload.bodyTemplate ?? null).toBeNull(); // only the subject was overridden
  expect(payload.formName).toBe(form.name);
  expect(payload.respondentEmail).toBe(email);
  expect(payload.to).toContain(email);
  expect(interpolate(payload.subjectTemplate!, { formName: payload.formName! })).toBe(
    `QA confirmed [${RUN}] ${form.name}`,
  );
});
