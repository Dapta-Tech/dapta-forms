import { test, expect, type APIRequestContext, type Frame, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * One page as a regular web form (#127): half-width pairs share a row from
 * 400 px (so they pair inside a 400 to 600 px embed) and stack below it, a name step shows a label above each input, and
 * `branding.density: 'compact'` packs the page. The reference is a clinic
 * contact form of 7 fields, embedded in a hero: at 1440 px its embed must be
 * no taller than 650 px, and at least 45 % shorter than the same config with
 * neither density nor width.
 *
 * Point it at other ports with QA_API_URL and QA_WEB_URL. QA_SHOTS_DIR keeps
 * the screenshots somewhere outside the test output. Run it in Chromium and
 * WebKit: `--browser=chromium` / `--browser=webkit`.
 */

const API = process.env.QA_API_URL ?? 'http://localhost:4400';
if (process.env.QA_WEB_URL) test.use({ baseURL: process.env.QA_WEB_URL });

const RUN = randomUUID().slice(0, 8);

async function createForm(request: APIRequestContext, label: string, config: Record<string, unknown>) {
  const me = await request.get(`${API}/v1/me`);
  expect(me.status()).toBe(200);
  const { accountCode } = (await me.json()) as { accountCode: string };
  const res = await request.post(`${API}/v1/forms`, { data: { name: `QA one page ${label} ${RUN}`, config } });
  expect(res.status(), await res.text()).toBe(201);
  const form = (await res.json()) as { id: string; slug: string };
  return { ...form, path: `/${accountCode}/f/${form.slug}` };
}

const STEPS = [
  {
    key: 'nombre',
    type: 'name',
    question: 'Nombre y apellido',
    required: true,
    fieldLabels: { firstname: 'Nombre', lastname: 'Apellido' },
  },
  { key: 'telefono', type: 'phone', question: 'Teléfono', required: true, width: 'half' },
  { key: 'email', type: 'email', question: 'Correo', required: true, width: 'half' },
  {
    key: 'sede',
    type: 'dropdown',
    question: 'Sede',
    required: true,
    width: 'half',
    options: [
      { label: 'Centro', value: 'centro' },
      { label: 'Norte', value: 'norte' },
      { label: 'Sur', value: 'sur' },
    ],
  },
  {
    key: 'servicio',
    type: 'dropdown',
    question: 'Servicio',
    required: true,
    width: 'half',
    options: [
      { label: 'Valoración', value: 'valoracion' },
      { label: 'Limpieza', value: 'limpieza' },
      { label: 'Ortodoncia', value: 'ortodoncia' },
      { label: 'Blanqueamiento', value: 'blanqueamiento' },
    ],
  },
  {
    key: 'consentimiento',
    type: 'multiple_choice',
    question: 'Tratamiento de datos',
    required: true,
    options: [{ label: 'Acepto el tratamiento de mis datos', value: 'acepto' }],
  },
];

const REFERENCE = {
  version: 1,
  language: 'es',
  layout: 'vertical',
  cover: { enabled: false },
  branding: { density: 'compact' },
  steps: STEPS,
};

/** The same config with neither density nor width: every question a full, roomy row. */
const BASELINE = {
  ...REFERENCE,
  branding: {},
  steps: STEPS.map(({ width: _width, ...step }) => step),
};

const PAIRS: Array<[string, string]> = [
  ['telefono', 'email'],
  ['sede', 'servicio'],
];

function shotsDir(): string {
  const dir = process.env.QA_SHOTS_DIR ?? test.info().outputPath('shots');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function shot(name: string): string {
  return path.join(shotsDir(), `${test.info().project.name || 'default'}-${name}.png`);
}

async function tops(target: Page | Frame) {
  await target.waitForSelector('[data-vf-step="servicio"]');
  return target.evaluate(() => {
    const out: Record<string, number> = {};
    for (const el of document.querySelectorAll<HTMLElement>('[data-vf-step]')) {
      out[el.dataset.vfStep!] = Math.round(el.getBoundingClientRect().top + window.scrollY);
    }
    return out;
  });
}

/**
 * The height the embed asks its host for: what `EmbedHeightReporter` posts
 * (the `.pf-embed-root` wrapper's bottom edge, overflow included). Not
 * `documentElement.scrollHeight` in a 900 px tall window: that never reads
 * below the window's own height, while a real iframe is sized to the content.
 */
async function embedHeight(page: Page, formPath: string): Promise<number> {
  await page.goto(`${formPath}?embed=1`);
  await page.waitForSelector('[data-vf-step="servicio"]');
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('.pf-embed-root')!;
    return Math.ceil(content.getBoundingClientRect().top + window.scrollY + content.scrollHeight);
  });
}

test.describe('one page: rows, name labels and compact density', () => {
  let reference: { id: string; path: string };
  let baseline: { id: string; path: string };

  test.beforeAll(async ({ request }) => {
    reference = await createForm(request, 'reference', REFERENCE);
    baseline = await createForm(request, 'baseline', BASELINE);
  });

  test('embed at 1440: <= 650 px, at least 45 % shorter, pairs share a row', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const before = await embedHeight(page, baseline.path);
    await page.screenshot({ path: shot('1440-embed-baseline'), fullPage: true });
    const after = await embedHeight(page, reference.path);
    await page.screenshot({ path: shot('1440-embed-reference'), fullPage: true });
    const drop = 1 - after / before;
    test.info().annotations.push({
      type: 'heights',
      description: `reference ${after}px, baseline ${before}px, ${(drop * 100).toFixed(1)}% shorter`,
    });
    console.log(`[${test.info().project.name || 'default'}] embed 1440: reference ${after}px, baseline ${before}px, ${(drop * 100).toFixed(1)}% shorter`);
    expect(after).toBeLessThanOrEqual(650);
    expect(drop).toBeGreaterThanOrEqual(0.45);

    const t = await tops(page);
    for (const [a, b] of PAIRS) expect(t[a], `${a} and ${b}`).toBe(t[b]);
    // 5 visual rows: name, phone + email, site + service, consent, button.
    const rowsAt = new Set(Object.values(t));
    expect(rowsAt.size).toBe(4);
    await expect(page.locator('.pf-v__row')).toHaveCount(2);
    await expect(page.locator('.pf-name-field__label')).toHaveText(['Nombre*', 'Apellido*']);
    await expect(page.locator('[data-vf-step="nombre"] h2.pf__question')).toHaveClass(/sr-only/);
  });

  test('390: every pair stacks and nothing overflows sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [label, suffix] of [
      ['public', ''],
      ['embed', '?embed=1'],
    ] as const) {
      await page.goto(`${reference.path}${suffix}`);
      const t = await tops(page);
      for (const [a, b] of PAIRS) expect(t[a], `${a} and ${b}`).toBeLessThan(t[b]!);
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
      // Labelled name inputs stack too.
      const names = await page.locator('.pf-name-field').evaluateAll((els) =>
        els.map((e) => Math.round(e.getBoundingClientRect().top)),
      );
      expect(names[0]).toBeLessThan(names[1]!);
      await page.screenshot({ path: shot(`390-${label}-reference`), fullPage: true });
    }
  });

  test('embed at 480 (a card on a landing page): pairs and labelled name share a row', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 900 });
    const after = await embedHeight(page, reference.path);
    await page.screenshot({ path: shot('480-embed-reference'), fullPage: true });
    console.log(`[${test.info().project.name || 'default'}] embed 480: reference ${after}px`);
    const t = await tops(page);
    for (const [a, b] of PAIRS) expect(t[a], `${a} and ${b}`).toBe(t[b]);
    const names = await page.locator('.pf-name-field').evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().top)),
    );
    expect(names[0]).toBe(names[1]);
    // A half cell at this width still opens the country picker whole.
    await page.locator('[data-vf-step="telefono"] .pf-phone__country').click();
    const panel = page.locator('[data-vf-step="telefono"] .pf-phone__panel');
    await expect(panel).toBeVisible();
    expect((await panel.boundingBox())!.height).toBeGreaterThan(100);
    await page.screenshot({ path: shot('480-embed-country-open'), fullPage: true });
    await page.keyboard.press('Escape');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(overflow).toBe(true);
  });

  test('1440: the service dropdown and the country picker open whole', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const [label, suffix] of [
      ['public', ''],
      ['embed', '?embed=1'],
    ] as const) {
      await page.goto(`${reference.path}${suffix}`);
      await page.waitForSelector('[data-vf-step="servicio"]');

      await page.locator('[data-vf-step="servicio"] input.pf-input').click();
      const list = page.locator('[data-vf-step="servicio"] .pf-dropdown__list');
      await expect(list).toBeVisible();
      await expect(list.getByRole('option')).toHaveCount(4);
      const listBox = (await list.boundingBox())!;
      const cell = (await page.locator('[data-vf-step="servicio"]').boundingBox())!;
      // Not clipped by the row: the panel is as wide as its cell and hangs below it.
      expect(Math.round(listBox.width)).toBeGreaterThanOrEqual(Math.round(cell.width) - 2);
      await page.screenshot({ path: shot(`1440-${label}-dropdown-open`), fullPage: true });
      await page.keyboard.press('Escape');
      await page.locator('h2').first().click({ force: true }).catch(() => undefined);

      await page.locator('[data-vf-step="telefono"] .pf-phone__country').click();
      const panel = page.locator('[data-vf-step="telefono"] .pf-phone__panel');
      await expect(panel).toBeVisible();
      const panelBox = (await panel.boundingBox())!;
      expect(panelBox.height).toBeGreaterThan(100);
      await page.screenshot({ path: shot(`1440-${label}-country-open`), fullPage: true });
      await page.keyboard.press('Escape');
    }
  });

  test('builder preview at 1280 and 390 matches the public form', async ({ page, browserName }) => {
    // The preview iframe stays blank under Playwright's WebKit for every form,
    // a one-question legacy one included: a harness limit, not this layout.
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`/admin/forms/${reference.id}/edit?tab=design`);
    const frameOf = async () => {
      const handle = await page.waitForSelector('[data-testid="preview-iframe"]');
      const frame = (await handle.contentFrame())!;
      await frame.waitForSelector('[data-vf-step="servicio"]', { state: 'attached', timeout: 60_000 });
      await page.waitForTimeout(500);
      return frame;
    };

    await expect(page.locator('[data-testid="design-density"]')).toBeVisible();
    const desktop = await tops(await frameOf());
    for (const [a, b] of PAIRS) expect(desktop[a], `${a} and ${b}`).toBe(desktop[b]);
    await page.screenshot({ path: shot('builder-preview-1280') });

    await page.click('[data-testid="preview-device-mobile"]');
    const mobile = await tops(await frameOf());
    for (const [a, b] of PAIRS) expect(mobile[a], `${a} and ${b}`).toBeLessThan(mobile[b]!);
    await page.screenshot({ path: shot('builder-preview-390') });

    // The public form at the same widths, for the side-by-side.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(reference.path);
    await tops(page);
    await page.screenshot({ path: shot('public-1280-reference'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(reference.path);
    await tops(page);
    await page.screenshot({ path: shot('public-390-reference'), fullPage: true });

  });

  test('builder canvas shows the rows, the name labels and compact density', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`/admin/forms/${reference.id}/edit`);
    await expect(page.locator('[data-testid="canvas-page"]')).toBeVisible();
    await expect(page.locator('[data-testid^="page-row-"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="canvas-name-labels-note"]')).toBeVisible();
    await page.screenshot({ path: shot('builder-canvas-1600'), fullPage: true });
  });
});
