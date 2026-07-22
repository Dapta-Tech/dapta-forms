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
    { type: 'hubspot', enabled: true, fieldMappings: { work_email: 'email' } },
  ],
};

let seq = 0;
async function createForm(request: APIRequestContext, label: string, cfg: unknown = baseConfig) {
  seq += 1;
  const res = await request.post(`${API}/v1/forms`, {
    data: { name: `persist2 ${label} ${seq}-${Date.now()}`, config: cfg },
  });
  expect(res.ok(), `create failed ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: string; slug: string };
}
async function getForm(request: APIRequestContext, id: string) {
  const res = await request.get(`${API}/v1/forms/${id}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { config: any; draftConfig: any };
}
const hs = (cfg: any) => (cfg.destinations ?? []).find((d: any) => d.type === 'hubspot');
const wh = (cfg: any) => (cfg.destinations ?? []).find((d: any) => d.type === 'webhook');

async function pickProperty(page: Page, ariaLabel: string, optionText: string) {
  await page.getByRole('button', { name: ariaLabel, exact: true }).click();
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  const search = listbox.getByRole('textbox').first();
  if (await search.count()) await search.fill(optionText);
  await listbox.getByRole('option').filter({ hasText: optionText }).first().click();
}

// ---------------------------------------------------------------------------
// P1b — instrumented reload: was a destinations PUT even attempted?
// ---------------------------------------------------------------------------
test('P1b immediate reload — network trace', async ({ page, request }) => {
  const { id } = await createForm(request, 'reload2');
  const puts: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/destinations')) puts.push(`REQ ${r.method()} ${r.url()}`);
  });
  page.on('requestfailed', (r) => {
    if (r.url().includes('/destinations')) puts.push(`FAILED ${r.url()} ${r.failure()?.errorText}`);
  });
  await page.goto(`/admin/forms/${id}/edit?tab=connect`);
  await expect(page.getByTestId('integrations-save-status')).toHaveAttribute('data-status', 'saved');
  await pickProperty(page, 'Company name → HubSpot property', 'Company Name');
  console.log(
    'P1b status right before reload:',
    await page.getByTestId('integrations-save-status').getAttribute('data-status'),
  );
  await page.reload();
  await page.waitForTimeout(2000);
  console.log('P1b net:', JSON.stringify(puts));
  const { config } = await getForm(request, id);
  console.log('P1b stored:', JSON.stringify(hs(config)?.fieldMappings));
});

// ---------------------------------------------------------------------------
// P1c — same but a HARD navigation to a different URL (browser back / typing)
// ---------------------------------------------------------------------------
test('P1c immediate hard nav away', async ({ page, request }) => {
  const { id } = await createForm(request, 'hardnav');
  await page.goto(`/admin/forms/${id}/edit?tab=connect`);
  await expect(page.getByTestId('integrations-save-status')).toHaveAttribute('data-status', 'saved');
  await pickProperty(page, 'Company name → HubSpot property', 'Company Name');
  await page.goto('/admin/forms');
  await page.waitForTimeout(2000);
  const { config } = await getForm(request, id);
  console.log('P1c stored:', JSON.stringify(hs(config)?.fieldMappings));
});

// ---------------------------------------------------------------------------
// P3b — invalid webhook URL blocks unrelated hubspot edits (switch role fixed)
// ---------------------------------------------------------------------------
test('P3b invalid webhook URL blocks hubspot edits', async ({ page, request }) => {
  const { id } = await createForm(request, 'badurl');
  await page.goto(`/admin/forms/${id}/edit?tab=connect`);
  await expect(page.getByTestId('integrations-save-status')).toHaveAttribute('data-status', 'saved');

  // enable the webhook card
  await page.getByRole('switch', { name: 'Webhook', exact: true }).click();
  const url = page.getByPlaceholder('https://example.com/webhooks/forms');
  await expect(url).toBeVisible();
  await url.fill('notaurl');
  await page.waitForTimeout(1400);
  console.log(
    'P3b status after invalid url:',
    await page.getByTestId('integrations-save-status').getAttribute('data-status'),
  );

  // a hubspot edit while the url is invalid
  await pickProperty(page, 'Company name → HubSpot property', 'Company Name');
  await page.waitForTimeout(1400);
  let cfg = (await getForm(request, id)).config;
  console.log('P3b stored while url bad:', JSON.stringify(hs(cfg)?.fieldMappings));
  console.log(
    'P3b status:',
    await page.getByTestId('integrations-save-status').getAttribute('data-status'),
  );

  // now FIX the url — does the earlier hubspot edit ride along?
  await url.fill('https://example.com/hook');
  await page.waitForTimeout(1600);
  cfg = (await getForm(request, id)).config;
  console.log(
    'P3b after fixing url — fieldMappings:',
    JSON.stringify(hs(cfg)?.fieldMappings),
    'webhook:',
    JSON.stringify(wh(cfg)),
  );
  console.log(
    'P3b status:',
    await page.getByTestId('integrations-save-status').getAttribute('data-status'),
  );
});

// ---------------------------------------------------------------------------
// P5 — turn the HubSpot card OFF: is the destination row kept or dropped?
//      Then reload: does the toggle read back the way it was left?
// ---------------------------------------------------------------------------
test('P5 hubspot toggle off/on round-trip', async ({ page, request }) => {
  const { id } = await createForm(request, 'toggle');
  await page.goto(`/admin/forms/${id}/edit?tab=connect`);
  await expect(page.getByTestId('integrations-save-status')).toHaveAttribute('data-status', 'saved');
  await page.getByRole('switch', { name: 'HubSpot', exact: true }).click();
  await expect(page.getByTestId('integrations-save-status')).toHaveAttribute('data-status', 'saved', {
    timeout: 5000,
  });
  let cfg = (await getForm(request, id)).config;
  console.log('P5 after off:', JSON.stringify(cfg.destinations));
  await page.reload();
  await expect(page.getByTestId('connect-panel')).toBeVisible();
  const on = await page.getByRole('switch', { name: 'HubSpot', exact: true }).getAttribute('aria-checked');
  console.log('P5 toggle after reload aria-checked:', on);
  // turn it back on
  await page.getByRole('switch', { name: 'HubSpot', exact: true }).click();
  await expect(page.getByTestId('integrations-save-status')).toHaveAttribute('data-status', 'saved', {
    timeout: 5000,
  });
  cfg = (await getForm(request, id)).config;
  console.log('P5 after back on:', JSON.stringify(cfg.destinations));
});

// ---------------------------------------------------------------------------
// P6 — status honesty: does "saved" ever show while an edit is still pending?
// ---------------------------------------------------------------------------
test('P6 save-status timeline', async ({ page, request }) => {
  const { id } = await createForm(request, 'status');
  await page.goto(`/admin/forms/${id}/edit?tab=connect`);
  await expect(page.getByTestId('integrations-save-status')).toHaveAttribute('data-status', 'saved');
  await pickProperty(page, 'Company name → HubSpot property', 'Company Name');
  const timeline: string[] = [];
  for (let i = 0; i < 20; i++) {
    timeline.push(
      `${i * 100}ms=${await page.getByTestId('integrations-save-status').getAttribute('data-status')}`,
    );
    await page.waitForTimeout(100);
  }
  console.log('P6', timeline.join(' '));
});
