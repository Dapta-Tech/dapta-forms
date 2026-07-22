import { test, expect } from '@playwright/test';

const FORM_ID = '958cbd82-3c54-4528-9e5d-df53f0e0c258';
const PUBLIC = '/ixin59/me/qa-comma-value-variant-collision';

async function draft(page: any) {
  const j = await (await page.request.get(`http://localhost:4400/v1/forms/${FORM_ID}`)).json();
  return { draft: j.draftConfig ?? j.config, live: j.config };
}

test('1 — author key crm,ads + fallback, publish', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/admin/forms/${FORM_ID}/edit`);
  await page.getByTestId('question-spine').getByText('Tell us more').first().click();
  await page.waitForTimeout(1200);

  const toggle = page.getByRole('switch', { name: 'Vary the question by a field' });
  if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
  await page.waitForTimeout(1000);

  const chips = page.getByTestId('variant-multi-option');
  const crm = chips.filter({ hasText: /^CRM$/ });
  const ads = chips.filter({ hasText: /^Ads$/ });

  // Drive the key to exactly "crm,ads" (current key is "ads").
  const seq = async () => (await draft(page)).draft.steps[1].questionVariants;
  console.log('start key:', JSON.stringify(await seq()));
  await crm.click(); await page.waitForTimeout(600);
  console.log('after +CRM:', JSON.stringify(await seq()));
  await ads.click(); await page.waitForTimeout(600);
  console.log('after -Ads:', JSON.stringify(await seq()));
  await ads.click(); await page.waitForTimeout(600);
  console.log('after +Ads:', JSON.stringify(await seq()));

  await page.getByLabel('Ask instead').fill('ROW authored for the CRM+Ads PAIR');
  await page.waitForTimeout(400);
  await page.getByLabel('Fallback (any other answer)').fill('FALLBACK question');
  await page.waitForTimeout(1500);
  console.log('final variants:', JSON.stringify((await draft(page)).draft.steps[1].questionVariants));
  await page.screenshot({ path: 'qa/tmp-shots/31-authored.png', fullPage: true });

  await page.getByRole('button', { name: /^Publish$/ }).click();
  await page.waitForTimeout(2500);
  const after = await draft(page);
  console.log('LIVE step2:', JSON.stringify(after.live.steps[1]));
  console.log('LIVE options:', JSON.stringify(after.live.steps[0].options));
});

test('2 — public: tick ONLY "Both CRM and Ads"', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(PUBLIC);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'qa/tmp-shots/40-public-q1.png', fullPage: true });
  console.log('Q1:', await page.locator('.pf__question').first().innerText());
  await page.getByText('Both CRM and Ads', { exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator('.pf__btn--inline').first().click();
  await page.waitForTimeout(1500);
  const q2 = await page.locator('.pf__question').first().innerText();
  console.log('Q2 SHOWN (only Both):', JSON.stringify(q2));
  await page.screenshot({ path: 'qa/tmp-shots/41-public-q2-both.png', fullPage: true });
});

test('3 — public: tick CRM and Ads separately', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(PUBLIC);
  await page.waitForTimeout(1200);
  await page.getByText('CRM', { exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByText('Ads', { exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator('.pf__btn--inline').first().click();
  await page.waitForTimeout(1500);
  const q2 = await page.locator('.pf__question').first().innerText();
  console.log('Q2 SHOWN (CRM+Ads separately):', JSON.stringify(q2));
  await page.screenshot({ path: 'qa/tmp-shots/42-public-q2-pair.png', fullPage: true });
});

test('4 — public: tick ONLY CRM (control)', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(PUBLIC);
  await page.waitForTimeout(1200);
  await page.getByText('CRM', { exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator('.pf__btn--inline').first().click();
  await page.waitForTimeout(1500);
  console.log('Q2 SHOWN (only CRM):', JSON.stringify(await page.locator('.pf__question').first().innerText()));
});
