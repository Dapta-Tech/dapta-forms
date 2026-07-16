import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

/**
 * Screenshot capture for the V3 feedback presentation. Not a functional test —
 * it drives each changed surface and saves a PNG to qa/shots/. Run:
 *   npx playwright test -c qa/playwright.config.ts qa/e2e/v3-shots.spec.ts --reporter=list
 *
 * Conventions: every temp form is created via the admin API with a `v3shot-`
 * name (→ slug prefix) and deleted in afterEach so the QA DB keeps ONLY the
 * user's three forms. The forms-list shot runs FIRST, before any temp form
 * exists, so the list shows exactly the user's forms. Viewport 1440×900.
 */

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(here, '..', 'shots');
mkdirSync(SHOTS, { recursive: true });
const API = 'http://localhost:4400';
const shot = (name: string) => resolve(SHOTS, `${name}.png`);

// Per-run nonce (Date.now is banned in specs) keeps slugs unique per run.
const RUN = randomUUID().slice(0, 8);
let seq = 0;
const slugFor = (label: string) => `v3shot-${label}-${RUN}-${++seq}`;

test.use({ viewport: { width: 1440, height: 900 } });

let accountCode = '';
let handle = 'me';
/** Ids of forms created by the CURRENT test — swept in afterEach. */
const created: string[] = [];

test.beforeAll(async ({ request }) => {
  const me = (await (await request.get(`${API}/v1/me`)).json()) as {
    accountCode: string;
    handle: string | null;
  };
  accountCode = me.accountCode;
  handle = me.handle ?? 'me';
});

test.afterEach(async ({ request }) => {
  // Delete every temp form this attempt created so the QA DB stays clean even
  // when a capture fails mid-way (retries recreate their own forms).
  while (created.length > 0) {
    const id = created.pop()!;
    await request.delete(`${API}/v1/forms/${id}`).catch(() => {});
  }
});

/**
 * Create a temp form with a PRESENTABLE display name (shown in the editor
 * header / public topbar) and a `v3shot-` slug (the QA cleanup marker — the
 * create API honors an explicit slug).
 */
async function createForm(
  request: APIRequestContext,
  name: string,
  slugLabel: string,
  config: Record<string, unknown>,
): Promise<{ id: string; slug: string }> {
  const res = await request.post(`${API}/v1/forms`, {
    data: { name, slug: slugFor(slugLabel), config },
  });
  expect(res.ok(), `POST /v1/forms failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; slug: string };
  expect(body.slug.startsWith('v3shot-'), `slug must carry v3shot-: ${body.slug}`).toBe(true);
  created.push(body.id);
  return body;
}

/**
 * Open a public form and click through its cover. The public API bucket is
 * shared per-IP across every QA suite — reload until the cover renders instead
 * of failing on a transient 429.
 */
async function openCover(page: Page, path: string, cta: string): Promise<void> {
  await page.goto(path);
  const start = page.getByRole('button', { name: cta });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const visible = await start
      .waitFor({ state: 'visible', timeout: 2_500 })
      .then(() => true)
      .catch(() => false);
    if (visible) break;
    await page.waitForTimeout(1_500);
    await page.reload();
  }
  await start.click();
}

/** A forms-list row anchored on the form id (names can collide, ids cannot). */
function rowFor(page: Page, id: string) {
  return page
    .getByTestId('form-row')
    .filter({ has: page.locator(`a[data-testid="form-row-edit"][href="/admin/forms/${id}/edit"]`) });
}

// ---------------------------------------------------------------------------
// 2 · v3-forms-list — FIRST so the list holds only the user's three forms.
// ---------------------------------------------------------------------------
test('shot · forms list action rows', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/admin/forms');

  const rows = page.getByTestId('form-row');
  for (const name of ['Pilot Lead Qualifier', 'Test', 'Customer feedback']) {
    await expect(rows.filter({ hasText: name }).first()).toBeVisible({ timeout: 25_000 });
  }
  // Action set present on a row: Edit/Submissions/Analytics/Connect + icons.
  const first = rows.first();
  for (const tid of [
    'form-row-edit',
    'form-row-submissions',
    'form-row-analytics',
    'form-row-connect',
    'form-row-copy',
    'form-row-open',
    'form-row-menu',
  ]) {
    await expect(first.getByTestId(tid)).toBeVisible();
  }
  await page.waitForTimeout(500); // icon fonts settle
  await page.screenshot({ path: shot('v3-forms-list') });
});

// ---------------------------------------------------------------------------
// 1 · v3-step-order — public form authored name-first renders name FIRST.
// ---------------------------------------------------------------------------
test('shot · public step order (name first, WYSIWYG)', async ({ page, request }) => {
  test.setTimeout(90_000);
  const form = await createForm(request, 'Encuentra tu plan ideal', 'orden', {
    version: 1,
    cover: {
      enabled: true,
      badge: 'Evaluación de 2 minutos',
      headline: 'Encuentra el plan ideal para tu equipo',
      subheadline: 'Responde unas preguntas y agenda una llamada con nosotros.',
      ctaText: 'Comenzar',
    },
    steps: [
      {
        // Authored FIRST with the editor's own lead_capture tag — the shape the
        // old two-phase reorder used to demote to the end.
        key: 'nombre',
        type: 'name',
        question: '¿Cómo te llamas?',
        flowGroup: 'lead_capture',
        required: true,
        fields: ['firstname', 'lastname'],
      },
      {
        key: 'correo',
        type: 'email',
        question: '¿Cuál es tu correo de trabajo?',
        flowGroup: 'lead_capture',
        required: true,
      },
      {
        key: 'area',
        type: 'multiple_choice',
        question: '¿Qué área quieres mejorar primero?',
        flowGroup: 'qualification',
        options: [
          { label: 'Ventas', value: 'ventas' },
          { label: 'Soporte', value: 'soporte' },
          { label: 'Marketing', value: 'marketing' },
        ],
      },
    ],
    scoring: { enabled: false },
    outcomes: [{ id: 'done', label: 'Gracias', minScore: 0 }],
  });

  await openCover(page, `/${accountCode}/${handle}/${form.slug}`, 'Comenzar');
  await expect(page.locator('.pf__question')).toHaveText('¿Cómo te llamas?');
  await expect(page.locator('.pf-name-fields input')).toHaveCount(2);
  await page.waitForTimeout(500); // step entrance transition settles
  await page.screenshot({ path: shot('v3-step-order') });
});

// ---------------------------------------------------------------------------
// 3 · v3-confirm-dialog — branded delete confirm, CANCELLED (cleanup via API).
// ---------------------------------------------------------------------------
test('shot · branded confirm dialog', async ({ page, request }) => {
  test.setTimeout(60_000);
  const form = await createForm(request, 'Encuesta demo', 'encuesta-demo', {
    version: 1,
    cover: { enabled: true, headline: 'Encuesta demo', ctaText: 'Comenzar' },
    steps: [
      { key: 'correo', type: 'email', question: '¿Cuál es tu correo?', required: true },
      { key: 'detalle', type: 'text', question: 'Cuéntanos un poco más' },
    ],
  });

  await page.goto('/admin/forms');
  const row = rowFor(page, form.id);
  await expect(row).toBeVisible({ timeout: 25_000 });

  await row.getByTestId('form-row-menu').click();
  await row.getByRole('menuitem', { name: /^(Delete|Eliminar)$/ }).click();

  const dlg = page.getByTestId('confirm-dialog');
  await expect(dlg).toBeVisible();
  await expect(page.getByTestId('confirm-dialog-confirm')).toBeVisible();
  await expect(page.getByTestId('confirm-dialog-cancel')).toBeVisible();
  await page.waitForTimeout(350); // overlay fade settles
  await page.screenshot({ path: shot('v3-confirm-dialog') });

  // CANCEL — never delete through the dialog; afterEach removes it via API.
  await page.getByTestId('confirm-dialog-cancel').click();
  await expect(dlg).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 4 · v3-connect-tab — Integrations (HubSpot connected) + top of Tracking.
// ---------------------------------------------------------------------------
test('shot · editor Connect tab', async ({ page, request }) => {
  test.setTimeout(60_000);
  const form = await createForm(request, 'Califica a tus leads', 'conectar', {
    version: 1,
    cover: { enabled: true, headline: 'Califica a tus leads', ctaText: 'Comenzar' },
    steps: [
      { key: 'correo', type: 'email', question: '¿Cuál es tu correo de trabajo?', required: true },
      { key: 'empresa', type: 'text', question: '¿Cómo se llama tu empresa?' },
    ],
  });

  await page.goto(`/admin/forms/${form.id}/edit?tab=connect`);
  await expect(page.getByTestId('connect-panel')).toBeVisible();

  const integrations = page.getByTestId('connect-integrations');
  await expect(integrations.getByText('HubSpot connected')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('tracking-gtm')).toBeVisible();

  // Keep BOTH section titles in frame: minimally scroll the Tracking heading
  // into view (bottom edge) so the Integrations title stays above it.
  await page
    .getByRole('heading', { name: /Tracking/i })
    .scrollIntoViewIfNeeded()
    .catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot('v3-connect-tab') });
});

// ---------------------------------------------------------------------------
// 5 · v3-tracking — Tracking & Pixels card with GTM + Meta pixel ids typed in.
// ---------------------------------------------------------------------------
test('shot · tracking & pixels filled', async ({ page, request }) => {
  test.setTimeout(60_000);
  const form = await createForm(request, 'Campaña de leads', 'pixeles', {
    version: 1,
    cover: { enabled: true, headline: 'Campaña de leads', ctaText: 'Comenzar' },
    steps: [{ key: 'correo', type: 'email', question: '¿Cuál es tu correo?', required: true }],
  });

  await page.goto(`/admin/forms/${form.id}/edit?tab=connect`);
  await expect(page.getByTestId('connect-panel')).toBeVisible();

  const gtm = page.getByTestId('tracking-gtm');
  await gtm.scrollIntoViewIfNeeded();
  await gtm.fill('GTM-EXAMPLE1');
  await page.getByTestId('tracking-meta').fill('111222333444555');
  await expect(gtm).toHaveValue('GTM-EXAMPLE1');
  await expect(page.getByTestId('tracking-meta')).toHaveValue('111222333444555');

  // Center the card so the whole Tracking section is the subject of the shot.
  await page
    .getByRole('heading', { name: /Tracking/i })
    .evaluate((el) => el.scrollIntoView({ block: 'start' }))
    .catch(() => {});
  await page.waitForTimeout(600); // debounced autosave indicator settles
  await page.screenshot({ path: shot('v3-tracking') });
});

// ---------------------------------------------------------------------------
// 6 · v3-mapping-dropdown — custom mapping key Select OPEN (grouped options).
// ---------------------------------------------------------------------------
test('shot · mapping key dropdown open', async ({ page, request }) => {
  test.setTimeout(60_000);
  const form = await createForm(request, 'Mapeo a HubSpot', 'mapeo', {
    version: 1,
    cover: { enabled: true, headline: 'Mapeo a HubSpot', ctaText: 'Comenzar' },
    steps: [
      { key: 'correo', type: 'email', question: '¿Cuál es tu correo de trabajo?', required: true },
      {
        key: 'area',
        type: 'multiple_choice',
        question: '¿Qué área te interesa?',
        options: [
          { label: 'Ventas', value: 'Ventas' },
          { label: 'Soporte', value: 'Soporte' },
        ],
      },
    ],
    // Enabled at creation → the HubSpot card body renders expanded on load.
    destinations: [{ type: 'hubspot', enabled: true }],
  });

  await page.goto(`/admin/forms/${form.id}/edit?tab=connect`);
  await expect(page.getByRole('switch', { name: 'HubSpot', exact: true })).toBeVisible({
    timeout: 20_000,
  });

  const addMapping = page.getByRole('button', { name: 'Add mapping', exact: true });
  await addMapping.scrollIntoViewIfNeeded();
  await addMapping.click();

  const keySelect = page.getByTestId('mapping-key-select');
  await expect(keySelect).toBeVisible();
  // Center the row BEFORE opening so the dropdown panel has room below.
  await keySelect.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await keySelect.getByRole('button', { name: 'Form step key' }).click();

  await expect(keySelect.getByRole('listbox')).toBeVisible();
  await expect(keySelect.getByRole('option', { name: 'Form questions', exact: true })).toBeVisible();
  await expect(keySelect.getByRole('option', { name: 'System fields', exact: true })).toBeVisible();
  await expect(keySelect.getByRole('option', { name: 'utm_source', exact: true })).toBeVisible();
  await expect(keySelect.getByRole('option', { name: 'Custom key…', exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('v3-mapping-dropdown') }); // dropdown stays open
});

// ---------------------------------------------------------------------------
// 7 · v3-question-mapto — Build tab, per-question "Map to" with email mapped.
// ---------------------------------------------------------------------------
test('shot · question Map to (HubSpot)', async ({ page, request }) => {
  test.setTimeout(60_000);
  const form = await createForm(request, 'Leads B2B', 'mapto', {
    version: 1,
    cover: { enabled: true, headline: 'Califica a tus leads', ctaText: 'Comenzar' },
    steps: [
      { key: 'work_email', type: 'email', question: '¿Cuál es tu correo de trabajo?', required: true },
      { key: 'empresa', type: 'text', question: '¿Cómo se llama tu empresa?' },
    ],
    destinations: [{ type: 'hubspot', enabled: true }],
  });

  await page.goto(`/admin/forms/${form.id}/edit`);

  const mapto = page.getByTestId('qs-hubspot-mapto');
  await expect(mapto).toBeVisible({ timeout: 25_000 });

  await mapto.getByRole('button', { name: 'Map to' }).click();
  await mapto.getByRole('textbox').fill('email');
  await mapto.getByRole('option', { name: 'Email (email)', exact: true }).click();
  await expect(mapto.getByRole('button', { name: 'Map to' })).toContainText('Email (email)');
  // Saved flash is transient — wait for it best-effort, then shoot fast.
  await page
    .getByTestId('qs-hubspot-saved')
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => {});
  await page.getByTestId('qs-hubspot-section').scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot('v3-question-mapto') });
});

// ---------------------------------------------------------------------------
// 8 · v3-partial-point — spine marker between two questions + info popover.
// ---------------------------------------------------------------------------
test('shot · partial submit point + info popover', async ({ page, request }) => {
  test.setTimeout(60_000);
  const form = await createForm(request, 'Diagnóstico de ventas', 'parcial', {
    version: 1,
    cover: { enabled: true, headline: 'Diagnóstico de ventas', ctaText: 'Comenzar' },
    steps: [
      { key: 'correo', type: 'email', question: '¿Cuál es tu correo de trabajo?', required: true },
      { key: 'nombre', type: 'text', question: '¿Cómo te llamas?', required: true },
      { key: 'empresa', type: 'text', question: '¿Cómo se llama tu empresa?', required: true },
    ],
    scoring: { enabled: true },
    outcomes: [{ id: 'default', label: 'Gracias', minScore: -100 }],
  });

  await page.goto(`/admin/forms/${form.id}/edit`);

  const addBtn = page.getByTestId('partial-point-add');
  await expect(addBtn).toBeVisible({ timeout: 25_000 });
  await addBtn.click(); // marker drops AFTER question 1 (the selected step)

  const marker = page.getByTestId('partial-point-row');
  await expect(marker).toBeVisible();

  const info = page.getByTestId('partial-point-info');
  await info.click();
  await expect(info).toHaveAttribute('aria-expanded', 'true');
  await expect(marker.getByText(/partial/i).first()).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot('v3-partial-point') });
});

// ---------------------------------------------------------------------------
// 9 · v3-emails — Connect tab Emails, one card expanded in customize mode.
// ---------------------------------------------------------------------------
test('shot · per-form email customize', async ({ page, request }) => {
  test.setTimeout(60_000);
  const form = await createForm(request, 'Registro al programa', 'correos', {
    version: 1,
    cover: { enabled: true, headline: 'Registro al programa', ctaText: 'Comenzar' },
    steps: [{ key: 'correo', type: 'email', question: '¿Cuál es tu correo?', required: true }],
  });

  await page.goto(`/admin/forms/${form.id}/edit?tab=connect`);
  const emails = page.getByTestId('connect-emails');
  await expect(emails).toBeVisible();
  await emails.scrollIntoViewIfNeeded();

  await page.getByTestId('connect-email-customize-submission_confirmed').click();
  const subject = page.getByTestId('connect-email-submission_confirmed-subject');
  await expect(subject).toBeVisible();
  await subject.fill('Gracias {{formName}}');
  await expect(subject).toHaveValue('Gracias {{formName}}');

  // Center the expanded card so subject/body/save are all in frame.
  await page
    .getByTestId('connect-email-submission_confirmed')
    .evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('v3-emails') });
});

// ---------------------------------------------------------------------------
// 10 · v3-at-picker — "@" token dropdown open on the second question's title.
// ---------------------------------------------------------------------------
test('shot · @ token picker open', async ({ page, request }) => {
  test.setTimeout(60_000);
  const Q1 = '¿Cómo te llamas?';
  const Q2 = '¿Qué reto quieres resolver?';
  const form = await createForm(request, 'Cuéntanos de ti', 'tokens', {
    version: 1,
    cover: { enabled: true, headline: 'Cuéntanos de ti', ctaText: 'Comenzar' },
    steps: [
      { key: 'fullname', type: 'name', question: Q1, required: true, fields: ['firstname', 'lastname'] },
      { key: 'reto', type: 'text', question: Q2 },
    ],
  });

  await page.goto(`/admin/forms/${form.id}/edit`);
  const title = page.getByTestId('canvas-title-input');
  await expect(title).toHaveValue(Q1, { timeout: 25_000 });

  // Select the SECOND question in the spine, then type @ at the title's end.
  await page.getByRole('button', { name: Q2 }).first().click();
  await expect(title).toHaveValue(Q2);
  await expect(page.getByTestId('token-hint')).toBeVisible();

  await title.click();
  await page.keyboard.press('End');
  await title.pressSequentially('@');

  await expect(page.getByTestId('token-picker')).toBeVisible();
  await expect(page.getByTestId('token-option')).toHaveCount(2); // firstname + lastname
  await page.waitForTimeout(250);
  await page.screenshot({ path: shot('v3-at-picker') }); // dropdown stays open
});

// ---------------------------------------------------------------------------
// 11 · v3-name-placeholders — canvas live preview + Name fields settings.
// ---------------------------------------------------------------------------
test('shot · name placeholders preview + settings', async ({ page, request }) => {
  test.setTimeout(60_000);
  const form = await createForm(request, 'Bienvenido al piloto', 'nombres', {
    version: 1,
    cover: { enabled: true, headline: 'Bienvenido al piloto', ctaText: 'Comenzar' },
    steps: [
      { key: 'fullname', type: 'name', question: '¿Cómo te llamas?', required: true },
      { key: 'correo', type: 'email', question: '¿Cuál es tu correo?', required: true },
    ],
  });

  await page.goto(`/admin/forms/${form.id}/edit`);

  // The name step is auto-selected; canvas previews the localized defaults.
  await expect(page.getByTestId('canvas-name-first')).toHaveAttribute('placeholder', 'First name', {
    timeout: 25_000,
  });
  await expect(page.getByTestId('canvas-name-second')).toHaveAttribute('placeholder', 'Last name');

  // The Name fields settings (right panel) show the same defaults.
  const settingsFirst = page.getByTestId('name-placeholder-0');
  await expect(settingsFirst).toBeVisible();
  await settingsFirst.scrollIntoViewIfNeeded();
  await expect(page.getByTestId('name-placeholder-1')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot('v3-name-placeholders') });
});
