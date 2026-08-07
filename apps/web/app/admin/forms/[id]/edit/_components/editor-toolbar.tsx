'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { BuilderMessages } from './builder-messages';

/**
 * The editor's top-level sections. Lives here because both the topbar's tab row
 * and this contextual toolbar key off it.
 *
 * `results` is retained as a PARSEABLE value with no tab of its own: the
 * section was absorbed into Logic → Scoring and Logic → Outcomes, and keeping
 * the id lets an old `?tab=results` link resolve to the default rather than
 * dead-end.
 */
export type Tab = 'build' | 'logic' | 'connect' | 'results' | 'design';

/**
 * The topbar's SECOND row: a contextual toolbar whose contents change with the
 * active tab.
 *
 * The single-row header carried ten controls (back, name, save status, five
 * tabs, Preview, Copy link, Embed, Open form, Publish) and had been losing that
 * fight for a while — the tab labels only appeared at `2xl`, the link labels at
 * `xl`, and a duplicate tab bar existed below `lg`. Nothing was redundant; one
 * 56px row simply could not hold it.
 *
 * Splitting by SCOPE is what makes the space: row 1 keeps what is true of the
 * whole form (which section you are in, sharing it, publishing it), and this row
 * holds what only makes sense inside the current section. A control that acts on
 * the Build canvas has no business being visible while you edit Connect.
 */
export function EditorToolbar({
  children,
  m,
}: {
  children: ReactNode;
  m: BuilderMessages;
}) {
  return (
    <div
      role="toolbar"
      aria-label={m.shell.toolbar}
      data-testid="editor-toolbar"
      className="flex h-11 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border px-3 sm:px-4"
    >
      {children}
    </div>
  );
}

/** Shared look for a toolbar entry: text + icon, quiet until hovered. */
const itemClass =
  'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-sm font-medium ' +
  'text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40';

/** A labelled action in the contextual toolbar. */
export function ToolbarButton({
  icon,
  label,
  onClick,
  primary = false,
  testId,
  disabled,
}: {
  /** primeicons class, without the leading `pi `. */
  icon: string;
  label: string;
  onClick: () => void;
  /** The section's main action (e.g. "Add question") — filled, not quiet. */
  primary?: boolean;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={cn(
        itemClass,
        primary && 'bg-foreground text-background hover:bg-foreground/90 hover:text-background',
      )}
    >
      <i aria-hidden className={`pi ${icon}`} style={{ fontSize: 12 }} />
      {label}
    </button>
  );
}

/** An icon-only toolbar action, for controls whose meaning is carried by the
 *  glyph alone (play, zoom). The label still reaches assistive tech. */
export function ToolbarIconButton({
  icon,
  label,
  onClick,
  testId,
  disabled,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      data-testid={testId}
      className={cn(itemClass, 'w-8 justify-center px-0')}
    >
      <i aria-hidden className={`pi ${icon}`} style={{ fontSize: 13 }} />
    </button>
  );
}

/** A hairline between groups of toolbar entries. */
export function ToolbarSeparator() {
  return <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

/**
 * The Build canvas's viewport switch. It used to sit in a third bar under the
 * canvas, directly below this one — two stacked chrome strips for one form. It
 * belongs here: it is a Build-scoped control, which is exactly what this row is
 * for, and merging the strips gives the canvas its height back.
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
      className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-card p-0.5"
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
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            device === d ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {d === 'desktop' ? m.shell.desktop : m.shell.mobile}
        </button>
      ))}
    </div>
  );
}
