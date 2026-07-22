import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const API = 'http://localhost:4400';
const RUN = Math.random().toString(36).slice(2, 8);
let seq = 0;

const richConfig = {
  version: 1,
  cover: { enabled: true, headline: 'Rename QA', ctaText: 'Start' },
  steps: [
    {
      key: 'pick',
      type: 'multiple_choice',
      question: 'Pick one',
      flowGroup: 'qualification',
      options: [
        { label: 'A', value: 'a', points: 5 },
        { label: 'B', value: 'b', points: 0 },
      ],
      goto: [{ values: ['b'], target: 'bye' }],
    },
    {
      key: 'leads',
      type: 'slider',
      question: 'How many leads, [pick]?',
      helper: 'based on [pick]',
      min: 0,
      max: 100,
      default: 10,
      flowGroup: 'qualification',
      sliderScoring: [{ min: 0, max: 50, points: 1 }],
      sliderLabelVariants: { a: 'leads for [pick]' },
    },
    {
      key: 'dyn',
      type: 'text',
      question: 'fallback',
      questionField: 'pick',
      questionVariants: { a: 'Why [pick]?', '*': 'Tell us about [pick]' },
    },
    { key: 'work_email', type: 'email', question: 'Email for [pick]?', flowGroup: 'lead_capture' },
    {
      key: 'bye',
      type: 'message',
      question: 'Not a fit [pick]',
      terminal: true,
      showWhen: { field: 'pick', values: ['b'] },
    },
  ],
  scoring: { enabled: true },
  outcomes: [
    {
      id: 'p1',
      label: 'P1 [pick]',
      minScore: 5,
      message: 'Nice [pick]',
      overrides: [{ field: 'pick', values: ['b'] }],
    },
    { id: 'p0', label: 'P0', minScore: -100 },
  ],
  reveal: {
    enabled: true,
    headline: 'Matching [pick]',
    subtitleTemplate: 'Advisor for [pick]',
    durationMs: 800,
  },
  ending: { headline: 'All done [pick]', body: 'Thanks [pick] — we will be in touch.' },
  destinations: [
    {
      type: 'hubspot',
      enabled: true,
      fieldMappings: { pick: 'industry', work_email: 'email' },
      valueMaps: { pick: { a: 'Option A' } },
    },
  ],
};

async function createForm(request: APIRequestContext, label: string, config: any = richConfig) {
  seq += 1;
  const res = await request.post(`${API}/v1/forms`, {
    data: { name: `rn-${label}-${RUN}-${seq}`, config },
  });
  expect(res.ok(), `create failed ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: string; slug: string };
}
async function getForm(request: APIRequestContext, id: string) {
  const res = await request.get(`${API}/v1/forms/${id}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { config: any; draftConfig: any };
}

async function openEditor(page: Page, id: string) {
  await page.goto(`/admin/forms/${id}/edit`);
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible({
    timeout: 20_000,
  });
}
async function selectStep(page: Page, title: string) {
  await page.getByTestId('question-spine').getByRole('button', { name: title }).first().click();
  await expect(page.getByTestId('step-field-key')).toBeVisible();
}
async function renameKey(page: Page, next: string) {
  const input = page.getByTestId('step-field-key');
  await input.fill(next);
  await input.press('Enter');
}
/** Wait for the builder autosave to settle. */
async function waitSaved(page: Page) {
  await page.waitForTimeout(2500);
}

// ---------------------------------------------------------------------------
// N1 — full cascade: rename `pick` -> `choice`, verify the STORED draft config
// ---------------------------------------------------------------------------
test('N1 rename cascade in the stored config', async ({ page, request }) => {
  const { id } = await createForm(request, 'cascade');
  await openEditor(page, id);
  await selectStep(page, 'Pick one');
  await renameKey(page, 'choice');
  await waitSaved(page);

  const { draftConfig: d, config: live } = await getForm(request, id);
  const cfg = typeof d === 'string' ? JSON.parse(d) : d;
  const byKey = (k: string) => cfg.steps.find((s: any) => s.key === k);
  console.log('N1 step keys:', cfg.steps.map((s: any) => s.key).join(','));
  console.log('N1 goto on choice:', JSON.stringify(byKey('choice')?.goto));
  console.log('N1 leads.question:', byKey('leads')?.question);
  console.log('N1 leads.helper:', byKey('leads')?.helper);
  console.log('N1 leads.sliderLabelVariants:', JSON.stringify(byKey('leads')?.sliderLabelVariants));
  console.log('N1 dyn.questionField:', byKey('dyn')?.questionField);
  console.log('N1 dyn.questionVariants:', JSON.stringify(byKey('dyn')?.questionVariants));
  console.log('N1 bye.showWhen:', JSON.stringify(byKey('bye')?.showWhen));
  console.log('N1 bye.question:', byKey('bye')?.question);
  console.log('N1 outcomes:', JSON.stringify(cfg.outcomes));
  console.log('N1 reveal:', JSON.stringify(cfg.reveal));
  console.log('N1 ending:', JSON.stringify(cfg.ending));
  console.log('N1 LIVE destinations:', JSON.stringify(live.destinations));
});

// ---------------------------------------------------------------------------
// N2 — rename twice in a row (quick succession)
// ---------------------------------------------------------------------------
test('N2 rename twice in a row', async ({ page, request }) => {
  const { id } = await createForm(request, 'twice');
  await openEditor(page, id);
  await selectStep(page, 'Pick one');
  await renameKey(page, 'choice');
  await renameKey(page, 'selection');
  await waitSaved(page);
  const { draftConfig: d, config: live } = await getForm(request, id);
  const cfg = typeof d === 'string' ? JSON.parse(d) : d;
  console.log('N2 keys:', cfg.steps.map((s: any) => s.key).join(','));
  console.log('N2 field key input shows:', await page.getByTestId('step-field-key').inputValue());
  console.log(
    'N2 bye.showWhen:',
    JSON.stringify(cfg.steps.find((s: any) => s.key === 'bye')?.showWhen),
  );
  console.log('N2 dyn.questionField:', cfg.steps.find((s: any) => s.key === 'dyn')?.questionField);
  console.log('N2 LIVE hubspot:', JSON.stringify(live.destinations));
});

// ---------------------------------------------------------------------------
// N3 — rename to a key another STEP uses (blocked?) and to a NAME subfield key
// ---------------------------------------------------------------------------
test('N3 collisions', async ({ page, request }) => {
  const { id } = await createForm(request, 'collide', {
    ...richConfig,
    steps: [
      ...richConfig.steps,
      { key: 'yourname', type: 'name', question: 'Your name', fields: ['firstname', 'lastname'] },
    ],
  });
  await openEditor(page, id);
  await selectStep(page, 'Pick one');

  // (a) collide with another step key
  const input = page.getByTestId('step-field-key');
  await input.fill('leads');
  console.log('N3 taken warning for step key:', await page.getByTestId('step-field-key-taken').count());
  await input.press('Enter');
  await page.waitForTimeout(600);
  console.log('N3 after collide attempt, input =', await input.inputValue());

  // (b) collide with a NAME step's subfield key
  await input.fill('firstname');
  console.log(
    'N3 taken warning for name subfield:',
    await page.getByTestId('step-field-key-taken').count(),
  );
  await input.press('Enter');
  await waitSaved(page);
  const { draftConfig: d } = await getForm(request, id);
  const cfg = typeof d === 'string' ? JSON.parse(d) : d;
  console.log('N3 keys after firstname rename:', cfg.steps.map((s: any) => s.key).join(','));
  console.log(
    'N3 name step fields:',
    JSON.stringify(cfg.steps.find((s: any) => s.type === 'name')?.fields),
  );
});

// ---------------------------------------------------------------------------
// N4 — rename then RELOAD immediately (inside the builder debounce)
// ---------------------------------------------------------------------------
test('N4 rename + immediate reload', async ({ page, request }) => {
  const { id } = await createForm(request, 'reload');
  await openEditor(page, id);
  await selectStep(page, 'Pick one');
  await renameKey(page, 'choice');
  await page.reload();
  await page.waitForTimeout(2500);
  const { draftConfig: d, config: live } = await getForm(request, id);
  const cfg = typeof d === 'string' ? JSON.parse(d) : d;
  console.log('N4 draft keys:', cfg ? cfg.steps.map((s: any) => s.key).join(',') : 'NO DRAFT');
  console.log('N4 LIVE hubspot fieldMappings:', JSON.stringify(
    (live.destinations ?? []).find((x: any) => x.type === 'hubspot')?.fieldMappings,
  ));
});

// ---------------------------------------------------------------------------
// N5 — rename, then PUBLISH: does the public form still work + do tokens render?
// ---------------------------------------------------------------------------
test('N5 rename then publish, public render', async ({ page, request }) => {
  const { id, slug } = await createForm(request, 'publish');
  await openEditor(page, id);
  await selectStep(page, 'Pick one');
  await renameKey(page, 'choice');
  await waitSaved(page);
  const pub = await request.post(`${API}/v1/forms/${id}/publish`);
  expect(pub.ok()).toBeTruthy();
  const me = await (await request.get(`${API}/v1/me`)).json();

  await page.goto(`/${me.accountCode}/me/${slug}`);
  await page.locator('.pf__btn').first().click();
  // answer the choice question with A
  await page.locator('.pf__fields button, .pf__fields label').first().click();
  await page.waitForTimeout(500);
  console.log('N5 question after choice:', (await page.locator('.pf__question').first().innerText()).trim());
  const { config } = await getForm(request, id);
  console.log('N5 live ending:', JSON.stringify(config.ending));
  console.log('N5 live outcomes:', JSON.stringify(config.outcomes));
});
