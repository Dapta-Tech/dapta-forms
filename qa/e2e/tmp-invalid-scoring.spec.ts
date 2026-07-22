import { test, expect, type APIRequestContext, type Page, type Locator } from '@playwright/test';

const API = 'http://127.0.0.1:4400';
const RUN = Math.random().toString(36).slice(2, 8);
let seq = 0;
const uniqueName = (l: string) => `invs-${l}-${RUN}-${++seq}`;

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
  return (await (await request.get(`${API}/v1/me`)).json()).accountCode as string;
}
const panel = (page: Page): Locator => page.locator('div.border-l').last();

test.describe('invalid scoring ranges + outcomes', () => {
  test.setTimeout(150_000);

  test('inverted slider scoring range: no flag, awards nothing, but counts in max', async ({ page, request }) => {
    const { id, slug } = await createForm(request, uniqueName('inverted'), {
      cover: { enabled: false },
      steps: [
        { key: 'lvl', type: 'slider', question: 'Level?', min: 0, max: 100, step: 1, default: 50,
          flowGroup: 'qualification', sliderScoring: [{ min: 80, max: 20, points: 10 }] },
      ],
      scoring: { enabled: true },
      outcomes: [{ id: 'lo', label: 'Low', minScore: 0 }, { id: 'hi', label: 'High', minScore: 5 }],
    });
    await openEditor(page, id);
    await page.getByRole('button', { name: /Level\?/ }).first().click();
    await page.waitForTimeout(700);
    console.log('INVERTED unreachable-flag:', await page.getByTestId('slider-range-unreachable').count());
    console.log('INVERTED range fields:', await panel(page).locator('input[type=number]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)));
    await page.screenshot({ path: 'qa/shots/invs-inverted-build.png', fullPage: true });

    await page.goto(`/admin/forms/${id}/edit?tab=results`);
    await expect(page.getByTestId('results-end')).toBeVisible({ timeout: 20_000 });
    console.log('INVERTED results points hint:', await page.locator('section').first().innerText());
    await page.screenshot({ path: 'qa/shots/invs-inverted-results.png', fullPage: true });

    const code = await accountCode(request);
    await page.goto(`/${code}/me/${slug}`);
    await page.waitForTimeout(1500);
    // leave the slider at its default 50 (inside 20..80) and submit
    await page.locator('.pf__btn--inline').first().click();
    await page.waitForTimeout(2500);
    console.log('INVERTED done text:', (await page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 200));
    const subs = await (await request.get(`${API}/v1/forms/${id}/submissions`)).json();
    console.log('INVERTED submission:', JSON.stringify(subs.items?.[0] ?? {}).slice(0, 300));
  });

  test('overlapping slider scoring ranges: which wins, any warning?', async ({ page, request }) => {
    const { id, slug } = await createForm(request, uniqueName('overlap'), {
      cover: { enabled: false },
      steps: [
        { key: 'lvl', type: 'slider', question: 'Level?', min: 0, max: 100, step: 1, default: 50,
          flowGroup: 'qualification', sliderScoring: [{ min: 0, max: 60, points: 1 }, { min: 20, max: 100, points: 9 }] },
      ],
      scoring: { enabled: true },
      outcomes: [{ id: 'lo', label: 'Low', minScore: 0 }, { id: 'hi', label: 'High', minScore: 5 }],
    });
    await openEditor(page, id);
    await page.getByRole('button', { name: /Level\?/ }).first().click();
    await page.waitForTimeout(700);
    console.log('OVERLAP unreachable-flag count:', await page.getByTestId('slider-range-unreachable').count());
    console.log('OVERLAP any alert:', await page.locator('[role=alert]').allInnerTexts());
    await page.screenshot({ path: 'qa/shots/invs-overlap-build.png', fullPage: true });

    const code = await accountCode(request);
    await page.goto(`/${code}/me/${slug}`);
    await page.waitForTimeout(1500);
    await page.locator('.pf__btn--inline').first().click();
    await page.waitForTimeout(2500);
    const subs = await (await request.get(`${API}/v1/forms/${id}/submissions`)).json();
    console.log('OVERLAP submission (value 50 → in BOTH ranges):', JSON.stringify(subs.items?.[0] ?? {}).slice(0, 300));
  });

  test('unreachable range flagged but still counted in "highest possible"', async ({ page, request }) => {
    const { id } = await createForm(request, uniqueName('unreach'), {
      cover: { enabled: false },
      steps: [
        { key: 'lvl', type: 'slider', question: 'Level?', min: 0, max: 100, step: 1, default: 50,
          flowGroup: 'qualification', sliderScoring: [{ min: 500, max: 600, points: 40 }] },
      ],
      scoring: { enabled: true },
      outcomes: [{ id: 'lo', label: 'Low', minScore: 0 }],
    });
    await openEditor(page, id);
    await page.getByRole('button', { name: /Level\?/ }).first().click();
    await page.waitForTimeout(700);
    console.log('UNREACH flag:', await page.getByTestId('slider-range-unreachable').count(),
      await page.getByTestId('slider-range-unreachable').innerText().catch(() => ''));
    await page.goto(`/admin/forms/${id}/edit?tab=results`);
    await expect(page.getByTestId('results-end')).toBeVisible({ timeout: 20_000 });
    console.log('UNREACH results points panel:', (await page.locator('section').first().innerText()).replace(/\n+/g, ' | '));
    await page.screenshot({ path: 'qa/shots/invs-unreach-results.png', fullPage: true });
  });

  test('outcome minScore: decimal typed in the UI, duplicates, negatives', async ({ page, request }) => {
    const { id } = await createForm(request, uniqueName('minscore'), {
      cover: { enabled: false },
      steps: [
        { key: 'pick', type: 'multiple_choice', question: 'Pick', flowGroup: 'qualification',
          options: [{ label: 'A', value: 'a', points: 5 }, { label: 'B', value: 'b', points: 0 }] },
      ],
      scoring: { enabled: true },
      outcomes: [{ id: 'lo', label: 'Low', minScore: 0 }, { id: 'hi', label: 'High', minScore: 5 }],
    });
    await page.goto(`/admin/forms/${id}/edit?tab=results`);
    await expect(page.getByTestId('results-end')).toBeVisible({ timeout: 20_000 });
    const ms = page.getByTestId('outcome-minscore');
    console.log('MINSCORE initial:', await ms.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)));

    // 1. decimal
    await ms.nth(1).fill('2.5');
    await ms.nth(1).blur();
    await page.waitForTimeout(3000);
    const status = page.getByTestId('editor-save-status');
    console.log('DECIMAL save status:', await status.getAttribute('data-status'), '| label:', await status.innerText(), '| title:', await status.getAttribute('title'));
    console.log('DECIMAL range chips:', await page.getByTestId('outcome-row').allInnerTexts().then((t) => t.map((x) => x.split('\n')[0])));
    await page.screenshot({ path: 'qa/shots/invs-minscore-decimal.png', fullPage: true });

    // 2. back to integer, then duplicate minScore
    await ms.nth(1).fill('0');
    await ms.nth(1).blur();
    await page.waitForTimeout(2500);
    console.log('DUPE save status:', await page.getByTestId('editor-save-status').getAttribute('data-status'));
    console.log('DUPE range chips:', await page.getByTestId('outcome-row').allInnerTexts().then((t) => t.map((x) => x.split('\n')[0])));
    await page.screenshot({ path: 'qa/shots/invs-minscore-dupe.png', fullPage: true });

    // 3. negative
    await page.getByTestId('outcome-minscore').nth(1).fill('-40');
    await page.getByTestId('outcome-minscore').nth(1).blur();
    await page.waitForTimeout(2500);
    console.log('NEG save status:', await page.getByTestId('editor-save-status').getAttribute('data-status'));
    console.log('NEG range chips:', await page.getByTestId('outcome-row').allInnerTexts().then((t) => t.map((x) => x.split('\n')[0])));
    await page.screenshot({ path: 'qa/shots/invs-minscore-neg.png', fullPage: true });
  });
});
