import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * V3 W7 — PER-FORM email template overrides (editor → Connect → Emails).
 *
 * A form can pin its own copy of either submission email, overriding the
 * account template (Typeform's per-form Follow-ups model). Send-time
 * precedence is form → account → stock, per field; the copy in effect is
 * SNAPSHOTTED onto the durable outbox payload exactly like the account
 * overrides (v2-notifications.spec.ts — outbox evidence mirrored here):
 *
 *   1. Connect tab → Emails: both cards default to "Using the account
 *      template"; customizing `submission_confirmed` stores a per-form
 *      override (badge flips, API reports it) WITHOUT touching the account
 *      settings.
 *   2. A completed public submission carrying an email enqueues the
 *      confirmation with the FORM override as subjectTemplate.
 *   3. "Use account template" (branded confirm dialog) removes the override;
 *      the next submission snapshots the account/stock template again (null).
 *   4. The Account settings → Notifications page still works after the shared
 *      editor refactor: load, save round-trip, reset (+ the new muted note
 *      that forms can override from their Connect tab).
 *
 * Account-level settings are normalized before/after (this suite runs
 * single-worker, so briefly customizing the account keys in (4) is safe).
 */

const API = 'http://localhost:4400';
const WEB = 'http://localhost:3400';

// EN i18n the QA env renders (packages/shared admin.notifications + editor.connect).
const CONFIRMED_TITLE = 'Respondent confirmation'; // submission_confirmed card title
const OWNER_TITLE = 'New submission notice'; // submission_received (Settings round-trip)
const USING_ACCOUNT = 'Using the account template';
const CUSTOM_BADGE = 'Custom for this form';
const SETTINGS_SAVE = 'Save changes';
const SETTINGS_RESET = 'Reset to default';
const SETTINGS_CUSTOMIZED = 'Customized';
const SETTINGS_USING_DEFAULT = 'Using default';

const specDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(specDir, '../..');
const DB_PATH = path.join(repoRoot, '.data', 'qa.db');

// better-sqlite3 is hoisted into packages/db (pnpm), not the repo root — resolve
// it from there. READONLY connections only (never mutate the QA DB directly).
const dbRequire = createRequire(path.join(repoRoot, 'packages/db/package.json'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Database: any = dbRequire('better-sqlite3');

// Per-run identity (NOT Date.now): a random tag + a monotonic counter make every
// form name / respondent email unique per run. Form names start with `v3w7-` so
// derived slugs carry this workstream's prefix.
const RUN = randomUUID().slice(0, 8);
let seq = 0;
const uid = (label: string) => `v3w7-${RUN}-${label}-${++seq}`;

interface EmailOutboxRow {
  id: string;
  action: string;
  status: string;
  payload: string | null;
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
        `SELECT id, action, status, payload
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

/** Force an ACCOUNT key back to the shipped default (enabled, no override). */
async function normalizeAccount(request: APIRequestContext, key: string): Promise<void> {
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
    cover: { enabled: true, headline: 'V3 W7 form emails', ctaText: 'Start' },
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

interface FormNotificationView {
  emailKey: string;
  account: { enabled: boolean; subject: string | null; body: string | null };
  override: { enabled: boolean; subject: string | null; body: string | null } | null;
}

async function formSetting(
  request: APIRequestContext,
  formId: string,
  key: string,
): Promise<FormNotificationView> {
  const res = await request.get(`${API}/v1/forms/${formId}/notifications`);
  expect(res.ok(), `GET /v1/forms/${formId}/notifications ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { settings: FormNotificationView[] };
  const s = body.settings.find((x) => x.emailKey === key);
  expect(s, `form notification setting ${key} missing`).toBeTruthy();
  return s!;
}

/** Complete the public flow once with the given respondent email. */
async function submitPublicForm(page: Page, publicUrl: string, email: string): Promise<void> {
  await page.goto(publicUrl);
  await page.getByRole('button', { name: 'Start' }).click();
  await page.locator('input[type="email"]').fill(email);
  await page.locator('.pf__btn--inline').click();
  await page.getByRole('radio', { name: 'Option A' }).click();
  await expect(page.locator('.pf-done__title')).toBeVisible({ timeout: 15_000 });
}

/** The Settings card for one email, scoped by its (unique) heading. */
function settingsCard(page: Page, title: string): Locator {
  return page
    .locator('div.p-5')
    .filter({ has: page.getByRole('heading', { level: 3, name: title, exact: true }) });
}

test.beforeAll(async ({ request }) => {
  await normalizeAccount(request, 'submission_received');
  await normalizeAccount(request, 'submission_confirmed');
});

test.afterAll(async ({ request }) => {
  await normalizeAccount(request, 'submission_received');
  await normalizeAccount(request, 'submission_confirmed');
});

test('per-form override: customize → outbox snapshots it → reset → account/stock again', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(150_000);
  const code = await accountCode(request);
  const form = await createForm(request, uid('form'));
  const publicUrl = `${WEB}/${code}/me/${form.slug}`;
  const customSubject = 'V3 override {{formName}}';

  // --- Connect tab → Emails: both cards default to "using account template".
  await page.goto(`/admin/forms/${form.id}/edit?tab=connect`);
  const section = page.getByTestId('connect-emails');
  await expect(section).toBeVisible();
  const card = page.getByTestId('connect-email-submission_confirmed');
  await expect(card).toBeVisible();
  await expect(card.getByText(CONFIRMED_TITLE)).toBeVisible();
  await expect(page.getByTestId('connect-email-badge-submission_confirmed')).toHaveText(
    USING_ACCOUNT,
  );
  await expect(page.getByTestId('connect-email-badge-submission_received')).toHaveText(
    USING_ACCOUNT,
  );
  // Collapsed state previews the effective account/stock subject (sample-interpolated).
  await expect(
    page.getByTestId('connect-email-account-preview-submission_confirmed'),
  ).toContainText('We got your responses: Lead Qualifier');

  // --- Customize the respondent confirmation subject for THIS form only.
  await page.getByTestId('connect-email-customize-submission_confirmed').click();
  const subjectInput = page.getByTestId('connect-email-submission_confirmed-subject');
  await expect(subjectInput).toHaveValue('We got your responses: {{formName}}'); // prefilled from account/stock
  await subjectInput.fill(customSubject);
  await page.getByTestId('connect-email-save-submission_confirmed').click();
  await expect(page.getByTestId('connect-email-badge-submission_confirmed')).toHaveText(
    CUSTOM_BADGE,
    { timeout: 10_000 },
  );

  // The override reached the API — and the ACCOUNT surface stayed untouched.
  await expect
    .poll(
      async () => (await formSetting(request, form.id, 'submission_confirmed')).override?.subject,
      { timeout: 10_000, message: 'form override never persisted' },
    )
    .toBe(customSubject);
  const accountRes = await request.get(`${API}/v1/notifications`);
  const accountSettings = (await accountRes.json()) as {
    settings: Array<{ emailKey: string; subject: string | null }>;
  };
  expect(
    accountSettings.settings.find((s) => s.emailKey === 'submission_confirmed')!.subject,
  ).toBeNull();

  // --- Publish (no-op without a pending draft; overrides live OUTSIDE the config)
  // and complete a public submission carrying a respondent email.
  const pub = await request.post(`${API}/v1/forms/${form.id}/publish`);
  expect(pub.ok(), `publish failed: ${pub.status()}`).toBeTruthy();
  const email1 = `${uid('a')}@example.com`;
  await submitPublicForm(page, publicUrl, email1);

  // Outbox evidence (mirrors v2-notifications): the confirmation is enqueued with
  // the FORM override snapshotted as subjectTemplate.
  await expect
    .poll(() => confirmedRows(email1).length, {
      timeout: 15_000,
      message: `no outbox row kind=email action=submission_confirmed referencing ${email1}`,
    })
    .toBeGreaterThan(0);
  const rows1 = confirmedRows(email1);
  expect(rows1).toHaveLength(1);
  const payload1 = JSON.parse(rows1[0]!.payload ?? '{}') as {
    subjectTemplate?: string | null;
    formName?: string;
    respondentEmail?: string;
    to?: string[];
  };
  expect(payload1.subjectTemplate).toBe(customSubject);
  expect(payload1.formName).toBe(form.name);
  expect(payload1.to).toContain(email1);
  expect(interpolate(payload1.subjectTemplate!, { formName: payload1.formName! })).toBe(
    `V3 override ${form.name}`,
  );

  // --- Reset to the account template (branded confirm dialog), fresh page load
  // proves the override state was persisted (editor reopens with the override).
  await page.goto(`/admin/forms/${form.id}/edit?tab=connect`);
  await expect(page.getByTestId('connect-email-badge-submission_confirmed')).toHaveText(
    CUSTOM_BADGE,
  );
  await expect(page.getByTestId('connect-email-submission_confirmed-subject')).toHaveValue(
    customSubject,
  );
  await page.getByTestId('connect-email-use-account-submission_confirmed').click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await page.getByTestId('confirm-dialog-confirm').click();
  await expect(page.getByTestId('confirm-dialog')).toBeHidden();
  await expect(page.getByTestId('connect-email-badge-submission_confirmed')).toHaveText(
    USING_ACCOUNT,
    { timeout: 10_000 },
  );
  await expect
    .poll(async () => (await formSetting(request, form.id, 'submission_confirmed')).override, {
      timeout: 10_000,
      message: 'reset did not remove the form override',
    })
    .toBeNull();

  // --- A NEW submission (fresh context = fresh session) snapshots the
  // account/stock template again: null subjectTemplate → stock copy at send.
  const email2 = `${uid('b')}@example.com`;
  const ctx2 = await browser.newContext();
  try {
    await submitPublicForm(await ctx2.newPage(), publicUrl, email2);
  } finally {
    await ctx2.close();
  }
  await expect
    .poll(() => confirmedRows(email2).length, {
      timeout: 15_000,
      message: `no outbox row for the post-reset submission ${email2}`,
    })
    .toBeGreaterThan(0);
  const payload2 = JSON.parse(confirmedRows(email2)[0]!.payload ?? '{}') as {
    subjectTemplate?: string | null;
    bodyTemplate?: string | null;
  };
  expect(payload2.subjectTemplate ?? null).toBeNull(); // account normalized → stock
  expect(payload2.bodyTemplate ?? null).toBeNull();
});

test('Account settings → Notifications still works: load, save round-trip, reset', async ({
  page,
  request,
}) => {
  const customSubject = `V3 settings ${RUN} {{formName}}`;

  await page.goto('/admin/account/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications', level: 2 })).toBeVisible();
  // The new muted pointer: forms can override from their Connect tab.
  await expect(page.getByTestId('notifications-form-override-note')).toBeVisible();

  // Load: the owner card hydrates with the shipped default and previews live.
  const card = settingsCard(page, OWNER_TITLE);
  await expect(card).toBeVisible();
  await expect(card.locator('input')).toHaveValue('New submission: {{formName}}');
  await expect(card.getByText(SETTINGS_USING_DEFAULT)).toBeVisible();

  // Save round-trip.
  await card.locator('input').fill(customSubject);
  await card.getByRole('button', { name: SETTINGS_SAVE }).click();
  await expect(card.getByText(SETTINGS_CUSTOMIZED)).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(
      async () => {
        const res = await request.get(`${API}/v1/notifications`);
        const body = (await res.json()) as {
          settings: Array<{ emailKey: string; subject: string | null }>;
        };
        return body.settings.find((s) => s.emailKey === 'submission_received')!.subject;
      },
      { timeout: 10_000, message: 'account subject never persisted' },
    )
    .toBe(customSubject);

  // Persists across a reload, then resets to the shipped default (confirm dialog).
  await page.reload();
  const reloaded = settingsCard(page, OWNER_TITLE);
  await expect(reloaded.locator('input')).toHaveValue(customSubject);
  await reloaded.getByRole('button', { name: SETTINGS_RESET }).click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await page.getByTestId('confirm-dialog-confirm').click();
  await expect(page.getByTestId('confirm-dialog')).toBeHidden();
  await expect(reloaded.locator('input')).toHaveValue('New submission: {{formName}}', {
    timeout: 10_000,
  });
  await expect(reloaded.getByText(SETTINGS_USING_DEFAULT)).toBeVisible();
});
