import { test, expect } from '@playwright/test';

const API = 'http://localhost:4400/v1';
const SHOTS = 'qa/shots/tmp-copy';

const BASE = {
  version: 1,
  cover: { enabled: true, headline: 'Copy lens', ctaText: 'Start' },
  steps: [
    {
      key: 'role', type: 'multiple_choice', question: 'What is your role?', flowGroup: 'qualification',
      options: [
        { label: 'Founder', value: 'founder', points: 5 },
        { label: 'Marketer', value: 'marketer', points: 2 },
        { label: 'Other', value: 'other', points: 0 },
      ],
    },
    {
      key: 'leads', type: 'slider', question: 'How many leads?', min: 0, max: 100, default: 10,
      flowGroup: 'qualification', sliderScoring: [{ min: 0, max: 50, points: 1 }],
    },
    { key: 'email', type: 'email', question: 'Email?', required: true },
  ],
  scoring: { enabled: true },
  outcomes: [{ id: 'p1', label: 'P1', minScore: 5 }, { id: 'p0', label: 'P0', minScore: 0 }],
};

async function mkForm(request: any, config: any = BASE) {
  const r = await request.post(`${API}/forms`, { data: { name: `copylens ${Date.now()}`, config } });
  const j = await r.json();
  return j.id as string;
}

async function selectStep(page: any, n: number) {
  await page.locator('[data-testid="question-spine"] li, aside li').first().waitFor({ timeout: 5000 }).catch(() => {});
  const rows = page.locator('li').filter({ has: page.locator('text=/^\\d+$/') });
  await page.locator('body').click({ position: { x: 5, y: 400 } }).catch(() => {});
  // fallback: click the nth spine card by its numeric badge
  await page.getByText(String(n + 1), { exact: true }).first().click();
  await page.waitForTimeout(400);
}

test('slider: default ABOVE max — does the warning name the right value?', async ({ page, request }) => {
  const id = await mkForm(request, { ...BASE, steps: BASE.steps.map((s: any) => s.key === 'leads' ? { ...s, default: 500 } : s) });
  await page.goto(`/admin/forms/${id}/edit?tab=build`);
  await page.waitForLoadState('networkidle');
  await selectStep(page, 1);
  const w = page.getByTestId('slider-default-out-of-range');
  console.log('ABOVE-MAX warn count:', await w.count());
  if (await w.count()) console.log('ABOVE-MAX TEXT:', (await w.first().innerText()).replace(/\n/g, ' '));
  const canvasBig = await page.locator('.pf__slider-value, .pf-slider__value').first().innerText().catch(() => null);
  console.log('canvas big number:', canvasBig);
  console.log('CANVAS TEXT:', (await page.locator('main, .flex-1').first().innerText()).replace(/\n/g, ' | ').slice(0, 400));
  await page.screenshot({ path: `${SHOTS}/20-above-max.png`, fullPage: true });
});

test('slider: scoring range unreachable copy', async ({ page, request }) => {
  const id = await mkForm(request, {
    ...BASE,
    steps: BASE.steps.map((s: any) => s.key === 'leads' ? { ...s, sliderScoring: [{ min: 500, max: 600, points: 3 }] } : s),
  });
  await page.goto(`/admin/forms/${id}/edit?tab=results`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  const u = page.getByTestId('slider-range-unreachable');
  console.log('UNREACHABLE count:', await u.count());
  if (await u.count()) console.log('UNREACHABLE TEXT:', (await u.first().innerText()).replace(/\n/g, ' '));
  await page.screenshot({ path: `${SHOTS}/21-unreachable.png`, fullPage: true });
});

test('results: scoring off panel', async ({ page, request }) => {
  const id = await mkForm(request, { ...BASE, scoring: { enabled: false } });
  await page.goto(`/admin/forms/${id}/edit?tab=results`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  const end = page.getByTestId('results-end');
  console.log('scoring-off attr:', await end.getAttribute('data-scoring-off'));
  console.log('INERT TEXT:', (await page.getByTestId('results-outcomes-inert').innerText()).replace(/\n/g, ' '));
  console.log('FULL RESULTS TEXT:', (await page.locator('body').innerText()).replace(/\n/g, ' | '));
  await page.screenshot({ path: `${SHOTS}/22-scoring-off.png`, fullPage: true });
});
