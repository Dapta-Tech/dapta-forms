import { test, expect, type APIRequestContext, type Page, type Locator } from '@playwright/test';

const API = 'http://127.0.0.1:4400';
const RUN = Math.random().toString(36).slice(2, 8);
let seq = 0;
const uniqueName = (l: string) => `invk-${l}-${RUN}-${++seq}`;

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
async function draft(request: APIRequestContext, id: string) {
  const f = await (await request.get(`${API}/v1/forms/${id}`)).json();
  const c = typeof f.draftConfig === 'string' ? JSON.parse(f.draftConfig) : f.draftConfig;
  const live = typeof f.config === 'string' ? JSON.parse(f.config) : f.config;
  return { draft: c, live };
}
const keyInput = (page: Page): Locator => page.getByTestId('step-field-key');

async function typeKey(page: Page, value: string) {
  await keyInput(page).click();
  await keyInput(page).fill(value);
  await page.waitForTimeout(300);
}

test.describe('invalid field keys (V5-A10)', () => {
  test.setTimeout(120_000);

  test('empty / punctuation / 64+ / duplicate / case-differing', async ({ page, request }) => {
    const { id } = await createForm(request, uniqueName('keys'), {
      cover: { enabled: false },
      steps: [
        { key: 'email', type: 'email', question: 'Email?' },
        { key: 'company', type: 'text', question: 'Company? [email]' },
      ],
      scoring: { enabled: false },
      outcomes: [],
    });
    await openEditor(page, id);
    await page.getByRole('button', { name: /Company\?/ }).first().click();
    await expect(keyInput(page)).toBeVisible();
    console.log('KEY initial:', await keyInput(page).inputValue());

    // 1. EMPTY
    await typeKey(page, '');
    console.log('EMPTY: taken-warning?', await page.getByTestId('step-field-key-taken').count(), 'value:', await keyInput(page).inputValue());
    await keyInput(page).press('Enter');
    await page.waitForTimeout(600);
    console.log('EMPTY after commit value:', await keyInput(page).inputValue(), 'draft key:', (await draft(request, id)).draft?.steps?.[1]?.key);

    // 2. PURE PUNCTUATION
    await typeKey(page, '!!!');
    console.log('PUNCT: warning?', await page.getByTestId('step-field-key-taken').count(), 'displayed:', await keyInput(page).inputValue());
    await keyInput(page).press('Enter');
    await page.waitForTimeout(900);
    let d = await draft(request, id);
    console.log('PUNCT committed key:', d.draft?.steps?.[1]?.key, '| question of step0 after cascade:', d.draft?.steps?.[1]?.question);
    console.log('PUNCT field hint text:', await page.locator('[data-testid="step-field-key"] ~ p').first().innerText().catch(() => 'n/a'));
    await page.screenshot({ path: 'qa/shots/invk-punct.png', fullPage: true });

    // restore
    await typeKey(page, 'company');
    await keyInput(page).press('Enter');
    await page.waitForTimeout(700);

    // 3. 80 CHARS
    const long = 'a'.repeat(80);
    await typeKey(page, long);
    console.log('LONG typed len:', (await keyInput(page).inputValue()).length, 'warning?', await page.getByTestId('step-field-key-taken').count());
    await keyInput(page).press('Enter');
    await page.waitForTimeout(900);
    d = await draft(request, id);
    console.log('LONG committed key len:', String(d.draft?.steps?.[1]?.key ?? '').length, 'value:', String(d.draft?.steps?.[1]?.key).slice(0, 20) + '…');
    await page.screenshot({ path: 'qa/shots/invk-long.png', fullPage: true });

    // restore
    await typeKey(page, 'company');
    await keyInput(page).press('Enter');
    await page.waitForTimeout(700);

    // 4. DUPLICATE (exact)
    await typeKey(page, 'email');
    console.log('DUP warning count:', await page.getByTestId('step-field-key-taken').count());
    if (await page.getByTestId('step-field-key-taken').count())
      console.log('DUP warning text:', await page.getByTestId('step-field-key-taken').innerText());
    await keyInput(page).press('Enter');
    await page.waitForTimeout(800);
    d = await draft(request, id);
    console.log('DUP after commit key:', d.draft?.steps?.[1]?.key, 'input shows:', await keyInput(page).inputValue());

    // 5. CASE-DIFFERING
    await typeKey(page, 'EMAIL');
    console.log('CASE warning count:', await page.getByTestId('step-field-key-taken').count(), 'input shows:', await keyInput(page).inputValue());
    await keyInput(page).press('Enter');
    await page.waitForTimeout(800);
    d = await draft(request, id);
    console.log('CASE after commit key:', d.draft?.steps?.[1]?.key);
    await page.screenshot({ path: 'qa/shots/invk-case.png', fullPage: true });

    // 6. KEY WITH SPACES / MIXED CASE (silent sanitize?)
    await typeKey(page, 'My Company Name');
    console.log('SPACES input shows:', await keyInput(page).inputValue(), 'warning?', await page.getByTestId('step-field-key-taken').count());
    await keyInput(page).press('Enter');
    await page.waitForTimeout(900);
    d = await draft(request, id);
    console.log('SPACES committed key:', d.draft?.steps?.[1]?.key);
    console.log('SPACES token cascade (step1 question):', d.draft?.steps?.[1]?.question, ' step0 q:', d.draft?.steps?.[0]?.question);
  });

  test('rename onto a name-step SUBFIELD key', async ({ page, request }) => {
    const { id, slug } = await createForm(request, uniqueName('namecol'), {
      cover: { enabled: false },
      steps: [
        { key: 'yourname', type: 'name', question: 'Your name?' },
        { key: 'company', type: 'text', question: 'Company?' },
      ],
      scoring: { enabled: false },
      outcomes: [],
    });
    await openEditor(page, id);
    await page.getByRole('button', { name: /Company\?/ }).first().click();
    await expect(keyInput(page)).toBeVisible();
    await typeKey(page, 'firstname');
    console.log('NAMECOL warning count:', await page.getByTestId('step-field-key-taken').count());
    await keyInput(page).press('Enter');
    await page.waitForTimeout(900);
    const d = await draft(request, id);
    console.log('NAMECOL committed key:', d.draft?.steps?.[1]?.key);
    await page.screenshot({ path: 'qa/shots/invk-namecol.png', fullPage: true });

    // publish then fill the public form and see which value wins
    const pub = await request.post(`${API}/v1/forms/${id}/publish`);
    console.log('publish status:', pub.status());
    const code = await accountCode(request);
    await page.goto(`/${code}/me/${slug}`);
    await page.waitForTimeout(1500);
    const inputs = page.locator('.pf__fields input');
    console.log('public name inputs:', await inputs.count());
    await inputs.nth(0).fill('Ada');
    await inputs.nth(1).fill('Lovelace');
    await page.locator('.pf__btn--inline').first().click();
    await page.waitForTimeout(1200);
    await page.locator('.pf__fields input').first().fill('AcmeCorp');
    await page.locator('.pf__btn--inline').first().click();
    await page.waitForTimeout(2500);
    console.log('public after submit:', (await page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 200));
    const subs = await (await request.get(`${API}/v1/forms/${id}/submissions`)).json();
    console.log('SUBMISSION answers:', JSON.stringify(subs).slice(0, 600));
  });
});
