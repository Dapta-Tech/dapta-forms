import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * V4-04 / V4-16 — the reveal screen has a POSITION (config.revealAfterStep) that
 * is authoritative, visible, and draggable, defaulting to the END of the form so
 * an enabled reveal never plays mid-form by accident; and each outcome can carry
 * its own thank-you body (config.outcomes[].message).
 *
 * Three independent journeys prove it through the real HTTP surface (fresh form
 * per test via the admin API; slug prefixed `v4rev-`; accountCode resolved from
 * GET /v1/me — never hardcoded; the DB is only written through the app):
 *
 *  (a) A reveal-enabled 3-question form shows the "Reveal screen" marker in the
 *      question spine defaulted to AFTER THE LAST question, and the public form
 *      plays NO reveal between questions — only after the final question, right
 *      before the result (the mid-form-reveal bug is gone).
 *  (b) Dragging the marker up one slot (dnd-kit keyboard path) autosaves an
 *      explicit revealAfterStep (asserted via GET /v1/forms/:id draftConfig).
 *  (c) A per-outcome message typed in Results autosaves, and after publishing a
 *      submission that lands in that outcome shows the message (interpolated) as
 *      the done-screen body.
 */

const API = 'http://localhost:4400';

/** Per-run nonce so reruns mint distinct forms (Date.now is banned in specs). */
const RUN = randomUUID().slice(0, 8);
let formSeq = 0;

/** The admin principal's public account code (NOT hardcoded `acme`). */
async function accountCode(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API}/v1/me`);
  expect(res.ok(), 'GET /v1/me should resolve the local principal').toBeTruthy();
  const me = (await res.json()) as { accountCode?: string; accountShortCode?: string };
  const code = me.accountCode ?? me.accountShortCode;
  expect(code, '/v1/me must expose an account code').toBeTruthy();
  return code as string;
}

/** Create a fresh, immediately-live form (POST writes live config). */
async function createForm(
  request: APIRequestContext,
  config: Record<string, unknown>,
): Promise<{ id: string; slug: string }> {
  formSeq += 1;
  const name = `v4rev-${RUN}-w${test.info().workerIndex}-${formSeq}`;
  const res = await request.post(`${API}/v1/forms`, { data: { name, config } });
  expect(res.ok(), `form creation failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; slug: string };
  expect(body.slug.startsWith('v4rev-'), `slug must carry the v4rev- prefix: ${body.slug}`).toBe(true);
  return body;
}

/** A reveal-enabled form with three plain text questions (no explicit position). */
function revealConfig(): Record<string, unknown> {
  return {
    version: 1,
    cover: { enabled: true, headline: 'Reveal position QA', ctaText: 'Start' },
    steps: [
      { key: 'q1', type: 'text', question: 'First question', required: true },
      { key: 'q2', type: 'text', question: 'Second question', required: true },
      { key: 'q3', type: 'text', question: 'Third question', required: true },
    ],
    scoring: { enabled: true },
    outcomes: [{ id: 'default', label: 'All done', minScore: -100 }],
    // Enabled, but NO revealAfterStep and NO triggersReveal → engine defaults it
    // to after the last question.
    reveal: { enabled: true, headline: 'Reviewing your answers…', durationMs: 1200 },
  };
}

/** The pending draft's revealAfterStep (null = no draft yet, 'unset' = absent). */
async function draftReveal(
  request: APIRequestContext,
  formId: string,
): Promise<number | 'no-draft' | 'unset'> {
  const res = await request.get(`${API}/v1/forms/${formId}`);
  if (!res.ok()) return 'no-draft';
  const body = (await res.json()) as { draftConfig?: { revealAfterStep?: number } | null };
  if (body.draftConfig == null) return 'no-draft';
  return body.draftConfig.revealAfterStep ?? 'unset';
}

/** Vertical center of a locator — used to assert the marker's slot in the spine. */
async function centerY(loc: Locator): Promise<number> {
  const box = await loc.boundingBox();
  expect(box, 'element should be laid out').toBeTruthy();
  return box!.y + box!.height / 2;
}

/**
 * The public surface is per-IP rate-limited and every concurrent QA spec shares
 * the browser-origin bucket; a transient 429 leaves the cover unrendered. Retry
 * the initial fetch with a refill pause, then start the flow.
 */
async function openCover(page: Page, url: string): Promise<void> {
  const start = page.getByRole('button', { name: 'Start' });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.goto(url);
    const visible = await start
      .waitFor({ state: 'visible', timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (visible) {
      await start.click();
      return;
    }
    await page.waitForTimeout(2_000); // let the shared token bucket refill
  }
  throw new Error('form cover never rendered (public form fetch likely rate-limited)');
}

/** Fill the current text step and click its inline Continue button. */
async function fillAndContinue(page: Page, value: string): Promise<void> {
  const input = page.locator('input[type="text"]');
  await expect(input).toBeVisible();
  await input.fill(value);
  await page.locator('.pf__btn--inline').first().click();
}

test('reveal marker defaults to the END; the public form plays no mid-form reveal', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const code = await accountCode(request);
  const form = await createForm(request, revealConfig());

  // --- Editor: the reveal marker renders defaulted AFTER the last question ----
  await page.goto(`/admin/forms/${form.id}/edit`);
  const spine = page.getByTestId('question-spine');
  const marker = page.getByTestId('reveal-point-row');
  await expect(marker).toBeVisible();

  const q1 = spine.getByText('First question', { exact: true });
  const q3 = spine.getByText('Third question', { exact: true });
  // Defaulted to the end: the marker sits BELOW the last question card.
  expect(await centerY(marker)).toBeGreaterThan(await centerY(q3));
  expect(await centerY(marker)).toBeGreaterThan(await centerY(q1));

  // --- Public: no reveal between questions, only after the LAST one -----------
  await openCover(page, `/${code}/me/${form.slug}`);
  await expect(page.locator('.pf__question')).toHaveText('First question');
  await fillAndContinue(page, 'one');
  // Straight to Q2 — the reveal must NOT play mid-form.
  await expect(page.locator('.pf__question')).toHaveText('Second question');
  await expect(page.locator('.pf-reveal__headline')).toHaveCount(0);
  await fillAndContinue(page, 'two');
  await expect(page.locator('.pf__question')).toHaveText('Third question');
  await expect(page.locator('.pf-reveal__headline')).toHaveCount(0);

  // Completing the LAST question plays the reveal as the pre-result interstitial…
  await fillAndContinue(page, 'three');
  await expect(page.locator('.pf-reveal__headline')).toBeVisible({ timeout: 3_000 });
  // …then it hands off to the thank-you screen on its own.
  await expect(page.locator('.pf-done__title')).toBeVisible({ timeout: 8_000 });
});

test('dragging the reveal marker up one slot autosaves an explicit revealAfterStep', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const form = await createForm(request, revealConfig());

  await page.goto(`/admin/forms/${form.id}/edit`);
  const spine = page.getByTestId('question-spine');
  const marker = page.getByTestId('reveal-point-row');
  await expect(marker).toBeVisible();

  const q2 = spine.getByText('Second question', { exact: true });
  const q3 = spine.getByText('Third question', { exact: true });
  // Starts at the end (below Q3).
  expect(await centerY(marker)).toBeGreaterThan(await centerY(q3));

  // Move the marker one slot UP via dnd-kit's keyboard path (deterministic).
  const handle = page.getByTestId('reveal-point-handle');
  await handle.focus();
  await page.keyboard.press('Space'); // pick up
  await page.waitForTimeout(300);
  await page.keyboard.press('ArrowUp'); // over question 3
  await page.waitForTimeout(300);
  await page.keyboard.press('Space'); // drop → now after question 2

  await expect
    .poll(() => draftReveal(request, form.id), {
      message: 'moving the marker up one slot should autosave revealAfterStep: 2',
      timeout: 15_000,
      intervals: [500, 1_000],
    })
    .toBe(2);

  // The marker now sits between Q2 and Q3.
  expect(await centerY(marker)).toBeGreaterThan(await centerY(q2));
  expect(await centerY(marker)).toBeLessThan(await centerY(q3));
});

test('a per-outcome message is editable, autosaves, and shows on the done screen', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const code = await accountCode(request);
  // email + a scored choice; two ranges so a 10-point pick lands in "High".
  const form = await createForm(request, {
    version: 1,
    cover: { enabled: true, headline: 'Outcome message QA', ctaText: 'Start' },
    steps: [
      { key: 'email', type: 'email', question: 'Your email?', required: true },
      {
        key: 'pick',
        type: 'multiple_choice',
        question: 'Pick one',
        flowGroup: 'qualification',
        options: [
          { label: 'Alpha', value: 'alpha', points: 10 },
          { label: 'Beta', value: 'beta', points: 0 },
        ],
      },
    ],
    scoring: { enabled: true },
    outcomes: [
      { id: 'low', label: 'Nurture', minScore: 0 },
      { id: 'high', label: 'Priority lead', minScore: 5 },
    ],
  });

  // --- Editor: type a message on the HIGH range in Results --------------------
  await page.goto(`/admin/forms/${form.id}/edit?tab=results`);
  const rows = page.getByTestId('outcome-row');
  await expect(rows).toHaveCount(2); // sorted ascending → [Nurture(0), Priority(5)]
  const message = 'You booked a spot at [email] — talk soon!';
  await rows.nth(1).getByTestId('outcome-message').fill(message);

  // Autosaves onto the HIGH outcome's draft.
  await expect
    .poll(
      async () => {
        const res = await request.get(`${API}/v1/forms/${form.id}`);
        if (!res.ok()) return null;
        const body = (await res.json()) as {
          draftConfig?: { outcomes?: Array<{ id: string; message?: string }> } | null;
        };
        return body.draftConfig?.outcomes?.find((o) => o.id === 'high')?.message ?? null;
      },
      { message: 'the message should autosave on the high outcome', timeout: 15_000, intervals: [500, 1_000] },
    )
    .toBe(message);

  // Publish the draft so the public form serves the message.
  const pub = await request.post(`${API}/v1/forms/${form.id}/publish`);
  expect(pub.ok(), `publish failed: ${pub.status()}`).toBeTruthy();

  // --- Public: a high-scoring submission shows the interpolated message -------
  const email = `qa-outcome-msg-${RUN}@example.com`;
  await openCover(page, `/${code}/me/${form.slug}`);
  await expect(page.locator('.pf__question')).toHaveText('Your email?');
  const emailInput = page.locator('input[type="email"]');
  await emailInput.fill(email);
  await page.locator('.pf__btn--inline').first().click();

  // The choice auto-advances on select; the 10-point pick lands in "Priority".
  await expect(page.locator('.pf__question')).toHaveText('Pick one');
  await page.getByRole('radio', { name: 'Alpha' }).click();

  // Done screen: heading = outcome label, body = the interpolated message.
  await expect(page.locator('.pf-done__title')).toHaveText('Priority lead', { timeout: 12_000 });
  await expect(page.locator('.pf-done__body')).toHaveText(
    `You booked a spot at ${email} — talk soon!`,
  );
});
