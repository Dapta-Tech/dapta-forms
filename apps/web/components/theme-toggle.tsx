'use client';

import { useTransition } from 'react';
import type { FormsMessages } from '@quill/shared';
import { setThemeAction } from '@/app/admin/theme-actions';
import { THEME_PREFS, type ThemePref } from '@/lib/theme';

type ThemeMessages = FormsMessages['admin']['chrome']['theme'];

/** PrimeIcons — the app's icon set everywhere else in the shell. */
const PI_BY_PREF: Record<ThemePref, string> = {
  system: 'pi-desktop',
  light: 'pi-sun',
  dark: 'pi-moon',
};

/**
 * The colour-scheme toggle: one icon button that cycles system → light → dark.
 *
 * A cycle rather than a select because it lives in the sidebar's icon row beside
 * "view public page" and "sign out", and because switching is the whole point —
 * the fast path matters more than naming all three states at once. `system` is in
 * the cycle rather than hidden behind a menu so a viewer who pinned a scheme can
 * hand the decision back to their OS.
 *
 * The icon shows the CURRENT state and the tooltip names the NEXT one, so the
 * control is readable without a label: an icon-only button whose tooltip repeats
 * its own state tells you nothing about what pressing it does.
 *
 * The write is a server action, not client state, because the scheme is decided
 * during SSR (see lib/theme.ts) — flipping a class here would desync the cookie
 * from the markup and reintroduce the flash on the next navigation.
 */
export function ThemeToggle({ pref, m }: { pref: ThemePref; m: ThemeMessages }) {
  const [pending, start] = useTransition();
  const next = THEME_PREFS[(THEME_PREFS.indexOf(pref) + 1) % THEME_PREFS.length]!;
  const label = `${m.label}: ${m[pref]} — ${m.next} ${m[next].toLowerCase()}`;

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={pending}
      onClick={() => start(() => void setThemeAction(next))}
      className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-[0.98] disabled:opacity-60"
    >
      <i aria-hidden className={`pi ${PI_BY_PREF[pref]}`} style={{ fontSize: 16 }} />
    </button>
  );
}
