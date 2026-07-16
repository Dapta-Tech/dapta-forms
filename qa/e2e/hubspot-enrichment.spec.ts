import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/**
 * Integrations UI round-trip for the HubSpot ENRICHMENT fields
 * (outcomeProperty, staticProperties, inferCompanyFromEmail, bookingSync,
 * valueMaps).
 *
 * This QA account has HubSpot CONNECTED (real token, ~856 portal properties),
 * so every property field renders as the branded searchable Select
 * (components/ui/select.tsx: trigger button + listbox), NOT a free-text
 * <Input>. The tests drive the picker like a user would (open → search → pick
 * a REAL portal property) and assert the plain property names round-trip
 * through the destination config. Free text remains only for VALUE fields
 * (static-property value, booking stage value). The connection itself is never
 * touched.
 *
 * Each test creates its OWN form via the admin API so reruns are idempotent.
 * The UI save path goes through the server action -> PUT /v1/forms/:id/destinations
 * (a partial, live-config write — no publish step needed). The per-form
 * integrations UI lives on the editor's Connect tab
 * (/admin/forms/:id/edit?tab=connect — the old /integrations route redirects).
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

/**
 * REAL portal properties the round-trip uses (verified present in this QA
 * portal's contact properties). The option label the branded Select renders is
 * `${label} (${name})`; the destination config stores the plain `name`.
 */
const PROPS = {
  outcome: { name: 'hs_lead_status', option: 'Lead Status (hs_lead_status)' },
  staticKey: { name: 'utm_source', option: 'utm_source (utm_source)' },
  stage: { name: 'lifecyclestage', option: 'Lifecycle Stage (lifecyclestage)' },
  date: { name: 'closedate', option: 'Close Date (closedate)' },
  hours: { name: 'jobtitle', option: 'Job Title (jobtitle)' },
} as const;

/** The enrichment controls, addressed by their i18n EN aria-labels. Property
 *  pickers are branded Select TRIGGER buttons (aria-haspopup="listbox"); only
 *  the two VALUE fields are free-text inputs. With NO custom-mapping rows on
 *  screen, the only exact 'HubSpot property' trigger is the static-property
 *  key (UTM rows are prefixed 'utm_x HubSpot property', question rows
 *  '<question> → HubSpot property'). */
function fields(page: Page) {
  return {
    hubspotToggle: page.getByRole('switch', { name: 'HubSpot', exact: true }),
    inferToggle: page.getByRole('switch', { name: 'Infer company from email', exact: true }),
    outcome: page.getByRole('button', { name: 'Outcome property', exact: true }),
    staticKey: page.getByRole('button', { name: 'HubSpot property', exact: true }),
    staticValue: page.getByLabel('Value', { exact: true }),
    stageProperty: page.getByRole('button', { name: 'Stage property', exact: true }),
    stageValue: page.getByLabel('Stage value', { exact: true }),
    dateProperty: page.getByRole('button', { name: 'Booking date property', exact: true }),
    hoursProperty: page.getByRole('button', { name: 'Meeting time property', exact: true }),
  };
}

/** Open the Connect tab (per-form integrations home) and wait for the editor. */
async function openConnect(page: Page, id: string) {
  await page.goto(`/admin/forms/${id}/edit?tab=connect`);
  await expect(page.getByTestId('connect-panel')).toBeVisible();
  await expect(page.getByRole('switch', { name: 'HubSpot', exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

/** Drive one branded property Select: open, search the portal list, pick. */
async function pickProperty(page: Page, trigger: Locator, prop: { name: string; option: string }) {
  await trigger.click();
  await page.getByPlaceholder('Search…').fill(prop.name);
  await page.getByRole('option', { name: prop.option, exact: true }).click();
  await expect(trigger).toContainText(prop.option);
}

test('enrichment fields configured via the UI save to the destination (connected picker)', async ({
  page,
  request,
}) => {
  const id = await createForm(request, `QA hubspot ui-save ${Date.now()}`);
  await openConnect(page, id);

  const f = fields(page);

  // Enable the HubSpot card — the body appears with the connected badge; the
  // "properties unavailable" fallback notice must NOT render (picker is live).
  await f.hubspotToggle.click();
  await expect(f.hubspotToggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('HubSpot connected')).toBeVisible();
  await expect(page.getByText(/temporarily unavailable/)).toHaveCount(0);

  // Every property field is a searchable Select over the portal's real list.
  await pickProperty(page, f.outcome, PROPS.outcome);

  await page.getByRole('button', { name: 'Add property', exact: true }).click();
  await pickProperty(page, f.staticKey, PROPS.staticKey);
  await f.staticValue.fill('qa_forms');

  await f.inferToggle.click();
  await expect(f.inferToggle).toHaveAttribute('aria-checked', 'true');

  await pickProperty(page, f.stageProperty, PROPS.stage);
  await f.stageValue.fill('salesqualifiedlead');
  await pickProperty(page, f.dateProperty, PROPS.date);
  await pickProperty(page, f.hoursProperty, PROPS.hours);

  await page.getByRole('button', { name: 'Save integrations', exact: true }).click();
  await expect(page.getByText('Integrations saved.')).toBeVisible({ timeout: 10_000 });

  // The save is a live-config PUT — the admin GET must show the PLAIN property
  // names (the payload shape is unchanged by the picker UI).
  await expect
    .poll(async () => (await getHubspotDestination(request, id))?.outcomeProperty, {
      timeout: 10_000,
    })
    .toBe(PROPS.outcome.name);

  const hs = (await getHubspotDestination(request, id))!;
  expect(hs.enabled).toBe(true);
  expect(hs.staticProperties).toEqual({ [PROPS.staticKey.name]: 'qa_forms' });
  expect(hs.inferCompanyFromEmail).toBe(true);
  expect(hs.bookingSync).toEqual({
    stageProperty: PROPS.stage.name,
    stageValue: 'salesqualifiedlead',
    dateProperty: PROPS.date.name,
    hoursProperty: PROPS.hours.name,
  });
});

test('saved enrichment values re-hydrate the UI after a reload', async ({ page, request }) => {
  const id = await createForm(request, `QA hubspot hydrate ${Date.now()}`);
  // Save via the same API the UI's server action uses (documented fallback);
  // the page must hydrate every field from the stored destination. Property
  // values are REAL portal names so the Select triggers resolve their labels.
  await putDestinations(request, id, [
    {
      type: 'hubspot',
      enabled: true,
      settings: { note: true },
      outcomeProperty: PROPS.outcome.name,
      staticProperties: { [PROPS.staticKey.name]: 'qa_forms' },
      inferCompanyFromEmail: true,
      bookingSync: {
        stageProperty: PROPS.stage.name,
        stageValue: 'salesqualifiedlead',
        dateProperty: PROPS.date.name,
        hoursProperty: PROPS.hours.name,
      },
    },
  ]);

  await openConnect(page, id);

  const assertHydrated = async () => {
    const f = fields(page);
    await expect(f.hubspotToggle).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
    // Select triggers surface the resolved `${label} (${name})` option text…
    await expect(f.outcome).toContainText(PROPS.outcome.option);
    await expect(f.staticKey).toContainText(PROPS.staticKey.option);
    await expect(f.stageProperty).toContainText(PROPS.stage.option);
    await expect(f.dateProperty).toContainText(PROPS.date.option);
    await expect(f.hoursProperty).toContainText(PROPS.hours.option);
    // …while the free-text VALUE fields hydrate verbatim.
    await expect(f.staticValue).toHaveValue('qa_forms');
    await expect(f.stageValue).toHaveValue('salesqualifiedlead');
    await expect(f.inferToggle).toHaveAttribute('aria-checked', 'true');
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

  // The value-map step key is a branded Select now; 'pick' is one of this
  // form's questions, so the group renders in select mode with its label.
  await expect(page.getByTestId('valuemap-key-select').locator('button')).toContainText(
    'Pick one (pick)',
  );
  await expect(page.getByLabel('Answer in the form', { exact: true })).toHaveValue('a');
  await expect(page.getByLabel('Value in HubSpot', { exact: true })).toHaveValue('Option A');
});
