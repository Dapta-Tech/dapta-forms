import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * V3 — P0 regression: the public form renders questions in the EXACT order
 * authored in the editor (WYSIWYG).
 *
 * The bug: `runtimeSteps` used to wrap the config in a two-phase `orderSteps`
 * partition (qualification first, `flowGroup: 'lead_capture'` last). Because the
 * editor auto-tags every name/email/phone step as `lead_capture`, a form
 * authored with a name step FIRST rendered it LAST publicly. The fix makes the
 * raw `config.steps` array order authoritative at runtime; `flowGroup` keeps
 * its scoring-exclusion semantics only.
 *
 * This spec authors the exact trigger shape — [name ("Tu nombre"), short-text,
 * select] with the editor's own flowGroup tags (name = lead_capture BEFORE two
 * qualification steps) — publishes it (POST /v1/forms writes LIVE config), and
 * walks the public URL asserting each rendered question in sequence:
 * name first, then the short-text, then the select.
 *
 * Conventions: fresh form per run via the admin API (slug prefixed `v3w1-`,
 * unique per-run nonce — reruns never collide); accountCode resolved from
 * GET /v1/me (never hardcoded); third-party hosts blocked; transient public
 * 429s (shared per-IP token bucket across parallel QA suites) are retried.
 */

const API = 'http://localhost:4400';

/** Per-run nonce so reruns mint distinct forms (Date.now is banned in specs). */
const RUN = randomUUID().slice(0, 8);
let formSeq = 0;

/** Authored config: name (lead_capture) FIRST, then two qualification steps. */
function buildConfig() {
  return {
    version: 1,
    cover: { enabled: true, headline: 'Step order QA', ctaText: 'Start' },
    steps: [
      {
        // The editor tags every name step lead_capture — the exact shape the
        // old two-phase reorder demoted to the end of the flow.
        key: 'name',
        type: 'name',
        question: 'Tu nombre',
        flowGroup: 'lead_capture',
        required: true,
        fields: ['firstname', 'lastname'],
        placeholders: { firstname: 'First name', lastname: 'Last name' },
      },
      {
        key: 'q2',
        type: 'text',
        question: 'What problem are you solving?',
        flowGroup: 'qualification',
        required: true,
      },
      {
        key: 'q3',
        type: 'multiple_choice',
        question: 'Pick your industry',
        flowGroup: 'qualification',
        options: [
          { label: 'SaaS', value: 'saas', points: 1 },
          { label: 'Banking', value: 'banking', points: 0 },
        ],
      },
    ],
    scoring: { enabled: true },
    outcomes: [{ id: 'p1', label: 'P1', minScore: -100 }],
  };
}

/**
 * Create a fresh, immediately-live form (POST /v1/forms writes LIVE config —
 * that IS the published surface) and return its public path. accountCode comes
 * from GET /v1/me; the `me` handle segment is cosmetic.
 */
async function createForm(request: APIRequestContext): Promise<string> {
  formSeq += 1;
  const name = `v3w1-step-order-${RUN}-w${test.info().workerIndex}-${formSeq}`;

  const me = await request.get(`${API}/v1/me`);
  expect(me.ok(), `GET /v1/me failed: ${me.status()}`).toBeTruthy();
  const { accountCode } = (await me.json()) as { accountCode: string };

  const res = await request.post(`${API}/v1/forms`, { data: { name, config: buildConfig() } });
  expect(res.ok(), `form creation failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { slug: string };
  expect(body.slug.startsWith('v3w1-'), `slug must carry the v3w1- prefix: ${body.slug}`).toBe(true);
  return `/${accountCode}/me/${body.slug}`;
}

/** Never let this test reach a third-party host (the form needs none). */
async function blockExternal(page: Page): Promise<void> {
  await page.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === 'localhost' || host === '127.0.0.1') return route.continue();
    return route.abort();
  });
}

/**
 * Open the public form and click through the cover to the first step. The
 * public API is rate-limited per IP (a bucket SHARED by every concurrently
 * running QA spec); a drained bucket 429s and the page renders not-found.
 * Reload (tokens refill at 1/s) until the cover appears.
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

test('authored [name, short-text, select] renders in exactly that order publicly', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000); // headroom for shared-rate-limiter retries only
  await blockExternal(page);
  const path = await createForm(request);
  await startForm(page, path);

  // 1) FIRST rendered question is the name step — authored first, rendered
  // first. Under the old two-phase reorder this was pushed to the END.
  await expect(page.locator('.pf__question')).toHaveText('Tu nombre');
  const nameInputs = page.locator('.pf-name-fields .pf-input');
  await expect(nameInputs).toHaveCount(2); // it really is the name step, not a lookalike
  await nameInputs.first().fill('Josue');
  await nameInputs.nth(1).fill('QA');
  await page.locator('.pf__btn--inline').click();

  // 2) SECOND is the short-text qualification step, exactly as authored.
  await expect(page.locator('.pf__question')).toHaveText('What problem are you solving?');
  const textInput = page.locator('input[type="text"]');
  await expect(textInput).toBeVisible();
  await textInput.fill('Ordering my steps');
  await page.locator('.pf__btn--inline').click();

  // 3) THIRD is the select step — the authored tail stays the rendered tail.
  await expect(page.locator('.pf__question')).toHaveText('Pick your industry');
  await expect(page.getByRole('radio', { name: 'SaaS' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Banking' })).toBeVisible();
});
