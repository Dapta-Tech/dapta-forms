import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * V14 — an option's stored value follows its label.
 *
 * The builder has always written the value for you, but only in the settings
 * panel. The canvas, which is where people actually type, changed the label and
 * left the value on the `option_1` / `option_2` the option was created with. The
 * result was a form that read properly on screen and stored answers nobody could
 * read, which is the reported complaint.
 *
 * Under test: the canvas inputs (canvas-question.tsx), the settings panel
 * (options-editor.tsx), and the engine rename both now route through
 * (`setOptionLabel` / `renameOptionValue` in form-config.ts). The assertions go
 * through the API rather than the DOM wherever the claim is about STORED data:
 * the point of the feature is what the submission will carry, not what the box
 * shows.
 *
 * Auth is the `local` dev stub; the principal is the seeded owner.
 */

const API = 'http://localhost:4400';

interface Form {
  id: string;
  config: Record<string, any>;
  draftConfig?: Record<string, any> | null;
}

/** A form with an option value pointed at from a jump AND from another step's condition. */
function branchingConfig() {
  return {
    version: 1,
    steps: [
      {
        key: 'size',
        type: 'multiple_choice',
        question: 'Company size?',
        options: [
          { label: 'Under 50', value: 'under_50' },
          { label: 'Over 50', value: 'over_50' },
        ],
        goto: [{ values: ['over_50'], target: 'budget' }],
      },
      {
        key: 'budget',
        type: 'multiple_choice',
        question: 'Budget?',
        showWhen: { field: 'size', values: ['over_50'] },
        options: [{ label: 'Yes', value: 'yes' }],
      },
    ],
  };
}

/**
 * Build the form the way the BUILDER does, and the two steps are the point.
 *
 * A form is created EMPTY and its questions land in the DRAFT; the live config
 * stays empty until somebody publishes. That is what makes a value free to
 * follow its label while the form is being built, and creating one with its
 * config in a single POST would publish it on the spot and lock every value
 * before the test began.
 */
async function createForm(request: APIRequestContext, label: string, config: unknown): Promise<Form> {
  const res = await request.post(`${API}/v1/forms`, {
    data: { name: `qa-optval-${label}-${Math.random().toString(36).slice(2, 10)}` },
  });
  expect(res.status(), 'POST /v1/forms should create the form').toBe(201);
  const form = (await res.json()) as Form;
  const staged = await request.put(`${API}/v1/forms/${form.id}`, { data: { config } });
  expect(staged.ok(), 'PUT /v1/forms/:id should stage the questions as a draft').toBeTruthy();
  return form;
}

/** What the builder is editing: the pending draft, or the live config when there is none. */
async function edited(request: APIRequestContext, id: string) {
  const res = await request.get(`${API}/v1/forms/${id}`);
  expect(res.ok(), `GET /v1/forms/${id}`).toBeTruthy();
  const form = (await res.json()) as Form;
  return form.draftConfig ?? form.config;
}

test.describe('V14: the option value follows the label', () => {
  // A cold `next dev` compiles the editor route on first hit.
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 950 });
  });

  test('renaming a label on the CANVAS carries the value, the jump and the condition', async ({
    page,
    request,
  }) => {
    const form = await createForm(request, 'canvas', branchingConfig());
    await page.goto(`/admin/forms/${form.id}/edit`);

    const option = page.locator('input[value="Over 50"]').first();
    await expect(option, 'the canvas renders the option label as an input').toBeVisible({
      timeout: 25_000,
    });
    await option.fill('More than 50 employees');
    // Blur, then let the debounced autosave land.
    await page.keyboard.press('Tab');
    await expect(page.getByText(/saved/i).first()).toBeVisible({ timeout: 25_000 });

    const config = await edited(request, form.id);
    expect(
      config.steps[0].options.map((o: { label: string; value: string }) => o.value),
      'the value followed the label',
    ).toEqual(['under_50', 'more_than_50_employees']);
    // The half that makes the rename safe rather than merely tidy: a pointer
    // left on the old token is a branch that silently never fires again.
    expect(config.steps[0].goto[0].values, 'the jump followed').toEqual(['more_than_50_employees']);
    expect(config.steps[1].showWhen.values, 'the other step condition followed').toEqual([
      'more_than_50_employees',
    ]);
  });

  test('a PUBLISHED form keeps its stored values while the labels change', async ({
    page,
    request,
  }) => {
    const form = await createForm(request, 'published', branchingConfig());
    // Publishing is what moves the draft into the live config, and the live
    // config is what a respondent can already have answered.
    const published = await request.post(`${API}/v1/forms/${form.id}/publish`);
    expect(published.ok(), 'POST /publish').toBeTruthy();

    await page.goto(`/admin/forms/${form.id}/edit`);
    const option = page.locator('input[value="Over 50"]').first();
    await expect(option).toBeVisible({ timeout: 25_000 });
    await option.fill('Over fifty');
    await page.keyboard.press('Tab');
    await expect(page.getByText(/saved/i).first()).toBeVisible({ timeout: 25_000 });

    const config = await edited(request, form.id);
    // The label is the author's to reword at any time; the token is not, because
    // answers already collected carry it and a CRM mapping may point at it.
    expect(config.steps[0].options[1].label).toBe('Over fifty');
    expect(config.steps[0].options[1].value).toBe('over_50');
    expect(config.steps[1].showWhen.values).toEqual(['over_50']);
  });

  test('a form stuck on the created placeholder heals on the next label edit', async ({
    page,
    request,
  }) => {
    // Exactly the shape the bug produced: a proper label, a value nobody chose.
    const form = await createForm(request, 'heal', {
      version: 1,
      steps: [
        {
          key: 'size',
          type: 'multiple_choice',
          question: 'Company size?',
          options: [{ label: 'Over 50 employees', value: 'option_1' }],
        },
      ],
    });

    await page.goto(`/admin/forms/${form.id}/edit`);
    const option = page.locator('input[value="Over 50 employees"]').first();
    await expect(option).toBeVisible({ timeout: 25_000 });
    await option.fill('Over 50 people');
    await page.keyboard.press('Tab');
    await expect(page.getByText(/saved/i).first()).toBeVisible({ timeout: 25_000 });

    const config = await edited(request, form.id);
    expect(config.steps[0].options[0].value).toBe('over_50_people');
  });

  test('the stored values are collapsed, and open on request', async ({ page, request }) => {
    const form = await createForm(request, 'advanced', branchingConfig());
    await page.goto(`/admin/forms/${form.id}/edit`);

    const toggle = page.getByTestId('options-advanced-toggle');
    await expect(toggle, 'the disclosure is offered').toBeVisible({ timeout: 25_000 });
    await expect(
      page.locator('input[value="under_50"]'),
      'and the values are not in the way until asked for',
    ).toHaveCount(0);

    await toggle.click();
    await expect(page.locator('input[value="under_50"]')).toBeVisible();
  });

  test('a hand-written value shows itself rather than hiding behind the disclosure', async ({
    page,
    request,
  }) => {
    // A value chosen to match something outside this form is the one thing here
    // an author needs to SEE, and it is also the one the label will not move.
    const form = await createForm(request, 'manual', {
      version: 1,
      steps: [
        {
          key: 'size',
          type: 'multiple_choice',
          question: 'Company size?',
          options: [
            { label: 'Under 50', value: 'under_50' },
            { label: 'Over 50', value: 'ENTERPRISE_TIER' },
          ],
        },
      ],
    });

    await page.goto(`/admin/forms/${form.id}/edit`);

    await expect(page.locator('input[value="ENTERPRISE_TIER"]')).toBeVisible({ timeout: 25_000 });

    // And it stays put when the label moves.
    const option = page.locator('input[value="Over 50"]').first();
    await option.fill('Over fifty');
    await page.keyboard.press('Tab');
    await expect(page.getByText(/saved/i).first()).toBeVisible({ timeout: 25_000 });

    const config = await edited(request, form.id);
    expect(config.steps[0].options[1]).toMatchObject({
      label: 'Over fifty',
      value: 'ENTERPRISE_TIER',
    });
  });
});
