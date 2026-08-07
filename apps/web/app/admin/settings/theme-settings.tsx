'use client';

import { useTransition } from 'react';
import type { FormsMessages } from '@quill/shared';
import { setThemeAction } from '@/app/admin/theme-actions';
import { cn } from '@/lib/cn';
import { THEME_PREFS, type ThemePref } from '@/lib/theme';

type SettingsMessages = FormsMessages['admin']['settings'];
type ThemeMessages = FormsMessages['admin']['chrome']['theme'];

const PI_BY_PREF: Record<ThemePref, string> = {
  system: 'pi-desktop',
  light: 'pi-sun',
  dark: 'pi-moon',
};

/**
 * The colour-scheme preference, named and explained.
 *
 * The sidebar already has a one-click cycle for switching fast; this is the other
 * half of the same setting — the place where all three choices are visible at once
 * and `System` says in words that it follows the OS. A cycle button is the wrong
 * control to *learn* a setting from: you cannot see what the options are without
 * pressing it repeatedly.
 *
 * A radiogroup rather than a select: three mutually-exclusive visual choices are
 * worth showing rather than hiding behind a trigger, and it matches the segmented
 * toggles the builder already uses. It writes through the same server action as the
 * sidebar, so the two controls can never disagree.
 */
export function ThemeSettings({ pref, s, m }: { pref: ThemePref; s: SettingsMessages; m: ThemeMessages }) {
  const [pending, start] = useTransition();

  return (
    <section className="mb-8 rounded-xl border border-border bg-card p-6">
      <h2 className="text-lg font-semibold tracking-tight">{s.appearanceHeading}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{s.appearanceSubtitle}</p>
      <div
        role="radiogroup"
        aria-label={m.label}
        className="mt-5 inline-flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5"
      >
        {THEME_PREFS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={pref === option}
            disabled={pending}
            onClick={() => start(() => void setThemeAction(option))}
            className={cn(
              'flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
              // The accent rim every segmented pill in the app uses to mark its
              // selected chip. It earns its keep hardest right here: this control
              // is how you CHOOSE light mode, so it is the one place guaranteed to
              // be read in the theme where a bare `bg-muted` wash sits at 1.17:1.
              pref === option
                ? 'bg-muted text-foreground shadow-[inset_0_0_0_1px_var(--primary-edge)]'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <i aria-hidden className={`pi ${PI_BY_PREF[option]}`} style={{ fontSize: 13 }} />
            {m[option]}
          </button>
        ))}
      </div>
    </section>
  );
}
