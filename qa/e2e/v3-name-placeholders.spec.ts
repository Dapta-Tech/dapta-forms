import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * V3 — name-step placeholder defaults + live editor preview.
 *
 * User feedback: leaving the name step's placeholders empty published inputs
 * with NO placeholder at all, and the editor canvas showed a hardcoded English
 * "First name"/"Last name" preview that ignored the configured fields and
 * placeholders.
 *
 * Fixed behavior under test:
 *  1. Public renderer (components/public/step-input.tsx `name` case): each
 *     input's placeholder is the configured value OR the localized default
 *     ("First name"/"Last name" in en — `renderer.name.*` in the shared
 *     catalog), positionally. aria-labels reuse the same resolved copy (never
 *     the raw field key).
 *  2. Editor canvas (canvas-question.tsx NamePreview): a LIVE preview driven by
 *     `nameFields(step)` + `step.placeholders` with the same localized
 *     defaults — typing a placeholder in the settings panel updates the canvas
 *     immediately, no reload.
 *  3. Settings panel (question-settings.tsx NameFieldsEditor): the two
 *     placeholder TextFields show the localized default as their own input
 *     placeholder (what ships when left empty); rows read "First field" /
 *     "Second field".
 *  4. Storage semantics unchanged: an empty placeholder stores nothing — the
 *     default is applied at render time only (asserted via the published
 *     config still lacking a `lastname` placeholder while the page shows one).
 *
 * Each test creates its own form via the admin API under a unique `v3w11-`
 * prefixed name (per-run token + counter, never Date.now) so slugs don't
 * collide and reruns stay idempotent.
 */

const API = 'http://localhost:4400';

// Unique names without Date.now: a per-process random token + a monotonic
// counter. Slugs derive from the name, so uniqueness prevents collisions.
const RUN = Math.random().toString(36).slice(2, 8);
let seq = 0;
function uniqueName(label: string): string {
  seq += 1;
  return `v3w11-nameph-${label}-${RUN}-${seq}`;
}

const NAME_QUESTION = 'What is your name?';

/** Single required name step (default firstname+lastname fields) behind a
 *  cover. NO placeholders configured — the render-time defaults are the SUT. */
function nameConfig() {
  return {
    version: 1,
    cover: { enabled: true, headline: 'Name placeholders QA', ctaText: 'Start' },
    steps: [{ key: 'fullname', type: 'name', question: NAME_QUESTION, required: true }],
  };
}

/**
 * POST /v1/forms (create writes LIVE config) → the form id (admin API + editor
 * URL) and the public path /<accountCode>/me/<slug>. Account code comes from
 * GET /v1/me — the local-stub principal is not a hardcoded account.
 */
async function createNameForm(
  request: APIRequestContext,
  name: string,
): Promise<{ id: string; path: string }> {
  const me = await request.get(`${API}/v1/me`);
  expect(me.ok(), `GET /v1/me failed: ${me.status()}`).toBeTruthy();
  const { accountCode } = (await me.json()) as { accountCode: string };

  const res = await request.post(`${API}/v1/forms`, { data: { name, config: nameConfig() } });
  expect(res.ok(), `form creation failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; slug: string };
  return { id: body.id, path: `/${accountCode}/me/${body.slug}` };
}

/**
 * Open the public form and click through the cover to the name step. The
 * public API rate-limit bucket is shared by every QA spec — reload (tokens
 * refill ~1/s) until the cover renders instead of failing on a transient 429.
 */
async function openToNameStep(page: Page, formPath: string): Promise<void> {
  await page.goto(formPath);
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
  await expect(page.locator('.pf__question')).toHaveText(NAME_QUESTION);
  await expect(page.locator('.pf-name-fields')).toBeVisible();
}

/** The editor's name-step surfaces: canvas preview inputs + settings fields. */
function editorLocators(page: Page) {
  return {
    canvasFirst: page.getByTestId('canvas-name-first'),
    canvasSecond: page.getByTestId('canvas-name-second'),
    settingsFirst: page.getByTestId('name-placeholder-0'),
    settingsSecond: page.getByTestId('name-placeholder-1'),
  };
}

test('public name inputs without configured placeholders render the localized defaults (en)', async ({
  page,
  request,
}) => {
  const { path: formPath } = await createNameForm(request, uniqueName('defaults'));
  await openToNameStep(page, formPath);

  const inputs = page.locator('.pf-name-fields input');
  await expect(inputs).toHaveCount(2);

  // Positional defaults from the en catalog — never an empty placeholder.
  await expect(inputs.nth(0)).toHaveAttribute('placeholder', 'First name');
  await expect(inputs.nth(1)).toHaveAttribute('placeholder', 'Last name');

  // aria-labels resolve to the same copy — never the raw field key
  // ('firstname'/'lastname'), which is what shipped before the fix.
  await expect(inputs.nth(0)).toHaveAttribute('aria-label', 'First name');
  await expect(inputs.nth(1)).toHaveAttribute('aria-label', 'Last name');
});

test('editor canvas live-previews a typed placeholder without reload', async ({ page, request }) => {
  const { id } = await createNameForm(request, uniqueName('live'));
  await page.goto(`/admin/forms/${id}/edit`);

  const { canvasFirst, canvasSecond, settingsFirst, settingsSecond } = editorLocators(page);

  // The only step is auto-selected; the canvas preview shows the localized
  // defaults (not the old hardcoded copy — same strings, but now config-driven,
  // which the typing assertion below proves).
  await expect(canvasFirst).toHaveAttribute('placeholder', 'First name');
  await expect(canvasSecond).toHaveAttribute('placeholder', 'Last name');

  // The settings panel's placeholder fields are empty but SHOW the default
  // that will ship, as their own input placeholder.
  await expect(settingsFirst).toHaveValue('');
  await expect(settingsFirst).toHaveAttribute('placeholder', 'First name');
  await expect(settingsSecond).toHaveAttribute('placeholder', 'Last name');

  // Row labels use the Typeform wording.
  await expect(page.getByText('First field', { exact: true })).toBeVisible();
  await expect(page.getByText('Second field', { exact: true })).toBeVisible();

  // Type a placeholder → the canvas updates immediately (same config state
  // object, props-driven re-render — no reload, no save round-trip needed).
  await settingsFirst.fill('Tu nombre');
  await expect(canvasFirst).toHaveAttribute('placeholder', 'Tu nombre');
  // The untouched second input keeps previewing its default.
  await expect(canvasSecond).toHaveAttribute('placeholder', 'Last name');
});

test('typed placeholder publishes; the untouched one still ships the localized default', async ({
  page,
  request,
}) => {
  const { id, path: formPath } = await createNameForm(request, uniqueName('publish'));

  // Configure the FIRST placeholder in the editor (exercises the real
  // settings-panel → autosave-draft path rather than a raw API PUT).
  await page.goto(`/admin/forms/${id}/edit`);
  const { settingsFirst } = editorLocators(page);
  await settingsFirst.fill('Tu nombre');

  // Debounced autosave stores an unpublished DRAFT — wait until the admin API
  // sees it before publishing.
  await expect
    .poll(
      async () => {
        const res = await request.get(`${API}/v1/forms/${id}`);
        if (!res.ok()) return `GET ${res.status()}`;
        const form = (await res.json()) as { draftConfig?: unknown };
        const draft =
          typeof form.draftConfig === 'string'
            ? (JSON.parse(form.draftConfig) as Record<string, unknown>)
            : (form.draftConfig as Record<string, unknown> | undefined);
        const steps = (draft?.steps ?? []) as {
          type?: string;
          placeholders?: Record<string, string>;
        }[];
        return steps.find((s) => s.type === 'name')?.placeholders?.firstname ?? 'missing';
      },
      { timeout: 15_000, message: 'autosaved draft never carried the typed placeholder' },
    )
    .toBe('Tu nombre');

  // Publish the draft (draft_config → live config).
  const pub = await request.post(`${API}/v1/forms/${id}/publish`);
  expect(pub.ok(), `publish failed: ${pub.status()} ${await pub.text()}`).toBeTruthy();

  // Storage semantics: the published config carries ONLY the typed
  // placeholder — the second field stores nothing (default is render-time).
  const live = await request.get(`${API}/v1/forms/${id}`);
  expect(live.ok()).toBeTruthy();
  const liveForm = (await live.json()) as { config: { steps: { placeholders?: Record<string, string> }[] } };
  const placeholders = liveForm.config.steps[0]?.placeholders ?? {};
  expect(placeholders['firstname']).toBe('Tu nombre');
  expect(placeholders['lastname']).toBeUndefined();

  // Public page: configured first placeholder + default second.
  await openToNameStep(page, formPath);
  const inputs = page.locator('.pf-name-fields input');
  await expect(inputs.nth(0)).toHaveAttribute('placeholder', 'Tu nombre');
  await expect(inputs.nth(0)).toHaveAttribute('aria-label', 'Tu nombre');
  await expect(inputs.nth(1)).toHaveAttribute('placeholder', 'Last name');
});
