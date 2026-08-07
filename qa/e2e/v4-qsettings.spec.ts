import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * V4 — question-settings builder fixes (all editor-only, admin API + builder UI):
 *
 *  V4-10  NumberField no longer keeps a leading zero: typing "1" onto the
 *         default "0" of an option Points field shows "1", not "01"; negatives
 *         ("-3") are accepted. The numeric onChange contract is unchanged, so
 *         the value still round-trips to the autosaved draft.
 *  V4-02  Per-option MC Points are visible + editable and reflected; a hint
 *         ties them to scoring; when scoring is on but nothing scores yet a
 *         "assign points" nudge shows near the toggle and clears once points
 *         are assigned.
 *  V4-09  Enabling "Vary the question by a field" seeds one empty variant row
 *         automatically; a scope note clarifies a variant only swaps the title.
 *  V4-13  The name-step Field Key inputs are labeled as URL parameters for
 *         prefill; the "Personal email only" visibility toggle is hidden on the
 *         FIRST question (no earlier email could exist).
 *
 * Each test creates its own form via the admin API under a unique `v4qs-`
 * prefixed name (per-run token + counter, never Date.now) so slugs don't
 * collide and reruns stay idempotent. Editor-only — no public navigation, so
 * the shared public rate-limit bucket is untouched.
 */

const API = 'http://localhost:4400';

const RUN = Math.random().toString(36).slice(2, 8);
let seq = 0;
function uniqueName(label: string): string {
  seq += 1;
  return `v4qs-${label}-${RUN}-${seq}`;
}

const cover = (headline: string) => ({ enabled: true, headline, ctaText: 'Start' });

/** POST /v1/forms (create writes LIVE config) → the form id + slug. */
async function createForm(
  request: APIRequestContext,
  name: string,
  config: Record<string, unknown>,
): Promise<{ id: string; slug: string }> {
  const res = await request.post(`${API}/v1/forms`, { data: { name, config: { version: 1, ...config } } });
  expect(res.ok(), `form creation failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; slug: string };
  return { id: body.id, slug: body.slug };
}

/** Open the builder and wait for the shell (Publish button) to render. */
async function openEditor(page: Page, id: string): Promise<void> {
  await page.goto(`/admin/forms/${id}/edit`);
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible({ timeout: 20_000 });
}

/** Read the autosaved DRAFT config back from the admin API. */
async function draftConfig(request: APIRequestContext, id: string): Promise<Record<string, unknown> | undefined> {
  const res = await request.get(`${API}/v1/forms/${id}`);
  if (!res.ok()) return undefined;
  const form = (await res.json()) as { draftConfig?: unknown };
  return typeof form.draftConfig === 'string'
    ? (JSON.parse(form.draftConfig) as Record<string, unknown>)
    : (form.draftConfig as Record<string, unknown> | undefined);
}

test.describe('V4 question settings', () => {
  test.setTimeout(60_000);

  test('MC option Points: visible, no leading zero, negatives accepted, and persisted (V4-10 + V4-02)', async ({
    page,
    request,
  }) => {
    const { id } = await createForm(request, uniqueName('mc-points'), {
      cover: cover('MC points QA'),
      steps: [
        {
          key: 'pick',
          type: 'multiple_choice',
          question: 'Pick one',
          options: [
            { label: 'Alpha', value: 'a', points: 0 },
            { label: 'Beta', value: 'b', points: 0 },
          ],
        },
      ],
    });
    await openEditor(page, id);

    // The pick step is auto-selected (index 0). Its first option's Points field
    // is visible, and the scoring hint under the list renders (new i18n copy).
    const p0 = page.getByTestId('option-points-0');
    await expect(p0).toBeVisible();
    await expect(p0).toHaveValue('0');
    await expect(page.getByTestId('option-points-hint')).toBeVisible();

    // V4-10 — leading zero fix: pressing "1" at the end of the default "0"
    // shows "1", not "01" (the exact bug the redesign left behind).
    await p0.click();
    await p0.press('End');
    await p0.press('1');
    await expect(p0).toHaveValue('1');

    // V4-02 — negative points are accepted (no min on the input; "-" types).
    await p0.fill('');
    await p0.pressSequentially('-3');
    await expect(p0).toHaveValue('-3');

    // A clean positive round-trips into the autosaved draft (editable + no crash).
    await p0.fill('7');
    await expect(p0).toHaveValue('7');
    await expect
      .poll(
        async () => {
          const draft = await draftConfig(request, id);
          const steps = (draft?.steps ?? []) as { options?: { points?: number }[] }[];
          return steps[0]?.options?.[0]?.points ?? 'missing';
        },
        { timeout: 15_000, message: 'autosaved draft never carried the option points' },
      )
      .toBe(7);
  });

  test('scoring-on-with-no-points shows the "assign points" nudge; adding points clears it (V4-02)', async ({
    page,
    request,
  }) => {
    const { id } = await createForm(request, uniqueName('zero-hint'), {
      cover: cover('Zero hint QA'),
      scoring: { enabled: true },
      steps: [
        {
          key: 'pick',
          type: 'multiple_choice',
          question: 'Pick one',
          options: [
            { label: 'Alpha', value: 'a', points: 0 },
            { label: 'Beta', value: 'b', points: 0 },
          ],
        },
      ],
    });
    await openEditor(page, id);

    // Scoring is on but the highest possible total is 0 → the nudge shows.
    await expect(page.getByTestId('scoring-zero-hint')).toBeVisible();

    // Assigning positive points recomputes the max live → the nudge disappears.
    await page.getByTestId('option-points-0').fill('5');
    await expect(page.getByTestId('scoring-zero-hint')).toHaveCount(0);
  });

  test('enabling the dynamic question seeds one variant row + shows the scope note (V4-09)', async ({
    page,
    request,
  }) => {
    const { id } = await createForm(request, uniqueName('variants'), {
      cover: cover('Variants QA'),
      steps: [
        {
          key: 'role',
          type: 'multiple_choice',
          question: 'Your role',
          options: [
            { label: 'Founder', value: 'founder', points: 0 },
            { label: 'Student', value: 'student', points: 0 },
          ],
        },
        { key: 'topic', type: 'text', question: 'Tell us more' },
      ],
    });
    await openEditor(page, id);

    // Select q2 (index 1) so a prior field exists and the toggle is enabled.
    await page.getByRole('button', { name: /Tell us more/ }).first().click();

    // The dynamic-question switch lives inside the Advanced group, which opens
    // itself only when a badge says something in there is configured. This step
    // has nothing configured, so the group is closed and the switch is not in
    // the DOM at all — the assertion below was unreachable without this click.
    await page.getByRole('button', { name: /Advanced/ }).click();

    const enable = page.getByRole('switch', { name: 'Vary the question by a field' });
    await expect(enable).toBeEnabled();

    // No variant rows before enabling.
    await expect(page.getByLabel('Ask instead')).toHaveCount(0);

    // Enabling seeds exactly one empty variant row (the pattern is now visible).
    await enable.click();
    await expect(page.getByLabel('Ask instead')).toHaveCount(1);

    // The scope note clarifies a variant only swaps the title.
    await expect(page.getByTestId('variants-scope-note')).toBeVisible();
  });

  test('the "Personal email only" toggle is hidden on the first question (V4-13)', async ({
    page,
    request,
  }) => {
    const { id } = await createForm(request, uniqueName('personal-email'), {
      cover: cover('Personal email QA'),
      steps: [
        {
          key: 'role',
          type: 'multiple_choice',
          question: 'Your role',
          options: [{ label: 'Founder', value: 'founder', points: 0 }],
        },
        { key: 'topic', type: 'text', question: 'Tell us more' },
      ],
    });
    await openEditor(page, id);

    // Q1 (index 0) is auto-selected and is NOT an email step, yet the
    // personal-email branch is impossible here (no earlier email) → hidden.
    await expect(page.getByRole('switch', { name: 'Personal email only' })).toHaveCount(0);

    // Q2 (index 1, non-email) → the toggle is available again.
    await page.getByRole('button', { name: /Tell us more/ }).first().click();
    await expect(page.getByRole('switch', { name: 'Personal email only' })).toHaveCount(1);
  });

  test('name-step field keys are labeled as URL parameters for prefill (V4-13)', async ({
    page,
    request,
  }) => {
    const { id } = await createForm(request, uniqueName('namekey'), {
      cover: cover('Name key QA'),
      steps: [{ key: 'fullname', type: 'name', question: 'Your name' }],
    });
    await openEditor(page, id);

    // The name step is auto-selected → the Field Key hint about URL-param
    // prefill renders under the two field-key inputs.
    const hint = page.getByTestId('name-fieldkey-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('URL parameter');
  });
});
