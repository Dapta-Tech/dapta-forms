import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * V6 — the Scheduler question type (Calendly).
 *
 * A scheduler is a real step in the flow: it appears in the add-question
 * gallery, has its own settings panel (event-type picker, or a prompt to connect
 * Calendly when the account has no token), and on the public form it renders the
 * booking embed under the step's own question. Booking answers the step, so a
 * required scheduler blocks Continue until a slot is picked — which is what
 * makes "on booking → submit the form" fall out of the normal last-step/goto
 * path rather than being a special case.
 *
 * This QA account has no Calendly token connected, so the panel is expected to
 * show the connect prompt — that IS the degraded state we want to lock in.
 */

const API = 'http://localhost:4400';
const RUN = randomUUID().slice(0, 8);
let seq = 0;

const CALENDLY_URL = 'https://calendly.com/dapta/30min';
const SCHED_Q = 'Separa tu puesto ahora';

async function accountCode(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API}/v1/me`);
  const me = (await res.json()) as { accountCode?: string; accountShortCode?: string };
  return (me.accountCode ?? me.accountShortCode) as string;
}

/** A form whose 2nd step is a configured Calendly scheduler. */
async function createForm(
  request: APIRequestContext,
  scheduler: Record<string, unknown> | null,
): Promise<{ id: string; slug: string }> {
  seq += 1;
  const res = await request.post(`${API}/v1/forms`, {
    data: {
      name: `v6sched-${RUN}-${seq}`,
      config: {
        version: 1,
        steps: [
          { key: 'email', type: 'email', question: 'Work email', required: true },
          {
            key: 'book',
            type: 'scheduler',
            question: SCHED_Q,
            required: true,
            ...(scheduler ? { scheduler } : {}),
          },
        ],
      },
    },
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

test.describe('V6 — Scheduler question type', () => {
  test.setTimeout(90_000);

  test('the Scheduler card is offered in the add-question gallery', async ({ page, request }) => {
    const { id } = await createForm(request, null);
    await openEditor(page, id);

    // Open the gallery from the spine's add button.
    await page.getByTestId('question-spine').locator('> button.border-dashed').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Scheduler', { exact: true })).toBeVisible();
  });

  test('a scheduler step shows its settings panel (connect prompt without a token)', async ({
    page,
    request,
  }) => {
    const { id } = await createForm(request, { provider: 'calendly', prefill: true });
    await openEditor(page, id);

    await page.getByTestId('question-spine').getByRole('button', { name: new RegExp(SCHED_Q) }).click();
    await expect(page.getByTestId('scheduler-panel')).toBeVisible();
    // No Calendly token on this QA account → the panel prompts to connect
    // instead of erroring, and never shows an empty event-type picker.
    const prompt = page.getByTestId('scheduler-connect-prompt');
    await expect(prompt).toBeVisible({ timeout: 20_000 });
    // Scoped to the prompt — the admin sidebar also has an "Integrations" link.
    await expect(prompt.getByRole('link')).toHaveAttribute('href', '/admin/integrations');
  });

  test('the public form renders the booking embed under the scheduler question', async ({
    page,
    request,
  }) => {
    const code = await accountCode(request);
    const { slug } = await createForm(request, {
      provider: 'calendly',
      url: CALENDLY_URL,
      prefill: true,
    });

    await page.goto(`/${code}/you/${slug}`);
    // Answer the email step to reach the scheduler.
    const email = page.locator('.pf__fields input').first();
    await expect(email).toBeVisible({ timeout: 20_000 });
    await email.fill('rep@acme.io');
    await page.locator('.pf__btn--inline, .pf__btn').first().click();

    // The scheduler renders as a normal step: its own question + the embed.
    await expect(page.locator('.pf__question')).toHaveText(SCHED_Q, { timeout: 20_000 });
    await expect(page.getByTestId('booking-screen')).toBeVisible();
    await expect(page.getByTestId('booking-embed-calendly')).toBeAttached();
    // Required → no skip button (booking is the only way forward).
    await expect(page.getByText('Skip for now')).toHaveCount(0);
  });

  test('an unconfigured scheduler degrades to a clear message, not a broken embed', async ({
    page,
    request,
  }) => {
    const code = await accountCode(request);
    const { slug } = await createForm(request, { provider: 'calendly', prefill: true }); // no url

    await page.goto(`/${code}/you/${slug}`);
    const email = page.locator('.pf__fields input').first();
    await expect(email).toBeVisible({ timeout: 20_000 });
    await email.fill('rep@acme.io');
    await page.locator('.pf__btn--inline, .pf__btn').first().click();

    await expect(page.getByTestId('scheduler-unconfigured')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('booking-screen')).toHaveCount(0);
  });
});
