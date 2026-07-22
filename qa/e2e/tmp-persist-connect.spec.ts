import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const API = 'http://localhost:4400';

const baseConfig = {
  version: 1,
  cover: { enabled: true, headline: 'Persist QA', ctaText: 'Start' },
  steps: [
    { key: 'work_email', type: 'email', question: 'Work email', required: true },
    { key: 'company', type: 'text', question: 'Company name' },
  ],
  destinations: [
    {
      type: 'hubspot',
      enabled: true,
      fieldMappings: { work_email: 'email' },
      staticProperties: { source: 'qa' },
    },
  ],
};

let seq = 0;
async function createForm(request: APIRequestContext, label: string, cfg: unknown = baseConfig) {
  seq += 1;
  const res = await request.post(`${API}/v1/forms`, {
    data: { name: `persist ${label} ${seq}-${Date.now()}`, config: cfg },
  });
  expect(res.ok(), `create failed ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: string; slug: string };
}

async function getForm(request: APIRequestContext, id: string) {
  const res = await request.get(`${API}/v1/forms/${id}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as {
    config: Record<string, any>;
    draftConfig: Record<string, any> | null;
  };
}

function hs(cfg: Record<string, any>) {
  return (cfg.destinations ?? []).find((d: any) => d.type === 'hubspot');
}
function wh(cfg: Record<string, any>) {
  return (cfg.destinations ?? []).find((d: any) => d.type === 'webhook');
}

/** Pick a HubSpot property in a branded Select by its aria-label. */
async function pickProperty(page: Page, ariaLabel: string, optionText: string) {
  await page.getByRole('button', { name: ariaLabel, exact: true }).click();
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  const search = listbox.getByRole('textbox').first();
  if (await search.count()) await search.fill(optionText);
  await listbox.getByRole('option').filter({ hasText: optionText }).first().click();
}

// ---------------------------------------------------------------------------
// P1 — edit a mapping and RELOAD immediately (inside the 900ms debounce)
// ---------------------------------------------------------------------------
test('P1 mapping edit + immediate reload', async ({ page, request }) => {
  const { id } = await createForm(request, 'reload');
  await page.goto(`/admin/forms/${id}/edit?tab=connect`);
  await expect(page.getByTestId('integrations-save-status')).toHaveAttribute('data-status', 'saved');

  await pickProperty(page, 'Company name → HubSpot property', 'Company Name');
  // do NOT wait for the debounce — reload right away
  await page.reload();
  await expect(page.getByTestId('connect-panel')).toBeVisible();
  await page.waitForTimeout(1500);

  const { config } = await getForm(request, id);
  console.log('P1 stored fieldMappings', JSON.stringify(hs(config)?.fieldMappings));
  expect(hs(config)?.fieldMappings?.company).toBeTruthy();
});

// ---------------------------------------------------------------------------
// P2 — edit a mapping and navigate AWAY immediately (SPA nav to another tab,
// then a hard nav to the forms list)
// ---------------------------------------------------------------------------
test('P2 mapping edit + immediate SPA tab switch', async ({ page, request }) => {
  const { id } = await createForm(request, 'spa');
  await page.goto(`/admin/forms/${id}/edit?tab=connect`);
  await expect(page.getByTestId('integrations-save-status')).toHaveAttribute('data-status', 'saved');

  await pickProperty(page, 'Company name → HubSpot property', 'Company Name');
  await page.getByTestId('editor-tab-build').click();
  await page.waitForTimeout(1500);

  const { config } = await getForm(request, id);
  console.log('P2 stored fieldMappings', JSON.stringify(hs(config)?.fieldMappings));
  expect(hs(config)?.fieldMappings?.company).toBeTruthy();
});

// ---------------------------------------------------------------------------
// P3 — a hubspot edit, THEN an invalid webhook URL, then fix the URL.
// Does the earlier hubspot edit survive?
// ---------------------------------------------------------------------------
test('P3 hubspot edit blocked behind an invalid webhook URL', async ({ page, request }) => {
  const { id } = await createForm(request, 'invalidurl');
  await page.goto(`/admin/forms/${id}/edit?tab=connect`);
  await expect(page.getByTestId('integrations-save-status')).toHaveAttribute('data-status', 'saved');

  // 1. a good hubspot edit, allowed to settle
  await pickProperty(page, 'Company name → HubSpot property', 'Company Name');
  await expect(page.getByTestId('integrations-save-status')).toHaveAttribute(
    'data-status',
    'saved',
    { timeout: 5000 },
  );
  let cfg = (await getForm(request, id)).config;
  console.log('P3 after hubspot edit', JSON.stringify(hs(cfg)?.fieldMappings));

  // 2. turn the webhook card on and type an INVALID url
  await page.getByRole('button', { name: 'Webhook', exact: true }).click();
  const url = page.getByPlaceholder('https://example.com/webhooks/forms');
  await expect(url).toBeVisible();
  await url.fill('notaurl');
  await page.waitForTimeout(1500);
  const status1 = await page.getByTestId('integrations-save-status').getAttribute('data-status');
  console.log('P3 status after invalid url:', status1);

  // 3. now make ANOTHER hubspot edit while the URL is still invalid
  await pickProperty(page, 'Outcome property', 'Industry');
  await page.waitForTimeout(1500);
  const status2 = await page.getByTestId('integrations-save-status').getAttribute('data-status');
  console.log('P3 status after 2nd hubspot edit (url still bad):', status2);
  cfg = (await getForm(request, id)).config;
  console.log('P3 stored outcomeProperty while url bad:', hs(cfg)?.outcomeProperty);

  // 4. leave the page while the URL is still invalid — what is persisted?
  await page.goto('/admin/forms');
  await page.waitForTimeout(1500);
  cfg = (await getForm(request, id)).config;
  console.log(
    'P3 after leaving with bad url — fieldMappings:',
    JSON.stringify(hs(cfg)?.fieldMappings),
    'outcomeProperty:',
    hs(cfg)?.outcomeProperty,
    'webhook:',
    JSON.stringify(wh(cfg)),
  );

  // 5. come back and fix the url
  await page.goto(`/admin/forms/${id}/edit?tab=connect`);
  await expect(page.getByTestId('connect-panel')).toBeVisible();
  const url2 = page.getByPlaceholder('https://example.com/webhooks/forms');
  const urlValue = (await url2.count()) ? await url2.inputValue() : '(card collapsed)';
  console.log('P3 webhook url after reload:', urlValue);
});

// ---------------------------------------------------------------------------
// P4 — clear a webhook URL while the toggle stays ON (permanent error state?)
// ---------------------------------------------------------------------------
test('P4 clearing a saved webhook URL with the toggle on', async ({ page, request }) => {
  const { id } = await createForm(request, 'clearurl', {
    ...baseConfig,
    destinations: [
      ...baseConfig.destinations,
      { type: 'webhook', enabled: true, settings: { url: 'https://example.com/hook' } },
    ],
  });
  await page.goto(`/admin/forms/${id}/edit?tab=connect`);
  const url = page.getByPlaceholder('https://example.com/webhooks/forms');
  await expect(url).toBeVisible();
  await url.fill('');
  await page.waitForTimeout(1500);
  console.log(
    'P4 status after clearing url:',
    await page.getByTestId('integrations-save-status').getAttribute('data-status'),
  );
  const errText = await page.getByTestId('connect-integrations').innerText();
  console.log('P4 visible error?', /valid|https|invalid/i.test(errText));

  // now make a hubspot edit — is it also blocked?
  await pickProperty(page, 'Company name → HubSpot property', 'Company Name');
  await page.waitForTimeout(1500);
  const cfg = (await getForm(request, id)).config;
  console.log('P4 stored after hubspot edit w/ empty url:', JSON.stringify(hs(cfg)?.fieldMappings));
  console.log(
    'P4 status:',
    await page.getByTestId('integrations-save-status').getAttribute('data-status'),
  );
});
