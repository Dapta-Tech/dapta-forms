import { test, expect, type Page, type Locator, type APIRequestContext } from '@playwright/test';

/**
 * N2 — branded admin dropdowns (custom combobox, not native <select>).
 *
 * The admin builder replaced every OS-native `<select>` with the token-styled
 * combobox in `apps/web/components/ui/select.tsx`: the trigger is a
 * `<button aria-haspopup="listbox">` and the popup is a `<ul role="listbox">`
 * of `<li role="option">`s. `SelectField` (the builder wrapper in
 * `_components/fields.tsx`) keeps the old `<option>` call shape but renders that
 * branded Select underneath.
 *
 * This spec drives the two representative admin surfaces end-to-end against the
 * live builder:
 *   1. Build tab → the "Question type" control (SelectField with no aria-label,
 *      targeted by its Field label) — open, list options, pick a different type.
 *   2. Design tab → the "Partial submissions" section: since V3 (W6) the
 *      threshold is authored via the spine's draggable partial-point marker
 *      (v3-partial-point.spec.ts covers it); the Design tab keeps a pointer
 *      note — and still renders no native <select>.
 *   3. Accessibility — the trigger is keyboard-openable (Enter) and
 *      keyboard-selectable (ArrowDown + Enter), and Escape restores focus.
 *
 * If any of these were still a native `<select>` the `toHaveCount(0)` / branded
 * assertions would fail — that would be a product finding, not a spec bug.
 *
 * Each test creates its own form via the admin API and navigates by the returned
 * id, so reruns are idempotent (slugs auto-suffix per account; no Date.now).
 */

const API = 'http://localhost:4400';

// Deterministic, rerun-safe form names: worker index + a per-run counter (no
// Date.now — banned in this suite). Every test navigates by the returned id, so
// repeated runs never depend on prior rows.
let seq = 0;
function uniqueName(label: string, workerIndex: number): string {
  seq += 1;
  return `qa-v2-branded-${label}-w${workerIndex}-${seq}`;
}

// A choice step first (so the Question-type trigger reads "Single choice") plus
// two more runtime steps (so the partial-submit list has several entries).
const CONFIG = {
  cover: { enabled: true, headline: 'N2 Branded Dropdowns', ctaText: 'Start' },
  steps: [
    {
      key: 'plan',
      type: 'multiple_choice',
      selectionMode: 'single',
      question: 'Which plan fits you?',
      options: [
        { label: 'Starter', value: 'starter', points: 1 },
        { label: 'Pro', value: 'pro', points: 3 },
      ],
    },
    { key: 'email', type: 'email', question: 'Your work email', required: true },
    { key: 'notes', type: 'textarea', question: 'Anything else?' },
  ],
  scoring: { enabled: true },
};

async function createForm(
  request: APIRequestContext,
  name: string,
): Promise<{ id: string; slug: string }> {
  // POST writes the config live (no draft), so the editor loads these steps.
  const res = await request.post(`${API}/v1/forms`, {
    data: { name, config: { version: 1, ...CONFIG } },
  });
  expect(res.ok(), `POST /v1/forms failed: ${res.status()}`).toBeTruthy();
  const body = await res.json();
  return { id: body.id, slug: body.slug };
}

async function openEditor(page: Page, id: string) {
  await page.goto(`/admin/forms/${id}/edit`);
  // First hit may compile the route in dev — allow generous time for the shell.
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

/** The right-hand builder settings pane (scoped by its heading so the spine
 *  aside — the other `complementary` landmark — is never matched). */
function settingsPanel(page: Page): Locator {
  return page
    .getByRole('complementary')
    .filter({ has: page.getByRole('heading', { name: 'Question settings' }) });
}

/** The branded Select's root (`.relative` div) that follows a builder `Field`
 *  label. Field labels are not htmlFor-associated with the branded combobox, so
 *  proximity to the label is the exact selector (see fields.tsx `Field`). */
function selectRootAfterLabel(scope: Locator, labelText: string): Locator {
  return scope.getByText(labelText, { exact: true }).locator('xpath=following-sibling::div[1]');
}

/** Click-open a branded Select, retrying the toggle so a pre-hydration click
 *  that no-ops still converges. Only retries while the listbox stays closed, so
 *  an already-open panel is never toggled shut. */
async function openByClick(trigger: Locator, listbox: Locator) {
  for (let i = 0; i < 4; i += 1) {
    await trigger.click();
    try {
      await expect(listbox).toBeVisible({ timeout: 2500 });
      return;
    } catch {
      /* likely clicked before hydration; retry */
    }
  }
  await expect(listbox).toBeVisible();
}

test.describe('N2 — branded admin dropdowns (custom combobox, not native <select>)', () => {
  test.describe.configure({ timeout: 60_000 });

  test('Build tab: the Question-type control is the branded combobox — open lists options, picking updates the selection', async ({
    page,
    request,
  }, testInfo) => {
    const form = await createForm(request, uniqueName('qtype', testInfo.workerIndex));
    await openEditor(page, form.id);

    // The whole builder is branded — zero native <select> elements anywhere.
    await expect(page.locator('select')).toHaveCount(0);

    const panel = settingsPanel(page);
    const qtRoot = selectRootAfterLabel(panel, 'Question type');
    const qtTrigger = qtRoot.locator('button[aria-haspopup="listbox"]');
    const qtListbox = qtRoot.getByRole('listbox');
    const qtOptions = qtRoot.getByRole('option');

    // The type control is a branded trigger, not a native control: a
    // <button aria-haspopup="listbox"> reflecting the current type, no <select>.
    await expect(qtRoot.locator('select')).toHaveCount(0);
    await expect(qtTrigger).toBeVisible();
    await expect(qtTrigger).toHaveAttribute('aria-haspopup', 'listbox');
    await expect(qtTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(qtTrigger).toContainText('Single choice');

    // Open → a role="listbox" of role="option"s appears; the current type is the
    // one marked aria-selected.
    await openByClick(qtTrigger, qtListbox);
    await expect(qtTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(await qtOptions.count()).toBeGreaterThan(1);
    await expect(qtRoot.getByRole('option', { name: 'Single choice' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(qtRoot.getByRole('option', { name: 'Long text' })).toBeVisible();

    // Pick a different type → the panel closes and the trigger reflects it.
    await qtRoot.getByRole('option', { name: 'Long text' }).click();
    await expect(qtListbox).toHaveCount(0);
    await expect(qtTrigger).toContainText('Long text');

    // Re-open → the new type is now the selected one (state actually updated).
    await openByClick(qtTrigger, qtListbox);
    await expect(qtRoot.getByRole('option', { name: 'Long text' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(qtRoot.getByRole('option', { name: 'Single choice' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  test('Design tab: the partial threshold moved to the spine — pointer note, still no native <select>', async ({
    page,
    request,
  }, testInfo) => {
    // V3 (W6) replaced the Design tab's "Partial submissions" SelectField with
    // the draggable partial-point MARKER in the Build tab's question spine
    // (covered by v3-partial-point.spec.ts). The Design tab keeps the section
    // as a pointer: a note telling the author where the control now lives.
    const form = await createForm(request, uniqueName('partial', testInfo.workerIndex));
    await openEditor(page, form.id);
    // The topbar's contextual row now carries its own "Design" shortcut, so the
  // role+name lookup resolves to two buttons — target the TAB by testid.
  await page.getByTestId('editor-tab-design').click();

    // The section survives with its pointer note…
    await expect(page.getByText('Partial submissions', { exact: true })).toBeVisible();
    await expect(page.getByTestId('partial-point-design-note')).toBeVisible();
    await expect(page.getByTestId('partial-point-design-note')).not.toBeEmpty();

    // …the old dropdown is gone (no trigger, no listbox with that name)…
    await expect(page.getByRole('button', { name: 'Partial submissions' })).toHaveCount(0);

    // …and the Design surface still renders zero OS-native <select>s (the N2
    // theme this spec exists for).
    await expect(page.locator('select')).toHaveCount(0);
  });

  test('Accessibility: the Question-type trigger is keyboard-openable and keyboard-selectable', async ({
    page,
    request,
  }, testInfo) => {
    const form = await createForm(request, uniqueName('a11y', testInfo.workerIndex));
    await openEditor(page, form.id);

    const panel = settingsPanel(page);
    const qtRoot = selectRootAfterLabel(panel, 'Question type');
    const qtTrigger = qtRoot.locator('button[aria-haspopup="listbox"]');
    const qtListbox = qtRoot.getByRole('listbox');

    await expect(qtTrigger).toContainText('Single choice');
    await expect(qtTrigger).toHaveAttribute('aria-expanded', 'false');

    // Gate on hydration with one mouse open (retrying), then verify Escape closes
    // the panel and restores focus to the trigger — leaving the trigger focused
    // for a clean, deterministic keyboard open next.
    await openByClick(qtTrigger, qtListbox);
    await expect(qtListbox).toBeFocused(); // focus moves into the list on open
    await page.keyboard.press('Escape');
    await expect(qtListbox).toHaveCount(0);
    await expect(qtTrigger).toBeFocused();
    await expect(qtTrigger).toHaveAttribute('aria-expanded', 'false');

    // Keyboard-openable: focus + Enter (native button activation) opens the
    // listbox and moves focus into it.
    await qtTrigger.press('Enter');
    await expect(qtListbox).toBeVisible();
    await expect(qtTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect(qtListbox).toBeFocused();

    // Keyboard-selectable: ArrowDown moves the active option (Single → Multiple),
    // Enter commits and closes the panel.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(qtListbox).toHaveCount(0);
    await expect(qtTrigger).toContainText('Multiple choice');
    await expect(qtTrigger).toHaveAttribute('aria-expanded', 'false');
  });
});
