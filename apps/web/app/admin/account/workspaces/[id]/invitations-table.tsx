import type { Locale } from '@quill/shared';
import type { AccountMember, PendingInvitation } from '@/lib/admin-api';
import { StatusBadge } from './members-table';
import { ResendInvitationButton, type ResendInvitationLabels } from './pending-invitations';

export interface InvitationsTableLabels extends ResendInvitationLabels {
  invitationsSubtitle: string;
  invitationsEmpty: string;
  colEmail: string;
  colStatus: string;
  colSent: string;
  colExpires: string;
  colActions: string;
  pendingBadge: string;
}

/** One row of the Invitations tab, whichever store it came from. */
interface InvitationRow {
  /** React key; prefixed so an invitation and a member never collide. */
  key: string;
  /** Set for identity-service invitations (the only ones that can be resent). */
  invitationId: string | null;
  email: string;
  sentAt: Date | null;
  expiresAt: Date | null;
}

/** `null`/garbage-safe: the identity service hands back ISO strings, the roster epoch-ms. */
function toDate(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Everyone invited to this workspace who has not accepted yet, from BOTH
 * stores: the identity service's pending invitations (resendable) and roster
 * members still in `invited` status (the local, no-identity-service model:
 * invited by email, adopted on their first sign-in; nothing to resend).
 * Server-rendered; dates are formatted here with Intl so the client ships no
 * formatter. Keeps `data-testid="pending-invitations"` on the wrapper for the
 * e2e specs that predate the tab.
 */
export function InvitationsTable({
  accountId,
  invitations,
  invitedMembers,
  locale,
  labels,
}: {
  accountId: string;
  invitations: PendingInvitation[];
  invitedMembers: AccountMember[];
  locale: Locale;
  labels: InvitationsTableLabels;
}) {
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const format = (d: Date | null) => (d ? fmt.format(d) : '');

  const rows: InvitationRow[] = [
    ...invitations.map(
      (inv): InvitationRow => ({
        key: `inv:${inv.id}`,
        invitationId: inv.id,
        email: inv.email,
        sentAt: toDate(inv.createdAt),
        expiresAt: toDate(inv.expiresAt),
      }),
    ),
    ...invitedMembers.flatMap((m): InvitationRow[] =>
      m.email
        ? [{ key: `mem:${m.id}`, invitationId: null, email: m.email, sentAt: toDate(m.createdAt), expiresAt: null }]
        : [],
    ),
  ];

  return (
    <section data-testid="pending-invitations">
      <p className="text-sm text-muted-foreground">{labels.invitationsSubtitle}</p>
      {rows.length === 0 ? (
        <p
          data-testid="invitations-table"
          className="mt-4 rounded-xl border border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground"
        >
          {labels.invitationsEmpty}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[640px] border-collapse text-sm" data-testid="invitations-table">
            <thead>
              <tr className="border-b border-border text-left text-2xs uppercase tracking-wide text-faint">
                <th className="whitespace-nowrap px-4 py-3 font-medium">{labels.colEmail}</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">{labels.colStatus}</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">{labels.colSent}</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">{labels.colExpires}</th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-medium">
                  <span className="sr-only">{labels.colActions}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.key}
                  data-testid="invitation-row"
                  className="border-b border-border last:border-b-0"
                >
                  <td className="max-w-[280px] truncate px-4 py-3 font-medium text-foreground" title={row.email}>
                    {row.email}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <StatusBadge status="invited" label={labels.pendingBadge} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{format(row.sentAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{format(row.expiresAt)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    {row.invitationId ? (
                      <ResendInvitationButton
                        accountId={accountId}
                        invitationId={row.invitationId}
                        labels={{
                          resendInvite: labels.resendInvite,
                          resendSuccess: labels.resendSuccess,
                          resendError: labels.resendError,
                        }}
                      />
                    ) : (
                      <span aria-hidden className="inline-block h-8" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
