import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const API = 'http://127.0.0.1:4400';
const RUN = randomUUID().slice(0, 8);
let seq = 0;

async function accountCode(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API}/v1/me`);
  const me = (await res.json()) as { accountCode?: string };
  return me.accountCode as string;
}

async function createForm(
  request: APIRequestContext,
  config: Record<string, unknown>,
): Promise<{ id: string; slug: string }> {
  seq += 1;
  const name = `tmpsc-${RUN}-${seq}`;
  const res = await request.post(`${API}/v1/forms`, { data: { name, config } });
  expect(res.ok(), `create failed ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: string; slug: string };
}

/**
 * COMBO 1 — scoring OFF but outcomes still carry redirectUrl + per-outcome
 * message + a booking handoff. What does the respondent actually get?
 */
test('combo1: scoring off + outcome redirect/message/booking — public submit', async ({ page, request }) => {
  const code = await accountCode(request);
  const { id, slug } = await createForm(request, {
    version: 1,
    cover: { enabled: true, headline: 'Combo1', ctaText: 'Start' },
    steps: [
      {
        key: 'size',
        type: 'multiple_choice',
        question: 'Team size?',
        flowGroup: 'qualification',
        options: [
          { label: 'Big', value: 'big', points: 10 },
          { label: 'Small', value: 'small', points: 0 },
        ],
      },
      { key: 'email', type: 'email', question: 'Email?', required: true, flowGroup: 'lead_capture' },
    ],
    scoring: { enabled: false },
    outcomes: [
      {
        id: 'p1',
        label: 'You qualify',
        minScore: 5,
        redirectUrl: 'https://example.com/p1',
        message: 'Great — book below.',
        booking: { provider: 'hubspot_meetings', url: 'https://meetings.hubspot.com/x/p1', prefill: true },
      },
      { id: 'p0', label: 'Not a fit', minScore: -100, message: 'Sorry, not a fit.' },
    ],
  });

  // Block all external hosts.
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue();
    return route.abort();
  });

  await page.goto(`/${code}/me/${slug}`);
  await page.locator('.pf__btn').first().click();
  await page.getByRole('radio', { name: 'Big' }).click();
  await page.locator('input[type="email"]').fill('big@corp.com');
  await page.locator('.pf__btn--inline').click();
  await expect(page.locator('.pf-done__title')).toBeVisible({ timeout: 15000 });
  const title = await page.locator('.pf-done__title').textContent();
  const body = await page.locator('.pf-done__body').textContent();
  console.log('COMBO1 done title=', JSON.stringify(title), 'body=', JSON.stringify(body));
  console.log('COMBO1 url=', page.url());

  // What did the API store?
  const subs = await request.get(`${API}/v1/forms/${id}/submissions`);
  console.log('COMBO1 submissions=', (await subs.text()).slice(0, 1200));
});

/**
 * COMBO 2 — toggle scoring OFF then back ON in the builder. Are the outcome
 * ranges / per-question points really intact afterwards?
 */
test('combo2: scoring off then on — ranges intact?', async ({ page, request }) => {
  const { id } = await createForm(request, {
    version: 1,
    cover: { enabled: true, headline: 'Combo2', ctaText: 'Start' },
    steps: [
      {
        key: 'size',
        type: 'multiple_choice',
        question: 'Team size?',
        flowGroup: 'qualification',
        options: [
          { label: 'Big', value: 'big', points: 10 },
          { label: 'Small', value: 'small', points: 0 },
        ],
      },
    ],
    scoring: { enabled: true },
    outcomes: [
      { id: 'p1', label: 'Hot', minScore: 8, redirectUrl: 'https://example.com/hot', message: 'hot msg' },
      { id: 'p0', label: 'Cold', minScore: 0 },
    ],
  });

  await page.goto(`/admin/forms/${id}/edit?tab=results`);
  await expect(page.getByTestId('results-end')).toBeVisible();
  await expect(page.getByTestId('results-end')).not.toHaveAttribute('data-scoring-off', /.*/);
  const rowsBefore = await page.getByTestId('outcome-row').count();
  console.log('COMBO2 outcome rows before=', rowsBefore);

  // toggle off
  const sw = page.getByRole('switch').first();
  await sw.click();
  await expect(page.getByTestId('results-outcomes-inert')).toBeVisible();
  console.log('COMBO2 inert text=', await page.getByTestId('results-outcomes-inert').textContent());
  await page.waitForTimeout(2500);
  let cfg = await (await request.get(`${API}/v1/forms/${id}`)).json();
  console.log('COMBO2 after OFF draft scoring=', JSON.stringify(cfg.draftConfig?.scoring), 'outcomes=', JSON.stringify(cfg.draftConfig?.outcomes));

  // toggle back on
  await sw.click();
  await page.waitForTimeout(2500);
  cfg = await (await request.get(`${API}/v1/forms/${id}`)).json();
  console.log('COMBO2 after ON draft scoring=', JSON.stringify(cfg.draftConfig?.scoring), 'outcomes=', JSON.stringify(cfg.draftConfig?.outcomes));
  const rowsAfter = await page.getByTestId('outcome-row').count();
  console.log('COMBO2 outcome rows after=', rowsAfter);
});
