import { test, expect } from '@playwright/test';

const FORM_ID = 'b2f98cb0-02f9-446a-a41b-1fb7bc87ff76';

test('A10 field key enter focus + collision revert', async ({ page }) => {
  await page.goto(`http://localhost:3400/admin/forms/${FORM_ID}/edit`);
  const key = page.getByTestId('step-field-key');
  await expect(key).toBeVisible({ timeout: 15000 });
  console.log('INITIAL VALUE =', await key.inputValue());

  // --- Step 2: valid rename, press Enter
  await key.click();
  await key.fill('work_email');
  await key.press('Enter');
  await page.waitForTimeout(600);

  const after1 = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return {
      tag: el?.tagName ?? null,
      testid: el?.getAttribute?.('data-testid') ?? null,
      isBody: el === document.body,
    };
  });
  console.log('AFTER ENTER (valid) activeElement =', JSON.stringify(after1));
  console.log('AFTER ENTER (valid) input value =', await page.getByTestId('step-field-key').inputValue());

  // --- Step 3: collide with the other step's key
  const key2 = page.getByTestId('step-field-key');
  await key2.click();
  await key2.fill('company');
  await page.waitForTimeout(300);
  const alertVisible = await page.getByTestId('step-field-key-taken').isVisible().catch(() => false);
  console.log('COLLISION ALERT VISIBLE (before Enter) =', alertVisible);

  const aria = await page.evaluate(() => {
    const input = document.querySelector('[data-testid="step-field-key"]') as HTMLElement | null;
    const alert = document.querySelector('[data-testid="step-field-key-taken"]') as HTMLElement | null;
    return {
      ariaInvalid: input?.getAttribute('aria-invalid') ?? null,
      ariaDescribedby: input?.getAttribute('aria-describedby') ?? null,
      ariaErrormessage: input?.getAttribute('aria-errormessage') ?? null,
      alertId: alert?.getAttribute('id') ?? null,
      alertRole: alert?.getAttribute('role') ?? null,
      alertText: alert?.textContent ?? null,
    };
  });
  console.log('ARIA WHILE COLLIDING =', JSON.stringify(aria));

  await key2.press('Enter');
  await page.waitForTimeout(600);

  const after2 = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    const input = document.querySelector('[data-testid="step-field-key"]') as HTMLInputElement | null;
    const alert = document.querySelector('[data-testid="step-field-key-taken"]');
    return {
      activeTag: el?.tagName ?? null,
      activeTestid: el?.getAttribute?.('data-testid') ?? null,
      isBody: el === document.body,
      inputValue: input?.value ?? null,
      alertPresent: !!alert,
      alertText: alert?.textContent ?? null,
      liveRegions: Array.from(document.querySelectorAll('[role="alert"],[role="status"],[aria-live]')).map(
        (n) => (n.textContent ?? '').trim().slice(0, 80),
      ),
    };
  });
  console.log('AFTER ENTER (collision) =', JSON.stringify(after2, null, 2));

  // --- Also check: what does the spine/config say now?
  const spine = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="question-spine"] *')).length,
  );
  console.log('spine node count', spine);
});
