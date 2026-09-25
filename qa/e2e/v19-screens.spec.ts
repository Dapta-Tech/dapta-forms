import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Screens (#200): several questions on one slides screen, with one button.
 *
 * Every form here is created through the admin API with `screenGroup` already
 * on its steps, so the public renderer is exercised exactly as it serves a
 * published config.
 *
 * Point it at other ports with QA_API_URL (the web side is `baseURL`), and at
 * the API's database file with QA_DB_PATH when it is not `.data/qa.db`. The
 * public surface is rate-limited per IP (60 requests, then 1/s) and a screen
 * records one event per question: run this file alone, or boot the API with
 * RATE_LIMIT_ENABLED=false.
 */

const API = process.env.QA_API_URL ?? 'http://localhost:4400';

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.QA_DB_PATH ?? path.resolve(SPEC_DIR, '../../.data/qa.db');
const requireFromDb = createRequire(path.resolve(SPEC_DIR, '../../packages/db/package.json'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Database = requireFromDb('better-sqlite3') as new (
  filename: string,
  options?: { readonly?: boolean },
) => { prepare(sql: string): { all(...p: unknown[]): unknown[] }; close(): void };

function query<T>(sql: string, ...params: unknown[]): T[] {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

const RUN = randomUUID().slice(0, 8);

async function createForm(
  request: APIRequestContext,
  label: string,
  config: Record<string, unknown>,
): Promise<{ id: string; slug: string; path: string }> {
  const me = await request.get(`${API}/v1/me`);
  expect(me.status()).toBe(200);
  const { accountCode } = (await me.json()) as { accountCode: string };
  const res = await request.post(`${API}/v1/forms`, { data: { name: `QA screens ${label} ${RUN}`, config } });
  expect(res.status(), await res.text()).toBe(201);
  const form = (await res.json()) as { id: string; slug: string };
  return { ...form, path: `/${accountCode}/f/${form.slug}` };
}

const yesNo = [
  { label: 'Sí', value: 'yes' },
  { label: 'No', value: 'no' },
];

/**
 * Screen 1: a heading and three questions (two required). Screen 2: a choice
 * with a follow-up shown live on "Sí" and a jump on "No" past `meta`, and a
 * dropdown. Then `meta` and `notas`, each on a screen of its own. The partial
 * point is the email, inside screen 1.
 */
const SCREENS = {
  version: 1,
  language: 'es',
  partialSubmitAfterStep: 3,
  steps: [
    { key: 'intro', type: 'message', question: 'Tus datos', buttonText: 'Continuar', screenGroup: 'datos' },
    { key: 'nombre', type: 'text', question: '¿Cómo te llamas?', required: true, screenGroup: 'datos' },
    { key: 'email', type: 'email', question: '¿Cuál es tu correo?', required: true, screenGroup: 'datos' },
    { key: 'telefono', type: 'phone', question: '¿Tu teléfono?', screenGroup: 'datos' },
    {
      key: 'equipo',
      type: 'multiple_choice',
      question: '¿Tienes equipo?',
      options: yesNo,
      goto: [{ values: ['no'], target: 'notas' }],
      screenGroup: 'trabajo',
    },
    {
      key: 'tamano',
      type: 'text',
      question: '¿Cuántas personas?',
      showWhen: { field: 'equipo', values: ['yes'] },
      screenGroup: 'trabajo',
    },
    {
      key: 'plan',
      type: 'dropdown',
      question: '¿Qué plan?',
      options: [
        { label: 'Gratis', value: 'free' },
        { label: 'Pro', value: 'pro' },
      ],
      screenGroup: 'trabajo',
    },
    { key: 'meta', type: 'text', question: '¿Tu meta?' },
    { key: 'notas', type: 'textarea', question: '¿Algo más?' },
  ],
};

/** Eight questions on one screen, then one more. */
const EIGHT = {
  version: 1,
  steps: [
    ...Array.from({ length: 8 }, (_, i) => ({
      key: `q${i + 1}`,
      type: i === 2 ? 'multiple_choice' : i === 5 ? 'textarea' : 'text',
      question: `Question ${i + 1}, long enough to wrap on a phone screen?`,
      required: i < 2,
      ...(i === 2
        ? {
            optionLayout: 'cards',
            options: [
              { label: 'One', value: 'one' },
              { label: 'Two', value: 'two' },
              { label: 'Three', value: 'three' },
            ],
          }
        : {}),
      screenGroup: 'eight',
    })),
    { key: 'after', type: 'text', question: 'After the screen?' },
  ],
};

const button = (page: Page) => page.locator('.pf-s__footer .pf__btn');
const member = (page: Page, key: string) => page.locator(`[data-pf-step="${key}"]`);
const progress = (page: Page) => page.locator('[data-testid="pf-progress"]');
const focusedMember = (page: Page) =>
  page.evaluate(() => document.activeElement?.closest('[data-pf-step]')?.getAttribute('data-pf-step') ?? null);
const sessionOf = (page: Page) =>
  page.evaluate(() => Object.entries(sessionStorage).find(([k]) => k.startsWith('quill-form-'))?.[1] ?? '');

test.describe('screens: several questions on one slides screen', () => {
  test('one click per screen; validation, focus and Enter across the members', async ({ page, request }) => {
    const form = await createForm(request, 'flow', SCREENS);
    await page.goto(form.path);
    await expect(member(page, 'telefono')).toBeVisible();
    await expect(page.locator('[data-pf-step]')).toHaveCount(4);
    await expect(button(page)).toHaveCount(1);
    await expect(progress(page)).toHaveAttribute('aria-label', 'Paso 1 de 4');
    // The first question that takes input has the focus, and only it.
    expect(await focusedMember(page)).toBe('nombre');

    // Two empty required questions: two errors, one announced summary, focus on the first.
    await button(page).click();
    await expect(page.locator('.pf-s__member--error')).toHaveCount(2);
    await expect(member(page, 'nombre').locator('.pf__error')).toHaveText('Este campo es obligatorio.');
    await expect(member(page, 'email').locator('.pf__error')).toHaveText('Este campo es obligatorio.');
    await expect(page.locator('.pf [role="alert"]')).toHaveCount(1);
    expect(await focusedMember(page)).toBe('nombre');

    // Enter walks the fields, the phone's digits included, and submits from the last one.
    await member(page, 'nombre').locator('input').fill('Laura');
    await member(page, 'nombre').locator('input').press('Enter');
    expect(await focusedMember(page)).toBe('email');
    await member(page, 'email').locator('input').fill('laura@example.com');
    await member(page, 'email').locator('input').press('Enter');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('type'))).toBe('tel');
    const session = await sessionOf(page);
    await page.keyboard.press('Enter');
    await expect(progress(page)).toHaveAttribute('aria-label', 'Paso 2 de 4');

    // The partial point (email) was on that screen: saved on its submit.
    await expect
      .poll(() => query<{ partial_at: number | null }>('SELECT partial_at FROM submission WHERE form_id = ? AND session_id = ?', form.id, session)[0]?.partial_at ?? null)
      .not.toBeNull();

    // A follow-up shown by another member's answer appears live; nothing advances by itself.
    await expect(member(page, 'tamano')).toHaveCount(0);
    await member(page, 'equipo').getByRole('radio', { name: 'Sí' }).click();
    await expect(member(page, 'tamano')).toBeVisible();
    await expect(progress(page)).toHaveAttribute('aria-label', 'Paso 2 de 4');
    await member(page, 'equipo').getByRole('radio', { name: 'No' }).click();
    await expect(member(page, 'tamano')).toHaveCount(0);

    // "No" jumps to `notas`, but only when the screen is left: `plan` is still here.
    await expect(member(page, 'plan')).toBeVisible();
    await button(page).click();
    await expect(page.locator('.pf__question')).toHaveText('¿Algo más?');

    // Funnel events per question: a view per visible member (the live one
    // included) and a completion per member when its screen was submitted.
    const events = () =>
      query<{ type: string; step_index: number | null; step_key: string | null }>(
        'SELECT type, step_index, step_key FROM form_event WHERE form_id = ? AND session_id = ? ORDER BY rowid',
        form.id,
        session,
      );
    await expect.poll(() => events().some((e) => e.type === 'step_view' && e.step_key === 'notas')).toBe(true);
    const rows = events();
    // A screen's events go to the API at once, so their rows land in any
    // order within the screen (no metric reads it): compared as a set.
    const listOf = (type: string) =>
      rows
        .filter((e) => e.type === type)
        .map((e) => `${e.step_index}:${e.step_key}`)
        .sort();
    expect(listOf('step_view')).toEqual([
      '0:intro',
      '1:nombre',
      '2:email',
      '3:telefono',
      '4:equipo',
      '5:plan',
      '5:tamano',
      '6:notas',
    ]);
    expect(listOf('step_complete')).toEqual(['0:intro', '1:nombre', '2:email', '3:telefono', '4:equipo', '5:plan']);
    expect(rows.filter((e) => e.type === 'start')).toHaveLength(1);
    expect(rows.filter((e) => e.type === 'partial_submit').map((e) => e.step_key)).toEqual(['email']);
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    test(`eight members at ${viewport.width}x${viewport.height}: one column, nothing clipped, button in flow`, async ({
      page,
      request,
    }) => {
      const form = await createForm(request, `eight-${viewport.width}`, EIGHT);
      await page.setViewportSize(viewport);
      await page.goto(form.path);
      await expect(member(page, 'q8')).toBeVisible();
      const m = await page.evaluate(() => {
        const r = (el: Element) => el.getBoundingClientRect();
        const blocks = [...document.querySelectorAll('[data-pf-step]')].map(r);
        const card = r(document.querySelector('.pf__body')!);
        return {
          overflow: document.documentElement.scrollWidth - innerWidth,
          top: r(document.querySelector('.pf__topbar')!).top,
          stacked: blocks.every((b, i) => i === 0 || b.top >= blocks[i - 1]!.bottom - 1),
          inside: blocks.every((b) => b.left >= card.left - 1 && b.right <= card.right + 1),
          lastBottom: blocks[blocks.length - 1]!.bottom,
          buttonTop: r(document.querySelector('.pf-s__footer .pf__btn')!).top,
          cardWidth: card.width,
          titles: [...document.querySelectorAll('[data-pf-step] .pf__question')].map((el) =>
            parseFloat(getComputedStyle(el).fontSize),
          ),
        };
      });
      expect(m.overflow).toBeLessThanOrEqual(0);
      expect(m.top).toBeGreaterThanOrEqual(0);
      expect(m.stacked && m.inside).toBe(true);
      expect(m.buttonTop).toBeGreaterThanOrEqual(m.lastBottom);
      for (const size of m.titles) {
        expect(size).toBeGreaterThanOrEqual(17);
        expect(size).toBeLessThanOrEqual(21);
      }
      if (viewport.width >= 769) expect(Math.round(m.cardWidth)).toBe(560);
    });
  }

  test('embedded: after a tall screen the host brings the frame back into view, and loading never scrolls it', async ({
    page,
    request,
    baseURL,
  }) => {
    const form = await createForm(request, 'embed', EIGHT);
    // A real host page on another local origin, with exactly the snippet the
    // editor hands out. Served from a socket rather than `page.route`: Chrome
    // refuses a routed (address-less) page framing localhost.
    const html = `<!doctype html><html><body style="margin:0">
      <div style="height:900px">Above</div>
      <iframe data-dapta-forms src="${baseURL}${form.path}?embed=1" title="Form" loading="lazy" style="width:100%;border:0;min-height:480px;"></iframe>
      <div style="height:900px">Below</div>
      <script src="${baseURL}/embed.js" async></script>
    </body></html>`;
    const server = http.createServer((_req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(html);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`http://127.0.0.1:${port}/`);
      await page.waitForTimeout(1_500);
      expect(await page.evaluate(() => scrollY)).toBe(0);
      const frameEl = page.locator('iframe[data-dapta-forms]');
      // A cross-origin frame is not laid out while off screen: the visitor scrolls to it.
      await frameEl.scrollIntoViewIfNeeded();
      const frame = page.frameLocator('iframe[data-dapta-forms]');
      await expect(frame.locator('[data-pf-step="q8"]')).toBeVisible();
      await expect.poll(() => frameEl.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(1200);
      await frame.locator('[data-pf-step="q1"] input').fill('one');
      await frame.locator('[data-pf-step="q2"] input').fill('two');
      await frame.locator('.pf-s__footer .pf__btn').scrollIntoViewIfNeeded();
      expect(await frameEl.evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(0);
      await frame.locator('.pf-s__footer .pf__btn').click();
      await expect(frame.locator('.pf__question')).toHaveText('After the screen?');
      await expect.poll(() => frameEl.evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
      expect(await frameEl.evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(800);
    } finally {
      server.close();
    }
  });

  test('one page ignores the screens: every question on the page, no screen card', async ({ page, request }) => {
    const form = await createForm(request, 'vertical', { ...SCREENS, layout: 'vertical' });
    await page.goto(form.path);
    await expect(page.locator('.pf--vertical')).toBeVisible();
    await expect(page.locator('[data-pf-step]')).toHaveCount(0);
    await expect(page.locator('.pf-v__question')).toHaveCount(8);
  });
});

/**
 * The builder side: a plain slides form, grouped from the editor itself, the
 * way an author does it. Every write is read back from the saved draft.
 */
const PLAIN = {
  version: 1,
  steps: [
    { key: 'intro', type: 'message', question: 'Your details' },
    { key: 'name', type: 'text', question: 'Your name?', required: true },
    { key: 'email', type: 'email', question: 'Your email?', required: true },
    { key: 'phone', type: 'phone', question: 'Your phone?' },
    { key: 'meet', type: 'scheduler', question: 'Book a call' },
    { key: 'notes', type: 'textarea', question: 'Anything else?' },
  ],
};

async function draftGroups(request: APIRequestContext, id: string): Promise<string> {
  const res = await request.get(`${API}/v1/forms/${id}`);
  const form = (await res.json()) as { draftConfig?: { steps: Array<{ key: string; screenGroup?: string }> } };
  return (form.draftConfig?.steps ?? []).map((s) => (s.screenGroup ? `${s.key}:${s.screenGroup}` : s.key)).join(' ');
}

test.describe('screens in the builder', () => {
  test('the spine and the settings switch join and split the same boundary; the canvas shows the screen', async ({
    page,
    request,
  }) => {
    const form = await createForm(request, 'editor', PLAIN);
    await page.goto(`/admin/forms/${form.id}/edit`);
    const spine = page.getByTestId('question-spine');
    await spine.waitFor();

    // A chain on every row; the ones that cannot join say why.
    await expect(page.locator('[data-testid^="screen-toggle-"]')).toHaveCount(6);
    await expect(page.getByTestId('screen-toggle-0')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('screen-toggle-4')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('screen-toggle-4')).toHaveAttribute(
      'title',
      'Calendars, reveal screens and file uploads always get a screen of their own.',
    );

    await spine.getByText('Your email?').hover();
    await page.getByTestId('screen-toggle-2').click();
    await spine.getByText('Your phone?').hover();
    await page.getByTestId('screen-toggle-3').click();
    await expect(page.getByTestId('spine-screen-chip')).toHaveText('Screen 2 · 3 questions');
    await expect.poll(() => draftGroups(request, form.id)).toBe('intro name:screen_1 email:screen_1 phone:screen_1 meet notes');

    // Selecting a question of the screen draws the whole screen, that question marked.
    await spine.getByText('Your email?').click();
    await expect(page.getByTestId('canvas-screen')).toHaveAttribute('data-screen-size', '3');
    await expect(page.locator('[data-testid^="screen-block-"]')).toHaveCount(3);
    await expect(page.getByTestId('screen-block-2')).toHaveAttribute('aria-current', 'true');

    // The settings switch is the same boundary: off splits the screen above the
    // email, which starts a screen of its own (a new id; the name, left alone,
    // loses its).
    // Always in view (the only way to group below lg, where the spine is hidden).
    const join = page.getByTestId('behavior-screen-join');
    await expect(join).toBeVisible();
    await expect(join).toHaveAttribute('aria-checked', 'true');
    await join.click();
    await expect(page.getByTestId('spine-screen-chip')).toHaveText('Screen 3 · 2 questions');
    await expect.poll(() => draftGroups(request, form.id)).toBe('intro name email:screen_2 phone:screen_2 meet notes');

    // The scheduler's switch is off and cannot be turned on: still in the Tab
    // order, announced as unavailable, described by its reason, and a key
    // press does nothing.
    await spine.getByText('Book a call').click();
    const blocked = page.getByTestId('behavior-screen-join');
    await expect(blocked).toHaveAttribute('aria-disabled', 'true');
    await expect(blocked).toHaveAccessibleDescription(
      'Calendars, reveal screens and file uploads always get a screen of their own.',
    );
    await blocked.focus();
    await expect(blocked).toBeFocused();
    await page.keyboard.press('Space');
    await expect(blocked).toHaveAttribute('aria-checked', 'false');
  });

  test('jump targets are screen starts, and the preview walks screens', async ({ page, request }) => {
    // The name jumps to the notes: said to happen when the screen is left.
    const grouped = {
      ...PLAIN,
      steps: PLAIN.steps.map((s) =>
        ['intro', 'name', 'email'].includes(s.key)
          ? { ...s, screenGroup: 'details', ...(s.key === 'name' ? { goto: [{ values: ['*'], target: 'notes' }] } : {}) }
          : s,
      ),
    };
    const form = await createForm(request, 'editor-logic', grouped);
    await page.goto(`/admin/forms/${form.id}/edit`);
    await page.getByTestId('question-spine').getByText('Your name?').click();

    const jumpNote = 'This jump happens when the respondent leaves this screen.';
    await expect(page.getByTestId('question-logic').getByTestId('screen-jump-note')).toHaveText(jumpNote);
    await page.getByTestId('question-logic-edit').click();
    await expect(page.getByTestId('logic-dialog').getByTestId('screen-jump-note')).toHaveText(jumpNote);
    await page.getByTestId('logic-dialog-always').locator('button').first().click();
    await expect(page.getByRole('option')).toHaveText([
      'Next question in order',
      'Your phone?',
      'Book a call',
      'Anything else?',
      'End of the form',
    ]);
    await page.keyboard.press('Escape');
    if (await page.getByTestId('logic-dialog').isVisible()) await page.getByTestId('logic-dialog-close').click();
    await expect(page.getByTestId('logic-dialog')).toHaveCount(0);

    await page.getByTestId('toolbar-preview').or(page.getByRole('button', { name: 'Preview' })).first().click();
    await expect(page.getByTestId('preview-position')).toHaveText('Step 1 of 4');
    // The frame loads its own document and then receives the draft: on a
    // cold server that first paint takes a while.
    const frame = page.frameLocator('[data-testid="preview-iframe"]');
    await expect(frame.locator('[data-pf-step]')).toHaveCount(3, { timeout: 20_000 });
    await page.getByTestId('preview-next').click();
    await expect(page.getByTestId('preview-position')).toHaveText('Step 2 of 4');
    await expect(frame.locator('.pf__question')).toHaveText('Your phone?', { timeout: 20_000 });
  });

  test('one page hides every screen control, keeps the screens, and Design says so', async ({ page, request }) => {
    const grouped = {
      ...PLAIN,
      layout: 'vertical',
      steps: PLAIN.steps.map((s) => (['name', 'email'].includes(s.key) ? { ...s, screenGroup: 'details' } : s)),
    };
    const form = await createForm(request, 'editor-vertical', grouped);
    await page.goto(`/admin/forms/${form.id}/edit`);
    await page.getByTestId('question-spine').waitFor();
    await expect(page.getByTestId('question-logic')).toBeVisible();
    await expect(page.locator('[data-testid^="screen-toggle-"]')).toHaveCount(0);
    await expect(page.getByTestId('spine-screen-chip')).toHaveCount(0);
    await expect(page.getByTestId('behavior-screen-join')).toHaveCount(0);

    await page.goto(`/admin/forms/${form.id}/edit?tab=design`);
    await expect(page.getByTestId('design-screens-ignored')).toHaveText(
      'Screens only apply to Slides. On One page every question is already on one page.',
    );
    await page.getByTestId('design-layout-slides').click();
    await expect(page.getByTestId('design-screens-ignored')).toHaveCount(0);
    await expect.poll(() => draftGroups(request, form.id)).toBe('intro name:details email:details phone meet notes');
  });
});

