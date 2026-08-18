import { test, expect, type Page, type Locator, type APIRequestContext } from '@playwright/test';

/**
 * V13: branded date picker on the analytics "Custom" range.
 *
 * The From / To fields used to be OS-native `<input type="date">`s, which hand
 * their popup to the browser (unthemed, off-brand, different everywhere). They
 * are now `apps/web/components/ui/date-picker.tsx`: a `<button
 * aria-haspopup="dialog">` trigger plus a `role="dialog"` popover holding a
 * `role="grid"` mini calendar (`components/ui/calendar.tsx`). This spec drives
 * the analytics page end-to-end:
 *   1. Mouse: open Custom, pick From and To through the calendars (paging back a
 *      month first), Apply, and land on `?preset=custom&from=&to=`.
 *   2. Keyboard: Enter opens, ArrowLeft + Enter picks, Escape closes and hands
 *      focus back to the trigger.
 *   3. A reversed pick (From after To) still applies with from <= to, because
 *      the filter swaps the bounds before pushing the URL.
 *
 * Each test creates its own form via the admin API and navigates by the returned
 * id, so reruns are idempotent (no Date.now, per the suite's rule).
 */

const API = 'http://localhost:4400';
const ISO = /^\d{4}-\d{2}-\d{2}$/;

let seq = 0;
function uniqueName(label: string, workerIndex: number): string {
  seq += 1;
  return `qa-v13-datepicker-${label}-w${workerIndex}-${seq}`;
}

const CONFIG = {
  cover: { enabled: true, headline: 'V13 Date Picker', ctaText: 'Start' },
  steps: [
    {
      key: 'email',
      type: 'email',
      question: 'Your work email',
      required: true,
    },
    { key: 'notes', type: 'textarea', question: 'Anything else?' },
  ],
};

async function createForm(request: APIRequestContext, name: string): Promise<{ id: string }> {
  const res = await request.post(`${API}/v1/forms`, {
    data: { name, config: { version: 1, ...CONFIG } },
  });
  expect(res.ok(), `POST /v1/forms failed: ${res.status()}`).toBeTruthy();
  const body = await res.json();
  return { id: body.id };
}

async function openAnalytics(page: Page, id: string) {
  await page.goto(`/admin/forms/${id}/analytics`);
  // First hit may compile the route in dev; wait for the Custom chip to hydrate.
  await expect(page.getByRole('button', { name: 'Custom', exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

/** Click the Custom chip until the branded From trigger appears (a click that
 *  lands before hydration no-ops, so retry while it stays hidden). */
async function revealCustom(page: Page) {
  const chip = page.getByRole('button', { name: 'Custom', exact: true });
  const from = page.getByTestId('analytics-from');
  for (let i = 0; i < 4; i += 1) {
    await chip.click();
    try {
      await expect(from).toBeVisible({ timeout: 2500 });
      return;
    } catch {
      /* likely clicked before hydration; retry */
    }
  }
  await expect(from).toBeVisible();
}

/** Click-open a picker, retrying while the dialog stays closed. */
async function openByClick(trigger: Locator, dialog: Locator) {
  for (let i = 0; i < 4; i += 1) {
    await trigger.click();
    try {
      await expect(dialog).toBeVisible({ timeout: 2500 });
      return;
    } catch {
      /* likely clicked before hydration; retry */
    }
  }
  await expect(dialog).toBeVisible();
}

/** The first enabled day of the visible grid (may be a padding day of the
 *  previous month; still a valid, pickable ISO date). */
function firstEnabledDay(dialog: Locator): Locator {
  return dialog.locator('[data-testid="calendar-day"]:not([aria-disabled="true"])').first();
}

test.describe('V13: branded analytics date picker (no native <input type="date">)', () => {
  test.describe.configure({ timeout: 60_000 });

  test('Mouse: Custom reveals branded From/To, calendars pick dates, Apply lands on the custom URL', async ({
    page,
    request,
  }, testInfo) => {
    const form = await createForm(request, uniqueName('mouse', testInfo.workerIndex));
    await openAnalytics(page, form.id);
    await revealCustom(page);

    // Zero native date inputs anywhere on the page.
    await expect(page.locator('input[type="date"]')).toHaveCount(0);

    const fromTrigger = page.getByTestId('analytics-from');
    const fromDialog = page.getByTestId('analytics-from-dialog');
    await expect(fromTrigger).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(fromTrigger).toHaveAttribute('aria-expanded', 'false');

    // From: open, page back one month, pick the first enabled day.
    await openByClick(fromTrigger, fromDialog);
    await expect(fromTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect(fromDialog.getByRole('grid')).toBeVisible();
    await expect(fromDialog.getByTestId('calendar-day')).toHaveCount(42);
    const fromTitleBefore = await fromDialog.getByRole('grid').getAttribute('aria-label');
    await fromDialog.getByRole('button', { name: 'Previous month' }).click();
    await expect(fromDialog.getByRole('grid')).not.toHaveAttribute(
      'aria-label',
      fromTitleBefore ?? '',
    );
    const fromDay = firstEnabledDay(fromDialog);
    const fromIso = await fromDay.getAttribute('data-iso');
    expect(fromIso).toMatch(ISO);
    await fromDay.click();
    await expect(fromDialog).toHaveCount(0);
    await expect(fromTrigger).toHaveAttribute('aria-expanded', 'false');
    // The trigger now shows a formatted date, not the placeholder.
    await expect(fromTrigger).not.toContainText('Pick a date');
    await expect(page.getByTestId('analytics-from-clear')).toBeVisible();

    // To: open (defaults to today's month), pick the first enabled day, which is
    // >= From because From is the To picker's `min`.
    const toTrigger = page.getByTestId('analytics-to');
    const toDialog = page.getByTestId('analytics-to-dialog');
    await openByClick(toTrigger, toDialog);
    // Days before From are disabled in the To calendar.
    if (fromIso) {
      const prevDay = toDialog.locator(`[data-iso="${shiftIso(fromIso, -1)}"]`);
      if ((await prevDay.count()) > 0) {
        await expect(prevDay).toHaveAttribute('aria-disabled', 'true');
      }
    }
    await toDialog.getByRole('button', { name: 'Previous month' }).click();
    const toDay = firstEnabledDay(toDialog);
    const toIso = await toDay.getAttribute('data-iso');
    expect(toIso).toMatch(ISO);
    await toDay.click();
    await expect(toDialog).toHaveCount(0);

    // Apply: URL carries the custom range, in order.
    await page.getByTestId('analytics-apply').click();
    await expect(page).toHaveURL(/preset=custom&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
    const url = new URL(page.url());
    const from = url.searchParams.get('from') ?? '';
    const to = url.searchParams.get('to') ?? '';
    expect(from <= to).toBe(true);
    expect(from).toBe(fromIso);
    expect(to).toBe(toIso);
  });

  test('Keyboard: Enter opens, ArrowLeft + Enter picks, Escape closes and restores focus', async ({
    page,
    request,
  }, testInfo) => {
    const form = await createForm(request, uniqueName('kbd', testInfo.workerIndex));
    await openAnalytics(page, form.id);
    await revealCustom(page);

    const trigger = page.getByTestId('analytics-from');
    const dialog = page.getByTestId('analytics-from-dialog');

    // Gate on hydration with one mouse open, then Escape closes and refocuses.
    await openByClick(trigger, dialog);
    await expect(dialog.locator('[data-iso][tabindex="0"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    // Keyboard open: Enter on the focused trigger.
    await trigger.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const focusedCell = dialog.locator('[data-iso][tabindex="0"]');
    await expect(focusedCell).toBeFocused();
    const startIso = await focusedCell.getAttribute('data-iso');
    expect(startIso).toMatch(ISO);

    // ArrowLeft moves the cursor one day back, Enter commits it.
    await page.keyboard.press('ArrowLeft');
    const moved = dialog.locator('[data-iso][tabindex="0"]');
    await expect(moved).toBeFocused();
    await expect(moved).toHaveAttribute('data-iso', shiftIso(startIso ?? '', -1));
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).not.toContainText('Pick a date');
  });

  test('Reversed range: the pickers refuse it live, and a reversed URL still applies as from <= to', async ({
    page,
    request,
  }, testInfo) => {
    const form = await createForm(request, uniqueName('reversed', testInfo.workerIndex));

    // Live, the pickers make a reversed range unreachable: once To is set, From
    // treats it as `max`; once From is set, To treats it as `min`.
    await openAnalytics(page, form.id);
    await revealCustom(page);
    const toTrigger = page.getByTestId('analytics-to');
    const toDialog = page.getByTestId('analytics-to-dialog');
    await openByClick(toTrigger, toDialog);
    await toDialog.getByRole('button', { name: 'Previous month' }).click();
    const toDay = firstEnabledDay(toDialog);
    const toIso = (await toDay.getAttribute('data-iso')) ?? '';
    expect(toIso).toMatch(ISO);
    await toDay.click();
    await expect(toDialog).toHaveCount(0);

    const fromTrigger = page.getByTestId('analytics-from');
    const fromDialog = page.getByTestId('analytics-from-dialog');
    await openByClick(fromTrigger, fromDialog);
    // From opens on To's month (its clamped default) and every day after To is
    // disabled, so the day after To cannot be picked.
    const after = fromDialog.locator(`[data-iso="${shiftIso(toIso, 1)}"]`);
    await expect(after).toHaveAttribute('aria-disabled', 'true');
    await after.click({ force: true });
    await expect(fromDialog).toBeVisible();
    await expect(fromTrigger).toContainText('Pick a date');
    await page.keyboard.press('Escape');
    await expect(fromDialog).toHaveCount(0);

    // A reversed pair can still arrive by URL (a hand-edited or stale link). The
    // filter seeds its state from the params and Apply swaps the bounds before
    // pushing, so the server never sees a backwards window.
    await page.goto(
      `/admin/forms/${form.id}/analytics?preset=custom&from=2026-01-15&to=2026-01-05`,
    );
    await expect(page.getByTestId('analytics-from')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('analytics-from')).toContainText('Jan 15, 2026');
    await expect(page.getByTestId('analytics-to')).toContainText('Jan 5, 2026');
    await page.getByTestId('analytics-apply').click();
    await expect(page).toHaveURL(/preset=custom&from=2026-01-05&to=2026-01-15/);
  });
});

/** Shift a `YYYY-MM-DD` string by `n` days in UTC. */
function shiftIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + n));
  return t.toISOString().slice(0, 10);
}
