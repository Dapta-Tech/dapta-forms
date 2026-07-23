import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * V5-V4-05 — the Connect tab's webhook must persist HONESTLY.
 *
 * The closure audit's challenge phase broke the "autosaves like every other tab"
 * claim three ways, all rooted in `buildDestinations()` falling back to
 * `initialDestinations` — a MOUNT-TIME server snapshot the tab's refetch never
 * refreshed — and in an empty URL carrying that snapshot forward:
 *
 *  1. Clearing the URL said "saved" but kept delivering to a ghost endpoint.
 *  2. A malformed URL after a save reverted the STORED url to the page-load
 *     value, and a real respondent was delivered to that superseded URL.
 *  3. Connect→Build→Connect faster than the fire-and-forget unmount flush let
 *     the remount READ overtake the WRITE, silently dropping a saved webhook.
 *
 * Every persistence assertion reads back from GET /v1/forms/:id → config
 * .destinations (the source of truth an actual delivery derives from), never the
 * screen alone. Forms are minted per test via POST /v1/forms.
 */

const API = 'http://localhost:4400';
const RUN = randomUUID().slice(0, 8);
let seq = 0;

interface WebhookDest {
  type: 'webhook';
  enabled: boolean;
  settings: { url?: string };
}
type Dest = WebhookDest | { type: string; [k: string]: unknown };

async function createForm(request: APIRequestContext): Promise<{ id: string }> {
  seq += 1;
  const name = `v5wh-${RUN}-w${test.info().workerIndex}-${seq}`;
  const config = {
    version: 1,
    steps: [
      { key: 'work_email', type: 'email', question: 'Work email', required: true },
      { key: 'company', type: 'text', question: 'Company name' },
    ],
  };
  const res = await request.post(`${API}/v1/forms`, { data: { name, config } });
  expect(res.ok(), `create form failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: string };
}

/** The stored destinations, as a real delivery would read them. */
async function storedDestinations(request: APIRequestContext, id: string): Promise<Dest[]> {
  const res = await request.get(`${API}/v1/forms/${id}`);
  expect(res.ok(), `GET /v1/forms/${id} failed: ${res.status()}`).toBeTruthy();
  const f = (await res.json()) as { config?: { destinations?: Dest[] } };
  return f.config?.destinations ?? [];
}

const storedWebhook = (dests: Dest[]): WebhookDest | undefined =>
  dests.find((d): d is WebhookDest => d.type === 'webhook');

/** The webhook URL input inside the Connect tab's webhook card. */
const urlInput = (page: Page) => page.locator('input[type="url"]');
const saveStatus = (page: Page) => page.getByTestId('integrations-save-status');

/** Turn the webhook card on and wait for it to render its URL field. */
async function enableWebhook(page: Page): Promise<void> {
  const sw = page.getByRole('switch', { name: 'Webhook', exact: true });
  await expect(sw).toBeVisible({ timeout: 20_000 });
  if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
  await expect(urlInput(page)).toBeVisible();
}

async function openConnect(page: Page, id: string): Promise<void> {
  await page.goto(`/admin/forms/${id}/edit?tab=connect`);
  await expect(page.getByTestId('connect-integrations')).toBeVisible({ timeout: 20_000 });
}

test.describe('V5-V4-05 — webhook persists honestly', () => {
  test('clearing the URL REMOVES the webhook — no ghost delivery', async ({ page, request }) => {
    const { id } = await createForm(request);
    await openConnect(page, id);
    await enableWebhook(page);

    await urlInput(page).fill('http://localhost:9/hook-a');
    await expect(saveStatus(page)).toHaveAttribute('data-status', 'saved', { timeout: 15_000 });
    expect(storedWebhook(await storedDestinations(request, id))?.settings.url).toBe(
      'http://localhost:9/hook-a',
    );

    // Reload so the stored URL becomes the mount snapshot — the exact state the
    // old code reverted to.
    await openConnect(page, id);
    await expect(urlInput(page)).toHaveValue('http://localhost:9/hook-a');

    // Clear it. The status must go green AND the stored destination must be gone.
    await urlInput(page).fill('');
    await expect(saveStatus(page)).toHaveAttribute('data-status', 'saved', { timeout: 15_000 });
    expect(
      storedWebhook(await storedDestinations(request, id)),
      'clearing the URL must delete the webhook, not keep a ghost one',
    ).toBeUndefined();
  });

  test('a malformed URL keeps the LAST SAVED url, not the mount snapshot', async ({
    page,
    request,
  }) => {
    const { id } = await createForm(request);
    await openConnect(page, id);
    await enableWebhook(page);

    // Save an OLD url, then reload so OLD is the mount snapshot.
    await urlInput(page).fill('http://localhost:9/old-hook');
    await expect(saveStatus(page)).toHaveAttribute('data-status', 'saved', { timeout: 15_000 });
    await openConnect(page, id);
    await expect(urlInput(page)).toHaveValue('http://localhost:9/old-hook');

    // Save a NEW url in this same session.
    await urlInput(page).fill('http://localhost:9/new-hook');
    await expect(saveStatus(page)).toHaveAttribute('data-status', 'saved', { timeout: 15_000 });
    expect(storedWebhook(await storedDestinations(request, id))?.settings.url).toBe(
      'http://localhost:9/new-hook',
    );

    // Now type garbage. The card reports it (status 'partial'), but the STORED
    // url must stay the last valid one (new-hook) — never revert to the mount
    // value (old-hook), which is what a respondent would have been delivered to.
    await urlInput(page).fill('ftp://not-a-webhook');
    await expect(saveStatus(page)).toHaveAttribute('data-status', 'partial', { timeout: 15_000 });
    expect(
      storedWebhook(await storedDestinations(request, id))?.settings.url,
      'a malformed draft must not revert the stored url to the page-load value',
    ).toBe('http://localhost:9/new-hook');
  });

  test('rapid Connect→Build→Connect never drops the saved webhook', async ({ page, request }) => {
    test.setTimeout(120_000);
    const { id } = await createForm(request);
    await openConnect(page, id);
    await enableWebhook(page);
    await urlInput(page).fill('http://localhost:9/race-hook');
    await expect(saveStatus(page)).toHaveAttribute('data-status', 'saved', { timeout: 15_000 });

    // Bounce between tabs faster than a flush can land, then read back. The
    // loader now awaits the pending write, so the webhook must survive every
    // cycle instead of being read-then-overwritten away.
    const misses: string[] = [];
    for (let i = 1; i <= 8; i++) {
      // Edit → immediately leave to Build (unmount flush) → come straight back.
      await urlInput(page).fill(`http://localhost:9/race-hook-${i}`);
      await page.getByTestId('editor-tab-build').click();
      await expect(page.getByTestId('connect-panel')).toHaveCount(0);
      await page.getByTestId('editor-tab-connect').click();
      await expect(page.getByTestId('connect-integrations')).toBeVisible({ timeout: 20_000 });
      await expect(urlInput(page)).toBeVisible({ timeout: 20_000 });

      const wh = storedWebhook(await storedDestinations(request, id));
      if (!wh) misses.push(`cycle ${i}: webhook was dropped from stored config`);
    }
    expect(misses, 'the webhook must survive every rapid tab bounce').toEqual([]);
  });
});
