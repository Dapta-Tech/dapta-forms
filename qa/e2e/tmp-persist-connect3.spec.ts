import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const API = 'http://localhost:4400';
const baseConfig = {
  version: 1,
  cover: { enabled: true, headline: 'Persist QA', ctaText: 'Start' },
  steps: [
    { key: 'work_email', type: 'email', question: 'Work email', required: true },
    { key: 'company', type: 'text', question: 'Company name' },
  ],
  destinations: [{ type: 'hubspot', enabled: true, fieldMappings: { work_email: 'email' } }],
};
let seq = 0;
async function createForm(request: APIRequestContext, label: string, cfg: unknown = baseConfig) {
  seq += 1;
  const res = await request.post(`${API}/v1/forms`, {
    data: { name: `p3 ${label} ${seq}-${Date.now()}`, config: cfg },
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

// R1 — reload immediately, three times over, to see how reliable the flush is
test('R1 reload-within-debounce x4', async ({ page, request }) => {
  for (let i = 0; i < 4; i++) {
    const { id } = await createForm(request, `r${i}`);
    await page.goto(`/admin/forms/${id}/edit?tab=connect`);
    await expect(page.getByTestId('integrations-save-status')).toHaveAttribute('data-status', 'saved');
    await pickProperty(page, 'Company name → HubSpot property', 'Company Name');
    await page.reload();
    await page.waitForTimeout(2000);
    const { config } = await getForm(request, id);
    console.log(`R1 run ${i}: ${JSON.stringify(hs(config)?.fieldMappings)}`);
  }
});

// R2 — leave the page while the webhook URL is invalid: what is lost, silently?
test('R2 leaving with an invalid webhook url', async ({ page, request }) => {
  const { id } = await createForm(request, 'leavebad');
  await page.goto(`/admin/forms/${id}/edit?tab=connect`);
  await expect(page.getByTestId('integrations-save-status')).toHaveAttribute('data-status', 'saved');

  await page.getByRole('switch', { name: 'Webhook', exact: true }).click();
  const url = page.getByPlaceholder('https://example.com/webhooks/forms');
  await url.fill('htp://oops.example.com/hook'); // typo'd scheme
  await page.waitForTimeout(1200);
  await pickProperty(page, 'Company name → HubSpot property', 'Company Name');
  await page.waitForTimeout(1200);
  const errBlock = await page.getByTestId('connect-integrations').innerText();
  console.log('R2 error text seen:', errBlock.split('\n').filter((l) => /valid|https/i.test(l)).join(' | '));
  console.log(
    'R2 status:',
    await page.getByTestId('integrations-save-status').getAttribute('data-status'),
  );
  console.log(
    'R2 status text:',
    (await page.getByTestId('integrations-save-status').innerText()).trim(),
  );

  // navigate away (SPA) — is there any guard / confirm?
  await page.getByTestId('editor-tab-build').click();
  await page.waitForTimeout(1500);
  let cfg = (await getForm(request, id)).config;
  console.log('R2 after SPA tab switch:', JSON.stringify(hs(cfg)?.fieldMappings), JSON.stringify(wh(cfg)));

  // hard leave
  await page.goto('/admin/forms');
  await page.waitForTimeout(1500);
  cfg = (await getForm(request, id)).config;
  console.log('R2 after leaving app:', JSON.stringify(hs(cfg)?.fieldMappings), JSON.stringify(wh(cfg)));

  // come back — what does the webhook card show?
  await page.goto(`/admin/forms/${id}/edit?tab=connect`);
  await expect(page.getByTestId('connect-panel')).toBeVisible();
  const sw = await page.getByRole('switch', { name: 'Webhook', exact: true }).getAttribute('aria-checked');
  console.log('R2 webhook switch after return:', sw);
});

// R3 — webhook secret: type one, autosave, reload, then edit something else.
//      Does the stored secret survive an unrelated autosave?
test('R3 webhook secret survives later autosaves', async ({ page, request }) => {
  const { id } = await createForm(request, 'secret', {
    ...baseConfig,
    destinations: [
      ...baseConfig.destinations,
      { type: 'webhook', enabled: true, settings: { url: 'https://example.com/hook', secret: 'topsecret123' } },
    ],
  });
  let cfg = (await getForm(request, id)).config;
  console.log('R3 initial webhook (masked on read):', JSON.stringify(wh(cfg)));

  await page.goto(`/admin/forms/${id}/edit?tab=connect`);
  await expect(page.getByTestId('integrations-save-status')).toHaveAttribute('data-status', 'saved');
  await pickProperty(page, 'Company name → HubSpot property', 'Company Name');
  await expect(page.getByTestId('integrations-save-status')).toHaveAttribute('data-status', 'saved', {
    timeout: 5000,
  });
  cfg = (await getForm(request, id)).config;
  console.log('R3 webhook after unrelated autosave:', JSON.stringify(wh(cfg)));
});
