'use client';

import { cn } from '@/lib/cn';
import type { BuilderMessages } from './builder-messages';

/**
 * The editor's top-level sections.
 *
 * `results` is retained as a PARSEABLE value with no tab of its own: the
 * section was absorbed into Logic → Scoring and Logic → Outcomes, and keeping
 * the id lets an old `?tab=results` link resolve to the default rather than
 * dead-end.
 */
export type Tab = 'build' | 'logic' | 'connect' | 'results' | 'design';

/**
 * The Build canvas's viewport switch. It sits on the canvas itself, over the
 * card it resizes: it changes nothing but that card, so that is where it reads.
 * (This file once held a whole second topbar row, the "contextual toolbar".
 * Its controls each moved next to what they act on, and the row went away.)
 */
export function DeviceToggle({
  device,
  onChange,
  m,
}: {
  device: 'desktop' | 'mobile';
  onChange: (device: 'desktop' | 'mobile') => void;
  m: BuilderMessages;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={m.shell.desktop + ' / ' + m.shell.mobile}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-input bg-card p-0.5"
    >
      {(['desktop', 'mobile'] as const).map((d) => (
        <button
          key={d}
          type="button"
          role="radio"
          aria-checked={device === d}
          onClick={() => onChange(d)}
          data-testid={`canvas-device-${d}`}
          className={cn(
            'rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            // Selected is ink, the app-wide mark for "this one": 16:1 against
            // the track, so the state never depends on a faint wash.
            device === d
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {d === 'desktop' ? m.shell.desktop : m.shell.mobile}
        </button>
      ))}
    </div>
  );
}
