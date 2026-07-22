import { test, expect, type APIRequestContext, type Page, type Locator } from '@playwright/test';

const API = 'http://127.0.0.1:4400';
const RUN = Math.random().toString(36).slice(2, 8);
let seq = 0;
const uniqueName = (l: string) => `inv-${l}-${RUN}-${++seq}`;

async function createForm(request: APIRequestContext, name: string, config: Record<string, unknown>) {
  const res = await request.post(`${API}/v1/forms`, { data: { name, config: { version: 1, ...config } } });
  expect(res.ok(), `create failed ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: string; slug: string };
}

async function openEditor(page: Page, id: string, tab = 'build') {
  await page.goto(`/admin/forms/${id}/edit?tab=${tab}`);
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible({ timeout: 30_000 });
}

async function accountCode(request: APIRequestContext) {
  const me = await (await request.get(`${API}/v1/me`)).json();
  return me.accountCode as string;
}

/** settings panel = the right-hand column */
const panel = (page: Page): Locator => page.locator('div.border-l').last();
const nf = (page: Page, i: number): Locator => panel(page).locator('input[type=number]').nth(i);

async function rangeAttrs(loc: Locator) {
  return loc.evaluate((el: HTMLInputElement) => ({
    min: el.min, max: el.max, step: el.step, value: el.value,
    fillPct: getComputedStyle(el.parentElement as HTMLElement).getPropertyValue('--pf-slider-pct') || null,
  }));
}

test.describe('invalid slider input', () => {
  test.setTimeout(90_000);

  test('slider min===max: builder warnings + public render', async ({ page, request }) => {
    const { id, slug } = await createForm(request, uniqueName('minmax'), {
      cover: { enabled: false },
      steps: [
        { key: 'flat', type: 'slider', question: 'Flat slider', min: 5, max: 5, step: 1, default: 5,
          sliderScoring: [{ min: 5, max: 5, points: 3 }] },
      ],
      scoring: { enabled: true },
      outcomes: [{ id: 'a', label: 'A', minScore: 0 }],
    });
    await openEditor(page, id);
    await page.getByRole('button', { name: /Flat slider/ }).first().click();
    await page.waitForTimeout(600);
    console.log('MINMAX panel numbers:', await panel(page).locator('input[type=number]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)));
    console.log('MINMAX warn max-below-min:', await page.getByTestId('slider-max-below-min').count());
    console.log('MINMAX warn default-oor:', await page.getByTestId('slider-default-out-of-range').count());
    console.log('MINMAX warn unreachable:', await page.getByTestId('slider-range-unreachable').count());

    const code = await accountCode(request);
    await page.goto(`/${code}/me/${slug}`);
    await page.waitForTimeout(1500);
    const r = page.locator('input[type=range]').first();
    console.log('PUBLIC minmax range count:', await r.count());
    if (await r.count()) console.log('PUBLIC minmax attrs:', await rangeAttrs(r));
    console.log('PUBLIC minmax text:', (await page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 300));
    await page.screenshot({ path: 'qa/shots/inv-minmax.png', fullPage: true });
  });

  test('negative bounds + huge default: builder + public', async ({ page, request }) => {
    const { id, slug } = await createForm(request, uniqueName('neg'), {
      cover: { enabled: false },
      steps: [
        { key: 'neg', type: 'slider', question: 'Negative slider', min: -100, max: -10, step: 1, default: -50 },
        { key: 'huge', type: 'slider', question: 'Huge default', min: 0, max: 5, step: 1, default: 878 },
      ],
      scoring: { enabled: true },
      outcomes: [{ id: 'a', label: 'A', minScore: 0 }],
    });
    await openEditor(page, id);
    await page.getByRole('button', { name: /Negative slider/ }).first().click();
    await page.waitForTimeout(600);
    console.log('NEG panel numbers:', await panel(page).locator('input[type=number]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)));
    console.log('NEG warn oor:', await page.getByTestId('slider-default-out-of-range').count());
    const canvasRange = page.locator('input[type=range]');
    if (await canvasRange.count()) console.log('NEG canvas attrs:', await rangeAttrs(canvasRange.first()));
    await page.screenshot({ path: 'qa/shots/inv-neg-builder.png', fullPage: true });

    await page.getByRole('button', { name: /Huge default/ }).first().click();
    await page.waitForTimeout(600);
    console.log('HUGE warn count:', await page.getByTestId('slider-default-out-of-range').count());
    if (await page.getByTestId('slider-default-out-of-range').count())
      console.log('HUGE warn text:', await page.getByTestId('slider-default-out-of-range').innerText());
    if (await canvasRange.count()) console.log('HUGE canvas attrs:', await rangeAttrs(canvasRange.first()));

    const code = await accountCode(request);
    await page.goto(`/${code}/me/${slug}`);
    await page.waitForTimeout(1500);
    const r = page.locator('input[type=range]').first();
    console.log('PUBLIC neg attrs:', await rangeAttrs(r));
    console.log('PUBLIC neg fields text:', (await page.locator('.pf__fields').innerText()).replace(/\n+/g, ' | ').slice(0, 200));
    await page.screenshot({ path: 'qa/shots/inv-neg.png', fullPage: true });
    const next = page.locator('.pf__btn--inline').first();
    if (await next.count()) { await next.click(); await page.waitForTimeout(1200); }
    const r2 = page.locator('input[type=range]').first();
    if (await r2.count()) {
      console.log('PUBLIC huge attrs:', await rangeAttrs(r2));
      console.log('PUBLIC huge fields text:', (await page.locator('.pf__fields').innerText()).replace(/\n+/g, ' | ').slice(0, 200));
    }
    await page.screenshot({ path: 'qa/shots/inv-huge.png', fullPage: true });
  });

  test('decimal + zero + negative step: public slider behavior', async ({ page, request }) => {
    const { slug } = await createForm(request, uniqueName('step'), {
      cover: { enabled: false },
      steps: [
        { key: 'dec', type: 'slider', question: 'Decimal step', min: 0, max: 1, step: 0.1, default: 0.5 },
        { key: 'zero', type: 'slider', question: 'Zero step', min: 0, max: 10, step: 0, default: 5 },
        { key: 'negstep', type: 'slider', question: 'Negative step', min: 0, max: 10, step: -2, default: 4 },
      ],
      scoring: { enabled: false },
      outcomes: [],
    });
    const code = await accountCode(request);
    await page.goto(`/${code}/me/${slug}`);
    await page.waitForTimeout(1500);
    for (const label of ['dec', 'zero', 'negstep']) {
      const r = page.locator('input[type=range]').first();
      if (await r.count()) {
        console.log(`PUBLIC ${label} attrs:`, await rangeAttrs(r));
        console.log(`PUBLIC ${label} shown:`, (await page.locator('.pf__fields').innerText()).replace(/\n+/g, ' | ').slice(0, 200));
        await page.screenshot({ path: `qa/shots/inv-step-${label}.png` });
      } else {
        console.log(`PUBLIC ${label}: no range input; body=`, (await page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 200));
      }
      const next = page.locator('.pf__btn--inline').first();
      if (await next.count()) { await next.click(); await page.waitForTimeout(1200); }
    }
  });
});
