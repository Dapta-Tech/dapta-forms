'use client';

import { useId, useState, useTransition } from 'react';
import { t, type FormsMessages } from '@quill/shared';
import type { AttributionStatus } from '@/lib/admin-api';
import { callAction, isTransportError } from '@/lib/call-action';
import { cn } from '@/lib/cn';
import { SettingsRow } from '@/components/ui/settings';
import { Switch } from '@/components/ui/switch';
import { saveAttributionAction } from './actions';

type AttributionMessages = FormsMessages['admin']['attributionSetting'];

/** The three states a workspace can be in, named once so the copy and the tests agree. */
export type AttributionMode = 'on' | 'off' | 'lapsed';

export function attributionMode(s: AttributionStatus): AttributionMode {
  if (!s.hideAttribution) return 'on';
  return s.canHide ? 'off' : 'lapsed';
}

/**
 * Brand kit, first row: "Show “Made with dForms” on my forms and pages".
 *
 *  - on (the default): the switch is on; a paying workspace can turn it off.
 *  - off (paid): the switch is off, and no public surface carries it.
 *  - lapsed (stored off, verdict not paid): the switch shows the stored
 *    choice, with the sentence that the attribution is showing again and the
 *    choice is saved. Turning it back on never needs the subscription, so the
 *    switch stays usable.
 *
 * Not paid (and not lapsed): the switch is disabled with a muted label, and
 * "Only for Dapta AI subscribers." both as its tooltip and as a note under it,
 * "Dapta AI" linked to the landing the deployment names (`DAPTA_AI_URL`, read
 * by the server page: no host is written in this tree). Members see the row
 * read-only: only owners and admins change it.
 *
 * The page hides the whole row on a deployment with no attribution at all
 * (`signupHref` null): a switch for something that never shows is dead.
 */
export function AttributionSetting({
  initial,
  canEdit,
  daptaAiUrl,
  first = false,
  m,
}: {
  initial: AttributionStatus;
  canEdit: boolean;
  /** The Dapta AI landing, or null: then the note is plain text. */
  daptaAiUrl: string | null;
  first?: boolean;
  m: AttributionMessages;
}) {
  const [state, setState] = useState<AttributionStatus>(initial);
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<'saved' | 'failed' | null>(null);
  const noteId = useId();
  const mode = attributionMode(state);
  // Only turning the attribution OFF needs the subscription. Turning it back
  // ON never does, so a lapsed choice (stored off, not paying) stays usable.
  const usable = state.canHide || state.hideAttribution;
  const enabled = canEdit && !pending && usable;
  const subscribersOnly = t(m.subscribersOnly, { product: m.product });
  const [before, after = ''] = m.subscribersOnly.split('{product}');

  const save = (show: boolean) =>
    start(async () => {
      setNotice(null);
      const r = await callAction(() => saveAttributionAction(!show));
      if (!isTransportError(r) && r.ok) {
        setState(r.value);
        setNotice('saved');
      } else {
        setNotice('failed');
      }
    });

  const note =
    mode === 'lapsed' ? (
      <p id={noteId} data-testid="attribution-lapsed" className="text-xs text-muted-foreground">
        {m.lapsed}
      </p>
    ) : !usable ? (
      <p id={noteId} data-testid="attribution-subscribers-only" className="text-xs text-muted-foreground">
        {before}
        {daptaAiUrl ? (
          <a href={daptaAiUrl} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
            {m.product}
          </a>
        ) : (
          m.product
        )}
        {after}
      </p>
    ) : null;

  return (
    <SettingsRow first={first} title={m.title} hint={m.hint} testId="attribution-setting">
      <div className="flex flex-col gap-2">
        <span
          className="flex min-h-9 items-center gap-3 text-sm"
          // The reason a disabled switch cannot move, on hover. A disabled
          // button fires no pointer events in some browsers, so the tooltip
          // sits on the row around it.
          title={!usable ? subscribersOnly : undefined}
          data-testid="attribution-switch-row"
        >
          <Switch
            checked={!state.hideAttribution}
            disabled={!enabled}
            aria-label={m.switchLabel}
            aria-describedby={note ? noteId : undefined}
            onCheckedChange={save}
            data-testid="attribution-switch"
          />
          <span className={cn(enabled ? 'text-foreground' : 'text-muted-foreground')}>
            {m.switchLabel}
          </span>
        </span>
        {note}
        {!canEdit ? (
          <p data-testid="attribution-read-only" className="text-xs text-muted-foreground">
            {m.readOnly}
          </p>
        ) : null}
        {notice === 'saved' ? (
          <p role="status" className="text-xs font-medium text-foreground">
            {m.saved}
          </p>
        ) : notice === 'failed' ? (
          <p role="alert" className="text-xs text-destructive">
            {m.saveFailed}
          </p>
        ) : null}
      </div>
    </SettingsRow>
  );
}
