import { test, expect } from '@playwright/test';

const FORM_ID = '76156223-c706-4a21-810e-9f6c572d0be0';

async function probe(page: any, label: string) {
  const info = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('[data-testid="token-warning"]'));
    const ta = document.querySelector('[data-testid="canvas-title-input"]') as HTMLElement | null;
    const alerts = Array.from(document.querySelectorAll('[role="alert"],[aria-live]')).map((n) => ({
      tag: n.tagName,
      role: n.getAttribute('role'),
      live: n.getAttribute('aria-live'),
      testid: n.getAttribute('data-testid'),
      text: (n.textContent || '').slice(0, 120),
    }));
    return {
      warnings: nodes.map((n) => ({
        tag: n.tagName,
        kind: n.getAttribute('data-kind'),
        form: n.getAttribute('data-form'),
        role: n.getAttribute('role'),
        ariaLive: n.getAttribute('aria-live'),
        id: n.getAttribute('id'),
        ariaAtomic: n.getAttribute('aria-atomic'),
        text: (n.textContent || '').trim(),
        // does any ANCESTOR provide a live region?
        ancestorLive: (() => {
          let p: HTMLElement | null = n.parentElement;
          const chain: string[] = [];
          while (p) {
            const r = p.getAttribute('role');
            const l = p.getAttribute('aria-live');
            if (r || l) chain.push(`${p.tagName}[role=${r} live=${l}]`);
            p = p.parentElement;
          }
          return chain;
        })(),
      })),
      textarea: ta
        ? {
            describedby: ta.getAttribute('aria-describedby'),
            invalid: ta.getAttribute('aria-invalid'),
            role: ta.getAttribute('role'),
            errormessage: ta.getAttribute('aria-errormessage'),
          }
        : null,
      allLiveRegions: alerts,
    };
  });
  console.log(`\n===== ${label} =====`);
  console.log(JSON.stringify(info, null, 2));
  return info;
}

test('A5 token warning aria probe', async ({ page }) => {
  await page.goto(`http://localhost:3400/admin/forms/${FORM_ID}/edit`);
  await page.waitForLoadState('networkidle');

  // select the "Company?" step
  await page.getByText('Company?', { exact: false }).first().click();
  await page.waitForTimeout(500);

  const ta = page.getByTestId('canvas-title-input');
  await expect(ta).toBeVisible();

  // --- case 1: bare @email (raw) ---
  await ta.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await ta.pressSequentially('Hello @email', { delay: 40 });
  await page.keyboard.press('Escape');
  await ta.pressSequentially(', welcome', { delay: 40 });
  await page.waitForTimeout(400);
  await expect(page.getByTestId('token-warning').first()).toBeVisible();
  await probe(page, 'raw / at  (Hello @email, welcome)');

  // --- case 2: @nosuchkey (unknown, at form) ---
  await ta.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await ta.pressSequentially('Hi @nosuchkey', { delay: 30 });
  await page.keyboard.press('Escape');
  await ta.pressSequentially(' there', { delay: 30 });
  await page.waitForTimeout(400);
  await probe(page, 'unknown / at  (Hi @nosuchkey there)');

  // --- case 3: [nosuchkey] (unknown, bracket form) ---
  await ta.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await ta.pressSequentially('Hi [nosuchkey] there', { delay: 30 });
  await page.waitForTimeout(400);
  await probe(page, 'unknown / bracket  (Hi [nosuchkey] there)');

  // --- control: does step-field-key-taken really use role=alert? ---
  console.log('\n===== control: sibling warning markup =====');
});
