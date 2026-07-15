import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Integrations UI round-trip for the HubSpot ENRICHMENT fields
 * (outcomeProperty, staticProperties, inferCompanyFromEmail, bookingSync,
 * valueMaps).
 *
 * The QA server has NO HUBSPOT_PRIVATE_APP_TOKEN, so the property picker is
 * disabled and every property field renders as a free-text <Input> — exactly
 * the state these tests exercise (free text must still be accepted + saved).
 *
 * Each test creates its OWN form via the admin API so reruns are idempotent.
 * The UI save path goes through the server action -> PUT /v1/forms/:id/destinations
 * (a partial, live-config write — no publish step needed).
 */

const API = 'http://localhost:4400';
// Literal of WEBHOOK_SECRET_MASK from @quill/types (kept inline so the spec
// has no workspace-package import).
const SECRET_MASK = '__DAPTA_FORMS_SECRET_KEEP__';

const baseConfig = {
  version: 1,
  cover: { enabled: true, headline: 'QA HubSpot enrichment', ctaText: 'Start' },
  steps: [
    { key: 'email', type: 'email', question: 'Email?', required: true },
    {
      key: 'pick',
      type: 'multiple_choice',
      question: 'Pick one',
      options: [
        { label: 'A', value: 'a' },
        { label: 'B', value: 'b' },
      ],
    },
  ],
};

async function createForm(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post(`${API}/v1/forms`, {
    data: { name, config: baseConfig },
  });
  expect(res.ok(), `create form failed: ${res.status()}`).toBeTruthy();
  const body = await res.json();
  return body.id as string;
}

async function putDestinations(
  request: APIRequestContext,
  id: string,
  destinations: unknown[],
): Promise<Record<string, unknown>> {
  const res = await request.put(`${API}/v1/forms/${id}/destinations`, {
    data: { destinations },
  });
  expect(res.ok(), `PUT destinations failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function getHubspotDestination(request: APIRequestContext, id: string) {
  const res = await request.get(`${API}/v1/forms/${id}`);
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  const destinations = (body.config?.destinations ?? []) as Array<Record<string, unknown>>;
  return destinations.find((d) => d.type === 'hubspot');
}

/** The enrichment inputs, addressed by their i18n EN aria-labels. */
function fields(page: Page) {
  return {
    hubspotToggle: page.getByRole('switch', { name: 'HubSpot', exact: true }),
    inferToggle: page.getByRole('switch', { name: 'Infer company from email', exact: true }),
    outcome: page.getByLabel('Outcome property', { exact: true }),
    // With NO field-mapping rows on screen, the only exact 'HubSpot property'
    // input is the static-property key (UTM rows are prefixed, e.g.
    // 'utm_source HubSpot property').
    staticKey: page.getByLabel('HubSpot property', { exact: true }),
    staticValue: page.getByLabel('Value', { exact: true }),
    stageProperty: page.getByLabel('Stage property', { exact: true }),
    stageValue: page.getByLabel('Stage value', { exact: true }),
    dateProperty: page.getByLabel('Booking date property', { exact: true }),
    hoursProperty: page.getByLabel('Meeting time property', { exact: true }),
  };
}

test('enrichment fields configured via the UI save to the destination (free text, no token)', async ({
  page,
  request,
}) => {
  const id = await createForm(request, `QA hubspot ui-save ${Date.now()}`);
  await page.goto(`/admin/forms/${id}/integrations`);

  const f = fields(page);

  // Enable the HubSpot card — the body (and the "no token" notice) appears.
  await f.hubspotToggle.click();
  await expect(f.hubspotToggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText(/HUBSPOT_PRIVATE_APP_TOKEN/)).toBeVisible();

  // The picker is disabled without a token, but inputs accept free text.
  await f.outcome.fill('lead_bucket');

  await page.getByRole('button', { name: 'Add property', exact: true }).click();
  await f.staticKey.fill('lead_source');
  await f.staticValue.fill('qa_forms');

  await f.inferToggle.click();
  await expect(f.inferToggle).toHaveAttribute('aria-checked', 'true');

  await f.stageProperty.fill('lifecyclestage');
  await f.stageValue.fill('salesqualifiedlead');
  await f.dateProperty.fill('demo_booked_date');
  await f.hoursProperty.fill('demo_booked_time');

  await page.getByRole('button', { name: 'Save integrations', exact: true }).click();
  await expect(page.getByText('Integrations saved.')).toBeVisible({ timeout: 10_000 });

  // The save is a live-config PUT — the admin GET must show the values.
  await expect
    .poll(async () => (await getHubspotDestination(request, id))?.outcomeProperty, {
      timeout: 10_000,
    })
    .toBe('lead_bucket');

  const hs = (await getHubspotDestination(request, id))!;
  expect(hs.enabled).toBe(true);
  expect(hs.staticProperties).toEqual({ lead_source: 'qa_forms' });
  expect(hs.inferCompanyFromEmail).toBe(true);
  expect(hs.bookingSync).toEqual({
    stageProperty: 'lifecyclestage',
    stageValue: 'salesqualifiedlead',
    dateProperty: 'demo_booked_date',
    hoursProperty: 'demo_booked_time',
  });
});

test('saved enrichment values re-hydrate the UI after a reload', async ({ page, request }) => {
  const id = await createForm(request, `QA hubspot hydrate ${Date.now()}`);
  // Save via the same API the UI's server action uses (documented fallback);
  // the page must hydrate every field from the stored destination.
  await putDestinations(request, id, [
    {
      type: 'hubspot',
      enabled: true,
      settings: { note: true },
      outcomeProperty: 'lead_bucket',
      staticProperties: { lead_source: 'qa_forms' },
      inferCompanyFromEmail: true,
      bookingSync: {
        stageProperty: 'lifecyclestage',
        stageValue: 'salesqualifiedlead',
        dateProperty: 'demo_booked_date',
        hoursProperty: 'demo_booked_time',
      },
    },
  ]);

  await page.goto(`/admin/forms/${id}/integrations`);

  const assertHydrated = async () => {
    const f = fields(page);
    await expect(f.hubspotToggle).toHaveAttribute('aria-checked', 'true');
    await expect(f.outcome).toHaveValue('lead_bucket');
    await expect(f.staticKey).toHaveValue('lead_source');
    await expect(f.staticValue).toHaveValue('qa_forms');
    await expect(f.inferToggle).toHaveAttribute('aria-checked', 'true');
    await expect(f.stageProperty).toHaveValue('lifecyclestage');
    await expect(f.stageValue).toHaveValue('salesqualifiedlead');
    await expect(f.dateProperty).toHaveValue('demo_booked_date');
    await expect(f.hoursProperty).toHaveValue('demo_booked_time');
  };

  await assertHydrated();

  // Persistence: a full reload re-reads the stored config and hydrates again.
  await page.reload();
  await assertHydrated();
});

test('admin GET masks only the webhook secret — enrichment values come back verbatim', async ({
  request,
}) => {
  const id = await createForm(request, `QA hubspot masking ${Date.now()}`);
  const putResponse = await putDestinations(request, id, [
    {
      type: 'webhook',
      enabled: true,
      settings: { url: 'https://example.com/qa-hook', secret: 'qa-super-secret' },
    },
    {
      type: 'hubspot',
      enabled: true,
      settings: { note: true },
      fieldMappings: { email: 'email' },
      valueMaps: { pick: { a: 'Option A' } },
      outcomeProperty: 'lead_bucket',
      staticProperties: { lead_source: 'qa_forms' },
      inferCompanyFromEmail: true,
      bookingSync: { stageProperty: 'lifecyclestage', stageValue: 'salesqualifiedlead' },
    },
  ]);

  // The PUT response itself must never echo the plaintext secret.
  const putDests = (putResponse.config as { destinations: Array<Record<string, unknown>> })
    .destinations;
  const putWebhook = putDests.find((d) => d.type === 'webhook')!;
  expect((putWebhook.settings as Record<string, unknown>).secret).toBe(SECRET_MASK);

  // GET: webhook secret masked; URL and every HubSpot enrichment field verbatim.
  const res = await request.get(`${API}/v1/forms/${id}`);
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  const destinations = body.config.destinations as Array<Record<string, unknown>>;

  const webhook = destinations.find((d) => d.type === 'webhook')!;
  expect((webhook.settings as Record<string, unknown>).secret).toBe(SECRET_MASK);
  expect((webhook.settings as Record<string, unknown>).url).toBe('https://example.com/qa-hook');

  const hs = destinations.find((d) => d.type === 'hubspot')!;
  expect(hs.enabled).toBe(true);
  expect(hs.fieldMappings).toEqual({ email: 'email' });
  expect(hs.valueMaps).toEqual({ pick: { a: 'Option A' } });
  expect(hs.outcomeProperty).toBe('lead_bucket');
  expect(hs.staticProperties).toEqual({ lead_source: 'qa_forms' });
  expect(hs.inferCompanyFromEmail).toBe(true);
  expect(hs.bookingSync).toEqual({
    stageProperty: 'lifecyclestage',
    stageValue: 'salesqualifiedlead',
  });
});

test('valueMaps set via the API render as mapping rows in the UI', async ({ page, request }) => {
  const id = await createForm(request, `QA hubspot valuemaps ${Date.now()}`);
  await putDestinations(request, id, [
    { type: 'hubspot', enabled: true, settings: { note: true }, valueMaps: { pick: { a: 'Option A' } } },
  ]);

  await page.goto(`/admin/forms/${id}/integrations`);

  // No fieldMappings rows exist, so the only 'Form step key' input on screen
  // is the value-map group's step key.
  await expect(page.getByLabel('Form step key', { exact: true })).toHaveValue('pick');
  await expect(page.getByLabel('Form answer value', { exact: true })).toHaveValue('a');
  await expect(page.getByLabel('HubSpot value', { exact: true })).toHaveValue('Option A');
});
