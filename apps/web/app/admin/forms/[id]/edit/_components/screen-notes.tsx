'use client';

import type { BuilderMessages } from './builder-messages';
import type { JumpLanding } from './screen-util';

/**
 * What a jump means differently on a screen of several questions (#200), said
 * the same way on every surface that authors one: the question's Logic dialog,
 * the form-wide Branching dialog, the settings panel's Logic card and a
 * scheduler's after-booking picker.
 */

/** On a question of a screen that can route: its jumps run when the screen is left. */
export function ScreenJumpNote({ m }: { m: BuilderMessages }) {
  return (
    <p data-testid="screen-jump-note" className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
      <i aria-hidden className="pi pi-info-circle mt-0.5 shrink-0" style={{ fontSize: 10 }} />
      {m.logic.jumpAfterScreen}
    </p>
  );
}

/** Under a jump whose target sits inside a screen, not at its start. */
export function MidScreenNote({ m }: { m: BuilderMessages }) {
  return (
    <p
      data-testid="screen-mid-target"
      className="flex items-start gap-1.5 rounded-md border border-secondary/40 bg-secondary/10 px-2.5 py-1.5 text-xs leading-relaxed text-foreground"
    >
      <i aria-hidden className="pi pi-info-circle mt-0.5 shrink-0 text-secondary" style={{ fontSize: 10 }} />
      {m.logic.midScreenTarget}
    </p>
  );
}

/** Under a jump whose target is a later question of its own screen: it never runs. */
export function OwnScreenNote({ m }: { m: BuilderMessages }) {
  return (
    <p
      data-testid="screen-own-target"
      className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs leading-relaxed text-destructive"
    >
      <i aria-hidden className="pi pi-exclamation-triangle mt-0.5 shrink-0" style={{ fontSize: 10 }} />
      {m.logic.ownScreenTarget}
    </p>
  );
}

/** The note a jump's landing calls for, if any (see `jumpLanding`). */
export function JumpLandingNote({ landing, m }: { landing: JumpLanding; m: BuilderMessages }) {
  if (landing === 'mid') return <MidScreenNote m={m} />;
  if (landing === 'own') return <OwnScreenNote m={m} />;
  return null;
}

/** On a question whose show or hide rule reads a question of its own screen. */
export function ScreenLiveNote({ m }: { m: BuilderMessages }) {
  return (
    <p data-testid="screen-live-note" className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
      <i aria-hidden className="pi pi-bolt mt-0.5 shrink-0 text-secondary" style={{ fontSize: 10 }} />
      {m.screens.liveNote}
    </p>
  );
}
