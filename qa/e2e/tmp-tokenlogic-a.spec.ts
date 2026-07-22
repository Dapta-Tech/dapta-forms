import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/** THROWAWAY QA probe — tokens (A5) + logic advisories (A6). Delete after the run. */

const API = 'http://localhost:4400';
const RUN = randomUUID().slice(0, 6);
let seq = 0;
function uniqueName(label: string): string {
  seq += 1;
  return `tmp-tl-${label}-${RUN}-${seq}`;
}

async function accountCode(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API}/v1/me`);
  const me = (await res.json()) as { accountCode: string };
  return me.accountCode;
}

async function createForm(
  request: APIRequestContext,
  name: string,
  config: unknown,
): Promise<{ id: string; path: string }> {
  const code = await accountCode(request);
  const res = await request.post(`${API}/v1/forms`, { data: { name, config } });
  expect(res.ok(), `create failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; slug: string };
  return { id: body.id, path: `/${code}/me/${body.slug}` };
}

const Q_NAME = 'What is your name?';
const Q_EMAIL = 'Work email?';
const Q_COMPANY = 'Company?';
const Q_TARGET = 'What do you want to fix?';
const Q_BUDGET = 'Budget?';

function tokenConfig() {
  return {
    version: 1,
    cover: { enabled: true, headline: 'tok', ctaText: 'Start' },
    steps: [
      { key: 'fullname', type: 'name', question: Q_NAME, fields: ['firstname', 'lastname'] },
      { key: 'email', type: 'email', question: Q_EMAIL, required: true },
      { key: 'company', type: 'text', question: Q_COMPANY },
      { key: 'target', type: 'text', question: Q_TARGET },
      { key: 'budget', type: 'slider', question: Q_BUDGET, min: 0, max: 1000, default: 100 },
    ],
  };
}

function title(page: Page) {
  return page.getByTestId('canvas-title-input');
}

async function openEditor(page: Page, id: string) {
  await page.goto(`/admin/forms/${id}/edit`);
  await expect(title(page)).toHaveValue(Q_NAME);
}

async function selectStep(page: Page, questionText: string) {
  await page.getByRole('button', { name: questionText }).first().click();
}

/** Dump every visible token warning as {kind, form, text}. */
async function warnings(page: Page) {
  const els = page.getByTestId('token-warning');
  const n = await els.count();
  const out: { kind: string | null; form: string | null; text: string }[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push({
      kind: await els.nth(i).getAttribute('data-kind'),
      form: await els.nth(i).getAttribute('data-form'),
      text: ((await els.nth(i).textContent()) ?? '').trim(),
    });
  }
  return out;
}

test('A5 probe — warning matrix on the canvas title', async ({ page, request }) => {
  const { id } = await createForm(request, uniqueName('a5'), tokenConfig());
  await openEditor(page, id);
  await selectStep(page, Q_TARGET);
  await expect(title(page)).toHaveValue(Q_TARGET);

  const cases: string[] = [
    'Hi [firstname], what do you want to fix?', // valid earlier bracket -> silent
    'Hi @firstname, what do you want to fix?', // A5 raw
    'Budget check [budget]?', // later bracket
    'Budget check @budget?', // later, at-form
    'Ask about [nope]', // unknown bracket
    'Ask about @nope', // unknown at
    'Email us at sales@gmail.com for help', // REAL email in question text
    'Reach me: first.last@acme.co.uk', // email with dots
    'Just an @ sign alone', // bare @
    '@firstname and @firstname twice', // duplicate at-token
    '[firstname] and @firstname', // both spellings, same key
    'Pricing tier [optional] notes', // legit bracketed word
    'Twitter handle @jack?', // social handle
    'Cost is 100 @ 5% per unit', // @ used as "at" with number after
    'Hola @Firstname', // wrong case
  ];

  for (const text of cases) {
    await title(page).fill(text);
    // let React settle
    await expect(title(page)).toHaveValue(text);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ text, warnings: await warnings(page) }));
  }
});

test('A5 probe — warnings while the picker is open / mid-typing an email', async ({ page, request }) => {
  const { id } = await createForm(request, uniqueName('a5typing'), tokenConfig());
  await openEditor(page, id);
  await selectStep(page, Q_TARGET);

  await title(page).fill('');
  await title(page).click();

  const trace: { typed: string; picker: boolean; warnings: unknown }[] = [];
  const email = 'Mail me at bob@gmail.com';
  for (const ch of email) {
    await title(page).pressSequentially(ch, { delay: 15 });
    trace.push({
      typed: await title(page).inputValue(),
      picker: await page.getByTestId('token-picker').isVisible().catch(() => false),
      warnings: await warnings(page),
    });
  }
  // eslint-disable-next-line no-console
  console.log('EMAIL TYPING TRACE:\n' + trace.map((t) => JSON.stringify(t)).join('\n'));

  // Now the same for a legitimate token typed by hand.
  await title(page).fill('');
  const trace2: { typed: string; picker: boolean; warnings: unknown }[] = [];
  for (const ch of '@company') {
    await title(page).pressSequentially(ch, { delay: 15 });
    trace2.push({
      typed: await title(page).inputValue(),
      picker: await page.getByTestId('token-picker').isVisible().catch(() => false),
      warnings: await warnings(page),
    });
  }
  // eslint-disable-next-line no-console
  console.log('AT-TOKEN TYPING TRACE:\n' + trace2.map((t) => JSON.stringify(t)).join('\n'));
});
