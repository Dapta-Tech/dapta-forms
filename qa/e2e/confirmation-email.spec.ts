import { test, expect, type APIRequestContext } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Respondent confirmation email via the durable outbox (log-only provider in QA).
 *
 * A COMPLETED submission whose answers carry an email must enqueue TWO outbox
 * rows (kind `email`): `submission_confirmed` addressed to the respondent and
 * `submission_received` for the account owner. A partial-only session must
 * enqueue neither. The outbox worker (5s poll) must drain email rows to a
 * non-failed terminal status (log-only provider resolves success).
 *
 * Each test creates its own form via the admin API (unique name per run) and
 * scopes every DB assertion by a unique respondent email, so reruns are
 * idempotent and concurrent specs can't cross-contaminate.
 */

const API = 'http://localhost:4400';

const specDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(specDir, '../..');
const DB_PATH = path.join(repoRoot, '.data', 'qa.db');

// better-sqlite3 is hoisted into packages/db (pnpm), not the repo root — resolve
// it from there. READONLY connections only (never mutate the QA DB).
const dbRequire = createRequire(path.join(repoRoot, 'packages/db/package.json'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Database: any = dbRequire('better-sqlite3');

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

/** Email outbox rows for an action whose payload references `needle`. */
function emailOutboxRows(action: string, needle: string): EmailOutboxRow[] {
  return q((db) =>
    db
      .prepare(
        `SELECT id, kind, action, status, attempts, payload, last_error
           FROM outbox
          WHERE kind = 'email' AND action = ? AND payload LIKE ?
          ORDER BY created_at ASC`,
      )
      .all(action, `%${needle}%`),
  );
}

/** Minimal form: required email step + one single-select choice (auto-advances). */
function baseConfig(extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    cover: { enabled: true, headline: 'QA confirmation email', ctaText: 'Start' },
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
    ...extra,
  };
}

/**
 * Create a form via the admin API. The local-stub principal is NOT necessarily
 * the `acme` account, so resolve the public account code from the DB using the
 * accountId the API returns.
 */
async function createForm(
  request: APIRequestContext,
  name: string,
  config: Record<string, unknown>,
): Promise<{ id: string; slug: string; code: string }> {
  const res = await request.post(`${API}/v1/forms`, { data: { name, config } });
  expect(res.ok(), `POST /v1/forms failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const form = (await res.json()) as { id: string; slug: string; accountId: string };
  const account = q((db) =>
    db.prepare('SELECT code FROM account WHERE id = ?').get(form.accountId),
  ) as { code: string } | undefined;
  expect(account?.code, `no account code for accountId ${form.accountId}`).toBeTruthy();
  return { id: form.id, slug: form.slug, code: account!.code };
}

test('completed submission enqueues submission_confirmed to the respondent (plus owner notice)', async ({
  page,
  request,
}) => {
  const ts = Date.now();
  const email = `qa-confirm-${ts}@example.com`;
  const { code, slug } = await createForm(request, `qa-confirm-email-${ts}`, baseConfig());

  // Walk the public form to completion.
  await page.goto(`/${code}/me/${slug}`);
  await page.getByRole('button', { name: 'Start' }).click();
  await page.locator('input[type="email"]').fill(email);
  await page.locator('.pf__btn--inline').click();
  // Single-select choice auto-advances and, being the last step, submits.
  await page.getByRole('radio', { name: 'Option A' }).click();
  await expect(page.locator('.pf-done__title')).toBeVisible({ timeout: 15_000 });

  // Respondent confirmation row lands in the outbox (enqueued post-submit).
  await expect
    .poll(() => emailOutboxRows('submission_confirmed', email).length, {
      timeout: 15_000,
      message: `no outbox row kind=email action=submission_confirmed referencing ${email}`,
    })
    .toBeGreaterThan(0);

  const confirmed = emailOutboxRows('submission_confirmed', email);
  expect(confirmed).toHaveLength(1); // one submission -> exactly one receipt
  expect(confirmed[0].kind).toBe('email');
  const payload = JSON.parse(confirmed[0].payload ?? '{}') as {
    to?: string[];
    respondentEmail?: string;
    submissionId?: string;
  };
  // Addressed to the respondent, not the owner.
  expect(payload.to).toContain(email);
  expect(payload.respondentEmail).toBe(email);
  expect(payload.submissionId).toBeTruthy();

  // The owner notice (submission_received) was enqueued for the same submission.
  await expect
    .poll(() => emailOutboxRows('submission_received', email).length, {
      timeout: 10_000,
      message: `no outbox row action=submission_received referencing ${email}`,
    })
    .toBeGreaterThan(0);
  const received = emailOutboxRows('submission_received', email);
  const receivedPayload = JSON.parse(received[0].payload ?? '{}') as { submissionId?: string };
  expect(receivedPayload.submissionId).toBe(payload.submissionId);
});

test('partial-only session never enqueues submission_confirmed', async ({ page, request }) => {
  const ts = Date.now();
  const email = `qa-partial-${ts}@example.com`;
  const { id, code, slug } = await createForm(
    request,
    `qa-partial-email-${ts}`,
    baseConfig({ partialSubmitAfterStep: 1 }), // partial save fires after the email step
  );

  await page.goto(`/${code}/me/${slug}`);
  await page.getByRole('button', { name: 'Start' }).click();
  await page.locator('input[type="email"]').fill(email);
  await page.locator('.pf__btn--inline').click(); // completes step 1 -> fires the partial save
  await expect(page.getByRole('radio', { name: 'Option A' })).toBeVisible(); // on step 2

  // The partial submission landed server-side before we abandon the session.
  await expect
    .poll(
      () =>
        (q((db) => db.prepare('SELECT COUNT(*) AS n FROM submission WHERE form_id = ?').get(id)) as {
          n: number;
        }).n,
      { timeout: 10_000, message: 'partial submission row never persisted' },
    )
    .toBeGreaterThan(0);

  // Abandon: navigate away without finishing the form.
  await page.goto('about:blank');

  // Give the effects + a full worker cycle time to (wrongly) produce anything.
  await page.waitForTimeout(6_000);

  const sub = q((db) =>
    db.prepare('SELECT completed_at, partial_at FROM submission WHERE form_id = ?').get(id),
  ) as { completed_at: number | null; partial_at: number | null };
  expect(sub.completed_at).toBeNull(); // stayed partial — never completed
  expect(sub.partial_at).not.toBeNull();

  // No confirmation receipt for this session — and no owner notice either
  // (both are gated on a COMPLETED submission).
  expect(emailOutboxRows('submission_confirmed', email)).toHaveLength(0);
  expect(emailOutboxRows('submission_received', email)).toHaveLength(0);
});

test('worker drains email outbox rows to a non-failed terminal status', async ({ request }) => {
  const ts = Date.now();
  const email = `qa-worker-${ts}@example.com`;
  const { code, slug } = await createForm(request, `qa-worker-email-${ts}`, baseConfig());

  // Complete a submission via the public API (no browser needed for this check).
  const res = await request.post(`${API}/v1/public/forms/${code}/${slug}/submissions`, {
    data: { sessionId: `qa-worker-${ts}`, data: { email, pick: 'a' } },
  });
  expect(res.ok(), `public submit failed: ${res.status()} ${await res.text()}`).toBeTruthy();

  // Both email rows exist AND leave `pending` (worker polls every 5s;
  // the log-only provider resolves success, so no row may end up `failed`).
  await expect
    .poll(
      () => {
        const rows = [
          ...emailOutboxRows('submission_confirmed', email),
          ...emailOutboxRows('submission_received', email),
        ];
        if (rows.length < 2) return `waiting: ${rows.length}/2 rows enqueued`;
        if (rows.some((r) => r.status === 'pending')) {
          return `still pending: ${rows.map((r) => `${r.action}=${r.status}`).join(', ')}`;
        }
        return 'processed';
      },
      { timeout: 20_000, message: 'email outbox rows never left pending' },
    )
    .toBe('processed');

  const rows = [
    ...emailOutboxRows('submission_confirmed', email),
    ...emailOutboxRows('submission_received', email),
  ];
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(row.status, `${row.action} last_error=${row.last_error}`).not.toBe('failed');
    // Log-only provider: success ('done') or a deliberate 'skipped' are the
    // only acceptable terminal states.
    expect(['done', 'skipped']).toContain(row.status);
    expect(row.attempts).toBeLessThanOrEqual(1);
  }
});
