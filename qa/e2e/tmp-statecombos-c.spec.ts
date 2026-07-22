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
  const res = await request.post(`${API}/v1/forms`, { data: { name: `tmpscc-${RUN}-${seq}`, config } });
  expect(res.ok(), `create failed ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: string; slug: string };
}

test('combo3b: hidden points inflate the builder max', async ({ page, request }) => {
  const { id } = await createForm(request, {
    version: 1,
    cover: { enabled: true, headline: 'C3b', ctaText: 'Start' },
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
  const hint = page.getByText(/Highest possible/i).first();
  console.log('C3B hint =', await hint.innerText());
  const barTop = page.getByTestId('results-end').locator('span', { hasText: /^\d+$/ });
  const nums: string[] = [];
  for (let i = 0; i < (await barTop.count()); i++) nums.push(await barTop.nth(i).innerText());
  console.log('C3B scorebar numbers =', nums.join('|'));
  const pointsSection = page.locator('section', { hasText: /Highest possible/i }).first();
  console.log('C3B points section =', (await pointsSection.innerText()).replace(/\n+/g, ' | '));
});

test('combo4b: unreachable slider range inflates the builder max', async ({ page, request }) => {
  const { id } = await createForm(request, {
    version: 1,
    cover: { enabled: true, headline: 'C4b', ctaText: 'Start' },
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
  console.log('C4B hint =', await page.getByText(/Highest possible/i).first().innerText());
  const pointsSection = page.locator('section', { hasText: /Highest possible/i }).first();
  console.log('C4B points section =', (await pointsSection.innerText()).replace(/\n+/g, ' | '));
  console.log('C4B end section =', (await page.getByTestId('results-end').innerText()).replace(/\n+/g, ' | '));
});

test('combo6: scoring OFF — are option points / slider ranges still editable in Build?', async ({ page, request }) => {
  const { id } = await createForm(request, {
    version: 1,
    cover: { enabled: true, headline: 'C6', ctaText: 'Start' },
    steps: [
      {
        key: 'leads',
        type: 'slider',
        question: 'Leads?',
        min: 0,
        max: 10,
        default: 5,
        flowGroup: 'qualification',
        sliderScoring: [{ min: 0, max: 10, points: 3 }],
      },
      {
        key: 'size',
        type: 'multiple_choice',
        question: 'Size?',
        flowGroup: 'qualification',
        options: [{ label: 'Big', value: 'big', points: 5 }],
      },
    ],
    scoring: { enabled: false },
    outcomes: [{ id: 'cold', label: 'Cold', minScore: 0 }],
  });

  await page.goto(`/admin/forms/${id}/edit?tab=build`);
  await page.waitForTimeout(1200);
  // select the slider question in the spine
  const spine = page.getByTestId('question-spine');
  console.log('C6 spine =', (await spine.innerText()).replace(/\n+/g, ' | ').slice(0, 300));
  await spine.getByText('Leads?').first().click();
  await page.waitForTimeout(600);
  const panel = page.locator('aside, [data-testid="question-settings"]').first();
  const text = (await panel.innerText()).replace(/\n+/g, ' | ');
  console.log('C6 settings panel (slider) =', text.slice(0, 2000));
  const rangeInputs = panel.locator('input');
  console.log('C6 slider panel input count =', await rangeInputs.count());
  const toggle = page.getByTestId('step-scoring-toggle');
  console.log('C6 step-scoring-toggle disabled =', await toggle.isDisabled().catch(() => 'n/a'));

  // now the choice question — is the option Points column still live?
  await spine.getByText('Size?').first().click();
  await page.waitForTimeout(600);
  console.log('C6 settings panel (choice) =', (await panel.innerText()).replace(/\n+/g, ' | ').slice(0, 2000));
});
