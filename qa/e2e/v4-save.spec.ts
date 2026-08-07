import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * V4 — the editor autosave is now BULLETPROOF and the Results panel is clear.
 *
 * Four independent journeys prove the round-trip through the real HTTP surface
 * (fresh form per test via the admin API; slug prefixed `v4save-`; the DB is only
 * ever written through the app):
 *
 *   (a) Add a score range in Results → it AUTOSAVES (the empty-label outcome that
 *       used to 400 the whole config now persists to draftConfig; no error state).
 *   (b) An outcome heading + a SCHEMELESS redirect (`example.com`) → saves, with
 *       the redirect normalized to `https://example.com` (no doomed request).
 *   (c) Numbering: a lead-capture step + an earlier scored choice + a scored
 *       slider at question 5 → the read-only Points card shows the REAL question
 *       number ("5"), not its index in the filtered scoring list ("2").
 *   (d) Leave-while-dirty: mutate an outcome then click Back before the debounce
 *       fires → the flush-on-leave still persists the change (polled via the API).
 */

const API = 'http://localhost:4400';

/** Per-run nonce so reruns mint distinct forms (Date.now is banned in specs). */
const RUN = randomUUID().slice(0, 8);
let formSeq = 0;

type Cfg = Record<string, unknown>;

/** A scored form with one slider + one outcome — the Results panel has content. */
function scoredConfig(): Cfg {
  return {
    version: 1,
    cover: { enabled: true, headline: 'V4 save QA', ctaText: 'Start' },
    steps: [
      {
        key: 'budget',
        type: 'slider',
        question: 'Budget?',
        min: 0,
        max: 100,
        default: 10,
        sliderScoring: [
          { min: 0, max: 50, points: 1 },
          { min: 51, max: 100, points: 5 },
        ],
        flowGroup: 'qualification',
      },
    ],
    scoring: { enabled: true },
    outcomes: [{ id: 'base', label: 'Base', minScore: -100 }],
  };
}

/**
 * A form whose SCORED slider is question 5: an email (lead-capture, unscored), a
 * scored choice at Q2, two text steps (unscored), then the slider at Q5. The
 * filtered scoring list is [choice(Q2), slider(Q5)] — so the OLD filtered index
 * would render the slider as "Question 2"; the fix renders its real number "5".
 */
function numberingConfig(): Cfg {
  return {
    version: 1,
    cover: { enabled: true, headline: 'V4 numbering QA', ctaText: 'Start' },
    steps: [
      { key: 'email', type: 'email', question: 'Your email?', required: true, flowGroup: 'lead_capture' },
      {
        key: 'segment',
        type: 'multiple_choice',
        question: 'Segment?',
        flowGroup: 'qualification',
        options: [
          { label: 'SMB', value: 'smb', points: 1 },
          { label: 'Enterprise', value: 'ent', points: 5 },
        ],
      },
      { key: 'role', type: 'text', question: 'Your role?' },
      { key: 'notes', type: 'textarea', question: 'Anything else?' },
      {
        key: 'budget',
        type: 'slider',
        question: 'Budget?',
        min: 0,
        max: 100,
        default: 10,
        sliderScoring: [{ min: 0, max: 100, points: 3 }],
        flowGroup: 'qualification',
      },
    ],
    scoring: { enabled: true },
    outcomes: [{ id: 'base', label: 'Base', minScore: -100 }],
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
async function createForm(request: APIRequestContext, label: string, config: Cfg): Promise<string> {
  formSeq += 1;
  const name = `v4save-${label}-${RUN}-w${test.info().workerIndex}-${formSeq}`;
  const res = await request.post(`${API}/v1/forms`, { data: { name, config } });
  expect(res.ok(), `form creation failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; slug: string };
  expect(body.slug.startsWith('v4save-'), `slug must carry the v4save- prefix: ${body.slug}`).toBe(true);
  return body.id;
}

/** The pending draft's outcomes (null when no draft has been written yet). */
async function draftOutcomes(
  request: APIRequestContext,
  id: string,
): Promise<Array<{ id: string; label: string; minScore?: number; redirectUrl?: string | null }> | null> {
  const res = await request.get(`${API}/v1/forms/${id}`);
  if (!res.ok()) return null;
  const body = (await res.json()) as { draftConfig?: { outcomes?: unknown[] } | null };
  if (body.draftConfig == null) return null;
  return (body.draftConfig.outcomes ?? []) as Array<{
    id: string;
    label: string;
    minScore?: number;
    redirectUrl?: string | null;
  }>;
}

/** Open the editor on a given tab and wait for the shell to be interactive. */
async function openEditor(page: Page, id: string, tab: string): Promise<void> {
  await page.goto(`/admin/forms/${id}/edit?tab=${tab}`);
  await expect(page.getByTestId('editor-save-status')).toBeVisible();
}

/**
 * Open the score-range editor.
 *
 * The Results TAB is gone: its two panels were absorbed into the Logic tab's
 * contextual toolbar (Scoring for the points, Outcomes for the ranges), so
 * there is one form-wide view of each axis instead of a tab that mixed them.
 * Every outcome testid below is unchanged — only the door moved.
 */
async function openLogicDialog(page: Page, id: string, which: 'outcomes' | 'scoring'): Promise<void> {
  await openEditor(page, id, 'logic');
  const trigger = page.getByTestId(`toolbar-${which}`);
  const dialog = page.getByTestId(`${which}-dialog`);
  await expect(trigger).toBeVisible({ timeout: 20_000 });
  // Retried as a unit: the toolbar is a client island, so a click landing
  // before hydration is swallowed while the button looks perfectly ready.
  await expect(async () => {
    if (!(await dialog.isVisible())) await trigger.click();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}
const openOutcomes = (page: Page, id: string) => openLogicDialog(page, id, 'outcomes');
const openScoring = (page: Page, id: string) => openLogicDialog(page, id, 'scoring');

test('(a) adding a score range autosaves — the empty-label outcome persists, no error', async ({
  page,
  request,
}) => {
  const id = await createForm(request, 'add-range', scoredConfig());
  await openOutcomes(page, id);

  await expect(page.getByTestId('outcome-row')).toHaveCount(1); // the seeded "Base"
  await page.getByTestId('results-add-range').click();
  await expect(page.getByTestId('outcome-row')).toHaveCount(2); // new range appears

  // Durable: the draft now carries TWO outcomes (the new one has an empty label,
  // which used to 400 the whole PUT and poison every later save).
  await expect
    .poll(async () => (await draftOutcomes(request, id))?.length ?? 0, {
      message: 'autosave must persist the newly-added range to draftConfig',
      timeout: 15_000,
      intervals: [500, 1_000],
    })
    .toBe(2);

  // And the editor settled on "saved", never the error state.
  await expect(page.getByTestId('editor-save-status')).toHaveAttribute('data-status', 'saved');
});

test('(b) outcome heading + schemeless redirect saves — redirect normalized to https://', async ({
  page,
  request,
}) => {
  const id = await createForm(request, 'redirect', scoredConfig());
  await openOutcomes(page, id);

  // The label is the heading respondents see for this range.
  await page.getByTestId('outcome-label').first().fill('Hot lead — thanks!');
  // A schemeless redirect: it must be upgraded to https:// on blur, not sent raw.
  const redirect = page.getByTestId('outcome-redirect').first();
  await redirect.fill('example.com');
  await redirect.blur();

  await expect
    .poll(
      async () => {
        const o = (await draftOutcomes(request, id))?.[0];
        return o ? `${o.label}|${o.redirectUrl ?? ''}` : '';
      },
      {
        message: 'the heading + normalized redirect must persist to the draft',
        timeout: 15_000,
        intervals: [500, 1_000],
      },
    )
    .toBe('Hot lead — thanks!|https://example.com');

  await expect(page.getByTestId('editor-save-status')).toHaveAttribute('data-status', 'saved');
});

test('(c) Results numbering: a slider at question 5 shows "5", not its filtered index "2"', async ({
  page,
  request,
}) => {
  const id = await createForm(request, 'numbering', numberingConfig());
  await openScoring(page, id);

  // Two Points cards render (the scored choice at Q2, then the scored slider at
  // Q5) — in step order. Their number chips must be the REAL positions.
  const numbers = page.getByTestId('points-question-number');
  await expect(numbers).toHaveCount(2);
  await expect(numbers.nth(0)).toHaveText('2'); // the choice is question 2
  await expect(numbers.nth(1)).toHaveText('5'); // the slider is question 5, not "2"
});

test('(d) leave-while-dirty: mutate then click Back fast — the change is still persisted', async ({
  page,
  request,
}) => {
  const id = await createForm(request, 'leave', scoredConfig());
  await openOutcomes(page, id);

  // Mutate an outcome, then navigate away BEFORE the ~900ms debounce fires.
  await page.getByTestId('outcome-label').first().fill('LeaveSaved');
  // Escape rather than a click on Done: the ranges live in a dialog now, which
  // aria-hides the page behind it, so Back is genuinely unreachable while it is
  // open. Escape closes synchronously and — crucially — writes nothing, so the
  // race this test exists for is intact: the edit is still only in memory when
  // the navigation starts.
  await page.keyboard.press('Escape');
  await page.locator('a[href="/admin/forms"]').first().click(); // Back — SPA nav unmounts the editor

  // The flush-on-leave (effect cleanup → server action) still persisted it.
  await expect
    .poll(async () => (await draftOutcomes(request, id))?.[0]?.label ?? '', {
      message: 'flush-on-leave must persist the mutation made just before navigating away',
      timeout: 15_000,
      intervals: [500, 1_000],
    })
    .toBe('LeaveSaved');
});
