'use client';

import { useTransition } from 'react';
import type { FormsMessages } from '@quill/shared';
import { setThemeAction } from '@/app/admin/theme-actions';
import { THEME_ICON, THEME_PREFS, type ThemePref } from '@/lib/theme';
import { callAction } from '@/lib/call-action';

type ThemeMessages = FormsMessages['admin']['chrome']['theme'];

/**
 * The colour-scheme toggle: one icon button that flips dark ↔ light.
 *
 * A flip rather than a select because it lives in the sidebar's icon row beside
 * "view public page" and "sign out", and because switching is the whole point.
 * There is no `system` state to return to — the product is dark by default and
 * light is an opt-in (see lib/theme.ts), so two states name themselves.
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
      onClick={() => start(() => void callAction(() => setThemeAction(next)))}
      className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-[0.98] disabled:opacity-60"
    >
      <i aria-hidden className={`pi ${THEME_ICON[pref]}`} style={{ fontSize: 16 }} />
    </button>
  );
}
