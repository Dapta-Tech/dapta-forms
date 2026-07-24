import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * V4-04 / V4-16, re-based on the single reveal model.
 *
 * A reveal is a STEP now — there is no form-level `config.reveal` to enable in
 * Design and no draggable marker to position. What survives from V4-04 is the
 * guarantee it was written for: a form whose reveal was authored the OLD way
 * still plays it right before the result and never mid-form. So these specs pin
 * the MIGRATION instead of the marker.
 *
 * Three independent journeys through the real HTTP surface (fresh form per test
 * via the admin API; slug prefixed `v4rev-`; accountCode resolved from
 * GET /v1/me — never hardcoded; the DB is only written through the app):
 *
 *  (a) A legacy reveal-enabled 3-question form opens in the builder as a reveal
 *      CARD at the END of the question list, and the public form plays NO reveal
 *      between questions — only after the final one, right before the result.
 *  (b) Opening the builder autosaves that fold-in: the draft gains a `reveal`
 *      step carrying the legacy copy and LOSES `reveal`/`revealAfterStep`, so
 *      the two ways to author one screen cannot coexist (asserted via
 *      GET /v1/forms/:id draftConfig).
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

/** Shape of a pending draft, reduced to what the migration is judged on. */
interface DraftShape {
  /** Step types in order — a `reveal` among them is the migrated card. */
  types: string[];
  /** The reveal step's own copy (undefined when there is no reveal step). */
  revealCopy?: {
    enabled?: boolean;
    headline?: string | null;
    subtitle?: string | null;
    durationMs?: number;
  };
  /** Whether the LEGACY form-level fields are still present. */
  legacyReveal: boolean;
  legacyPosition: boolean;
}

/** The pending draft reduced to `DraftShape` (null while no draft exists yet). */
async function draftShape(
  request: APIRequestContext,
  formId: string,
): Promise<DraftShape | null> {
  const res = await request.get(`${API}/v1/forms/${formId}`);
  if (!res.ok()) return null;
  const body = (await res.json()) as {
    draftConfig?: {
      steps?: Array<{ type: string; reveal?: DraftShape['revealCopy'] }>;
      reveal?: unknown;
      revealAfterStep?: unknown;
    } | null;
  };
  const draft = body.draftConfig;
  if (draft == null) return null;
  const steps = draft.steps ?? [];
  return {
    types: steps.map((s) => s.type),
    revealCopy: steps.find((s) => s.type === 'reveal')?.reveal,
    legacyReveal: draft.reveal != null,
    legacyPosition: draft.revealAfterStep != null,
  };
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

test('a legacy reveal opens as a card at the END; the public form plays no mid-form reveal', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const code = await accountCode(request);
  const form = await createForm(request, revealConfig());

  // --- Editor: the legacy reveal is now a CARD, last in the question list -----
  await page.goto(`/admin/forms/${form.id}/edit`);
  const spine = page.getByTestId('question-spine');
  // It names itself by its headline (a reveal has no question text), and there
  // is no separate marker row any more — one reveal, one card.
  const card = spine.getByText('Reviewing your answers…', { exact: true });
  await expect(card).toBeVisible();
  await expect(page.getByTestId('reveal-point-row')).toHaveCount(0);

  const q1 = spine.getByText('First question', { exact: true });
  const q3 = spine.getByText('Third question', { exact: true });
  // Folded in at the end: the card sits BELOW the last question.
  expect(await centerY(card)).toBeGreaterThan(await centerY(q3));
  expect(await centerY(card)).toBeGreaterThan(await centerY(q1));

  // Selecting it shows the real interstitial on the canvas — spinner and all —
  // not a question card with an empty answer box.
  await card.click();
  await expect(page.getByTestId('canvas-reveal-preview')).toBeVisible();
  await expect(page.getByTestId('canvas-reveal-spinner')).toBeVisible();

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

test('opening the builder folds the legacy reveal into a step and drops the legacy fields', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  // Pinned mid-form (after question 2) so the fold-in has a real position to
  // preserve — an "always appends at the end" bug would pass without this.
  const form = await createForm(request, { ...revealConfig(), revealAfterStep: 2 });

  await page.goto(`/admin/forms/${form.id}/edit`);
  await expect(page.getByTestId('question-spine')).toBeVisible();

  await expect
    .poll(() => draftShape(request, form.id), {
      message: 'opening the builder should autosave the migrated shape',
      timeout: 20_000,
      intervals: [500, 1_000],
    })
    .toEqual({
      // The reveal landed exactly where it used to play, not at the end.
      types: ['text', 'text', 'reveal', 'text'],
      revealCopy: {
        enabled: true,
        headline: 'Reviewing your answers…',
        subtitle: '',
        durationMs: 1200,
      },
      // Both legacy fields are gone, so nothing can play the reveal twice.
      legacyReveal: false,
      legacyPosition: false,
    });
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
