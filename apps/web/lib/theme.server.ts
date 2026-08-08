import { cookies } from 'next/headers';
import { isThemePref, THEME_COOKIE, type ThemePref } from './theme';

/**
 * The persisted preference, read on the server so the correct `data-theme` is in
 * the FIRST HTML response.
 *
 * This is why the choice lives in a cookie rather than `localStorage`: a
 * client-read preference cannot be known during SSR, so the page paints one
 * scheme and then repaints in the other — the flash every dark-mode toggle is
 * judged by. Reading it here means there is nothing to correct after hydration
 * and no blocking inline script in `<head>`.
 *
 * Defaults to `dark`, which is what the app rendered when the scheme was pinned
 * in the root layout — a viewer with no cookie sees exactly what they saw before
 * the toggle existed.
 */
export async function getThemePref(): Promise<ThemePref> {
  const value = (await cookies()).get(THEME_COOKIE)?.value;
  return isThemePref(value) ? value : 'dark';
}
