import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * F1 — graceful `[field]` variable interpolation on the PUBLIC form.
 *
 * The engine's `interpolate` (packages/engine/src/form-logic.ts) sweeps a token
 * whose answer is missing AND the punctuation/whitespace that joined it to the
 * rest of the sentence, so a personalization token that has not been answered
 * yet never leaves a dangling comma, trailing space, or lowercase artifact.
 * The public renderer feeds every question through it (runtimeSteps →
 * resolveStepDisplay → resolveQuestion → interpolate), so these are black-box
 * assertions on the visible `.pf__question` text.
 *
 * A `name` step (flowGroup `lead_capture`) always renders AFTER `qualification`
 * steps (engine `orderSteps` is two-phase), so a qualification question that
 * references `[firstname]` is shown BEFORE any name is captured — the exact
 * moment the graceful-sweep must fire.
 *
 * 1. Leading empty token — "[firstname], what problem are you solving?" with no
 *    firstname renders "What problem are you solving?": no leading comma, first
 *    letter re-capitalized.
 * 2. Control, embedded/trailing empty token — "Hi [firstname]" with no firstname
 *    renders exactly "Hi": the space in front of the token is swept, no trailing
 *    artifact.
 * 3. Answered token — with the name step ordered first (flowGroup `qualification`)
 *    and the reference in a later `lead_capture` step, "[firstname], welcome"
 *    interpolates the real name → "Alex, welcome" (comma kept, verbatim).
 *
 * Each test creates its own live form via the admin API (:4400) with a unique
 * name (per-run counter + worker index; Date.now is banned). `uniqueFormSlug`
 * de-dupes server-side, so the returned slug is authoritative and reruns never
 * collide. accountCode is resolved from GET /v1/me, never hardcoded.
 */

const API = 'http://localhost:4400';

/** Per-run form counter — keeps names distinct without Date.now. */
let formSeq = 0;

type Cfg = Record<string, unknown>;

/** A qualification (shown-first) single-select choice with the given question. */
function qualChoice(key: string, question: string): Cfg {
  return {
    key,
    type: 'multiple_choice',
    question,
    flowGroup: 'qualification',
    options: [
      { label: 'Growth', value: 'growth', points: 1 },
      { label: 'Retention', value: 'retention', points: 0 },
    ],
  };
}

/** A name step (firstname/lastname) in the given flow phase. */
function nameStep(flowGroup: 'qualification' | 'lead_capture', question: string): Cfg {
  return {
    key: 'name',
    type: 'name',
    question,
    flowGroup,
    required: false,
    fields: ['firstname', 'lastname'],
    placeholders: { firstname: 'First name', lastname: 'Last name' },
  };
}

/**
 * POST /v1/forms (create writes LIVE config) → public path
 * /<accountCode>/me/<slug>. accountCode from GET /v1/me (the local auth stub's
 * principal is NOT `acme`); the `me` handle segment is cosmetic — resolution is
 * by accountCode + slug.
 */
async function createForm(
  request: APIRequestContext,
  label: string,
  steps: Cfg[],
): Promise<string> {
  formSeq += 1;
  const name = `v2-interp-${label}-w${test.info().workerIndex}-${formSeq}`;
  const config: Cfg = {
    version: 1,
    cover: { enabled: true, headline: 'Interpolation QA', ctaText: 'Start' },
    steps,
    scoring: { enabled: true },
    outcomes: [{ id: 'p1', label: 'P1', minScore: -100 }],
  };

  const me = await request.get(`${API}/v1/me`);
  expect(me.ok(), `GET /v1/me failed: ${me.status()}`).toBeTruthy();
  const { accountCode } = (await me.json()) as { accountCode: string };

  const res = await request.post(`${API}/v1/forms`, { data: { name, config } });
  expect(res.ok(), `form creation failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { slug: string };
  return `/${accountCode}/me/${body.slug}`;
}

/** Never let a test reach a third-party host (these forms need none). */
async function blockExternal(page: Page): Promise<void> {
  await page.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === 'localhost' || host === '127.0.0.1') return route.continue();
    return route.abort();
  });
}

/**
 * Open the public form and click through the cover to the first step.
 *
 * The public API is rate-limited per IP (a token bucket SHARED by every
 * concurrently running QA spec); a drained bucket 429s and the server component
 * renders not-found (no Start button). Reload (tokens refill at 1/s) until the
 * cover appears rather than failing on a transient 429.
 */
async function startForm(page: Page, path: string): Promise<void> {
  await page.goto(path);
  const start = page.getByRole('button', { name: 'Start' });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const visible = await start
      .waitFor({ state: 'visible', timeout: 2_000 })
      .then(() => true)
      .catch(() => false);
    if (visible) break;
    await page.waitForTimeout(1_500);
    await page.reload();
  }
  await start.click();
}

/** Raw visible text of the current question (no whitespace normalization). */
async function questionText(page: Page): Promise<string> {
  const q = page.locator('.pf__question');
  await expect(q).toBeVisible();
  return (await q.textContent()) ?? '';
}

test('leading empty token: "[firstname], what problem…" sweeps the comma and re-capitalizes', async ({
  page,
  request,
}) => {
  await blockExternal(page);
  const path = await createForm(request, 'lead-comma', [
    qualChoice('problem', '[firstname], what problem are you solving?'),
    nameStep('lead_capture', "What's your name?"),
  ]);
  await startForm(page, path);

  // The qualification question renders before any name is captured.
  const text = await questionText(page);

  // The swept form: no leading comma, first letter capitalized, byte-for-byte.
  expect(text).toBe('What problem are you solving?');
  expect(text.startsWith(','), `question began with a comma: ${JSON.stringify(text)}`).toBe(false);
  expect(text.trimStart().startsWith(','), 'leading punctuation survived the sweep').toBe(false);
  // Belt-and-braces: the raw token must be gone (not rendered literally).
  expect(text).not.toContain('[firstname]');
  // Assert against the visible element too (normalized) so a stray node fails.
  await expect(page.locator('.pf__question')).toHaveText('What problem are you solving?');
});

test('control — embedded empty token: "Hi [firstname]" renders exactly "Hi", no trailing artifact', async ({
  page,
  request,
}) => {
  await blockExternal(page);
  const path = await createForm(request, 'trailing', [
    qualChoice('greeting', 'Hi [firstname]'),
    nameStep('lead_capture', 'Your name?'),
  ]);
  await startForm(page, path);

  const text = await questionText(page);

  // Exact "Hi": the space in front of the emptied token is swept, no trailing
  // space, no leftover bracket, nothing after it.
  expect(text).toBe('Hi');
  expect(text.endsWith(' '), `trailing whitespace survived: ${JSON.stringify(text)}`).toBe(false);
  expect(text).not.toContain('[');
  expect(text).not.toContain(']');
});

test('answered token: name captured first → "[firstname], welcome" interpolates the real name', async ({
  page,
  request,
}) => {
  await blockExternal(page);
  // Name step ordered FIRST (flowGroup qualification); the reference lives in a
  // later lead_capture step, so firstname is answered by the time it renders.
  const path = await createForm(request, 'answered', [
    nameStep('qualification', "What's your name?"),
    { ...qualChoice('welcome', '[firstname], welcome'), flowGroup: 'lead_capture' },
  ]);
  await startForm(page, path);

  // First step is the name step — no interpolation on its own question.
  await expect(page.locator('.pf__question')).toHaveText("What's your name?");

  // Fill firstname (+ lastname) and continue to the lead_capture reference step.
  const nameInputs = page.locator('.pf-name-fields .pf-input');
  await nameInputs.first().fill('Alex');
  await nameInputs.nth(1).fill('Rivera');
  await page.locator('.pf__btn--inline').click();

  // The reference now resolves the real answer verbatim (comma kept).
  await expect(page.locator('.pf__question')).toHaveText('Alex, welcome');
  const text = await questionText(page);
  expect(text).toBe('Alex, welcome');
  expect(text).not.toContain('[firstname]');
});
