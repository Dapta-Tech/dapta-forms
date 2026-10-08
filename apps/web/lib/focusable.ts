/**
 * The controls Tab can land on, for code that walks focus by hand (dialog and
 * menu traps, focus guards). One list, so a fix to what counts as focusable
 * reaches every trap at once.
 */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
