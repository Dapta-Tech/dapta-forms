import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * N6 — WEBHOOK PER-EVENT TRIGGERS (partial vs complete).
 *
 * A webhook destination may carry an optional `events: ('partial'|'complete')[]`
 * filter (absent/empty = both phases, back-compat). `destinationFiresForPhase`
 * (@quill/types) gates the enqueue in DestinationEffects, so a submission only
 * fans out to the webhook for a phase the destination subscribes to.
 *
 *   1. events:['complete'] → a COMPLETE submit enqueues one `outbox` webhook row
 *      (kind='webhook', action='complete'); a PARTIAL submit enqueues NONE.
 *   2. events:['partial']  → the reverse: PARTIAL enqueues one row, COMPLETE none.
 *      (The pre-loop reconsideration in enqueueSubmissionDeliveries runs for
 *      every destination kind, but both of its moves are scoped to the phase
 *      being enqueued, so the complete pass can only reach `action='complete'`
 *      rows and the partial row survives on that action scoping, asserted per
 *      action.)
 *   3. UI — /admin/forms/:id/integrations: the webhook card shows Partial/Complete
 *      checkboxes; unchecking one is allowed, unchecking the LAST one is blocked
 *      (≥1 stays checked).
 *
 * Tests 1–2 are API-level: submit partial:true then partial:false for the SAME
 * session (one submission row → a stable outbox `subject_uid`) and assert on the
 * durable outbox rows via a readonly better-sqlite3 connection. The outbox worker
 * only marks status (never deletes), so a row's mere existence — regardless of
 * whether the worker has drained it — is the enqueue fact under test.
 *
 * Each test creates its OWN published form via the admin API with a per-run
 * unique name so reruns stay idempotent (fresh form/session/submission ids each
 * run; prior runs' rows are keyed by prior submission ids and never collide).
 * The public account code is resolved from GET /v1/me (NOT hardcoded `acme`).
 */

const API = 'http://localhost:4400';
// Loopback webhook target: the QA env is non-production, so the SSRF guard
// permits localhost (allowLocalhost=true) and the schema allows plain http for
// localhost. Delivery outcome is irrelevant — the assertion is on the ENQUEUE.
const WEBHOOK_URL = 'http://localhost:4400/health';

// ESM-safe __dirname; resolve the QA SQLite DB relative to this spec.
const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(SPEC_DIR, '../../.data/qa.db');

// better-sqlite3 is kept under packages/db by pnpm (not hoisted) — resolve it
// through the workspace package that owns it.
const requireFromDb = createRequire(path.resolve(SPEC_DIR, '../../packages/db/package.json'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Database = requireFromDb('better-sqlite3') as new (
  filename: string,
  options?: { readonly?: boolean },
) => {
  prepare(sql: string): { get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
  close(): void;
};

// A per-run token (random, not Date.now) so every rerun mints fresh form names
// → fresh slugs/ids → idempotent outbox assertions.
const RUN = randomUUID().slice(0, 8);
const formName = (label: string): string => `QA webhook-events ${label} ${RUN}`;

interface OutboxWebhookRow {
  action: string;
  status: string;
  payload: string;
}

/** Every webhook outbox row for a submission (its stable subject_uid). */
function webhookRows(submissionId: string): OutboxWebhookRow[] {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return db
      .prepare(
        `SELECT action, status, payload
           FROM outbox
          WHERE kind = 'webhook' AND subject_uid = ?
          ORDER BY created_at ASC`,
      )
      .all(submissionId) as OutboxWebhookRow[];
  } finally {
    db.close();
  }
}

/** How many webhook rows a submission enqueued for a given phase (action). */
function countByAction(submissionId: string, action: 'partial' | 'complete'): number {
  return webhookRows(submissionId).filter((r) => r.action === action).length;
}

/** The public account code of the admin principal (local stub — NOT `acme`). */
async function accountCode(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API}/v1/me`);
  expect(res.status(), 'GET /v1/me should resolve the principal').toBe(200);
  const me = (await res.json()) as { accountShortCode?: string; accountCode?: string };
  const code = me.accountShortCode ?? me.accountCode;
  expect(code, '/v1/me must expose an account code').toBeTruthy();
  return code as string;
}

/**
 * Form config with a single enabled webhook destination. `events` omitted =
 * both phases (back-compat); pass a subset to restrict. `partialSubmitAfterStep`
 * is set so a partial phase is meaningful (the API `partial` flag drives the
 * enqueue directly at this level).
 */
function webhookConfig(events?: ('partial' | 'complete')[]): Record<string, unknown> {
  const webhook: Record<string, unknown> = {
    type: 'webhook',
    enabled: true,
    settings: { url: WEBHOOK_URL },
  };
  if (events) webhook.events = events;
  return {
    version: 1,
    cover: { enabled: true, headline: 'QA webhook events', ctaText: 'Start' },
    steps: [{ key: 'email', type: 'email', question: 'Work email?', required: true }],
    partialSubmitAfterStep: 1,
    destinations: [webhook],
  };
}

async function createForm(
  request: APIRequestContext,
  name: string,
  config: Record<string, unknown>,
): Promise<{ id: string; slug: string }> {
  const res = await request.post(`${API}/v1/forms`, { data: { name, config } });
  if (res.status() !== 201) {
    throw new Error(`POST /v1/forms failed: ${res.status()} ${await res.text()}`);
  }
  return (await res.json()) as { id: string; slug: string };
}

/** Publish so the public submit endpoint (getPublishedForm) serves the form. */
async function publish(request: APIRequestContext, id: string): Promise<void> {
  const res = await request.post(`${API}/v1/forms/${id}/publish`);
  if (res.status() !== 201) {
    throw new Error(`POST /v1/forms/${id}/publish failed: ${res.status()} ${await res.text()}`);
  }
}

/** Public submission (partial or complete). Returns the persisted submission id. */
async function submit(
  request: APIRequestContext,
  code: string,
  slug: string,
  sessionId: string,
  partial: boolean,
): Promise<{ id: string; score: number; outcome: string | null }> {
  const res = await request.post(`${API}/v1/public/forms/${code}/${slug}/submissions`, {
    data: { sessionId, data: { email: 'qa-webhook@example.com' }, partial },
  });
  if (res.status() !== 201) {
    throw new Error(`submit(partial=${partial}) failed: ${res.status()} ${await res.text()}`);
  }
  return (await res.json()) as { id: string; score: number; outcome: string | null };
}

test.describe('N6 — webhook per-event triggers', () => {
  test("events:['complete'] enqueues a webhook row for the COMPLETE phase only, never the partial", async ({
    request,
  }) => {
    const code = await accountCode(request);
    const form = await createForm(request, formName('complete-only'), webhookConfig(['complete']));
    await publish(request, form.id);

    // Same session → one submission row → a stable subject_uid across phases.
    const sessionId = randomUUID();
    const partialRes = await submit(request, code, form.slug, sessionId, true);
    const completeRes = await submit(request, code, form.slug, sessionId, false);
    expect(completeRes.id, 'partial + complete share one submission').toBe(partialRes.id);
    const submissionId = completeRes.id;

    // The COMPLETE phase enqueues exactly one webhook outbox row...
    await expect
      .poll(() => countByAction(submissionId, 'complete'), {
        timeout: 10_000,
        message: 'complete phase must enqueue exactly one webhook row',
      })
      .toBe(1);
    // ...and the PARTIAL phase enqueued NONE (events:['complete'] skips partials).
    expect(countByAction(submissionId, 'partial'), 'partial phase must enqueue no webhook row').toBe(
      0,
    );

    // The persisted row's phase is 'complete' on both the action column AND the
    // payload's captured context; the destination's events filter is serialized.
    const rows = webhookRows(submissionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('complete');
    const payload = JSON.parse(rows[0].payload) as {
      ctx: { phase: string };
      destination: { type: string; events?: string[] };
    };
    expect(payload.ctx.phase).toBe('complete');
    expect(payload.destination.type).toBe('webhook');
    expect(payload.destination.events).toEqual(['complete']);
  });

  test("events:['partial'] enqueues a webhook row for the PARTIAL phase only, never the complete", async ({
    request,
  }) => {
    const code = await accountCode(request);
    const form = await createForm(request, formName('partial-only'), webhookConfig(['partial']));
    await publish(request, form.id);

    const sessionId = randomUUID();
    const partialRes = await submit(request, code, form.slug, sessionId, true);
    const completeRes = await submit(request, code, form.slug, sessionId, false);
    expect(completeRes.id, 'partial + complete share one submission').toBe(partialRes.id);
    const submissionId = completeRes.id;

    // The PARTIAL phase enqueues exactly one webhook outbox row...
    await expect
      .poll(() => countByAction(submissionId, 'partial'), {
        timeout: 10_000,
        message: 'partial phase must enqueue exactly one webhook row',
      })
      .toBe(1);
    // ...and the COMPLETE phase enqueued NONE. The complete pass still runs the
    // pre-loop reconsideration (it runs for every destination kind, whether or
    // not one fires), but both of its moves are scoped to `action='complete'`,
    // so neither can reach the partial row above: distinct action,
    // distinct row.
    expect(countByAction(submissionId, 'complete'), 'complete phase must enqueue no webhook row').toBe(
      0,
    );

    const rows = webhookRows(submissionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('partial');
    const payload = JSON.parse(rows[0].payload) as {
      ctx: { phase: string };
      destination: { type: string; events?: string[] };
    };
    expect(payload.ctx.phase).toBe('partial');
    expect(payload.destination.type).toBe('webhook');
    expect(payload.destination.events).toEqual(['partial']);
  });

  test('integrations UI: webhook card shows Partial/Complete checkboxes and blocks unchecking the last one', async ({
    page,
    request,
  }) => {
    // `events` omitted = both phases → both event checkboxes start checked.
    const form = await createForm(request, formName('ui-events'), webhookConfig());
    await page.goto(`/admin/forms/${form.id}/integrations`);

    const partial = page.getByRole('checkbox', { name: 'Partial submissions', exact: true });
    const complete = page.getByRole('checkbox', { name: 'Complete submissions', exact: true });

    // The enabled webhook card renders both event checkboxes, both checked.
    await expect(partial).toBeVisible();
    await expect(complete).toBeVisible();
    await expect(partial).toBeChecked();
    await expect(complete).toBeChecked();

    // Unchecking ONE is allowed: drop 'partial'; 'complete' stays on.
    await partial.click();
    await expect(partial).not.toBeChecked();
    await expect(complete).toBeChecked();

    // Unchecking the LAST one is blocked — ≥1 must stay checked. Clicking
    // 'complete' now is a no-op: the controlled input reverts to checked and
    // 'partial' remains off.
    await complete.click();
    await expect(complete).toBeChecked();
    await expect(partial).not.toBeChecked();
  });
});
