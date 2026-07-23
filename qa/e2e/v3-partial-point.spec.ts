import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * V3 — the Partial Submit Point is a visible, movable marker in the editor's
 * question spine (Typeform parity), and it drives the real runtime threshold.
 *
 * One end-to-end journey proves the whole loop:
 *   1. (editor) A form with 3 questions and NO threshold shows the dashed
 *      "+ Partial submit point" affordance; clicking it drops the marker AFTER
 *      question 1 (the selected step) — asserted visually (the marker card sits
 *      between Q1 and Q2) and durably (autosaved draftConfig.partialSubmitAfterStep
 *      === 1 via GET /v1/forms/:id).
 *   2. (editor) The marker MOVES through the same dnd-kit list as questions —
 *      exercised via dnd-kit's keyboard path (focus grip → Space picks up →
 *      ArrowDown → Space drops), deterministic under Playwright. The draft
 *      threshold becomes 2 and the marker renders between Q2 and Q3.
 *   3. (runtime) After publishing, answering THROUGH question 2 on the public
 *      form writes ONE partial submission row — polled through the admin
 *      submissions API with the `status=partial` filter (the same surface the
 *      marker's info popover points users to).
 *   4. (editor) The marker's × removes it: the add affordance returns and the
 *      autosaved draft carries NO partialSubmitAfterStep.
 *
 * Conventions: fresh form per run via the admin API (slug prefixed `v3w6-`,
 * per-run nonce — reruns never collide); accountCode resolved from GET /v1/me
 * (never hardcoded); the DB is only written through the app's HTTP surface;
 * transient public 429s (shared per-IP bucket across parallel QA suites) are
 * retried on the cover.
 */

const API = 'http://localhost:4400';

/** Per-run nonce so reruns mint distinct forms (Date.now is banned in specs). */
const RUN = randomUUID().slice(0, 8);
let formSeq = 0;

/** Three plain questions — the threshold is authored in the UI, not here. */
function buildConfig() {
  return {
    version: 1,
    cover: { enabled: true, headline: 'Partial point QA', ctaText: 'Start' },
    steps: [
      { key: 'email', type: 'email', question: 'Your work email?', required: true },
      { key: 'firstname', type: 'text', question: 'Your first name?', required: true },
      { key: 'company', type: 'text', question: 'Your company?', required: true },
    ],
    scoring: { enabled: true },
    outcomes: [{ id: 'default', label: 'Thanks', minScore: -100 }],
  };
}

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
async function createForm(request: APIRequestContext): Promise<{ id: string; slug: string }> {
  formSeq += 1;
  const name = `v3w6-partial-point-${RUN}-w${test.info().workerIndex}-${formSeq}`;
  const res = await request.post(`${API}/v1/forms`, { data: { name, config: buildConfig() } });
  expect(res.ok(), `form creation failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; slug: string };
  expect(body.slug.startsWith('v3w6-'), `slug must carry the v3w6- prefix: ${body.slug}`).toBe(true);
  return body;
}

/** The pending draft's partialSubmitAfterStep (null = no draft yet). */
async function draftThreshold(
  request: APIRequestContext,
  formId: string,
): Promise<number | 'no-draft' | 'unset'> {
  const res = await request.get(`${API}/v1/forms/${formId}`);
  if (!res.ok()) return 'no-draft';
  const body = (await res.json()) as { draftConfig?: { partialSubmitAfterStep?: number } | null };
  if (body.draftConfig == null) return 'no-draft';
  return body.draftConfig.partialSubmitAfterStep ?? 'unset';
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
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.goto(url);
    const visible = await start
      .waitFor({ state: 'visible', timeout: 4_000 })
      .then(() => true)
      .catch(() => false);
    if (visible) {
      await start.click();
      return;
    }
    await page.waitForTimeout(2_500); // let the shared token bucket refill
  }
  throw new Error('form cover never rendered (public form fetch likely rate-limited)');
}

/** Fill the current step's input and click its inline Continue button. */
async function fillAndContinue(page: Page, selector: string, value: string): Promise<void> {
  const input = page.locator(selector);
  await expect(input).toBeVisible();
  await input.fill(value);
  await page.locator('.pf__btn--inline').first().click();
}

test('partial submit point: add in spine → keyboard-drag down → publish → runtime partial → remove clears config', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000); // one full editor→runtime→editor journey + rate-limit headroom
  const code = await accountCode(request);
  const form = await createForm(request);

  // --- 1) Editor: the add affordance places the marker after question 1 -----
  await page.goto(`/admin/forms/${form.id}/edit`);
  const spine = page.getByTestId('question-spine'); // left question list (lg layout)
  const addBtn = page.getByTestId('partial-point-add');
  const marker = page.getByTestId('partial-point-row');
  await expect(addBtn).toBeVisible();
  await expect(marker).toHaveCount(0);

  await addBtn.click();
  await expect(marker).toBeVisible();
  await expect(addBtn).toHaveCount(0); // affordance swaps for the marker

  // Visually AFTER Q1 and BEFORE Q2 in the spine.
  const q1 = spine.getByText('Your work email?', { exact: true });
  const q2 = spine.getByText('Your first name?', { exact: true });
  const q3 = spine.getByText('Your company?', { exact: true });
  expect(await centerY(marker)).toBeGreaterThan(await centerY(q1));
  expect(await centerY(marker)).toBeLessThan(await centerY(q2));

  // Durably autosaved: the draft carries threshold 1.
  await expect
    .poll(() => draftThreshold(request, form.id), {
      message: 'autosave should store partialSubmitAfterStep: 1 in the draft',
      timeout: 15_000,
      intervals: [500, 1_000],
    })
    .toBe(1);

  // --- 2) Move the marker one slot down via dnd-kit's keyboard path ---------
  const handle = page.getByTestId('partial-point-handle');
  await handle.focus();
  await page.keyboard.press('Space'); // pick up
  await page.waitForTimeout(300);
  await page.keyboard.press('ArrowDown'); // over question 2
  await page.waitForTimeout(300);
  await page.keyboard.press('Space'); // drop
  await expect
    .poll(() => draftThreshold(request, form.id), {
      message: 'moving the marker should autosave partialSubmitAfterStep: 2',
      timeout: 15_000,
      intervals: [500, 1_000],
    })
    .toBe(2);
  expect(await centerY(marker)).toBeGreaterThan(await centerY(q2));
  expect(await centerY(marker)).toBeLessThan(await centerY(q3));

  // --- 3) Publish, then cross the threshold on the public form --------------
  const pub = await request.post(`${API}/v1/forms/${form.id}/publish`);
  expect(pub.ok(), `publish failed: ${pub.status()}`).toBeTruthy();

  const email = `qa-partial-point-${RUN}@example.com`;
  await openCover(page, `/${code}/me/${form.slug}`);
  await expect(page.locator('.pf__question')).toHaveText('Your work email?');
  await fillAndContinue(page, 'input[type="email"]', email);
  await expect(page.locator('.pf__question')).toHaveText('Your first name?');
  await fillAndContinue(page, 'input[type="text"]', 'Josue'); // completes step 2 = threshold
  await expect(page.locator('.pf__question')).toHaveText('Your company?');

  // Linger on step 3 (never finish) and poll the ADMIN submissions API with the
  // Partial filter — the exact surface the marker's popover points users to.
  await expect
    .poll(
      async () => {
        const res = await request.get(`${API}/v1/forms/${form.id}/submissions?status=partial`);
        if (!res.ok()) return -1;
        const body = (await res.json()) as { items: Array<{ data?: Record<string, unknown> }> };
        return body.items.filter((it) => it.data?.email === email).length;
      },
      {
        message: 'crossing the threshold should persist exactly one PARTIAL row',
        timeout: 25_000,
        intervals: [1_000, 2_000],
      },
    )
    .toBe(1);

  // --- 4) Editor: removing the marker clears the config ---------------------
  await page.goto(`/admin/forms/${form.id}/edit`); // publish cleared the draft → live config (threshold 2) loads
  await expect(marker).toBeVisible();
  await page.getByTestId('partial-point-remove').click();
  await expect(marker).toHaveCount(0);
  await expect(page.getByTestId('partial-point-add')).toBeVisible(); // affordance returns

  await expect
    .poll(() => draftThreshold(request, form.id), {
      message: 'removing the marker should autosave a draft WITHOUT partialSubmitAfterStep',
      timeout: 15_000,
      intervals: [500, 1_000],
    })
    .toBe('unset');
});
