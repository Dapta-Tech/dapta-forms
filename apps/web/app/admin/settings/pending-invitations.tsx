'use client';

import { useTransition } from 'react';
import type { PendingInvitation } from '@/lib/admin-api';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/toast';
import { callAction, isTransportError } from '@/lib/call-action';
import { resendInvitationAction } from './actions';

export interface PendingInvitationsLabels {
  pendingHeading: string;
  pendingBadge: string;
  resendInvite: string;
  resendSuccess: string;
  resendError: string;
}

/**
 * Invitations that have not been accepted yet. They live in the identity
 * service (which also sends the email), so the only thing to do here is
 * resend. Renders nothing when there are none.
 */
export function PendingInvitations({
  invitations,
  labels,
}: {
  invitations: PendingInvitation[];
  labels: PendingInvitationsLabels;
}) {
  const [pending, start] = useTransition();
  const toast = useToast();
  if (invitations.length === 0) return null;

  function resend(id: string) {
    start(async () => {
      const res = await callAction(() => resendInvitationAction(id));
      if (!isTransportError(res) && res.ok) toast.success(labels.resendSuccess);
      else toast.error(labels.resendError);
    });
  }

  return (
    <div className="mt-6 border-t border-border pt-5" data-testid="pending-invitations">
      <h3 className="text-sm font-semibold">{labels.pendingHeading}</h3>
      <ul className="mt-3 flex flex-col gap-2">
        {invitations.map((inv) => (
          <li
            key={inv.id}
            className="flex items-center gap-3 rounded-md border border-dashed border-border bg-background/40 px-4 py-2.5"
          >
            <span className="min-w-0 flex-1 truncate text-sm">{inv.email}</span>
            <span className="shrink-0 rounded-full bg-secondary/15 px-2 py-0.5 text-2xs font-medium text-secondary">
              {labels.pendingBadge}
            </span>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => resend(inv.id)}>
              {labels.resendInvite}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
