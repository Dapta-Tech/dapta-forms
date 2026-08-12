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
 * Defaults to `dark`. That covers three cases with one line: never chose, cleared
 * their cookies, or still carries the retired `system` value — `isThemePref` no
 * longer recognises it, so it reads as "no choice" and lands on the default
 * instead of on a scheme nobody can select any more.
 */
export async function getThemePref(): Promise<ThemePref> {
  const value = (await cookies()).get(THEME_COOKIE)?.value;
  return isThemePref(value) ? value : 'dark';
}
