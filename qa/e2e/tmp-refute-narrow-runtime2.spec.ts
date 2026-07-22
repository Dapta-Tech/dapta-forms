import { test, expect } from '@playwright/test';

const API = 'http://localhost:4400';

async function createForm(name: string, sliderDefault: number) {
  const res = await fetch(`${API}/v1/forms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name,
      config: {
        version: 1,
        cover: { enabled: false },
        steps: [
          { key: 'budget', type: 'slider', question: 'Budget?', min: 0, max: 1000, default: sliderDefault },
          {
            key: 'reason',
            type: 'text',
            question: 'Why?',
            showWhen: { field: 'budget', op: 'between', min: 0, max: 100, values: [] },
            hideWhen: { field: 'budget', op: 'eq', value: 0, values: [] },
          },
          { key: 'tail', type: 'text', question: 'Anything else?' },
        ],
        scoring: { enabled: false },
        outcomes: [],
      },
    }),
  });
  return (await res.json()) as { id: string; slug: string };
}

for (const val of [0, 50, 100]) {
  test(`walk budget=${val}`, async ({ page }) => {
    const form = await createForm(`rt2-${val}-${Date.now()}`, val);
    await page.goto(`http://localhost:3400/ixin59/me/${form.slug}`);
    await page.waitForSelector('.pf__question', { timeout: 15000 });
    expect(await page.locator('.pf__question').first().textContent()).toContain('Budget');
    await page.locator('.pf__btn--inline').first().click();
    await page.waitForTimeout(1200);
    const q2 = await page.locator('.pf__question').first().textContent();
    console.log(`RESULT budget=${val}: second visible question = ${JSON.stringify(q2)}`);
  });
}
