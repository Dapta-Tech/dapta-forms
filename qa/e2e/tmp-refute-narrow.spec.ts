import { test, expect, type Page } from '@playwright/test';

const API = 'http://localhost:4400';

async function createForm(name: string) {
  const res = await fetch(`${API}/v1/forms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name,
      config: {
        version: 1,
        cover: { enabled: false },
        steps: [
          { key: 'budget', type: 'slider', question: 'Budget?', min: 0, max: 1000, default: 500 },
          { key: 'reason', type: 'text', question: 'Why?' },
        ],
        scoring: { enabled: false },
        outcomes: [],
      },
    }),
  });
  return (await res.json()) as { id: string; slug: string };
}

/** Pick an option in the branded combobox identified by its aria-label. */
async function pickSelect(page: Page, ariaLabel: string, optionText: string | RegExp) {
  const trigger = page.getByRole('button', { name: ariaLabel, exact: true });
  await trigger.click();
  await page.getByRole('option', { name: optionText }).first().click();
  await page.waitForTimeout(150);
}

test('A6 narrow advisory with a hide rule that clips one endpoint', async ({ page }) => {
  const form = await createForm(`refute-narrow-${Date.now()}`);
  await page.goto(`http://localhost:3400/admin/forms/${form.id}/edit`);

  // select the "Why?" question in the spine
  await page.getByTestId('question-spine').getByText('Why?', { exact: true }).click();
  await page.waitForTimeout(400);

  // Show when: Budget? / Between / 0 .. 100
  await pickSelect(page, 'Show when — Field', 'Budget?');
  await pickSelect(page, 'Show when — Condition', /^Between$/);
  await page.getByTestId('logic-show-min').fill('0');
  await page.getByTestId('logic-show-max').fill('100');

  // Hide when: Budget? / Equal to / 0
  await pickSelect(page, 'Hide when — Field', 'Budget?');
  await pickSelect(page, 'Hide when — Condition', /^Equal to$/);
  await page.getByTestId('logic-hide-value').fill('0');
  await page.waitForTimeout(600);

  const narrowEq0 = await page.getByTestId('logic-narrow').textContent();
  console.log('NARROW (hide eq 0):', JSON.stringify(narrowEq0));
  await page.screenshot({ path: 'qa/tmp-narrow-eq0.png' });

  // Now hide = Equal to 100
  await page.getByTestId('logic-hide-value').fill('100');
  await page.waitForTimeout(600);
  const narrowEq100 = await page.getByTestId('logic-narrow').textContent();
  console.log('NARROW (hide eq 100):', JSON.stringify(narrowEq100));

  // Contrast: a genuine one-sided clip, hide = Less than 50
  await pickSelect(page, 'Hide when — Condition', /^Less than$/);
  await page.getByTestId('logic-hide-value').fill('50');
  await page.waitForTimeout(600);
  console.log('NARROW (hide lt 50):', JSON.stringify(await page.getByTestId('logic-narrow').textContent()));

  // back to eq 0 and leave it saved for the runtime walk
  await pickSelect(page, 'Hide when — Condition', /^Equal to$/);
  await page.getByTestId('logic-hide-value').fill('0');
  await page.waitForTimeout(1200);

  const cfg = await (await fetch(`${API}/v1/forms/${form.id}`)).json();
  console.log('FORM ID', form.id, 'SLUG', form.slug);
  console.log('DRAFT', JSON.stringify(cfg.draftConfig));
  console.log('LIVE', JSON.stringify(cfg.config));
  expect(narrowEq0).toBeTruthy();
});
