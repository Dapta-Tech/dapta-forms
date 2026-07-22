import { test, expect } from '@playwright/test';

const API = 'http://localhost:4400';

async function createForm(name: string, sliderDefault: number, hide: Record<string, unknown>) {
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
            hideWhen: hide,
          },
        ],
        scoring: { enabled: false },
        outcomes: [],
      },
    }),
  });
  return (await res.json()) as { id: string; slug: string };
}

const cases: Array<[number, string]> = [
  [0, 'budget=0'],
  [50, 'budget=50'],
  [100, 'budget=100'],
];

for (const [val, label] of cases) {
  test(`runtime ${label} with hide eq 0`, async ({ page }) => {
    const form = await createForm(`rt-${val}-${Date.now()}`, val, {
      field: 'budget',
      op: 'eq',
      value: 0,
      values: [],
    });
    await page.goto(`http://localhost:3400/ixin59/me/${form.slug}`);
    await page.waitForSelector('.pf__question');
    const q1 = await page.locator('.pf__question').first().textContent();
    await page.locator('.pf__btn--inline').first().click();
    await page.waitForTimeout(700);
    const q2 = await page.locator('.pf__question').first().textContent().catch(() => null);
    const done = await page.locator('.pf-done__title').count();
    console.log(`${label}: q1=${JSON.stringify(q1)} -> next=${JSON.stringify(q2)} doneCount=${done}`);
    expect(q1).toContain('Budget');
  });
}
