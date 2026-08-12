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
 * What the viewer chose. Two values, not three.
 *
 * There used to be a `system` preference that followed the OS by stamping no
 * attribute at all. It is gone on purpose: the product is authored dark, dark is
 * what an unbranded public form is pinned to (see `lib/form-design.ts`), and
 * "follow the OS" meant a viewer on a light-mode laptop got a dashboard that
 * neither they nor we had chosen. Dark is the default and light is an opt-in.
 *
 * Dropping the value costs no migration: `isThemePref` now rejects a stored
 * `system`, and `getThemePref` already falls back to `dark` for anything it does
 * not recognise — so a browser still carrying the old cookie lands on the new
 * default rather than on a broken state.
 */
export type ThemePref = 'dark' | 'light';

/** Cycle order for the toggle — the default first, so index 0 is "unset". */
export const THEME_PREFS: readonly ThemePref[] = ['dark', 'light'];

/**
 * The PrimeIcon naming each preference. Here rather than in a component because
 * two of them render it — the sidebar's toggle and the Settings picker — and they
 * had byte-identical copies, so a third preference meant remembering to edit both.
 */
export const THEME_ICON: Record<ThemePref, string> = {
  light: 'pi-sun',
  dark: 'pi-moon',
};

export function isThemePref(value: string | undefined): value is ThemePref {
  return value === 'dark' || value === 'light';
}
