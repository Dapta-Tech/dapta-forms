/**
 * Colour-scheme preference — the parts BOTH runtimes need.
 *
 * Deliberately free of `next/headers`: the toggle is a client component and needs
 * the cycle order and the type, so anything in this module ends up in the browser
 * bundle. The cookie READ lives in `theme.server.ts`, because importing
 * `next/headers` from here would drag a server-only API into that bundle and fail
 * the build ("you're importing a module that depends on next/headers").
 */

/** Persisted colour-scheme choice, written by the sidebar's theme toggle. */
export const THEME_COOKIE = 'quill_theme';

/**
 * What the viewer asked for — not what they get.
 *
 * `system` is a real third value rather than the absence of a choice: it means
 * "follow the OS", which is a decision the toggle has to be able to return to
 * once someone has pinned a scheme.
 */
export type ThemePref = 'dark' | 'light' | 'system';

/** Cycle order for the toggle. */
export const THEME_PREFS: readonly ThemePref[] = ['system', 'light', 'dark'];

export function isThemePref(value: string | undefined): value is ThemePref {
  return value === 'dark' || value === 'light' || value === 'system';
}

/**
 * The `data-theme` attribute value for a preference, or `undefined` to omit the
 * attribute entirely.
 *
 * Omission is the whole mechanism for `system`: the token sheet's
 * `@media (prefers-color-scheme: light)` block is written as
 * `:root:not([data-theme='dark'])`, so it only takes effect when nothing is
 * pinned. Stamping `data-theme="system"` would match neither branch and leave the
 * viewer on the dark base tokens no matter what their OS says.
 */
export function themeAttribute(pref: ThemePref): 'dark' | 'light' | undefined {
  return pref === 'system' ? undefined : pref;
}
