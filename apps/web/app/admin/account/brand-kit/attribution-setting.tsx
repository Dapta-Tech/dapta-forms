'use client';

import { useId, useState, useTransition } from 'react';
import { REFERRAL_GOAL, t, type FormsMessages } from '@quill/shared';
import type { AttributionStatus } from '@/lib/admin-api';
import { callAction, isTransportError } from '@/lib/call-action';
import { cn } from '@/lib/cn';
import { SettingsRow } from '@/components/ui/settings';
import { Switch } from '@/components/ui/switch';
import { ReferralBadgeLock } from '@/components/referral/referral-badge-lock';
import { fillLock, type ReferralLock } from '@/lib/referral-lock';
import { saveAttributionAction } from './actions';
import { DAPTA_SUBSCRIPTION_REQUIRED } from './attribution-codes';

type AttributionMessages = FormsMessages['admin']['attributionSetting'];

/**
 * The states a stored choice can be in, named once so the copy and the tests
 * agree. `unpaid` is a choice stored off that no paid verdict ever backed (the
 * deployment was open when it was saved, or the verdict was never written):
 * there was no subscription to have ended, so it is not `lapsed`.
 */
export type AttributionMode = 'on' | 'off' | 'lapsed' | 'unpaid';

export function attributionMode(s: AttributionStatus): AttributionMode {
  if (!s.hideAttribution) return 'on';
  if (s.canHide) return 'off';
  // An API older than `verdictSeen` reads as seen: the old wording.
  return s.verdictSeen === false ? 'unpaid' : 'lapsed';
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
 *  - unpaid (stored off, no verdict ever seen): the same switch, without the
 *    sentence that a subscription ended; only the subscribers note.
 *
 * Not paid: the switch is disabled with a muted label, and "Only for Dapta AI
 * subscribers." both as its tooltip and as a note under it (lapsed carries
 * the same note and tooltip under its own sentence),
 * "Dapta AI" linked to the landing the deployment names (`DAPTA_AI_URL`, read
 * by the server page: no host is written in this tree). Members see the row
 * read-only: only owners and admins change it.
 *
 * Referral program on, and the reader an owner (`referral`): while locked,
 * the subscribers note gives way to "Invite 5 or pay for Dapta AI" with the
 * pill replica, the progress bar and the person's link
 * (`ReferralBadgeLock`). Unlocked by a referral (`referralUnlocked`): the
 * switch works as for a paying workspace, with one line saying why.
 *
 * The page hides the whole row on a deployment with no attribution at all
 * (`signupHref` null): a switch for something that never shows is dead.
 */
export function AttributionSetting({
  initial,
  canEdit,
  daptaAiUrl,
  first = false,
  referral = null,
  madeWith = 'Made with dForms',
  m,
}: {
  initial: AttributionStatus;
  canEdit: boolean;
  /** The Dapta AI landing, or null: then the note is plain text. */
  daptaAiUrl: string | null;
  first?: boolean;
  /** The reader's referral progress, when the program is on and they own the workspace (`referralLockOf`). */
  referral?: ReferralLock | null;
  /** `growth.madeWith` in the reader's language: the pill replica's label. */
  madeWith?: string;
  m: AttributionMessages;
}) {
  const [state, setState] = useState<AttributionStatus>(initial);
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<'saved' | 'failed' | 'notSubscribed' | null>(null);
  const lapsedId = useId();
  const subscribersId = useId();
  const fieldId = useId();
  const mode = attributionMode(state);
  // Only turning the attribution OFF needs the subscription. Turning it back
  // ON never does, so a lapsed choice (stored off, not paying) stays usable.
  const usable = state.canHide || state.hideAttribution;
  const enabled = canEdit && !pending && usable;
  // Locked with the referral program on: the way out is invite or pay.
  const lock = !state.canHide && referral ? referral : null;
  const lockedLine = referral ? fillLock(m.referralLocked, { goal: referral.goal, product: m.product }) : null;
  const subscribersOnly = lock && lockedLine ? lockedLine : t(m.subscribersOnly, { product: m.product });
  const [before, after = ''] = m.subscribersOnly.split('{product}');

  const save = (show: boolean) =>
    start(async () => {
      setNotice(null);
      const r = await callAction(() => saveAttributionAction(!show));
      if (!isTransportError(r) && r.ok) {
        setState(r.value);
        setNotice('saved');
      } else if (!isTransportError(r) && r.code === DAPTA_SUBSCRIPTION_REQUIRED) {
        // The verdict lapsed (or was never paid) since the page loaded: show
        // the row as the server now has it, so the switch greys out with the
        // subscribers note. Without that read, the refusal itself says the
        // workspace cannot hide it, and nothing was stored.
        setState((s) => r.status ?? { ...s, canHide: false });
        setNotice('notSubscribed');
      } else {
        setNotice('failed');
      }
    });

  // Whenever the workspace cannot hide it now (not paid, or lapsed), the row
  // says who can, with the link, as a note and as the tooltip. Lapsed adds the
  // sentence that the subscription ended; its switch stays usable, but only
  // to show the attribution again.
  const showSubscribersOnly = !state.canHide;
  const lapsedNote =
    mode === 'lapsed' ? (
      <p id={lapsedId} data-testid="attribution-lapsed" className="text-xs text-muted-foreground">
        {m.lapsed}
      </p>
    ) : null;
  const subscribersNote = lock ? (
    <div id={subscribersId}>
      <ReferralBadgeLock
        lock={lock}
        daptaAiUrl={daptaAiUrl}
        madeWith={madeWith}
        m={m}
        idPrefix={fieldId}
        testId="attribution-referral-lock"
      />
    </div>
  ) : showSubscribersOnly ? (
      <p id={subscribersId} data-testid="attribution-subscribers-only" className="text-xs text-muted-foreground">
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
  const describedBy = [lapsedNote ? lapsedId : null, subscribersNote ? subscribersId : null].filter(Boolean).join(' ');

  return (
    <SettingsRow first={first} title={m.title} hint={m.hint} testId="attribution-setting">
      <div className="flex flex-col gap-2">
        <span
          className="flex min-h-9 items-center gap-3 text-sm"
          // The reason a disabled switch cannot move, on hover. A disabled
          // button fires no pointer events in some browsers, so the tooltip
          // sits on the row around it.
          title={showSubscribersOnly ? subscribersOnly : undefined}
          data-testid="attribution-switch-row"
        >
          <Switch
            checked={!state.hideAttribution}
            disabled={!enabled}
            aria-label={m.switchLabel}
            aria-describedby={describedBy || undefined}
            onCheckedChange={save}
            data-testid="attribution-switch"
          />
          <span className={cn(enabled ? 'text-foreground' : 'text-muted-foreground')}>
            {m.switchLabel}
          </span>
        </span>
        {lapsedNote}
        {subscribersNote}
        {state.canHide && state.referralUnlocked ? (
          <p data-testid="attribution-referral-unlocked" className="text-xs text-muted-foreground">
            {fillLock(m.referralUnlocked, { goal: referral?.goal ?? REFERRAL_GOAL, product: m.product })}
          </p>
        ) : null}
        {!canEdit ? (
          <p data-testid="attribution-read-only" className="text-xs text-muted-foreground">
            {m.readOnly}
          </p>
        ) : null}
        {notice === 'saved' ? (
          <p role="status" className="text-xs font-medium text-foreground">
            {m.saved}
          </p>
        ) : notice === 'failed' || notice === 'notSubscribed' ? (
          <p role="alert" data-testid="attribution-save-error" className="text-xs text-destructive">
            {notice === 'notSubscribed' ? (lockedLine ?? m.notSubscribed) : m.saveFailed}
          </p>
        ) : null}
      </div>
    </SettingsRow>
  );
}
