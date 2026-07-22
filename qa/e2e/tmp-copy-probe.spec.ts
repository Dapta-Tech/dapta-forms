import { test, expect } from '@playwright/test';

const API = 'http://localhost:4400/v1';
const SHOTS = 'qa/shots/tmp-copy';
let ACCOUNT = '';

test.beforeAll(async ({ request }) => {
  ACCOUNT = (await (await request.get(`${API}/me`)).json()).accountCode;
});

async function mkForm(request: any, config: any) {
  const r = await request.post(`${API}/forms`, { data: { name: `copylens ${Date.now()}`, config } });
  const j = await r.json();
  return j as { id: string; slug: string };
}

async function pick(page: any, text: string) {
  const spine = page.locator('[data-testid="question-spine"]');
  await spine.waitFor({ state: 'visible', timeout: 15000 });
  await spine.getByText(text, { exact: false }).first().click();
  await page.waitForTimeout(500);
}

test('public: slider whose default sits above max', async ({ page, request }) => {
  const f = await mkForm(request, {
    version: 1,
    cover: { enabled: false },
    steps: [{ key: 'leads', type: 'slider', question: 'How many leads?', min: 0, max: 100, default: 500 }],
  });
  await page.goto(`/${ACCOUNT}/me/${f.slug}`);
  await page.waitForTimeout(1200);
  const body = await page.locator('body').innerText();
  console.log('PUBLIC SLIDER PAGE TEXT:', body.replace(/\n/g, ' | ').slice(0, 300));
  const range = page.locator('input[type=range]');
  console.log('range value =', await range.first().inputValue().catch(() => 'n/a'));
  await page.screenshot({ path: `${SHOTS}/30-public-slider.png` });
});

test('logic: partial overlap advisory copy', async ({ page, request }) => {
  const f = await mkForm(request, {
    version: 1,
    steps: [
      { key: 'leads', type: 'slider', question: 'How many leads?', min: 0, max: 1000, default: 10 },
      {
        key: 'followup', type: 'text', question: 'Tell us more',
        showWhen: { field: 'leads', op: 'between', min: 200, max: 500 },
        hideWhen: { field: 'leads', op: 'gt', value: 201 },
      },
    ],
  });
  await page.goto(`/admin/forms/${f.id}/edit?tab=build`);
  await page.waitForLoadState('networkidle');
  await pick(page, 'Tell us more');
  const n = page.getByTestId('logic-narrow');
  console.log('NARROW count:', await n.count());
  if (await n.count()) console.log('NARROW TEXT:', (await n.first().innerText()).replace(/\n/g, ' '));
  await page.screenshot({ path: `${SHOTS}/31-logic-narrow.png`, fullPage: true });
});

test('logic: NO overlap should stay silent', async ({ page, request }) => {
  const f = await mkForm(request, {
    version: 1,
    steps: [
      { key: 'leads', type: 'slider', question: 'How many leads?', min: 0, max: 1000, default: 10 },
      {
        key: 'followup', type: 'text', question: 'Tell us more',
        showWhen: { field: 'leads', op: 'between', min: 200, max: 500 },
        hideWhen: { field: 'leads', op: 'gt', value: 900 },
      },
    ],
  });
  await page.goto(`/admin/forms/${f.id}/edit?tab=build`);
  await page.waitForLoadState('networkidle');
  await pick(page, 'Tell us more');
  const n = page.getByTestId('logic-narrow');
  console.log('DISJOINT-HIDE narrow count (expect 0):', await n.count());
  if (await n.count()) console.log('  TEXT:', (await n.first().innerText()).replace(/\n/g, ' '));
  await page.screenshot({ path: `${SHOTS}/32-logic-nooverlap.png`, fullPage: true });
});

test('connect: autosave status copy', async ({ page, request }) => {
  const f = await mkForm(request, {
    version: 1,
    steps: [{ key: 'email', type: 'email', question: 'Email?' }],
  });
  await page.goto(`/admin/forms/${f.id}/edit?tab=connect`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);
  const s = page.getByTestId('integrations-save-status');
  console.log('STATUS count:', await s.count());
  if (await s.count()) {
    console.log('STATUS data-status:', await s.first().getAttribute('data-status'));
    console.log('STATUS TEXT (fresh load):', JSON.stringify(await s.first().innerText()));
  }
  await page.screenshot({ path: `${SHOTS}/33-connect-fresh.png`, fullPage: true });
  // make an edit
  const gtm = page.getByTestId('tracking-gtm');
  if (await gtm.count()) {
    await gtm.fill('GTM-COPY123');
    await page.waitForTimeout(300);
    console.log('STATUS right after typing:', await s.first().getAttribute('data-status'), JSON.stringify(await s.first().innerText()));
    await page.waitForTimeout(2000);
    console.log('STATUS after debounce:', await s.first().getAttribute('data-status'), JSON.stringify(await s.first().innerText()));
  }
  await page.screenshot({ path: `${SHOTS}/34-connect-saved.png`, fullPage: true });
});

test('create form: inline name error copy', async ({ page }) => {
  await page.goto('/admin/forms');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: /new form|create/i }).first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/35-create-open.png` });
  // submit empty
  await page.getByRole('button', { name: /^create$/i }).first().click();
  await page.waitForTimeout(600);
  const e = page.getByTestId('create-form-name-error');
  console.log('CREATE ERROR count:', await e.count());
  if (await e.count()) console.log('CREATE ERROR TEXT:', await e.innerText());
  await page.screenshot({ path: `${SHOTS}/36-create-error.png` });
  // whitespace only
  const input = page.locator('input[name=name]');
  await input.fill('   ');
  await page.waitForTimeout(200);
  console.log('after typing spaces, error visible?', await e.count());
  await page.getByRole('button', { name: /^create$/i }).first().click();
  await page.waitForTimeout(600);
  console.log('after submitting spaces, error count:', await e.count(), await e.count() ? await e.innerText() : '');
  await page.screenshot({ path: `${SHOTS}/37-create-spaces.png` });
});
