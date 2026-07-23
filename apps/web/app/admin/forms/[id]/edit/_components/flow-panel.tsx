'use client';

import { PanelSection } from './fields';
import type { EditorMessages } from './messages';

/**
 * Design-tab panel for the form's flow markers.
 *
 * All it holds today is a pointer to the partial-submission threshold, which is
 * authored in the Build tab's question spine (the draggable "Partial submit
 * point" marker) rather than here. The reveal screen used to live in this panel
 * as a form-level singleton; it is a `reveal` STEP now — added from the question
 * gallery like any other card, with its own copy — so a form can carry several
 * and there is exactly one place to author each of them.
 */
export function FlowPanel({
  partialNote,
  m,
}: {
  /** One-line pointer to the question-spine marker (builder catalog string). */
  partialNote: string;
  m: EditorMessages;
}) {
  return (
    <div className="flex flex-col gap-4" id="flow-panel" tabIndex={-1} data-testid="flow-panel">
      <PanelSection title={m.partial.title} subtitle={m.partial.hint}>
        <p data-testid="partial-point-design-note" className="text-sm text-muted-foreground">
          {partialNote}
        </p>
      </PanelSection>
    </div>
  );
}
