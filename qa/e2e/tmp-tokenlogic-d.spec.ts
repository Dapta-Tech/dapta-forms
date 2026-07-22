import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/** THROWAWAY QA probe — runtime consequences of the logic rules the editor accepts. */

const API = 'http://localhost:4400';
const RUN = randomUUID().slice(0, 6);
let seq = 0;
function uniqueName(label: string): string {
  seq += 1;
  return `tmp-tld-${label}-${RUN}-${seq}`;
}

async function createForm(
  request: APIRequestContext,
  name: string,
  config: unknown,
): Promise<{ id: string; path: string }> {
  const res0 = await request.get(`${API}/v1/me`);
  const code = ((await res0.json()) as { accountCode: string }).accountCode;
  const res = await request.post(`${API}/v1/forms`, { data: { name, config } });
  expect(res.ok(), `create failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; slug: string };
  return { id: body.id, path: `/${code}/me/${body.slug}` };
}

function cfg(showWhen: unknown, hideWhen?: unknown) {
  return {
    version: 1,
    cover: { enabled: true, headline: 'rt', ctaText: 'Start' },
    steps: [
      { key: 'budget', type: 'slider', question: 'Budget?', min: 0, max: 1000, default: 50 },
      { key: 'reason', type: 'text', question: 'Why?', showWhen, ...(hideWhen ? { hideWhen } : {}) },
      { key: 'email', type: 'email', question: 'Your email?', required: true },
    ],
  };
}

async function start(page: Page, path: string) {
  await page.goto(path);
  const btn = page.getByRole('button', { name: 'Start' });
  for (let i = 0; i < 8; i += 1) {
    if (await btn.isVisible().catch(() => false)) break;
    await page.waitForTimeout(1200);
    await page.reload();
  }
  await btn.click();
  await expect(page.locator('.pf__question')).toHaveText('Budget?');
}

async function setSlider(page: Page, value: number) {
  const slider = page.locator('input[type="range"]');
  await slider.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, String(v));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await expect(page.locator('.pf-slider__pill-num')).toHaveText(String(value));
}

async function nextQuestionAfter(page: Page, budget: number, path: string) {
  await start(page, path);
  await setSlider(page, budget);
  await page.locator('.pf__btn--inline').first().click();
  await expect(page.locator('.pf__question')).toBeVisible();
  return ((await page.locator('.pf__question').textContent()) ?? '').trim();
}

test('empty operand: show gt <no value> — is the step reachable at all?', async ({ page, request }) => {
  const { path } = await createForm(
    request,
    uniqueName('emptyop'),
    cfg({ field: 'budget', values: [], op: 'gt' }),
  );
  for (const v of [0, 500, 1000]) {
    // eslint-disable-next-line no-console
    console.log(`EMPTY-OP budget=${v} -> next question: ${await nextQuestionAfter(page, v, path)}`);
  }
});

test('inverted between: show between min 500 max 200', async ({ page, request }) => {
  const { path } = await createForm(
    request,
    uniqueName('inverted'),
    cfg({ field: 'budget', values: [], op: 'between', min: 500, max: 200 }),
  );
  for (const v of [200, 350, 500]) {
    // eslint-disable-next-line no-console
    console.log(`INVERTED budget=${v} -> next question: ${await nextQuestionAfter(page, v, path)}`);
  }
});

test('hide eq 0 endpoint: show between 0..100 + hide eq 0', async ({ page, request }) => {
  const { path } = await createForm(
    request,
    uniqueName('eq0'),
    cfg({ field: 'budget', values: [], op: 'between', min: 0, max: 100 }, { field: 'budget', values: [], op: 'eq', value: 0 }),
  );
  for (const v of [0, 50, 100]) {
    // eslint-disable-next-line no-console
    console.log(`EQ0 budget=${v} -> next question: ${await nextQuestionAfter(page, v, path)}`);
  }
});

test('hole in the middle: show between 0..100 + hide between 40..60', async ({ page, request }) => {
  const { path } = await createForm(
    request,
    uniqueName('hole'),
    cfg({ field: 'budget', values: [], op: 'between', min: 0, max: 100 }, { field: 'budget', values: [], op: 'between', min: 40, max: 60 }),
  );
  for (const v of [30, 50, 80]) {
    // eslint-disable-next-line no-console
    console.log(`HOLE budget=${v} -> next question: ${await nextQuestionAfter(page, v, path)}`);
  }
});

test('open-ended clip: show lt 100 + hide gt 50', async ({ page, request }) => {
  const { path } = await createForm(
    request,
    uniqueName('openend'),
    cfg({ field: 'budget', values: [], op: 'lt', value: 100 }, { field: 'budget', values: [], op: 'gt', value: 50 }),
  );
  for (const v of [20, 75, 99]) {
    // eslint-disable-next-line no-console
    console.log(`OPENEND budget=${v} -> next question: ${await nextQuestionAfter(page, v, path)}`);
  }
});
