import { test, expect } from '@playwright/test';

const FORM_ID = '4f664085-510b-4887-91ee-0ade8fb20b45';

test('B5 helptip keyboard + mouse gestures', async ({ page }) => {
  await page.goto(`http://localhost:3400/admin/forms/${FORM_ID}/edit`);

  // select the phone step in the spine so its settings panel renders
  await page.waitForSelector('[data-testid="question-spine"]');
  const phoneRow = page.getByText('Phone?', { exact: false }).first();
  await phoneRow.click();

  const trigger = page.locator('[data-testid="help-tip-trigger"]');
  const bubble = page.locator('[data-testid="help-tip-bubble"]');
  await expect(trigger).toHaveCount(1, { timeout: 10000 });

  const log: string[] = [];
  const snap = async (tag: string) => {
    const count = await bubble.count();
    const expanded = await trigger.getAttribute('aria-expanded');
    const describedby = await trigger.getAttribute('aria-describedby');
    const focused = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName,
    );
    log.push(`${tag}: bubbles=${count} aria-expanded=${expanded} describedby=${describedby ? 'set' : 'null'} focus=${focused}`);
  };

  // ---------- KEYBOARD ----------
  // park pointer far away so no hover state is in play
  await page.mouse.move(5, 5);
  await snap('K0 baseline');

  // focus the control immediately BEFORE the help tip, then Tab onto it
  const numberField = page.locator('input[type="number"]').first();
  await numberField.focus().catch(() => {});
  await snap('K1 after focusing number field');

  await trigger.focus();
  await snap('K2 after focus lands on trigger (Tab-in equivalent)');

  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  await snap('K3 after Enter');

  await page.keyboard.press('Space');
  await page.waitForTimeout(150);
  await snap('K4 after Space');

  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  await snap('K5 after second Enter');

  // reset: blur
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(150);
  await snap('K6 after blur/outside click');

  // ---------- REAL TAB SEQUENCE ----------
  await numberField.focus();
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  await snap('T1 after real Tab from number field');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  await snap('T2 after Enter');
  await page.keyboard.press('Space');
  await page.waitForTimeout(150);
  await snap('T3 after Space');

  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(200);
  await snap('T4 reset');

  // ---------- MOUSE ----------
  const box = (await trigger.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(5, 5);
  await page.waitForTimeout(100);
  await snap('M0 pointer far away');

  await page.mouse.move(cx, cy);
  await page.waitForTimeout(200);
  await snap('M1 hovering the i');

  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(200);
  await snap('M2 after single click without moving');

  await page.mouse.move(5, 400);
  await page.waitForTimeout(200);
  await snap('M3 after moving pointer away');

  await page.mouse.move(cx, cy);
  await page.waitForTimeout(150);
  await snap('M3b re-hovered');
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(200);
  await snap('M4 after second click');

  await page.mouse.move(5, 400);
  await page.waitForTimeout(200);
  await snap('M5 pointer away after second click');

  console.log('\n===== HELPTIP OBSERVATIONS =====\n' + log.join('\n') + '\n================================\n');
});
