import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * Builder UI for the newly-exposed engine features, end-to-end:
 * edit in the admin builder → Publish → verify behavior on the public page.
 *
 * Covers:
 *  1. Visibility (showWhen) added via the builder's Visibility section
 *  2. Behavior → "Ends the form" (terminal) toggle on a message step
 *  3. Design → cover badge + client logo URL
 *  4. Design → reveal panel (enable, durationMs, subtitleTemplate) +
 *     Behavior → "Show reveal screen after" (triggersReveal) on the pick step
 *
 * Draft semantics: builder autosave stores a DRAFT; the Publish button makes it
 * live. Every test creates its own form via the admin API (unique name/slug).
 */

const API = 'http://localhost:4400';
const DB_PATH = fileURLToPath(new URL('../../.data/qa.db', import.meta.url));
// better-sqlite3 lives in @quill/db's dependency tree (pnpm isolated layout),
// so resolve it from packages/db as QA-CONTEXT prescribes.
const requireFromDb = createRequire(
  fileURLToPath(new URL('../../packages/db/package.json', import.meta.url)),
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Database: any = requireFromDb('better-sqlite3');

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// --- config building blocks -------------------------------------------------

const cover = (headline: string) => ({ enabled: true, headline, ctaText: 'Start' });

const pickStep = {
  key: 'pick',
  type: 'multiple_choice',
  question: 'Pick one',
  options: [
    { label: 'Alpha', value: 'a', points: 0 },
    { label: 'Beta', value: 'b', points: 0 },
  ],
};
const detailsStep = { key: 'details', type: 'text', question: 'A few details', required: true };
const emailStep = { key: 'email', type: 'email', question: 'Your email', required: true };

async function createForm(
  request: APIRequestContext,
  name: string,
  config: Record<string, unknown>,
): Promise<{ id: string; slug: string }> {
  const res = await request.post(`${API}/v1/forms`, {
    data: { name, config: { version: 1, ...config } },
  });
  expect(res.ok(), `POST /v1/forms failed: ${res.status()}`).toBeTruthy();
  const body = await res.json();
  return { id: body.id, slug: body.slug };
}

/**
 * Public URL prefix for the admin principal's forms. Resolved from /v1/me
 * because the QA principal is NOT the `acme` account (its code is generated,
 * e.g. `kea9if`) — hardcoding `/acme/me/…` 404s.
 */
let publicPrefix = '';
test.beforeAll(async ({ request }) => {
  const me = await (await request.get(`${API}/v1/me`)).json();
  publicPrefix = `/${me.accountCode}/${me.handle ?? 'me'}`;
});

// --- builder helpers ---------------------------------------------------------

async function openEditor(page: Page, id: string) {
  await page.goto(`/admin/forms/${id}/edit`);
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible({
    timeout: 20_000,
  });
}

/**
 * Open the question panel's ADVANCED group (advanced-settings.tsx). It
 * auto-opens when the step already has a badge-worthy setting, so toggle only
 * when it is closed — a blind click would collapse it.
 */
async function openAdvanced(page: Page) {
  const header = page.getByTestId('advanced-settings').getByRole('button', { name: /Advanced/ });
  await expect(header).toBeVisible({ timeout: 15_000 });
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'true');
}

/** Wait for the autosaved draft to land, then publish it and wait for the toast. */
async function saveAndPublish(page: Page) {
  // "Unpublished changes" appears after the first successful autosave; the
  // status flips back to "Saved" once the last pending save completes.
  await expect(page.getByText('Unpublished changes')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText(/Changes published/)).toBeVisible({ timeout: 15_000 });
}

// --- public-page helpers -----------------------------------------------------

/**
 * Open a public form and wait for its cover.
 *
 * The public API is rate-limited per IP (token bucket: 60 burst, ~1/s refill)
 * and the QA instance is SHARED — the page's server-side config fetch can 429
 * under load, which renders the Not-found page. Reload after a refill pause
 * instead of failing the suite on an environmental throttle.
 */
async function gotoPublic(page: Page, slug: string) {
  const start = page.getByRole('button', { name: 'Start', exact: true });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.goto(`${publicPrefix}/${slug}`);
    try {
      await expect(start).toBeVisible({ timeout: 5_000 });
      return;
    } catch {
      await page.waitForTimeout(5_000); // let the rate-limit bucket refill
    }
  }
  await expect(start).toBeVisible();
}

async function startForm(page: Page, slug: string) {
  await gotoPublic(page, slug);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
}

test.describe('builder gaps: newly-exposed engine features via the builder UI', () => {
  test.setTimeout(60_000);

  test('Visibility: showWhen added in the builder gates the details step publicly', async ({
    page,
    request,
  }) => {
    const form = await createForm(request, `qa-bg-visibility-${Date.now()}`, {
      cover: cover('Visibility QA'),
      steps: [pickStep, detailsStep, emailStep],
    });

    await openEditor(page, form.id);
    // Select the "details" step in the left spine.
    await page.getByRole('button', { name: /A few details/ }).click();
    // The condition editors moved out of the settings panel: the Build panel now
    // SUMMARISES this question's logic and `question-logic-edit` opens the shared
    // dialog that edits it. Same editors, same testids, one dialog around them.
    await page.getByTestId('question-logic-edit').click();
    const dialog = page.getByTestId('logic-dialog');
    await expect(dialog).toBeVisible();
    // Visibility section → "Show when" source field = pick. The field picker is
    // the branded combobox (components/ui/select.tsx): a trigger button opening
    // a listbox of the prior questions. Picking a choice field seeds the
    // condition with its FIRST option value ("a").
    const showWhenField = page.getByRole('button', { name: 'Show when — Field', exact: true });
    await showWhenField.click();
    await page
      .getByRole('listbox', { name: 'Show when — Field' })
      .getByRole('option', { name: 'Pick one', exact: true })
      .click();
    await expect(showWhenField).toContainText('Pick one');
    const chip = page
      .getByRole('group', { name: 'Matches any of' })
      .getByRole('button', { name: 'Alpha', exact: true });
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    // Close the dialog so the topbar (save status, Publish) is reachable again.
    await page.getByTestId('logic-dialog-close').click();
    await expect(dialog).toBeHidden();

    await saveAndPublish(page);

    // Public: answering "b" skips the details step (straight to email).
    await startForm(page, form.slug);
    await expect(page.locator('.pf__question')).toHaveText('Pick one');
    await page.getByRole('radio', { name: 'Beta' }).click();
    await expect(page.locator('.pf__question')).toHaveText('Your email');

    // Public: answering "a" shows it (fresh visit restarts the client flow).
    await startForm(page, form.slug);
    await page.getByRole('radio', { name: 'Alpha' }).click();
    await expect(page.locator('.pf__question')).toHaveText('A few details');
  });

  test('Behavior: terminal toggle on a message step finalizes the form right there', async ({
    page,
    request,
  }) => {
    const form = await createForm(request, `qa-bg-terminal-${Date.now()}`, {
      cover: cover('Terminal QA'),
      steps: [
        pickStep,
        {
          key: 'bye',
          type: 'message',
          question: 'Not a fit',
          helper: 'Thanks anyway.',
          showWhen: { field: 'pick', values: ['b'] },
        },
        emailStep,
      ],
    });

    await openEditor(page, form.id);
    await page.getByRole('button', { name: /Not a fit/ }).click();
    // "Ends the form" is in the Behavior section, inside the collapsed Advanced group.
    await openAdvanced(page);
    const terminal = page.getByRole('switch', { name: 'Ends the form' });
    await terminal.click();
    await expect(terminal).toHaveAttribute('aria-checked', 'true');

    await saveAndPublish(page);

    // Public: "b" reveals the message step; continuing finalizes immediately —
    // done screen with the email step still unanswered.
    await startForm(page, form.slug);
    await page.getByRole('radio', { name: 'Beta' }).click();
    await expect(page.locator('.pf__question')).toHaveText('Not a fit');
    // Continuing on the terminal step submits. A rate-limited (429) submit
    // surfaces as an inline error with the step still shown — retry like a
    // respondent would once the shared bucket refills.
    const done = page.locator('.pf-done__title');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await page.locator('.pf__btn--inline').click();
      try {
        await expect(done).toBeVisible({ timeout: 8_000 });
        break;
      } catch {
        await expect(page.locator('.pf__error')).toBeVisible({ timeout: 2_000 });
        await page.waitForTimeout(5_000); // rate-limit refill
      }
    }
    await expect(done).toBeVisible();
    await expect(page.locator('.pf__question')).toHaveCount(0);

    // DB: a COMPLETED submission exists for this form with pick=b and no email.
    const db = new Database(DB_PATH, { readonly: true });
    try {
      await expect
        .poll(
          () => {
            const row = db
              .prepare('SELECT data, completed_at FROM submission WHERE form_id = ?')
              .get(form.id) as { data: string; completed_at: number | null } | undefined;
            if (!row?.completed_at) return null;
            const data = JSON.parse(row.data);
            return { pick: data.pick, email: data.email ?? null };
          },
          { timeout: 10_000 },
        )
        .toEqual({ pick: 'b', email: null });
    } finally {
      db.close();
    }
  });

  test('Design: cover badge + client logo URL show on the public cover', async ({
    page,
    request,
  }) => {
    const badgeText = `QA Badge ${Date.now()}`;
    const logoUrl = 'https://example.com/logo.png';
    const form = await createForm(request, `qa-bg-cover-${Date.now()}`, {
      cover: cover('Cover QA'),
      steps: [emailStep],
    });

    await openEditor(page, form.id);
    // The topbar's contextual row now carries its own "Design" shortcut, so the
    // role+name lookup resolves to two buttons — target the TAB by testid.
    await page.getByTestId('editor-tab-design').click();
    // Cover screen → Badge. `Field` (fields.tsx) renders
    // <div><span><label>Badge</label></span><input/></div> — the label is NOT
    // htmlFor-associated AND the input is a sibling of the label's SPAN, not of
    // the label, so reach the control through the Field wrapper.
    await page
      .locator('label:text-is("Badge")')
      .locator('xpath=ancestor::div[1]')
      .locator('input')
      .fill(badgeText);
    // Client logos → Add logo → Image URL.
    await page.getByRole('button', { name: 'Add logo', exact: true }).click();
    await page.getByLabel('Image URL').fill(logoUrl);

    await saveAndPublish(page);

    // Never hit example.com for real — fulfill the logo request with a 1x1 PNG
    // so the <img> doesn't onError-swap to its text fallback.
    await page.route('https://example.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 }),
    );
    await gotoPublic(page, form.slug);
    await expect(page.locator('.pf__badge')).toHaveText(badgeText);
    await expect(page.locator('img.pf-logos__img').first()).toHaveAttribute('src', logoUrl);
  });

  test('Reveal: the behavior toggle adds a card that plays the interstitial then auto-advances', async ({
    page,
    request,
  }) => {
    const form = await createForm(request, `qa-bg-reveal-${Date.now()}`, {
      cover: cover('Reveal QA'),
      steps: [pickStep, emailStep],
    });

    await openEditor(page, form.id);
    // Build tab → pick step → Behavior → "Show reveal screen after". The switch
    // INSERTS a reveal card after this question; there is no Design-tab reveal
    // to enable separately, which is the whole point of the single model.
    await page.getByRole('button', { name: /Pick one/ }).click();
    // Behavior lives inside the collapsed Advanced group (advanced-settings.tsx).
    await openAdvanced(page);
    const trigger = page.getByRole('switch', { name: 'Show reveal screen after' });
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-checked', 'true');

    // The new card is question 2, between the pick and the email step.
    const spine = page.getByTestId('question-spine');
    await expect(spine.getByText('Reveal screen', { exact: true })).toBeVisible();

    // Select it and author its copy + duration on the card itself.
    await spine.getByText('Reveal screen', { exact: true }).click();
    await expect(page.getByTestId('canvas-reveal-preview')).toBeVisible();
    await page.getByTestId('step-reveal-headline').fill('Matching you');
    // Both reveal lines interpolate [field] tokens.
    await page.getByTestId('step-reveal-subtitle').fill('For [pick]');
    await page.getByTestId('step-reveal-duration').fill('1000');

    await saveAndPublish(page);

    // Public: answering the pick step plays the reveal with the interpolated
    // subtitle, then auto-advances to the email step after ~1s.
    await startForm(page, form.slug);
    await page.getByRole('radio', { name: 'Alpha' }).click();
    await expect(page.locator('.pf-reveal__headline')).toBeVisible({ timeout: 5_000 });
    const t0 = Date.now();
    await expect(page.locator('.pf-reveal__subtitle')).toContainText('For a');
    // No clicks: the reveal must advance on its own when the bar fills.
    await expect(page.locator('.pf__question')).toHaveText('Your email', { timeout: 8_000 });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(300);
    expect(elapsed).toBeLessThanOrEqual(8_000);
  });
});
