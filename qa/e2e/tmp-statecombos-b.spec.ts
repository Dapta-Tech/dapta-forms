import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const API = 'http://127.0.0.1:4400';
const RUN = randomUUID().slice(0, 8);
let seq = 0;

async function accountCode(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API}/v1/me`);
  return ((await res.json()) as { accountCode: string }).accountCode;
}
async function createForm(request: APIRequestContext, config: Record<string, unknown>) {
  seq += 1;
  const res = await request.post(`${API}/v1/forms`, { data: { name: `tmpscb-${RUN}-${seq}`, config } });
  expect(res.ok(), `create failed ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: string; slug: string };
}

/** COMBO 3 — a HIDDEN question that carries points. Builder max vs runtime max. */
test('combo3: hidden question with points — builder max vs real score', async ({ page, request }) => {
  const code = await accountCode(request);
  const { id, slug } = await createForm(request, {
    version: 1,
    cover: { enabled: true, headline: 'Combo3', ctaText: 'Start' },
    steps: [
      {
        key: 'plan',
        type: 'multiple_choice',
        question: 'Plan?',
        hidden: true,
        flowGroup: 'qualification',
        options: [
          { label: 'Enterprise', value: 'ent', points: 10 },
          { label: 'Free', value: 'free', points: 0 },
        ],
      },
      {
        key: 'size',
        type: 'multiple_choice',
        question: 'Team size?',
        flowGroup: 'qualification',
        options: [
          { label: 'Big', value: 'big', points: 5 },
          { label: 'Small', value: 'small', points: 0 },
        ],
      },
    ],
    scoring: { enabled: true },
    outcomes: [
      { id: 'hot', label: 'Hot lead', minScore: 15 },
      { id: 'cold', label: 'Cold lead', minScore: 0 },
    ],
  });

  await page.goto(`/admin/forms/${id}/edit?tab=results`);
  await expect(page.getByTestId('results-end')).toBeVisible();
  const pointsPanel = page.locator('section').filter({ hasText: /points/i }).first();
  console.log('COMBO3 results points hint =', (await pointsPanel.innerText()).slice(0, 300));
  console.log('COMBO3 scorebar =', (await page.getByTestId('results-end').innerText()).slice(0, 400));

  // Public run: seed the hidden step from the URL, pick the best visible option.
  await page.goto(`/${code}/me/${slug}?plan=ent`);
  await page.locator('.pf__btn').first().click();
  await page.getByRole('radio', { name: 'Big' }).click();
  await expect(page.locator('.pf-done__title')).toBeVisible({ timeout: 15000 });
  console.log('COMBO3 done title =', await page.locator('.pf-done__title').textContent());
  const subs = await (await request.get(`${API}/v1/forms/${id}/submissions`)).json();
  console.log('COMBO3 submission =', JSON.stringify(subs.items?.[0]));
});

/** COMBO 4 — slider bounds edited AFTER the scoring ranges (A3) + Results math. */
test('combo4: unreachable slider range still counts in Results max', async ({ page, request }) => {
  const code = await accountCode(request);
  const { id, slug } = await createForm(request, {
    version: 1,
    cover: { enabled: true, headline: 'Combo4', ctaText: 'Start' },
    steps: [
      {
        key: 'leads',
        type: 'slider',
        question: 'Leads per month?',
        min: 0,
        max: 10,
        default: 5,
        flowGroup: 'qualification',
        sliderScoring: [
          { min: 0, max: 10, points: 3 },
          { min: 50, max: 100, points: 20 },
        ],
      },
    ],
    scoring: { enabled: true },
    outcomes: [
      { id: 'hot', label: 'Hot lead', minScore: 20 },
      { id: 'cold', label: 'Cold lead', minScore: 0 },
    ],
  });

  await page.goto(`/admin/forms/${id}/edit?tab=results`);
  await expect(page.getByTestId('results-end')).toBeVisible();
  console.log('COMBO4 results panel =', (await page.locator('main').innerText()).slice(0, 900));

  // The question panel should flag the unreachable range (A3).
  await page.goto(`/admin/forms/${id}/edit?tab=build`);
  await page.locator('[data-testid="question-spine"] button').first().click().catch(() => {});
  await page.waitForTimeout(800);
  const unreachable = page.getByTestId('slider-range-unreachable');
  console.log('COMBO4 unreachable badge count =', await unreachable.count());
  if (await unreachable.count()) console.log('COMBO4 badge text =', await unreachable.first().innerText());

  await page.goto(`/${code}/me/${slug}`);
  await page.locator('.pf__btn').first().click();
  await page.locator('.pf__btn--inline').click();
  await expect(page.locator('.pf-done__title')).toBeVisible({ timeout: 15000 });
  console.log('COMBO4 done title =', await page.locator('.pf-done__title').textContent());
  const subs = await (await request.get(`${API}/v1/forms/${id}/submissions`)).json();
  console.log('COMBO4 submission =', JSON.stringify(subs.items?.[0]));
});

/** COMBO 5 — slider Default OUTSIDE min/max (A2) + what value gets submitted. */
test('combo5: out-of-range slider default — rendered vs submitted value', async ({ page, request }) => {
  const code = await accountCode(request);
  const { id, slug } = await createForm(request, {
    version: 1,
    cover: { enabled: true, headline: 'Combo5', ctaText: 'Start' },
    steps: [
      {
        key: 'leads',
        type: 'slider',
        question: 'Leads?',
        min: 0,
        max: 10,
        default: 878,
        flowGroup: 'qualification',
        sliderScoring: [
          { min: 0, max: 10, points: 1 },
          { min: 11, max: 100000, points: 50 },
        ],
      },
    ],
    scoring: { enabled: true },
    outcomes: [
      { id: 'hot', label: 'Hot lead', minScore: 50 },
      { id: 'cold', label: 'Cold lead', minScore: 0 },
    ],
  });

  await page.goto(`/${code}/me/${slug}`);
  await page.locator('.pf__btn').first().click();
  await page.waitForTimeout(500);
  const range = page.locator('input[type="range"]');
  console.log('COMBO5 range value =', await range.inputValue(), 'min=', await range.getAttribute('min'), 'max=', await range.getAttribute('max'));
  console.log('COMBO5 visible slider text =', (await page.locator('.pf__fields').innerText()).slice(0, 200));
  await page.locator('.pf__btn--inline').click();
  await expect(page.locator('.pf-done__title')).toBeVisible({ timeout: 15000 });
  console.log('COMBO5 done title =', await page.locator('.pf-done__title').textContent());
  const subs = await (await request.get(`${API}/v1/forms/${id}/submissions`)).json();
  console.log('COMBO5 submission =', JSON.stringify(subs.items?.[0]));
});
