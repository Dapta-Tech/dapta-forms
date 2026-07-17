import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * N3 — integrations connect + per-form mapping (HubSpot ALREADY connected).
 *
 * This QA env has FORMS_ENCRYPTION_KEY set (encryptionAvailable:true) and a real
 * HubSpot token connected at the account level, so `GET /v1/integrations` reports
 * hubspot connected and the property picker resolves the portal's 800+ contact
 * properties. These tests exercise the CONNECTED surfaces only — they never
 * connect/disconnect for real (that would mutate the shared account connection)
 * and never assert on a token value.
 *
 * Mix of API (via the `request` context, hitting :4400 directly) and UI. Each UI
 * test creates its OWN form via the admin API with a per-run unique name so
 * reruns stay idempotent; the accountCode is resolved from GET /v1/me, never
 * hardcoded. Playwright's `request` fixture is baseURL'd at the web app, so the
 * API is always addressed absolutely.
 */

const API = 'http://localhost:4400';

// Per-run unique form names WITHOUT Date.now() (banned): a worker-scoped counter.
let seq = 0;
function formName(label: string, workerIndex: number): string {
  seq += 1;
  return `QA N3 ${label} w${workerIndex}-${seq}`;
}

/** A form with an email step plus a couple more question steps (name + text). */
const baseConfig = {
  version: 1,
  cover: { enabled: true, headline: 'QA N3 integrations', ctaText: 'Start' },
  steps: [
    { key: 'work_email', type: 'email', question: 'Work email', required: true },
    { key: 'full_name', type: 'name', question: 'Your name' },
    { key: 'company', type: 'text', question: 'Company name' },
  ],
};

async function resolveAccountCode(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API}/v1/me`);
  expect(res.ok(), `GET /v1/me failed: ${res.status()}`).toBeTruthy();
  const me = await res.json();
  expect(typeof me.accountCode, 'accountCode should be a string').toBe('string');
  expect(me.accountCode.length).toBeGreaterThan(0);
  return me.accountCode as string;
}

async function createForm(
  request: APIRequestContext,
  name: string,
): Promise<string> {
  const res = await request.post(`${API}/v1/forms`, { data: { name, config: baseConfig } });
  expect(res.ok(), `create form failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  return body.id as string;
}

/** The property picker (branded searchable Select) for the "Work email" question. */
function emailPropertyPicker(page: Page) {
  // The Select trigger is a <button aria-haspopup="listbox"> whose aria-label is
  // `${question} → ${property}` = "Work email → HubSpot property".
  return page.getByRole('button', { name: /Work email.*HubSpot property/ });
}

test('GET /v1/integrations reports HubSpot connected + encryption, and never a raw token', async ({
  request,
}) => {
  // Resolve identity from /v1/me (never hardcode the account).
  await resolveAccountCode(request);

  const res = await request.get(`${API}/v1/integrations`);
  expect(res.ok(), `GET /v1/integrations failed: ${res.status()}`).toBeTruthy();
  const body = await res.json();

  // Server encryption is available in this env.
  expect(body.encryptionAvailable).toBe(true);

  // HubSpot is connected with a last4, and exposes NO raw/encrypted token field.
  const providers = body.providers as Array<Record<string, unknown>>;
  const hs = providers.find((p) => p.provider === 'hubspot');
  expect(hs, 'hubspot should be present in providers').toBeTruthy();
  expect(hs!.connected).toBe(true);
  expect(typeof hs!.last4, 'last4 should be a string').toBe('string');
  expect((hs!.last4 as string).length).toBeGreaterThan(0);

  // Token-free contract: no key on the provider view mentions a token, and the
  // ciphertext columns are absent (last4/connectedAt/label/connected/provider only).
  const tokenishKeys = Object.keys(hs!).filter((k) => /token/i.test(k));
  expect(tokenishKeys, 'provider view must carry no token field').toEqual([]);
  expect(hs).not.toHaveProperty('encryptedToken');
  expect(hs).not.toHaveProperty('encrypted_token');
});

test('/admin/integrations shows HubSpot connected (Disconnect), not a Connect token input', async ({
  page,
}) => {
  await page.goto('/admin/integrations');

  // Scope to the HubSpot provider card (closest <section> ancestor of its heading).
  const hubspotCard = page
    .getByRole('heading', { level: 2, name: 'HubSpot', exact: true })
    .locator('xpath=ancestor::section[1]');

  // Connected UI: a "Connected" badge, the "Connected as HubSpot" label, and a
  // Disconnect affordance (NOT clicked — the connection stays intact).
  await expect(hubspotCard.getByText('Connected', { exact: true })).toBeVisible();
  await expect(hubspotCard.getByText('Connected as HubSpot')).toBeVisible();
  await expect(hubspotCard.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();

  // NOT the pre-connect state: no "Connect" button and no token (password) input
  // in the HubSpot card. (Calendly's card, which is unconnected, is out of scope.)
  await expect(hubspotCard.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);
  await expect(hubspotCard.locator('input[type="password"]')).toHaveCount(0);
});

test('per-form integrations shows the HubSpot mapping with a searchable property Select', async ({
  page,
  request,
}, testInfo) => {
  const id = await createForm(request, formName('mapping-ui', testInfo.workerIndex));
  await page.goto(`/admin/forms/${id}/integrations`);

  // Mapping UI is shown because HubSpot is connected: the connected badge renders
  // and the "connect first" prompt (Go to Connections) does NOT.
  await expect(page.getByText('HubSpot connected')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to Connections' })).toHaveCount(0);

  // Enable the HubSpot card to reveal its body (the card collapses when disabled).
  const hubspotToggle = page.getByRole('switch', { name: 'HubSpot', exact: true });
  await hubspotToggle.click();
  await expect(hubspotToggle).toHaveAttribute('aria-checked', 'true');

  // "Map questions" rows are shown, one per non-message question step.
  await expect(page.getByText('Map questions', { exact: true })).toBeVisible();

  // The property picker is the branded searchable Select (a button opening a
  // listbox), NOT a native <select> or a free-text input.
  const picker = emailPropertyPicker(page);
  await expect(picker).toBeVisible();
  await expect(picker).toHaveAttribute('aria-haspopup', 'listbox');

  // Open it and search "email" → real HubSpot properties surface as options.
  const selectRoot = picker.locator('xpath=ancestor::div[1]');
  await picker.click();
  await expect(selectRoot.getByRole('listbox')).toBeVisible();
  await selectRoot.getByPlaceholder('Search…').fill('email');

  // The exact "email" property is present, alongside several other email-ish ones.
  await expect(selectRoot.getByRole('option', { name: 'Email (email)', exact: true })).toBeVisible();
  expect(await selectRoot.getByRole('option').count()).toBeGreaterThanOrEqual(3);
});

test('Auto-map maps the email question to the email property and toasts a count', async ({
  page,
  request,
}, testInfo) => {
  const id = await createForm(request, formName('auto-map', testInfo.workerIndex));
  await page.goto(`/admin/forms/${id}/integrations`);

  // Enable HubSpot to reveal the mapping + the Auto-map action.
  const hubspotToggle = page.getByRole('switch', { name: 'HubSpot', exact: true });
  await hubspotToggle.click();
  await expect(hubspotToggle).toHaveAttribute('aria-checked', 'true');

  // The email question starts unmapped ("— none —").
  const picker = emailPropertyPicker(page);
  await expect(picker).toContainText('— none —');

  // Auto-map: a success toast with a count appears...
  await page.getByRole('button', { name: 'Auto-map', exact: true }).click();
  await expect(page.getByText(/Auto-mapped \d+ question/)).toBeVisible();

  // ...and the email question now maps to the HubSpot "email" property.
  await expect(picker).toContainText('Email (email)');
});
