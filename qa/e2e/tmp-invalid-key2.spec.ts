import { test, expect, type APIRequestContext, type Page, type Locator } from '@playwright/test';

const API = 'http://127.0.0.1:4400';
const RUN = Math.random().toString(36).slice(2, 8);
let seq = 0;
const uniqueName = (l: string) => `invk2-${l}-${RUN}-${++seq}`;

async function createForm(request: APIRequestContext, name: string, config: Record<string, unknown>) {
  const res = await request.post(`${API}/v1/forms`, { data: { name, config: { version: 1, ...config } } });
  expect(res.ok(), `create failed ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: string; slug: string };
}
async function openEditor(page: Page, id: string) {
  await page.goto(`/admin/forms/${id}/edit?tab=build`);
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible({ timeout: 30_000 });
}
async function saved(page: Page) {
  await expect(page.getByTestId('editor-save-status')).toHaveAttribute('data-status', 'saved', { timeout: 15_000 });
}
async function draftSteps(request: APIRequestContext, id: string) {
  const f = await (await request.get(`${API}/v1/forms/${id}`)).json();
  const c = typeof f.draftConfig === 'string' ? JSON.parse(f.draftConfig) : f.draftConfig;
  return c?.steps ?? [];
}
const keyInput = (page: Page): Locator => page.getByTestId('step-field-key');
async function setKey(page: Page, value: string) {
  await keyInput(page).click();
  await keyInput(page).fill(value);
  await page.waitForTimeout(250);
  await keyInput(page).press('Enter');
  await page.waitForTimeout(400);
}

test.describe('field key sanitize/persist', () => {
  test.setTimeout(150_000);

  test('punctuation / 80 chars / spaces — what actually persists', async ({ page, request }) => {
    const { id } = await createForm(request, uniqueName('sanitize'), {
      cover: { enabled: false },
      steps: [
        { key: 'email', type: 'email', question: 'Email?' },
        { key: 'company', type: 'text', question: 'Company for [email]?' },
      ],
      scoring: { enabled: false },
      outcomes: [],
    });

    // --- punctuation
    await openEditor(page, id);
    await page.getByRole('button', { name: /Company for/ }).first().click();
    await expect(keyInput(page)).toBeVisible();
    await setKey(page, '!!!');
    console.log('PUNCT hint now:', await page.locator('[data-testid="step-field-key"] ~ p').first().innerText());
    console.log('PUNCT taken-warn:', await page.getByTestId('step-field-key-taken').count());
    await saved(page);
    let steps = await draftSteps(request, id);
    console.log('PUNCT persisted keys:', steps.map((s: any) => s.key), 'q1 text:', steps[1]?.question);
    await page.screenshot({ path: 'qa/shots/invk2-punct.png', fullPage: true });

    // --- 80 chars (on a fresh form so state is clean)
    const f2 = await createForm(request, uniqueName('long'), {
      cover: { enabled: false },
      steps: [{ key: 'email', type: 'email', question: 'Email?' }, { key: 'company', type: 'text', question: 'Company?' }],
      scoring: { enabled: false }, outcomes: [],
    });
    await openEditor(page, f2.id);
    await page.getByRole('button', { name: /Company\?/ }).first().click();
    await expect(keyInput(page)).toBeVisible();
    await setKey(page, 'b'.repeat(80));
    console.log('LONG taken-warn:', await page.getByTestId('step-field-key-taken').count());
    console.log('LONG input now:', (await keyInput(page).inputValue()).length, 'chars');
    await saved(page);
    steps = await draftSteps(request, f2.id);
    console.log('LONG persisted key length:', String(steps[1]?.key ?? '').length);

    // --- spaces + mixed case
    const f3 = await createForm(request, uniqueName('spaces'), {
      cover: { enabled: false },
      steps: [{ key: 'email', type: 'email', question: 'Email?' }, { key: 'company', type: 'text', question: 'Company?' }],
      scoring: { enabled: false }, outcomes: [],
    });
    await openEditor(page, f3.id);
    await page.getByRole('button', { name: /Company\?/ }).first().click();
    await expect(keyInput(page)).toBeVisible();
    await setKey(page, 'My Company Name');
    console.log('SPACES taken-warn:', await page.getByTestId('step-field-key-taken').count());
    await saved(page);
    steps = await draftSteps(request, f3.id);
    console.log('SPACES persisted key:', steps[1]?.key);
  });

  test('two punctuation keys collide into the same sanitized key', async ({ page, request }) => {
    const { id } = await createForm(request, uniqueName('collide'), {
      cover: { enabled: false },
      steps: [
        { key: 'aaa', type: 'text', question: 'AAA?' },
        { key: 'bbb', type: 'text', question: 'BBB?' },
      ],
      scoring: { enabled: false }, outcomes: [],
    });
    await openEditor(page, id);
    await page.getByRole('button', { name: /AAA\?/ }).first().click();
    await setKey(page, '###');
    await saved(page);
    await page.getByRole('button', { name: /BBB\?/ }).first().click();
    await expect(keyInput(page)).toBeVisible();
    await setKey(page, '$$$');
    console.log('COLLIDE warn:', await page.getByTestId('step-field-key-taken').count());
    await page.waitForTimeout(2500);
    const steps = await draftSteps(request, id);
    console.log('COLLIDE persisted keys:', steps.map((s: any) => s.key));
    await page.screenshot({ path: 'qa/shots/invk2-collide.png', fullPage: true });
  });
});
