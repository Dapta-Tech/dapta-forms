'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/toast';
import { callAction, isTransportError } from '@/lib/call-action';
import { resendInvitationAction } from './actions';

export interface ResendInvitationLabels {
  resendInvite: string;
  resendSuccess: string;
  resendError: string;
}

/**
 * The one interactive bit of the Invitations tab: resend an invitation that has
 * not been accepted yet. Invitations live in the identity service (which also
 * sends the email), so this is the only lever there is. The table around it is
 * server-rendered in `invitations-table.tsx`; this file keeps the moved
 * `pending-invitations` name because it holds what is left of that component.
 */
export function ResendInvitationButton({
  accountId,
  invitationId,
  labels,
}: {
  accountId: string;
  invitationId: string;
  labels: ResendInvitationLabels;
}) {
  const [pending, start] = useTransition();
  const toast = useToast();

  function resend() {
    start(async () => {
      const res = await callAction(() => resendInvitationAction(accountId, invitationId));
      if (!isTransportError(res) && res.ok) toast.success(labels.resendSuccess);
      else toast.error(labels.resendError);
    });
  }

  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={resend} data-testid="invitation-resend">
      <i
        aria-hidden
        className={`pi ${pending ? 'pi-spinner pi-spin' : 'pi-refresh'}`}
        style={{ fontSize: 12 }}
      />
      {labels.resendInvite}
    </Button>
  );
}
