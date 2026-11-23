import { test, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The referral program's happy path, end to end on the local stack.
 *
 *  1. A referrer opens the dashboard: the left menu reads "Invite friends 0/5",
 *     the top banner is up, its "Remove the badge" opens the share dialog, and
 *     the link is copied to the clipboard.
 *  2. A NEW person opens that link and signs up, and lands in the dashboard.
 *  3. Back as the referrer: the count reads 1/5, and the outbox holds the
 *     `referral_joined` countdown email for the referrer, drained by the worker.
 *
 * Needs the API booted with `REFERRAL_PROGRAM=true`. The QA boot leaves it off
 * (the banner would otherwise sit on top of every admin page the other specs
 * drive), so this spec skips with a pointer when the program is off:
 *
 *   REFERRAL_PROGRAM=true bash qa/dev-sqlite.sh
 *
 * Local auth note. With `AUTH_PROVIDER=local` the root page is the OSS landing
 * and `/api/auth/login` bounces straight to `/login`: the IAM round trip that
 * parks `?ref=` in the `quill_attribution` cookie and posts it from
 * `/api/auth/callback` only exists in the workos flavor. So step 2 opens the
 * real link, signs up through the real local login screen, and then sends the
 * exact request the callback sends, `POST /v1/me/referral/claim {code}` as the
 * new person, inside their first ten minutes. Everything after that request
 * (crediting, the count, the email) is the production code path.
 *
 * Under test: apps/api/src/referral.service.ts (`me`, `claimByLink`,
 * `afterCredit`), apps/api/src/email-effects.ts (`enqueueReferralJoined`),
 * apps/web/components/admin-shell.tsx (`ReferralNavEntry`),
 * apps/web/components/referral/{referral-banner,referral-share-modal}.tsx.
 */

const API = 'http://localhost:4400';

// The rail and the mobile drawer both render the entry; the visible one is the one a person sees.
const NAV_ENTRY = '[data-testid="nav-referral"]:visible';
const NAV_PROGRESS = '[data-testid="nav-referral-progress"]:visible';

const specDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(specDir, '../..');
const DB_PATH = path.join(repoRoot, '.data', 'qa.db');

// better-sqlite3 is hoisted into packages/db (pnpm), not the repo root. READONLY
// connections only: the spec never writes the QA database.
const dbRequire = createRequire(path.join(repoRoot, 'packages/db/package.json'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Database: any = dbRequire('better-sqlite3');

interface OutboxRow {
  action: string;
  status: string;
  subject_uid: string;
  payload: string | null;
}

/** The referrer's `referral_joined` email rows, read on a fresh readonly connection. */
function referralJoinedRows(referrerKey: string): OutboxRow[] {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return db
      .prepare(
        `SELECT action, status, subject_uid, payload FROM outbox
          WHERE kind = 'email' AND action = 'referral_joined' AND subject_uid = ?
          ORDER BY created_at DESC`,
      )
      .all(referrerKey) as OutboxRow[];
  } finally {
    db.close();
  }
}

/** A brand-new dev identity. The API's local stub JIT-creates its workspace. */
function freshEmail(tag: string): string {
  return `qa-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@referral.test`;
}

interface MeReferral {
  enabled: boolean;
  link?: string;
  count?: number;
  goal?: number;
}

async function meReferral(request: APIRequestContext, email: string): Promise<MeReferral> {
  const res = await request.get(`${API}/v1/me`, { headers: { 'x-quill-email': email } });
  expect(res.ok(), `GET /v1/me as ${email}`).toBeTruthy();
  return ((await res.json()) as { referral: MeReferral }).referral;
}

/** Sign the browser in as `email` through the real local-dev login screen. */
async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await Promise.all([page.waitForURL(/\/(admin|onboarding)/), page.click('button[type="submit"]')]);
}

/**
 * Get past the first-run wizard to the dashboard. The wizard is not under test
 * here, so it is finished the way its last screen finishes it, by the API.
 */
async function toDashboard(page: Page, request: APIRequestContext, email: string): Promise<void> {
  const me = await request.get(`${API}/v1/me`, { headers: { 'x-quill-email': email } });
  if (((await me.json()) as { onboardingRequired?: boolean }).onboardingRequired) {
    const res = await request.post(`${API}/v1/account/onboarding/complete`, {
      headers: { 'x-quill-email': email },
      data: { template: 'lead-qualifier' },
    });
    expect(res.ok(), 'finish onboarding').toBeTruthy();
  }
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/?$/);
  await expect(page.locator(NAV_ENTRY)).toBeVisible();
}

async function newPage(browser: Browser, clipboard = false): Promise<Page> {
  const context = await browser.newContext({ baseURL: 'http://localhost:3400' });
  if (clipboard) await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  return context.newPage();
}

test.describe('referral program, happy path', () => {
  test.beforeAll(async ({ request }) => {
    const probe = await meReferral(request, freshEmail('probe'));
    test.skip(
      !probe.enabled,
      'The referral program is off on this QA server. Boot it with REFERRAL_PROGRAM=true bash qa/dev-sqlite.sh',
    );
  });

  test('a referrer copies the link, a new person signs up with it, the count and the email follow', async ({
    browser,
    request,
  }) => {
    test.setTimeout(90_000);
    const referrerEmail = freshEmail('referrer');
    const refereeEmail = freshEmail('referee');

    // 1. The referrer, a new person with no referrals yet.
    const referrer = await newPage(browser, true);
    await signIn(referrer, referrerEmail);
    await toDashboard(referrer, request, referrerEmail);

    const expected = await meReferral(request, referrerEmail);
    expect(expected.enabled).toBe(true);
    expect(expected.count).toBe(0);
    const link = expected.link!;
    expect(link).toMatch(/\/\?ref=[a-z0-9]{8}$/);
    const code = new URL(link).searchParams.get('ref')!;

    const nav = referrer.locator(NAV_ENTRY);
    await expect(nav).toContainText('Invite friends');
    await expect(referrer.locator(NAV_PROGRESS)).toHaveText('0/5');

    const banner = referrer.getByTestId('referral-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('data-count', '0');

    await referrer.getByTestId('referral-banner-cta').click();
    const modal = referrer.getByTestId('referral-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId('referral-progress')).toHaveText('0 of 5');
    await expect(modal.getByTestId('referral-link')).toHaveValue(link);

    const copy = modal.getByTestId('referral-copy');
    await expect(copy).toHaveText('Copy link');
    await copy.click();
    await expect(copy).toHaveText('Copied');
    expect(await referrer.evaluate(() => navigator.clipboard.readText())).toBe(link);
    await modal.getByTestId('referral-close').click();
    await expect(modal).toBeHidden();

    // 2. A new person opens the link and signs up.
    const referee = await newPage(browser);
    const opened = await referee.goto(new URL(link).pathname + new URL(link).search);
    expect(opened?.status(), 'the referral link opens').toBe(200);
    await signIn(referee, refereeEmail);
    // What /api/auth/callback posts after an IAM sign-in (see the header note).
    const claim = await request.post(`${API}/v1/me/referral/claim`, {
      headers: { 'x-quill-email': refereeEmail },
      data: { code },
    });
    expect(claim.ok()).toBeTruthy();
    expect(await claim.json()).toEqual({ credited: true });
    await toDashboard(referee, request, refereeEmail);
    await expect(referee.locator(NAV_PROGRESS)).toHaveText('0/5');

    // 3. Back as the referrer: the count moved, and the countdown email is queued.
    expect((await meReferral(request, referrerEmail)).count).toBe(1);
    await referrer.goto('/admin');
    await expect(referrer.locator(NAV_PROGRESS)).toHaveText('1/5');
    await expect(referrer.getByTestId('referral-banner')).toHaveAttribute('data-count', '1');

    const referrerKey = `email:${referrerEmail}`;
    await expect
      .poll(() => referralJoinedRows(referrerKey).length, { timeout: 15_000, message: 'referral_joined row' })
      .toBe(1);
    const [row] = referralJoinedRows(referrerKey);
    const payload = JSON.parse(row!.payload ?? '{}') as { to?: string; count?: number; goal?: number; share?: { link?: string } };
    expect(payload).toMatchObject({ to: referrerEmail, count: 1, goal: 5 });
    expect(payload.share?.link).toBe(link);
    // The worker drains it through the log-only provider.
    await expect
      .poll(() => referralJoinedRows(referrerKey)[0]?.status, { timeout: 20_000, message: 'outbox worker delivery' })
      .toBe('done');

    await referrer.context().close();
    await referee.context().close();
  });
});
