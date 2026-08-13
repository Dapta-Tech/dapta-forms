import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Typing a range, and being refused one that cannot exist.
 *
 * An outcome used to store only where it STARTED. The span was printed back at
 * the author from a badge on the other side of the row, derived from a
 * neighbour's number — so widening a range meant editing a different row, and
 * two ranges could quietly claim the same score, leaving one of them dead with
 * nothing on screen saying so.
 *
 * Driven through the browser because all three things under test are things
 * only a browser does: the bounds commit on BLUR (that is what makes a refusal
 * possible — "10" passes through "1" on the way in), the refused field puts
 * itself back from a prop that never moved, and the result has to survive a
 * real autosave round trip.
 */

const API = 'http://localhost:4400';

function buildConfig() {
  return {
    version: 1,
    steps: [
      {
        key: 'leads',
        type: 'slider',
        question: 'How many leads per month?',
        min: 0,
        max: 100,
        default: 50,
        sliderScoring: [{ min: 50, max: 100, points: 5 }],
        flowGroup: 'qualification',
      },
      { key: 'email', type: 'email', question: 'Your work email?', required: true },
    ],
    scoring: { enabled: true },
    // Stored the OLD way — thresholds only, no upper bounds anywhere. This is
    // the shape every already-published form carries.
    outcomes: [
      { id: 'p0', label: 'P0', minScore: -8 },
      { id: 'p3', label: 'P3', minScore: 0 },
      { id: 'p2', label: 'P2', minScore: 3 },
      { id: 'p1', label: 'P1', minScore: 6 },
    ],
  };
}

async function createForm(request: APIRequestContext): Promise<string> {
  const name = `qa-outcome-ranges-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const res = await request.post(`${API}/v1/forms`, { data: { name, config: buildConfig() } });
  expect(res.ok(), 'POST /v1/forms should create the form').toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

type StoredOutcome = { id: string; minScore?: number; maxScore?: number };

/**
 * The outcomes as the API has them stored — the only opinion that counts.
 *
 * `draftConfig` FIRST, and that is not a detail: the editor autosaves to the
 * draft, and `config` is the published copy, which does not move until Publish.
 * Reading `config` here made a failed write look like a refusal and, worse, made
 * the refusal assertions below pass for the wrong reason.
 */
async function stored(request: APIRequestContext, formId: string): Promise<StoredOutcome[]> {
  const res = await request.get(`${API}/v1/forms/${formId}`);
  const body = (await res.json()) as {
    config: { outcomes?: StoredOutcome[] };
    draftConfig: { outcomes?: StoredOutcome[] } | null;
  };
  return (body.draftConfig ?? body.config).outcomes ?? [];
}

async function openOutcomes(page: Page, formId: string): Promise<void> {
  await page.goto(`/admin/forms/${formId}/edit?tab=logic`);
  await page.getByTestId('toolbar-outcomes').click();
  await expect(page.getByTestId('outcomes-dialog')).toBeVisible();
  await expect(page.getByTestId('outcome-row')).toHaveCount(4);
}

test.describe('outcome ranges', () => {
  test('a legacy config shows both ends of every range, with the top one open', async ({
    page,
    request,
  }) => {
    await openOutcomes(page, await createForm(request));
    const rows = page.getByTestId('outcome-row');

    // Nothing stored an upper bound; the author still sees where each range ends.
    for (const [i, [from, to]] of [
      ['-8', '-1'],
      ['0', '2'],
      ['3', '5'],
    ].entries()) {
      await expect(rows.nth(i).getByTestId('outcome-minscore')).toHaveValue(from!);
      await expect(rows.nth(i).getByTestId('outcome-maxscore')).toHaveValue(to!);
    }
    // The top range has no upper bound to type — something must catch a score
    // above every ceiling.
    await expect(rows.nth(3).getByTestId('outcome-minscore')).toHaveValue('6');
    await expect(rows.nth(3).getByTestId('outcome-maxscore')).toHaveCount(0);
    await expect(rows.nth(3).getByTestId('outcome-maxscore-open')).toBeVisible();
  });

  test('a bound that fits is stored', async ({ page, request }) => {
    const formId = await createForm(request);
    await openOutcomes(page, formId);

    const to = page.getByTestId('outcome-row').nth(1).getByTestId('outcome-maxscore');
    await to.fill('1');
    await to.blur();
    await expect
      .poll(async () => (await stored(request, formId)).find((o) => o.id === 'p3')?.maxScore, {
        timeout: 8_000,
      })
      .toBe(1);
  });

  test('REFUSES a bound that would make two ranges claim the same score', async ({
    page,
    request,
  }) => {
    const formId = await createForm(request);
    await openOutcomes(page, formId);

    const row = page.getByTestId('outcome-row').nth(1); // P3, 0–2
    // Land a real draft first, so "no maxScore stored" below is a fact about
    // this edit and not just an artefact of nothing having been saved yet.
    await row.getByTestId('outcome-label').fill('P3 renamed');
    await expect
      .poll(async () => (await stored(request, formId)).find((o) => o.id === 'p3')?.minScore, {
        timeout: 8_000,
      })
      .toBe(0);

    const to = row.getByTestId('outcome-maxscore');
    await to.fill('9'); // reaches into P2 (starts at 3) and P1 (starts at 6)
    await to.blur();

    // It says which range it would have hit, not just that something is wrong.
    const error = row.getByTestId('outcome-range-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('P2');

    // The field puts itself back, because nothing was written.
    await expect(to).toHaveValue('2');

    // And nothing reached the config. Give autosave a window to prove it.
    await page.waitForTimeout(2_000);
    const outcomes = await stored(request, formId);
    expect(outcomes.find((o) => o.id === 'p3')?.maxScore).toBeUndefined();
  });

  test('REFUSES a range that would end below where it starts', async ({ page, request }) => {
    const formId = await createForm(request);
    await openOutcomes(page, formId);

    const row = page.getByTestId('outcome-row').nth(0); // P0, -8 to -1
    const to = row.getByTestId('outcome-maxscore');
    await to.fill('-20');
    await to.blur();
    await expect(row.getByTestId('outcome-range-error')).toBeVisible();
    await expect(to).toHaveValue('-1');
  });

  test('a gap is announced but still saved', async ({ page, request }) => {
    const formId = await createForm(request);
    await openOutcomes(page, formId);

    // Pull P3 back to 0–1, leaving score 2 covered by nothing.
    const to = page.getByTestId('outcome-row').nth(1).getByTestId('outcome-maxscore');
    await to.fill('1');
    await to.blur();

    const note = page.getByTestId('outcome-gap-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText('2');
    // Announced, not blocked — the write went through.
    await expect
      .poll(async () => (await stored(request, formId)).find((o) => o.id === 'p3')?.maxScore, {
        timeout: 8_000,
      })
      .toBe(1);
  });

  test('the Logic canvas prints the same span as the dialog', async ({ page, request }) => {
    // The chip used to render every range as `{minScore}+`, including the ones
    // with a ceiling — two screens describing the same range differently.
    await openOutcomes(page, await createForm(request));
    await page.getByTestId('outcomes-dialog-close').click();
    await expect(page.getByTestId('outcomes-dialog')).toBeHidden();

    const chips = page.getByTestId('logic-outcome-range');
    await expect(chips).toHaveCount(4);
    expect(await chips.allInnerTexts()).toEqual(['-8–-1', '0–2', '3–5', '6+']);
  });
});
