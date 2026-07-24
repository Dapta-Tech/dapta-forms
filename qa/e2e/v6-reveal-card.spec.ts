import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * V6 — the reveal screen has exactly ONE model: a card in the question list.
 *
 * It used to have two. A form-level `config.reveal` authored in the Design tab
 * (one per form, positioned by a draggable marker) coexisted with the `reveal`
 * STEP type, so the builder showed two different "Reveal screen" rows in the
 * same list and the author had to guess which one they were editing. The step
 * won: it can appear anywhere, several times, each with its own copy.
 *
 * These specs pin that single model end to end:
 *  - Design no longer offers a reveal at all (the duplicate is gone for good);
 *  - a reveal card renders the real interstitial on the canvas, not a question
 *    card with an empty answer box;
 *  - its settings are the ones a reveal actually has — no "Ends the form", no
 *    hidden/field-key, no dynamic-question variants;
 *  - and TWO reveals in one form each play their own copy, in order.
 */

const API = 'http://localhost:4400';
const RUN = randomUUID().slice(0, 8);
let seq = 0;

async function accountCode(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API}/v1/me`);
  const me = (await res.json()) as { accountCode?: string; accountShortCode?: string };
  return (me.accountCode ?? me.accountShortCode) as string;
}

async function createForm(
  request: APIRequestContext,
  steps: Record<string, unknown>[],
): Promise<{ id: string; slug: string }> {
  seq += 1;
  const res = await request.post(`${API}/v1/forms`, {
    data: { name: `v6reveal-${RUN}-w${test.info().workerIndex}-${seq}`, config: { version: 1, steps } },
  });
  expect(res.ok(), `create failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: string; slug: string };
}

async function openEditor(page: Page, id: string): Promise<void> {
  await page.goto(`/admin/forms/${id}/edit`);
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

/** A reveal step with its own copy — what the builder's gallery produces. */
const reveal = (key: string, headline: string, subtitle = ''): Record<string, unknown> => ({
  key,
  type: 'reveal',
  question: '',
  required: false,
  reveal: { enabled: true, headline, subtitle, durationMs: 700 },
});

const textStep = (key: string, question: string): Record<string, unknown> => ({
  key,
  type: 'text',
  question,
  required: true,
});

/**
 * The public surface is per-IP rate-limited and every concurrent spec shares the
 * bucket; a transient 429 renders nothing. Retry with a refill pause.
 */
async function openPublic(page: Page, url: string, firstQuestion: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.goto(url);
    const shown = await page
      .locator('.pf__question')
      .filter({ hasText: firstQuestion })
      .waitFor({ state: 'visible', timeout: 4_000 })
      .then(() => true)
      .catch(() => false);
    if (shown) return;
    await page.waitForTimeout(2_000);
  }
  throw new Error('public form never rendered (likely rate-limited)');
}

async function fillAndContinue(page: Page, value: string): Promise<void> {
  const input = page.locator('.pf__fields input').first();
  await expect(input).toBeVisible();
  await input.fill(value);
  await page.locator('.pf__btn--inline, .pf__btn').first().click();
}

test.describe('V6 — the reveal screen is a card, and only a card', () => {
  test.setTimeout(120_000);

  test('the Design tab no longer offers a reveal — the duplicate model is gone', async ({
    page,
    request,
  }) => {
    const { id } = await createForm(request, [textStep('q1', 'First question')]);
    await openEditor(page, id);
    await page.getByRole('button', { name: 'Design', exact: true }).click();

    // Everything else Design owns is untouched…
    await expect(page.getByTestId('flow-panel')).toBeVisible();
    await expect(page.getByTestId('partial-point-design-note')).toBeVisible();
    // …but the reveal section, its enable switch and its panel anchor are gone.
    await expect(page.getByTestId('reveal-panel')).toHaveCount(0);
    await expect(page.getByRole('switch', { name: 'Enable the reveal screen' })).toHaveCount(0);
    await expect(page.getByText('Subtitle template')).toHaveCount(0);
  });

  test('adding a Reveal from the gallery renders the real interstitial on the canvas', async ({
    page,
    request,
  }) => {
    const { id } = await createForm(request, [textStep('q1', 'First question')]);
    await openEditor(page, id);

    await page.getByTestId('question-spine').locator('> button.border-dashed').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByText('Reveal screen', { exact: true }).click();

    // The canvas shows what the respondent sees — spinner + copy + progress bar —
    // not the question chrome with a "…" answer box and a Next button.
    await expect(page.getByTestId('canvas-reveal-preview')).toBeVisible();
    await expect(page.getByTestId('canvas-reveal-spinner')).toBeVisible();
    await expect(page.getByTestId('canvas-title-input')).toHaveCount(0);

    // Its copy is authored on the card itself, and lands on the canvas live.
    await page.getByTestId('step-reveal-headline').fill('Crunching the numbers');
    await expect(page.getByTestId('canvas-reveal-preview')).toContainText('Crunching the numbers');
  });

  test('a reveal card offers only the settings a reveal actually has', async ({ page, request }) => {
    const { id } = await createForm(request, [
      textStep('q1', 'First question'),
      reveal('hold', 'One moment'),
    ]);
    await openEditor(page, id);
    await page.getByTestId('question-spine').getByText('One moment', { exact: true }).click();

    // Present: the copy, the duration, and the pre-warm carried over from the
    // Design panel this card replaced.
    await expect(page.getByTestId('step-reveal-headline')).toBeVisible();
    await expect(page.getByTestId('step-reveal-subtitle')).toBeVisible();
    await expect(page.getByTestId('step-reveal-duration')).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Pre-warm the booking embed' })).toBeVisible();

    // Absent: controls that contradict what a reveal IS. It asks nothing, so it
    // cannot be required, hidden, keyed, or seeded from a URL parameter; it is a
    // pause on the way somewhere, so it is never a disqualification; and its
    // `question` is never rendered, so varying it by an earlier answer is a
    // setting with no effect.
    await expect(page.getByText('Ends the form')).toHaveCount(0);
    await expect(page.getByText('Hidden question')).toHaveCount(0);
    await expect(page.getByTestId('step-field-key')).toHaveCount(0);
    await expect(page.getByText('Personal email only')).toHaveCount(0);
    await expect(page.getByRole('switch', { name: 'Required' })).toHaveCount(0);
    await expect(page.getByText('Vary the question by a field')).toHaveCount(0);
    // Nor a "show a reveal after this one" switch on a reveal.
    await expect(page.getByTestId('behavior-reveal-after')).toHaveCount(0);
  });

  test('the behavior switch adds a reveal card, and turning it off removes that card', async ({
    page,
    request,
  }) => {
    const { id } = await createForm(request, [
      textStep('q1', 'First question'),
      textStep('q2', 'Second question'),
    ]);
    await openEditor(page, id);
    const spine = page.getByTestId('question-spine');
    await spine.getByText('First question', { exact: true }).click();

    const toggle = page.getByTestId('behavior-reveal-after');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();

    // A real card appeared between the two questions — the list and the switch
    // describe the same thing, so they can never disagree.
    await expect(spine.getByText('Reveal screen', { exact: true })).toBeVisible();
    await expect(spine.getByText('Second question', { exact: true })).toBeVisible();
    await expect(page.getByTestId('behavior-reveal-after')).toHaveAttribute('aria-checked', 'true');

    // Off again removes it (and only it).
    await page.getByTestId('behavior-reveal-after').click();
    await expect(spine.getByText('Reveal screen', { exact: true })).toHaveCount(0);
    await expect(spine.getByText('Second question', { exact: true })).toBeVisible();
  });

  test('TWO reveals in one form each play their OWN copy, in order', async ({ page, request }) => {
    const code = await accountCode(request);
    const { slug } = await createForm(request, [
      textStep('q1', 'First question'),
      reveal('r1', 'Checking your answers'),
      textStep('q2', 'Second question'),
      reveal('r2', 'Building your result'),
      textStep('q3', 'Third question'),
    ]);

    await openPublic(page, `/${code}/me/${slug}`, 'First question');
    await fillAndContinue(page, 'one');

    // First interstitial — its own headline, and it advances on its own.
    await expect(page.locator('.pf-reveal__headline')).toHaveText('Checking your answers', {
      timeout: 10_000,
    });
    await expect(page.locator('.pf__question')).toHaveText('Second question', { timeout: 15_000 });
    await fillAndContinue(page, 'two');

    // Second interstitial — a DIFFERENT headline, proving the copy is per-card
    // and not one shared form-level string.
    await expect(page.locator('.pf-reveal__headline')).toHaveText('Building your result', {
      timeout: 10_000,
    });
    await expect(page.locator('.pf__question')).toHaveText('Third question', { timeout: 15_000 });
  });
});
