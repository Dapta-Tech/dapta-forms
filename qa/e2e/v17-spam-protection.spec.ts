import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Spam protection (#198): the human check before a form's final submit.
 *
 * Which half runs depends on how the QA API was booted:
 *
 * - WITH keys (the provider's public test keys; they always pass):
 *     CAPTCHA_SITE_KEY=1x00000000000000000000AA \
 *     CAPTCHA_SECRET_KEY=1x0000000000000000000000000000000AA bash qa/dev-sqlite.sh
 *   runs the "deployment with keys" block.
 * - WITHOUT keys (the default harness, and every bare fork) runs the other one.
 *
 * The provider's browser script is replaced with a stub (`page.route`), so no
 * test here needs the network and every widget outcome is deterministic: a
 * token, an error, or a click the person has to make. The test secret accepts
 * any token, which is what lets a stubbed widget complete a real submit. The
 * real widget against the test keys is exercised by hand (see the PR).
 *
 * Point it at other ports with QA_API_URL (the web side is `baseURL`), and at
 * the API's database file with QA_DB_PATH when it is not `.data/qa.db`. The
 * public surface is rate-limited per IP (60 requests, then 1/s): run this file
 * alone, or boot with RATE_LIMIT_ENABLED=false, or it reads RATE_LIMITED.
 */

const API = process.env.QA_API_URL ?? 'http://localhost:4400';
const CHALLENGE_HOST = 'challenges.cloudflare.com';

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

interface Me {
  accountCode: string;
  captcha?: { available: boolean };
}

async function me(request: APIRequestContext): Promise<Me> {
  const res = await request.get(`${API}/v1/me`);
  expect(res.status()).toBe(200);
  return (await res.json()) as Me;
}

const TWO_QUESTIONS = [
  { key: 'nombre', type: 'text', question: '¿Cómo te llamas?', required: true },
  { key: 'email', type: 'email', question: '¿Cuál es tu correo?', required: true },
];

/** Two questions, a partial point after the first, and a webhook listening to BOTH phases. */
function config(
  spamProtection: Record<string, unknown> | null,
  layout?: 'vertical',
  steps: Record<string, unknown>[] = TWO_QUESTIONS,
): Record<string, unknown> {
  return {
    version: 1,
    language: 'es',
    ...(layout ? { layout } : {}),
    steps,
    partialSubmitAfterStep: 1,
    ...(spamProtection ? { spamProtection } : {}),
    // Loopback target: allowed outside production. Delivery is irrelevant here;
    // the assertions are on what was ENQUEUED.
    destinations: [{ type: 'webhook', enabled: true, settings: { url: `${API}/health` } }],
  };
}

async function createForm(
  request: APIRequestContext,
  label: string,
  cfg: Record<string, unknown>,
): Promise<{ id: string; slug: string; path: string; code: string }> {
  const { accountCode } = await me(request);
  const res = await request.post(`${API}/v1/forms`, { data: { name: `QA spam ${label} ${RUN}`, config: cfg } });
  expect(res.status(), await res.text()).toBe(201);
  const form = (await res.json()) as { id: string; slug: string };
  return { ...form, code: accountCode, path: `/${accountCode}/f/${form.slug}` };
}

function rowsOf(formId: string) {
  return query<{ id: string; completed_at: number | null; partial_at: number | null; data: string }>(
    'SELECT id, completed_at, partial_at, data FROM submission WHERE form_id = ?',
    formId,
  );
}

function deliveriesOf(submissionIds: string[]) {
  if (submissionIds.length === 0) return [];
  return query<{ kind: string; action: string }>(
    `SELECT kind, action FROM outbox WHERE kind IN ('webhook', 'hubspot')
       AND subject_uid IN (${submissionIds.map(() => '?').join(',')})`,
    ...submissionIds,
  );
}

type StubMode = 'pass' | 'error' | 'interactive';

/**
 * Replace the provider's script with a stand-in whose widget answers `mode`,
 * recording every render's options on `window.__renders`.
 */
async function stubChallenge(page: Page, mode: StubMode): Promise<string[]> {
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes(CHALLENGE_HOST)) requests.push(r.url());
  });
  await page.route(`https://${CHALLENGE_HOST}/**`, (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        window.__renders = [];
        window.turnstile = {
          render(el, opts) {
            window.__renders.push({ appearance: opts.appearance, action: opts.action, cData: opts.cData,
              language: opts.language, size: opts.size, sitekey: opts.sitekey });
            const mode = ${JSON.stringify(mode)};
            if (mode === 'pass') setTimeout(() => opts.callback('XXXX.DUMMY.TOKEN.XXXX'), 50);
            if (mode === 'error') setTimeout(() => opts['error-callback']('600010'), 50);
            if (mode === 'interactive') {
              setTimeout(() => {
                opts['before-interactive-callback']();
                el.textContent = 'stub checkbox';
              }, 50);
              window.__solve = () => { opts['after-interactive-callback'](); opts.callback('XXXX.DUMMY.TOKEN.XXXX'); };
            }
            return 'stub-' + window.__renders.length;
          },
          reset() {},
          remove() {},
        };`,
    }),
  );
  return requests;
}

async function answerSlides(page: Page) {
  await page.locator('.pf__fields input').fill('Laura Gómez');
  await page.locator('.pf__btn--inline').click();
  await page.locator('input[type="email"]').fill('laura@example.com');
  await page.locator('.pf__btn--inline').click();
}

test.describe('spam protection: deployment with keys', () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await me(request)).captcha?.available, 'boot the QA API with CAPTCHA_* keys to run this block');
  });

  test('slides, Automatic: nothing loads before the first answer; the partial is held, the complete delivered', async ({
    page,
    request,
  }) => {
    const form = await createForm(request, 'auto', config({ captcha: true }));
    const requests = await stubChallenge(page, 'pass');
    await page.goto(form.path);
    await expect(page.locator('.pf__question')).toBeVisible();
    await page.waitForTimeout(500);
    expect(requests, 'no request to the provider on view').toEqual([]);

    await page.locator('.pf__fields input').fill('Laura Gómez');
    await page.locator('.pf__btn--inline').click();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect.poll(() => rowsOf(form.id).length).toBe(1);
    expect(rowsOf(form.id)[0]!.partial_at).not.toBeNull();

    await page.locator('input[type="email"]').fill('laura@example.com');
    await page.locator('.pf__btn--inline').click();
    await expect(page.locator('.pf-done__title')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __renders: unknown[] }).__renders)).toEqual([
      expect.objectContaining({ appearance: 'interaction-only', action: 'submit', language: 'es' }),
    ]);

    const ids = rowsOf(form.id).map((r) => r.id);
    await expect.poll(() => rowsOf(form.id)[0]!.completed_at).not.toBeNull();
    await expect.poll(() => deliveriesOf(ids).map((d) => d.action).sort()).toEqual(['complete']);
  });

  test('one page, Strict: the check is shown to everyone and the hidden field is out of reach', async ({
    page,
    request,
  }) => {
    const form = await createForm(request, 'strict', config({ captcha: true, strict: true }, 'vertical'));
    await stubChallenge(page, 'pass');
    await page.goto(form.path);
    // A person's pace: strict mode refuses a complete under 2 s from the view
    // (pinned in its own test below), and the stubbed check answers at once.
    await page.waitForTimeout(2_100);
    const inputs = page.locator('.pf-v__question input');
    await inputs.nth(0).fill('Laura Gómez');
    await inputs.nth(1).fill('laura@example.com');

    const honeypot = page.locator('[name="pf_hp"]');
    await expect(honeypot).toHaveAttribute('tabindex', '-1');
    await expect(honeypot).toHaveAttribute('aria-hidden', 'true');
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.getAttribute('name'))).not.toBe('pf_hp');
    }

    // The check sits right above Submit, and has run by the time the person gets there.
    await page.locator('.pf-v__footer .pf__btn').scrollIntoViewIfNeeded();
    const slot = page.locator('.pf-v__footer [data-testid="captcha-inline"]');
    await expect(slot.locator('[data-testid="captcha-widget"]')).toHaveCount(1);
    await expect(slot).toHaveAttribute('data-captcha-state', 'done');
    await page.locator('.pf-v__footer .pf__btn').click();
    await expect(page.locator('.pf-done__title')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __renders: { appearance: string }[] }).__renders[0]!.appearance)).toBe(
      'always',
    );
  });

  test('Strict: a submit that lands under 2 s from the view is refused, nothing written', async ({
    page,
    request,
  }) => {
    const form = await createForm(request, 'fast', config({ captcha: true, strict: true }));
    await stubChallenge(page, 'pass');
    await page.goto(form.path);
    // Bot speed: answer and submit at once. The stubbed check passes, so only
    // the minimum fill time can refuse it (twice: the renderer retries once).
    await answerSlides(page);
    await expect(page.locator('.pf__error')).toHaveText('No pudimos verificar que eres una persona. Inténtalo de nuevo.');
    expect(rowsOf(form.id).filter((r) => r.completed_at != null)).toHaveLength(0);
    const events = query<{ type: string }>(
      "SELECT type FROM form_event WHERE form_id = ? AND type LIKE 'spam%'",
      form.id,
    ).map((e) => e.type);
    expect(events.length).toBeGreaterThan(0);
    expect(new Set(events)).toEqual(new Set(['spam_too_fast']));
  });

  test('the API is the gate: a direct complete without a token writes nothing; a direct partial is held', async ({
    request,
  }) => {
    const form = await createForm(request, 'direct', config({ captcha: true }));
    const url = `${API}/v1/public/forms/${form.code}/${form.slug}/submissions`;
    const complete = await request.post(url, {
      data: { sessionId: randomUUID(), data: { nombre: 'Bot', email: 'bot@example.com' } },
    });
    expect(complete.status()).toBe(403);
    expect((await complete.json()).error).toBe('CAPTCHA_REQUIRED');
    expect(rowsOf(form.id)).toHaveLength(0);

    const partial = await request.post(url, {
      data: { sessionId: randomUUID(), data: { nombre: 'Bot', email: 'bot@example.com' }, partial: true },
    });
    expect(partial.status()).toBe(201);
    expect(rowsOf(form.id)).toHaveLength(1);
    expect(deliveriesOf(rowsOf(form.id).map((r) => r.id))).toEqual([]);
  });

  test('when the check cannot run, the answers are kept as a partial and the respondent is told so', async ({
    page,
    request,
  }) => {
    const form = await createForm(request, 'error', config({ captcha: true }));
    await stubChallenge(page, 'error');
    await page.goto(form.path);
    await answerSlides(page);
    await expect(page.locator('.pf__error')).toHaveText(
      'No pudimos completar la verificación de seguridad. Tus respuestas quedaron guardadas. Inténtalo de nuevo.',
    );
    await expect(page.locator('input[type="email"]')).toHaveValue('laura@example.com');
    const rows = rowsOf(form.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.completed_at).toBeNull();
    expect(JSON.parse(rows[0]!.data)).toMatchObject({ nombre: 'Laura Gómez', email: 'laura@example.com' });
    expect(deliveriesOf(rows.map((r) => r.id))).toEqual([]);
  });

  test('a check that needs the person asks right above the button; the submit goes once it is solved', async ({
    page,
    request,
  }) => {
    const form = await createForm(request, 'interactive', config({ captcha: true }));
    await stubChallenge(page, 'interactive');
    await page.goto(form.path);
    await answerSlides(page);
    // Still on the last step: the prompt and the checkbox above the button,
    // which says it is sending and takes no second click.
    const slot = page.locator('.pf__fields [data-testid="captcha-inline"]');
    await expect(slot.locator('.pf-captcha__prompt')).toHaveText(
      'Confirma que eres una persona para enviar tus respuestas.',
    );
    await expect(slot).toContainText('stub checkbox');
    await expect(page.locator('.pf__btn--inline')).toHaveText('Enviando…');
    await expect(page.locator('.pf__btn--inline')).toBeDisabled();
    await expect(page.locator('.pf-reveal__subtitle')).toHaveCount(0);
    await page.evaluate(() => (window as unknown as { __solve: () => void }).__solve());
    await expect(page.locator('.pf-done__title')).toBeVisible();
  });

  test('a finish with no button (a single choice last) keeps the check on the submitting screen', async ({
    page,
    request,
  }) => {
    const steps = [
      TWO_QUESTIONS[0]!,
      {
        key: 'tamano',
        type: 'multiple_choice',
        question: '¿Cuántas personas son?',
        required: true,
        options: [
          { label: '1 a 10', value: 'small' },
          { label: 'Más de 10', value: 'large' },
        ],
      },
    ];
    const form = await createForm(request, 'fallback', config({ captcha: true }, undefined, steps));
    await stubChallenge(page, 'interactive');
    await page.goto(form.path);
    await page.locator('.pf__fields input').fill('Laura Gómez');
    await page.locator('.pf__btn--inline').click();
    await expect(page.locator('[data-testid="captcha-inline"]')).toHaveCount(0);
    await page.getByRole('radio', { name: 'Más de 10' }).click();
    await expect(page.locator('.pf-reveal__subtitle')).toHaveText(
      'Confirma que eres una persona para enviar tus respuestas.',
    );
    await expect(page.locator('.pf-reveal__inner [data-testid="captcha-widget"]')).toContainText('stub checkbox');
    await page.evaluate(() => (window as unknown as { __solve: () => void }).__solve());
    await expect(page.locator('.pf-done__title')).toBeVisible();
  });

  test('the builder preview and a form with protection off make no request to the provider', async ({
    page,
    request,
  }) => {
    const requests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes(CHALLENGE_HOST)) requests.push(r.url());
    });

    const on = await createForm(request, 'preview', config({ captcha: true, strict: true }));
    await page.goto(`/admin/forms/${on.id}/edit?tab=design`);
    const preview = page.frameLocator('[data-testid="preview-iframe"]');
    await preview.locator('.pf__fields input').fill('Autor');
    await preview.locator('.pf__btn--inline').click();
    await preview.locator('input[type="email"]').fill('autor@example.com');
    await preview.locator('.pf__btn--inline').click();
    await expect(preview.locator('.pf-reveal__subtitle')).toBeVisible();
    await expect(preview.locator('[name="pf_hp"]')).toHaveCount(0);

    const off = await createForm(request, 'off', config(null));
    await page.goto(off.path);
    await answerSlides(page);
    await expect(page.locator('.pf-done__title')).toBeVisible();
    expect(requests).toEqual([]);
  });
});

test.describe('spam protection: deployment without keys', () => {
  test.beforeEach(async ({ request }) => {
    test.skip(Boolean((await me(request)).captcha?.available), 'this block needs an API booted without CAPTCHA_* keys');
  });

  test('the switch is disabled with the reason, and a form saved with it on behaves as before', async ({
    page,
    request,
  }) => {
    const plain = await createForm(request, 'nokeys', config(null));
    await page.goto(`/admin/forms/${plain.id}/edit?tab=connect`);
    await expect(page.getByTestId('spam-toggle')).toBeDisabled();
    await expect(page.getByTestId('spam-unavailable')).toBeVisible();

    const saved = await createForm(request, 'nokeys-saved', config({ captcha: true, strict: true }));
    const payload = await (await request.get(`${API}/v1/public/forms/${saved.code}/${saved.slug}`)).json();
    expect(payload.captcha).toBeUndefined();

    const requests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes(CHALLENGE_HOST)) requests.push(r.url());
    });
    await page.goto(saved.path);
    await answerSlides(page);
    await expect(page.locator('.pf-done__title')).toBeVisible();
    expect(requests).toEqual([]);
    // Nothing is held where nothing is checked: the partial went out as always.
    await expect
      .poll(() => deliveriesOf(rowsOf(saved.id).map((r) => r.id)).map((d) => d.action).sort())
      .toEqual(['complete', 'partial']);
  });
});
