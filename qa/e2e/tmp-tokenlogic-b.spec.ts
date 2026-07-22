import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/** THROWAWAY QA probe — what the PUBLIC form does with @token vs [token]. */

const API = 'http://localhost:4400';
const RUN = randomUUID().slice(0, 6);
let seq = 0;
function uniqueName(label: string): string {
  seq += 1;
  return `tmp-tlp-${label}-${RUN}-${seq}`;
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

async function openToFirstQuestion(page: Page, formPath: string, first: RegExp) {
  await page.goto(formPath);
  const start = page.getByRole('button', { name: 'Start' });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const visible = await start
      .waitFor({ state: 'visible', timeout: 2_000 })
      .then(() => true)
      .catch(() => false);
    if (visible) break;
    await page.waitForTimeout(1_500);
    await page.reload();
  }
  await start.click();
  await expect(page.locator('.pf__question')).toHaveText(first);
}

test('public render of @token vs [token]', async ({ page, request }) => {
  const { path } = await createForm(request, uniqueName('render'), {
    version: 1,
    cover: { enabled: true, headline: 'render', ctaText: 'Start' },
    steps: [
      { key: 'fullname', type: 'name', question: 'Your name?', fields: ['firstname', 'lastname'] },
      { key: 'q_at_valid', type: 'text', question: 'Hi @firstname, ready?' },
      { key: 'q_at_later', type: 'text', question: 'Budget check @budget?' },
      { key: 'q_br_later', type: 'text', question: 'Budget check [budget]?' },
      { key: 'q_br_unknown', type: 'text', question: 'Pricing tier [optional] notes' },
      { key: 'q_email', type: 'text', question: 'Email us at sales@gmail.com for help' },
      { key: 'budget', type: 'slider', question: 'Budget?', min: 0, max: 1000, default: 100 },
    ],
  });

  await openToFirstQuestion(page, path, /Your name/);
  // fill the name so [firstname] would resolve
  const inputs = page.locator('.pf__fields input');
  await inputs.nth(0).fill('Ada');
  await inputs.nth(1).fill('Lovelace');
  await page.locator('.pf__btn--inline').first().click();

  const seen: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    await expect(page.locator('.pf__question')).toBeVisible();
    seen.push(((await page.locator('.pf__question').textContent()) ?? '').trim());
    const box = page.locator('.pf__fields input, .pf__fields textarea').first();
    if (await box.isVisible().catch(() => false)) await box.fill('x');
    await page.locator('.pf__btn--inline').first().click();
    await page.waitForTimeout(250);
  }
  // eslint-disable-next-line no-console
  console.log('PUBLIC QUESTIONS RENDERED:\n' + seen.map((s) => JSON.stringify(s)).join('\n'));
});
