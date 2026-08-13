import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Editing inside a dialog must not throw the author back to the top of it.
 *
 * `Modal` autofocuses the first control in the dialog when it opens — correct
 * on open, wrong on every render after. Its setup effect used to list `onClose`
 * in the dep array, and every call site passes an inline arrow, so `onClose`
 * changed identity on each render of the editor. Feeding a keystroke back to
 * the editor therefore tore the effect down and set it up again, and setup ends
 * by focusing the FIRST input in the dialog. In the outcomes list — the longest
 * dialog in the builder, several screens tall — bumping the score of a range
 * halfway down moved focus to the top row's name field, and the browser
 * scrolled that field into view. The author lost their place on every single
 * edit, in a list where the whole task is comparing one range against its
 * neighbours.
 *
 * The dialog is driven here rather than unit-tested because both symptoms are
 * things only a browser does: `HTMLElement.focus()` moving `document.activeElement`,
 * and the scroll container following it. `apps/web` unit tests run in node with
 * no DOM by design.
 *
 * Guards the fix in `apps/web/components/modal.tsx` (onClose behind a ref, the
 * effect depending on `open` alone), which every dialog in the admin shares.
 */

const API = 'http://localhost:4400';

/**
 * Enough ranges, each with body copy, that the list is far taller than its
 * `max-h-[58vh]` box — the bug is invisible on a list that fits.
 */
function buildConfig() {
  const outcomes = [-8, 0, 3, 6, 10, 14].map((minScore, i) => ({
    id: `r${i}`,
    label: `Range ${i}`,
    minScore,
    message: `Copy for range ${i}.`,
  }));
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
    outcomes,
  };
}

async function createForm(request: APIRequestContext): Promise<string> {
  const name = `qa-modal-place-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const res = await request.post(`${API}/v1/forms`, { data: { name, config: buildConfig() } });
  expect(res.ok(), 'POST /v1/forms should create the form').toBeTruthy();
  const body = (await res.json()) as { id: string };
  return body.id;
}

async function openOutcomes(page: Page, formId: string): Promise<void> {
  await page.goto(`/admin/forms/${formId}/edit?tab=logic`);
  await page.getByTestId('toolbar-outcomes').click();
  await expect(page.getByTestId('outcomes-dialog')).toBeVisible();
  // Rows render from config, so wait for the real list rather than a timeout.
  await expect(page.getByTestId('outcome-row')).toHaveCount(6);
}

test.describe('a dialog keeps its place while you edit it', () => {
  test('bumping a score deep in the outcomes list holds scroll and focus', async ({
    page,
    request,
  }) => {
    const formId = await createForm(request);
    await openOutcomes(page, formId);

    const scroller = page.getByTestId('outcomes-scroller');
    // The 5th range: far enough down that the top of the list is off-screen.
    const target = page.getByTestId('outcome-row').nth(4);
    const score = target.getByTestId('outcome-minscore');
    await score.scrollIntoViewIfNeeded();

    const scrolledTo = await scroller.evaluate((el) => el.scrollTop);
    expect(scrolledTo, 'the list must actually be scrolled, or this proves nothing').toBeGreaterThan(
      0,
    );

    // A real edit through the real control, committed the way a user commits it.
    await score.click();
    await score.fill('11');
    await expect(score).toHaveValue('11');

    // Symptom 1: the list stayed where the author left it. Some drift is fine
    // (the row above may reflow); a reset to the top is the bug.
    const after = await scroller.evaluate((el) => el.scrollTop);
    expect(after, 'the list jumped back to the top').toBeGreaterThan(scrolledTo / 2);

    // Symptom 2 — the cause. Focus must still be in the box being typed in,
    // never stolen back to the first control in the dialog.
    const focusedValue = await page.evaluate(
      () => (document.activeElement as HTMLInputElement | null)?.value ?? null,
    );
    expect(focusedValue, 'focus was stolen away from the score being edited').toBe('11');
  });

  test('Escape still closes the dialog after edits', async ({ page, request }) => {
    // `onClose` now reaches the key handler through a ref. If that ref ever went
    // stale, Esc would call a closure from the first render — silently dead, and
    // dead in exactly the state this dialog spends its life in: post-edit.
    const formId = await createForm(request);
    await openOutcomes(page, formId);

    const score = page.getByTestId('outcome-row').nth(1).getByTestId('outcome-minscore');
    await score.fill('1');
    await expect(score).toHaveValue('1');

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('outcomes-dialog')).toBeHidden();
  });
});
