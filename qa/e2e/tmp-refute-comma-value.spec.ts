import { test, expect } from '@playwright/test';

const FORM_ID = '958cbd82-3c54-4528-9e5d-df53f0e0c258';

test('repro — comma in option value + variant row', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`/admin/forms/${FORM_ID}/edit`);
  await page.getByTestId('question-spine').getByText('Which channels do you use?').first().click();

  const rows = page.locator('div.flex.items-end.gap-2.rounded-md.border');
  await expect(rows).toHaveCount(2, { timeout: 15_000 });

  // --- Step 1: third option, hand-typed value with a comma -------------------
  await page.getByRole('button', { name: /add option/i }).first().click();
  await expect(rows).toHaveCount(3, { timeout: 10_000 });

  const third = rows.nth(2);
  await third.locator('input').nth(0).fill('Both CRM and Ads');
  await third.locator('input').nth(1).fill('crm,ads');
  await third.locator('input').nth(1).blur();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'qa/tmp-shots/10-comma-value.png', fullPage: true });

  const alerts = await page.getByRole('alert').allTextContents();
  console.log('ALERTS after typing comma value:', JSON.stringify(alerts));
  console.log('VALUE FIELD NOW:', JSON.stringify(await third.locator('input').nth(1).inputValue()));

  const stored = await (await page.request.get(`http://localhost:4400/v1/forms/${FORM_ID}`)).json();
  const cfg = stored.draftConfig ?? stored.config;
  console.log('STORED DRAFT OPTIONS:', JSON.stringify(cfg.steps[0].options));

  // --- Step 2: variant editor on question 2 --------------------------------
  await page.getByTestId('question-spine').getByText('Tell us more').first().click();
  await page.waitForTimeout(1000);
  const panelTxt = await page.locator('aside, [class*="Question settings"]').first().innerText().catch(() => '');
  const bodyTxt = await page.locator('body').innerText();
  console.log('PANEL TEXT >>>', (panelTxt || bodyTxt.slice(bodyTxt.indexOf('Question settings'))).slice(0, 2000));
  await page.screenshot({ path: 'qa/tmp-shots/11-q2-settings.png', fullPage: true });
});
