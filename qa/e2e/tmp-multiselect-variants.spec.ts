import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * THROWAWAY QA spec — lens: multiselect-variants (V5-A7).
 * Builder → public form, end to end. Delete after the round.
 */

const API = 'http://localhost:4400';
const RUN = Math.random().toString(36).slice(2, 8);
let seq = 0;
function uniq(label: string): string {
  seq += 1;
  return `tmp-msv-${label}-${RUN}-${seq}`;
}

type Cfg = Record<string, unknown>;

async function accountCode(request: APIRequestContext): Promise<string> {
  const me = await request.get(`${API}/v1/me`);
  expect(me.ok()).toBeTruthy();
  return ((await me.json()) as { accountCode: string }).accountCode;
}

async function createForm(
  request: APIRequestContext,
  label: string,
  steps: Cfg[],
): Promise<{ id: string; path: string }> {
  const code = await accountCode(request);
  const config: Cfg = {
    version: 1,
    cover: { enabled: true, headline: 'Multi-select variants QA', ctaText: 'Start' },
    steps,
    scoring: { enabled: false },
    outcomes: [{ id: 'p1', label: 'P1', minScore: -100 }],
  };
  const res = await request.post(`${API}/v1/forms`, { data: { name: uniq(label), config } });
  expect(res.ok(), `create failed ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; slug: string };
  return { id: body.id, path: `/${code}/me/${body.slug}` };
}

function toolsStep(options?: Cfg[]): Cfg {
  return {
    key: 'tools',
    type: 'multiple_choice',
    selectionMode: 'multiple',
    question: 'Which tools do you use?',
    required: false,
    options: options ?? [
      { label: 'CRM', value: 'crm', points: 0 },
      { label: 'Ads', value: 'ads', points: 0 },
      { label: 'Email', value: 'email_tool', points: 0 },
    ],
  };
}

function focusStep(variants?: Record<string, string>): Cfg {
  return {
    key: 'focus',
    type: 'text',
    question: 'Base question?',
    required: false,
    ...(variants ? { questionField: 'tools', questionVariants: variants } : {}),
  };
}

async function openEditor(page: Page, id: string): Promise<void> {
  await page.goto(`/admin/forms/${id}/edit`);
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible({ timeout: 25_000 });
}

async function draftConfig(request: APIRequestContext, id: string): Promise<any> {
  const res = await request.get(`${API}/v1/forms/${id}`);
  if (!res.ok()) return undefined;
  const form = (await res.json()) as { draftConfig?: unknown };
  return typeof form.draftConfig === 'string' ? JSON.parse(form.draftConfig) : form.draftConfig;
}

async function publish(request: APIRequestContext, id: string): Promise<void> {
  const res = await request.post(`${API}/v1/forms/${id}/publish`, { data: {} });
  expect(res.ok(), `publish failed ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function blockExternal(page: Page): Promise<void> {
  await page.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === 'localhost' || host === '127.0.0.1') return route.continue();
    return route.abort();
  });
}

async function startForm(page: Page, path: string): Promise<void> {
  await page.goto(path);
  const start = page.getByRole('button', { name: 'Start' });
  for (let i = 0; i < 8; i += 1) {
    const ok = await start
      .waitFor({ state: 'visible', timeout: 2_000 })
      .then(() => true)
      .catch(() => false);
    if (ok) break;
    await page.waitForTimeout(1_500);
    await page.reload();
  }
  await start.click();
}

/** Tick the given option LABELS in order on the current multi-select step, then Continue. */
async function tickAndContinue(page: Page, labels: string[]): Promise<void> {
  await expect(page.locator('.pf__question')).toBeVisible();
  for (const label of labels) {
    await page.getByRole('checkbox', { name: label, exact: true }).click();
  }
  await page.locator('.pf__btn--inline').click();
}

async function questionText(page: Page): Promise<string> {
  const q = page.locator('.pf__question');
  await expect(q).toBeVisible();
  return ((await q.textContent()) ?? '').trim();
}

/** Select a question row in the builder spine by its 1-based number. */
async function selectStep(page: Page, n: number): Promise<void> {
  const spine = page.getByTestId('question-spine');
  await spine.locator('button').filter({ hasText: new RegExp(`^${n}`) }).first().click();
}

test.describe('A7 multi-select dynamic-question variants', () => {
  test.setTimeout(120_000);

  test('builder: multi-pick editor authors a two-value row, and the public form resolves it in reverse order', async ({
    page,
    request,
  }) => {
    const { id, path } = await createForm(request, 'author', [toolsStep(), focusStep()]);
    await openEditor(page, id);

    // Select question 2 (the dependent one).
    await selectStep(page, 2);
    await expect(page.getByText('Dynamic question')).toBeVisible();

    // Enable the dynamic question.
    await page.getByRole('switch', { name: 'Vary the question by a field' }).click();

    // A7: the source is a multi-select, so a multi-PICK editor renders.
    const opts = page.getByTestId('variant-multi-option');
    await expect(opts).toHaveCount(3);
    await expect(page.getByText('Tick every option this version answers to')).toBeVisible();

    // The seeded row starts on the source's first option.
    await expect(opts.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(opts.nth(1)).toHaveAttribute('aria-pressed', 'false');

    // Tick a SECOND option → the row key becomes the two-value set.
    await opts.nth(1).click();
    await expect(opts.nth(1)).toHaveAttribute('aria-pressed', 'true');

    await page.getByLabel('Ask instead').first().fill('CRM and Ads: which is bigger?');
    await page.getByLabel('Fallback (any other answer)').fill('Fallback question?');

    await expect
      .poll(
        async () => {
          const d = await draftConfig(request, id);
          return JSON.stringify(d?.steps?.[1]?.questionVariants ?? {});
        },
        { timeout: 20_000 },
      )
      .toContain('crm,ads');

    const draft = await draftConfig(request, id);
    console.log('AUTHORED VARIANTS', JSON.stringify(draft?.steps?.[1], null, 2));

    await publish(request, id);

    // PUBLIC — tick in the REVERSE order to the authored row.
    await blockExternal(page);
    await startForm(page, path);
    await tickAndContinue(page, ['Ads', 'CRM']);
    expect(await questionText(page)).toBe('CRM and Ads: which is bigger?');
  });

  test('public resolution matrix: reverse / superset / subset / nothing', async ({ page, request }) => {
    const { path } = await createForm(request, 'matrix', [
      toolsStep(),
      focusStep({ 'crm,ads': 'PAIR variant', '*': 'FALLBACK variant' }),
    ]);
    await blockExternal(page);

    const cases: { label: string; ticks: string[] }[] = [
      { label: 'exact order (crm, ads)', ticks: ['CRM', 'Ads'] },
      { label: 'reverse order (ads, crm)', ticks: ['Ads', 'CRM'] },
      { label: 'superset (crm, ads, email)', ticks: ['CRM', 'Ads', 'Email'] },
      { label: 'subset (crm only)', ticks: ['CRM'] },
      { label: 'nothing ticked', ticks: [] },
    ];
    const seen: Record<string, string> = {};
    for (const c of cases) {
      await startForm(page, path);
      await tickAndContinue(page, c.ticks);
      seen[c.label] = await questionText(page);
    }
    console.log('MATRIX', JSON.stringify(seen, null, 2));

    expect(seen['exact order (crm, ads)']).toBe('PAIR variant');
    expect(seen['reverse order (ads, crm)']).toBe('PAIR variant');
  });

  test('colliding rows: same set authored twice (via API) — which one wins?', async ({ page, request }) => {
    const { path } = await createForm(request, 'collide', [
      toolsStep(),
      focusStep({ 'crm,ads': 'ROW A', 'ads,crm': 'ROW B', '*': 'FALLBACK' }),
    ]);
    await blockExternal(page);
    const seen: Record<string, string> = {};

    await startForm(page, path);
    await tickAndContinue(page, ['CRM', 'Ads']);
    seen['ticked crm then ads'] = await questionText(page);

    await startForm(page, path);
    await tickAndContinue(page, ['Ads', 'CRM']);
    seen['ticked ads then crm'] = await questionText(page);

    console.log('COLLISION', JSON.stringify(seen, null, 2));
  });

  test('builder refuses to build a colliding set — is there any feedback?', async ({ page, request }) => {
    const { id } = await createForm(request, 'collide-ui', [
      toolsStep(),
      focusStep({ 'crm,ads': 'ROW A', ads: 'ROW B' }),
    ]);
    await openEditor(page, id);
    await selectStep(page, 2);

    // Two rows render; row 2 currently keys on {ads}. Ticking CRM on row 2
    // would produce {crm,ads} — the set row 1 already owns.
    const rows = page.locator('[data-testid="variant-multi-option"]');
    await expect(rows).toHaveCount(6); // 3 options x 2 rows
    const row2Crm = rows.nth(3);
    const row2Email = rows.nth(5);
    await expect(row2Crm).toHaveAttribute('aria-pressed', 'false');
    console.log('COLLIDE-UI conflicting option disabled?', await row2Crm.isDisabled());
    console.log('COLLIDE-UI conflicting class:', await row2Crm.getAttribute('class'));
    console.log('COLLIDE-UI harmless class :', await row2Email.getAttribute('class'));
    console.log('COLLIDE-UI aria-disabled  :', await row2Crm.getAttribute('aria-disabled'));
    await row2Crm.click();
    await page.waitForTimeout(600);
    const after = await row2Crm.getAttribute('aria-pressed');
    const bodyText = await page.locator('main, body').first().innerText();
    console.log('COLLIDE-UI aria-pressed after click:', after);
    console.log(
      'COLLIDE-UI any warning text?',
      /already|duplicate|same|taken|cannot|can’t|can't/i.test(bodyText),
    );
    await page.screenshot({ path: 'qa/shots/tmp-msv-collide-ui.png', fullPage: true });
  });

  test('add a second row and try to narrow it to a single value the pair row uses', async ({
    page,
    request,
  }) => {
    const { id } = await createForm(request, 'stuck', [
      toolsStep(),
      focusStep({ 'crm,ads': 'ROW A' }),
    ]);
    await openEditor(page, id);
    await selectStep(page, 2);

    const opts = page.getByTestId('variant-multi-option');
    await expect(opts).toHaveCount(3);
    await page.getByRole('button', { name: 'Add variant' }).click();
    await expect(opts).toHaveCount(6);

    // Row 2 was seeded on the source's FIRST option (crm).
    const r2 = (i: number) => opts.nth(3 + i);
    const state = async () =>
      (await Promise.all([0, 1, 2].map(async (i) => `${await r2(i).innerText()}=${await r2(i).getAttribute('aria-pressed')}`))).join(' ');
    console.log('STUCK row2 seeded:', await state());

    // The author wants row 2 to be "Ads only". Click Ads …
    await r2(1).click();
    await page.waitForTimeout(400);
    console.log('STUCK after clicking Ads :', await state());

    // … then try to un-tick CRM instead.
    await r2(0).click();
    await page.waitForTimeout(400);
    console.log('STUCK after clicking CRM :', await state());

    const bodyText = await page.locator('body').innerText();
    console.log(
      'STUCK any explanation on screen?',
      /already|duplicate|at least one|taken|cannot|can’t|can't/i.test(bodyText),
    );
    await page.screenshot({ path: 'qa/shots/tmp-msv-stuck-row.png', fullPage: true });
  });

  test('removing a source option that a variant row references', async ({ page, request }) => {
    const { id, path } = await createForm(request, 'stale', [
      toolsStep(),
      focusStep({ 'crm,ads': 'PAIR variant', '*': 'FALLBACK variant' }),
    ]);
    await openEditor(page, id);

    // Delete the "Ads" option from the SOURCE question (question 1).
    await selectStep(page, 1);
    const removeButtons = page.getByRole('button', { name: 'Remove option' });
    await expect(removeButtons).toHaveCount(3);
    await removeButtons.nth(1).click();
    await expect(removeButtons).toHaveCount(2);

    // Now look at the dependent question's variant row.
    await selectStep(page, 2);
    const opts = page.getByTestId('variant-multi-option');
    await expect(opts).toHaveCount(2);
    const pressed: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      pressed.push(`${await opts.nth(i).innerText()}=${await opts.nth(i).getAttribute('aria-pressed')}`);
    }
    const panelText = await page.locator('[data-testid="variants-scope-note"]').locator('xpath=../..').innerText();
    console.log('STALE row buttons:', JSON.stringify(pressed));
    console.log('STALE panel text:', JSON.stringify(panelText));
    await page.screenshot({ path: 'qa/shots/tmp-msv-stale-row.png', fullPage: true });

    await expect
      .poll(async () => JSON.stringify((await draftConfig(request, id))?.steps ?? null), {
        timeout: 25_000,
        message: 'draft never autosaved',
      })
      .not.toBe('null');
    const draft = await draftConfig(request, id);
    console.log(
      'STALE draft source options:',
      JSON.stringify(draft?.steps?.[0]?.options?.map((o: any) => o.value)),
    );
    console.log('STALE draft variants:', JSON.stringify(draft?.steps?.[1]?.questionVariants));

    await publish(request, id);
    await blockExternal(page);
    await startForm(page, path);
    const boxes = page.getByRole('checkbox');
    console.log('STALE public option count (expect 2):', await boxes.count());
    await tickAndContinue(page, ['CRM']);
    console.log('STALE public question after ticking CRM:', await questionText(page));
  });

  test('builder accepts a comma inside an option VALUE (the ambiguity is authorable in the UI)', async ({
    page,
    request,
  }) => {
    const { id } = await createForm(request, 'commaui', [toolsStep(), focusStep()]);
    await openEditor(page, id);
    await selectStep(page, 1);

    // Third option's Value field — type a comma into it.
    const valueFields = page.locator('input').filter({ hasNot: page.locator('[type=number]') });
    const thirdValue = page
      .locator('label')
      .filter({ hasText: 'Value' })
      .nth(2)
      .locator('input');
    await thirdValue.fill('crm,ads');
    await expect(thirdValue).toHaveValue('crm,ads');
    void valueFields;

    await expect
      .poll(
        async () =>
          JSON.stringify((await draftConfig(request, id))?.steps?.[0]?.options?.map((o: any) => o.value) ?? []),
        { timeout: 25_000 },
      )
      .toContain('crm,ads');
    console.log('COMMA-UI draft option values:', JSON.stringify((await draftConfig(request, id))?.steps?.[0]?.options?.map((o: any) => o.value)));
    await page.screenshot({ path: 'qa/shots/tmp-msv-comma-value.png', fullPage: true });
  });

  test('an option VALUE containing a comma collides with a two-option set', async ({ page, request }) => {
    const { path } = await createForm(request, 'comma', [
      toolsStep([
        { label: 'CRM', value: 'crm', points: 0 },
        { label: 'Ads', value: 'ads', points: 0 },
        { label: 'Both CRM and Ads', value: 'crm,ads', points: 0 },
      ]),
      focusStep({ 'crm,ads': 'ROW authored for the SINGLE "Both" option', '*': 'FALLBACK' }),
    ]);
    await blockExternal(page);
    const seen: Record<string, string> = {};

    await startForm(page, path);
    await tickAndContinue(page, ['Both CRM and Ads']);
    seen['ticked only the Both option'] = await questionText(page);

    await startForm(page, path);
    await tickAndContinue(page, ['CRM', 'Ads']);
    seen['ticked CRM + Ads separately'] = await questionText(page);

    console.log('COMMA', JSON.stringify(seen, null, 2));
  });
});
