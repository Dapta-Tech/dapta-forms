import { test, expect } from '@playwright/test';

const FID = 'cb5bb701-ba22-42db-a183-12dbd92cc2fd';
const SHOTS = 'qa/shots/tmp-copy';

async function openSlider(page: any) {
  await page.goto(`/admin/forms/${FID}/edit?tab=build`);
  await page.waitForLoadState('networkidle');
  await page.getByText('How many leads?').first().click();
  await page.waitForTimeout(400);
}

test('probe: slider default above max', async ({ page }) => {
  await openSlider(page);
  // SLIDER grid inputs: min, max, step, default in DOM order
  const grid = page.locator('.grid.grid-cols-2').first();
  const inputs = grid.locator('input');
  console.log('grid input count', await inputs.count());
  await inputs.nth(3).fill('500');
  await inputs.nth(3).blur();
  await page.waitForTimeout(800);
  const w = page.getByTestId('slider-default-out-of-range');
  console.log('DEFAULT ABOVE MAX warning count:', await w.count());
  if (await w.count()) console.log('TEXT:', (await w.first().innerText()).replace(/\n/g, ' '));
  // what does the canvas actually render?
  console.log('CANVAS value:', await page.locator('.pf-slider__value, [class*="slider"]').first().innerText().catch(() => 'n/a'));
  await page.screenshot({ path: `${SHOTS}/11-default-above-max.png`, fullPage: true });
});

test('probe: slider default below min', async ({ page }) => {
  await openSlider(page);
  const grid = page.locator('.grid.grid-cols-2').first();
  const inputs = grid.locator('input');
  await inputs.nth(0).fill('20'); // min = 20
  await inputs.nth(0).blur();
  await inputs.nth(3).fill('5'); // default = 5 (below min)
  await inputs.nth(3).blur();
  await page.waitForTimeout(800);
  const w = page.getByTestId('slider-default-out-of-range');
  console.log('DEFAULT BELOW MIN count:', await w.count());
  if (await w.count()) console.log('TEXT:', (await w.first().innerText()).replace(/\n/g, ' '));
  await page.screenshot({ path: `${SHOTS}/13-default-below-min.png`, fullPage: true });
});

test('probe: max below min', async ({ page }) => {
  await openSlider(page);
  const grid = page.locator('.grid.grid-cols-2').first();
  const inputs = grid.locator('input');
  await inputs.nth(1).fill('-5');
  await inputs.nth(1).blur();
  await page.waitForTimeout(800);
  for (const id of ['slider-max-below-min', 'slider-default-out-of-range']) {
    const l = page.getByTestId(id);
    const n = await l.count();
    console.log(id, n, n ? (await l.first().innerText()).replace(/\n/g, ' ') : '');
  }
  await page.screenshot({ path: `${SHOTS}/12-max-below-min.png`, fullPage: true });
});
