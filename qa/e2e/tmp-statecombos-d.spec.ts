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
  const res = await request.post(`${API}/v1/forms`, { data: { name: `tmpscd-${RUN}-${seq}`, config } });
  expect(res.ok(), `create failed ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: string; slug: string };
}

function base(extra: Record<string, unknown>) {
  return {
    version: 1,
    cover: { enabled: true, headline: 'D', ctaText: 'Start' },
    steps: [
      {
        key: 'plan',
        type: 'multiple_choice',
        question: 'Plan?',
        hidden: true,
        flowGroup: 'qualification',
        options: [{ label: 'Ent', value: 'ent', points: 0 }],
      },
      { key: 'company', type: 'text', question: 'Company?', flowGroup: 'lead_capture' },
      { key: 'email', type: 'email', question: 'Email?', required: true, flowGroup: 'lead_capture' },
    ],
    scoring: { enabled: true },
    outcomes: [{ id: 'all', label: 'Thanks', minScore: 0 }],
    reveal: { enabled: true, headline: 'Matching you…', durationMs: 900 },
    ...extra,
  };
}

/** D1 — reveal PINNED to a hidden question: does it ever play? */
test('d1: reveal pinned to a hidden question', async ({ page, request }) => {
  const code = await accountCode(request);
  const hiddenPin = await createForm(request, base({ revealAfterStep: 1 }));
  const control = await createForm(request, base({ revealAfterStep: 2 }));

  for (const [label, f] of [
    ['pinned-to-hidden', hiddenPin],
    ['pinned-to-visible-control', control],
  ] as const) {
    let sawReveal = false;
    await page.goto(`/${code}/me/${f.slug}`);
    await page.locator('.pf__btn').first().click();
    await page.locator('input').first().fill('Acme');
    await page.locator('.pf__btn--inline').click();
    // give the reveal a window to appear
    for (let i = 0; i < 12; i++) {
      if (await page.locator('.pf-reveal__headline').count()) {
        sawReveal = true;
        break;
      }
      await page.waitForTimeout(150);
    }
    await page.locator('input[type="email"]').fill('a@corp.com');
    await page.locator('.pf__btn--inline').click();
    for (let i = 0; i < 15; i++) {
      if (await page.locator('.pf-reveal__headline').count()) sawReveal = true;
      if (await page.locator('.pf-done__title').count()) break;
      await page.waitForTimeout(200);
    }
    await expect(page.locator('.pf-done__title')).toBeVisible({ timeout: 10000 });
    console.log(`D1 ${label}: reveal seen =`, sawReveal);
  }
});

/** D2 — partial-submit point pinned to a hidden question. */
test('d2: partial submit point on a hidden question', async ({ page, request }) => {
  const code = await accountCode(request);
  const pinHidden = await createForm(request, base({ partialSubmitAfterStep: 1, reveal: { enabled: false } }));
  const control = await createForm(request, base({ partialSubmitAfterStep: 2, reveal: { enabled: false } }));

  for (const [label, f] of [
    ['partial-on-hidden', pinHidden],
    ['partial-on-visible-control', control],
  ] as const) {
    await page.goto(`/${code}/me/${f.slug}`);
    await page.locator('.pf__btn').first().click();
    await page.locator('input').first().fill('Acme');
    await page.locator('.pf__btn--inline').click();
    await page.waitForTimeout(1500);
    const subs = await (await request.get(`${API}/v1/forms/${f.id}/submissions`)).json();
    console.log(`D2 ${label}: rows=`, JSON.stringify(subs.items?.map((s: Record<string, unknown>) => ({ partialAt: s.partialAt, completedAt: s.completedAt, data: s.data }))));
  }
});

/** D3 — reveal pinned to a TERMINAL step. */
test('d3: reveal pinned to a terminal step', async ({ page, request }) => {
  const code = await accountCode(request);
  const f = await createForm(request, {
    version: 1,
    cover: { enabled: true, headline: 'D3', ctaText: 'Start' },
    steps: [
      {
        key: 'fit',
        type: 'multiple_choice',
        question: 'Are you a fit?',
        flowGroup: 'qualification',
        options: [
          { label: 'Yes', value: 'yes', points: 5 },
          { label: 'No', value: 'no', points: 0 },
        ],
      },
      {
        key: 'bye',
        type: 'message',
        question: 'Sorry, not a fit.',
        terminal: true,
        showWhen: { field: 'fit', values: ['no'] },
      },
      { key: 'email', type: 'email', question: 'Email?', required: true, flowGroup: 'lead_capture' },
    ],
    scoring: { enabled: true },
    outcomes: [{ id: 'all', label: 'Thanks', minScore: 0 }],
    reveal: { enabled: true, headline: 'Matching you…', durationMs: 900 },
    revealAfterStep: 2,
  });

  // path A: hits the terminal step
  let sawReveal = false;
  await page.goto(`/${code}/me/${f.slug}`);
  await page.locator('.pf__btn').first().click();
  await page.getByRole('radio', { name: 'No' }).click();
  for (let i = 0; i < 12; i++) {
    if (await page.locator('.pf-reveal__headline').count()) sawReveal = true;
    if (await page.locator('.pf-done__title').count()) break;
    await page.waitForTimeout(200);
  }
  console.log('D3 terminal path — step text =', (await page.locator('.pf__main').innerText()).replace(/\n+/g, ' | ').slice(0, 200));
  if (await page.locator('.pf__btn--inline').count()) await page.locator('.pf__btn--inline').click();
  for (let i = 0; i < 15; i++) {
    if (await page.locator('.pf-reveal__headline').count()) sawReveal = true;
    if (await page.locator('.pf-done__title').count()) break;
    await page.waitForTimeout(200);
  }
  console.log('D3 terminal path: reveal seen =', sawReveal, 'done =', await page.locator('.pf-done__title').textContent().catch(() => null));

  // path B: skips the terminal step entirely
  sawReveal = false;
  await page.goto(`/${code}/me/${f.slug}`);
  await page.locator('.pf__btn').first().click();
  await page.getByRole('radio', { name: 'Yes' }).click();
  await page.waitForTimeout(600);
  await page.locator('input[type="email"]').fill('yes@corp.com');
  await page.locator('.pf__btn--inline').click();
  for (let i = 0; i < 20; i++) {
    if (await page.locator('.pf-reveal__headline').count()) sawReveal = true;
    if (await page.locator('.pf-done__title').count()) break;
    await page.waitForTimeout(200);
  }
  console.log('D3 skip path: reveal seen =', sawReveal, 'done =', await page.locator('.pf-done__title').textContent().catch(() => null));
});
