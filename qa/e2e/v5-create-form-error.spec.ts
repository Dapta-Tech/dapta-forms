import { test, expect, type Page } from '@playwright/test';

/**
 * V5-V4-11 — the create-form dialog's error state, fully rendered.
 *
 * The inline "name required" message replaced the native browser bubble, but the
 * closure audit's challenge phase broke two adjacent pieces:
 *  1. The red input border never painted. An UNLAYERED `* { border-color }` in
 *     globals.css outranked Tailwind's layered `.border-destructive`, so the
 *     class landed on the element but the border stayed the neutral token —
 *     app-wide, every border-color utility was dead.
 *  2. Cancel left the error set. Cancel called only setOpen(false) while ESC /
 *     overlay-close also reset it, so a reopened, untouched dialog showed a red
 *     validation error the user had not earned.
 *
 * --destructive is #ec655f = rgb(236, 101, 95); --border is rgb(64, 64, 64).
 */

const DESTRUCTIVE = 'rgb(236, 101, 95)';

async function openCreateDialog(page: Page): Promise<void> {
  await page.goto('/admin/forms');
  // The forms list can be heavy in a long-lived QA DB; wait generously for the
  // header trigger rather than the whole list.
  const trigger = page.getByRole('button', { name: 'Create form' }).first();
  await expect(trigger).toBeVisible({ timeout: 45_000 });
  await trigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test.describe('V5-V4-11 — create-form error styling', () => {
  test('submitting empty paints the destructive border and shows the inline error', async ({
    page,
  }) => {
    await openCreateDialog(page);
    const dialog = page.getByRole('dialog');
    const input = dialog.locator('input[name="name"]');

    // Submit with the field empty (native bubble is suppressed by noValidate).
    await dialog.getByRole('button', { name: 'Create form' }).click();

    const err = page.getByTestId('create-form-name-error');
    await expect(err).toBeVisible();
    await expect(input).toHaveAttribute('aria-invalid', 'true');

    // The border must actually be the destructive token, not the neutral one —
    // this is the layering fix. Before it, every side computed rgb(64,64,64).
    const borderColor = await input.evaluate((el) => getComputedStyle(el).borderTopColor);
    expect(borderColor, 'the error input border must render destructive, not the neutral token').toBe(
      DESTRUCTIVE,
    );

    // Typing clears the error (the behaviour that already held — kept as a guard).
    await input.fill('My form');
    await expect(err).toHaveCount(0);
    await expect(input).not.toHaveAttribute('aria-invalid', 'true');
  });

  test('Cancel then reopen shows no stale error on the untouched field', async ({ page }) => {
    await openCreateDialog(page);
    const dialog = page.getByRole('dialog');

    await dialog.getByRole('button', { name: 'Create form' }).click();
    await expect(page.getByTestId('create-form-name-error')).toBeVisible();

    // Cancel — the path that used to leak the error into the next open.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Reopen: a brand-new, untouched dialog must be clean.
    await page.getByRole('button', { name: 'Create form' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByTestId('create-form-name-error')).toHaveCount(0);
    await expect(page.getByRole('dialog').locator('input[name="name"]')).not.toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });
});
