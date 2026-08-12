'use client';

import { useTransition } from 'react';
import type { FormsMessages } from '@quill/shared';
import { setThemeAction } from '@/app/admin/theme-actions';
import { SegmentedToggle } from '@/app/admin/forms/[id]/edit/_components/fields';
import { THEME_ICON, THEME_PREFS, type ThemePref } from '@/lib/theme';

type SettingsMessages = FormsMessages['admin']['settings'];
type ThemeMessages = FormsMessages['admin']['chrome']['theme'];

/**
 * The colour-scheme preference, named and explained.
 *
 * The sidebar already has a one-click flip for switching fast; this is the other
 * half of the same setting — the place where both choices are named at once. An
 * icon-only button is the wrong control to *learn* a setting from: you cannot see
 * what the options are without pressing it.
 *
 * Rendered with the builder's own `SegmentedToggle` rather than a second copy of
 * it. This used to re-implement the same radiogroup shell, the same selected-chip
 * rim and the same icon map — so the keyboard behaviour that control was missing
 * would have had to be written twice, and the two would have drifted exactly the
 * way `border-primary` did. `bg-background` because this one sits ON a card, where
 * the default `bg-card` shell would have no edge to show.
 */
export function ThemeSettings({ pref, s, m }: { pref: ThemePref; s: SettingsMessages; m: ThemeMessages }) {
  const [pending, start] = useTransition();

  return (
    <section className="mb-8 rounded-xl border border-border bg-card p-6">
      <h2 className="text-lg font-semibold tracking-tight">{s.appearanceHeading}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{s.appearanceSubtitle}</p>
      <SegmentedToggle
        value={pref}
        ariaLabel={m.label}
        disabled={pending}
        size="md"
        className="mt-5 bg-background"
        options={THEME_PREFS.map((option) => ({
          value: option,
          label: m[option],
          icon: THEME_ICON[option],
        }))}
        onChange={(next) => start(() => void setThemeAction(next))}
      />
    </section>
  );
}
