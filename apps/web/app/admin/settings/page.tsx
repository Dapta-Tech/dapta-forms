import Link from 'next/link';
import type { ReactNode } from 'react';
import { getMessages } from '@quill/shared';
import { adminApi, isAdminRole, type AccountMember, type AccountRole, type MemberStatus } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { getThemePref } from '@/lib/theme.server';
import { PageHeader } from '@/components/ui/page-header';
import { InviteMember } from './invite-member';
import { MemberRowActions } from './member-row-actions';
import { NotificationSettings } from './notification-settings';
import { PublicPageSettings } from './public-page';
import { ThemeSettings } from './theme-settings';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const locale = await getLocale();
  const s = getMessages(locale).admin.settings;
  const n = getMessages(locale).admin.notifications;
  const me = await adminApi.me();
  const members: AccountMember[] = isAdminRole(me.role)
    ? await adminApi.listMembers().catch(() => [])
    : [];
  // The two submission emails (owner notice + respondent confirmation), admin-only.
  const notifications = isAdminRole(me.role)
    ? await adminApi.getNotifications().catch(() => null)
    : null;

  const roleLabel: Record<AccountRole, string> = {
    owner: s.roleOwner,
    admin: s.roleAdmin,
    member: s.roleMember,
  };
  const statusLabel: Record<MemberStatus, string> = {
    active: s.statusActive,
    invited: s.statusInvited,
    disabled: s.statusDisabled,
  };
  const publicPath = me.handle ? `/${me.accountCode}/${me.handle}` : null;
  // Every member edits their OWN page, so this is not admin-gated.
  const myProfile = await adminApi.myProfile().catch(() => null);

  return (
    <div className="mx-auto max-w-[1520px] px-6 py-10 sm:px-8">
      <PageHeader title={s.title} subtitle={s.subtitle} />

      <PublicPageSettings publicPath={publicPath} initial={myProfile?.profile ?? null} m={s} />

      <ThemeSettings pref={await getThemePref()} s={s} m={getMessages(locale).admin.chrome.theme} />

      <section className="mb-8 rounded-md border border-border bg-card p-6">
        <h2 className="text-lg font-semibold tracking-tight">{s.workspaceHeading}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{s.workspaceSubtitle}</p>
        <dl className="mt-5 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <Field label={s.displayName} value={me.displayName ?? '—'} />
          <Field label={s.email} value={me.email ?? '—'} />
          <Field label={s.handle} value={me.handle ?? '—'} mono />
          <Field label={s.accountCode} value={me.accountCode} mono />
          <Field label={s.vanity} value={me.vanitySlug ?? s.vanityNone} mono />
        </dl>
        {publicPath ? (
          <div className="mt-6 border-t border-border pt-5">
            <span className="text-sm text-muted-foreground">{s.publicPage}</span>
            <Link
              href={publicPath}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 flex w-fit items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <i aria-hidden className="pi pi-external-link" style={{ fontSize: 12 }} />
              {s.viewPublic}
            </Link>
          </div>
        ) : null}
      </section>

      {isAdminRole(me.role) ? (
        <section className="rounded-md border border-border bg-card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">{s.membersHeading}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{s.membersSubtitle}</p>
            </div>
            <InviteMember
              labels={{
                addMember: s.addMember,
                inviteTitle: s.inviteTitle,
                inviteSubtitle: s.inviteSubtitle,
                inviteEmailLabel: s.inviteEmailLabel,
                inviteEmailPlaceholder: s.inviteEmailPlaceholder,
                inviteRoleLabel: s.inviteRoleLabel,
                roleAdmin: s.roleAdmin,
                roleMember: s.roleMember,
                inviteSubmit: s.inviteSubmit,
                inviteCancel: s.inviteCancel,
                inviteSuccess: s.inviteSuccess,
                inviteErrorTaken: s.inviteErrorTaken,
                inviteErrorInvalid: s.inviteErrorInvalid,
                inviteErrorFailed: s.inviteErrorFailed,
              }}
            />
          </div>
          {members.length === 0 ? (
            <p className="mt-5 text-sm text-muted-foreground">{s.membersEmpty}</p>
          ) : (
            <ul className="mt-5 flex flex-col gap-2">
              {members.map((mem) => {
                const isYou = mem.id === me.memberId;
                // The API is the real gate (assertAdmin + assertCanManageTarget +
                // assertNotSelf). Mirror it here so the controls only render when
                // they'd succeed: never yourself, and an admin may not manage an
                // owner (only an owner can). The whole section is already admin-only.
                const canManage = !isYou && (me.role === 'owner' || mem.role !== 'owner');
                const initial = (mem.displayName?.trim()?.charAt(0) || mem.email?.charAt(0) || '?').toUpperCase();
                return (
                  <li
                    key={mem.id}
                    className="flex items-center gap-3 rounded-md border border-border bg-background/40 px-4 py-3"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-xs font-semibold text-muted-foreground">
                      {initial}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 truncate text-sm font-medium">
                        {mem.displayName ?? mem.email ?? '—'}
                        {isYou ? (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            {s.you}
                          </span>
                        ) : null}
                      </span>
                      {mem.displayName && mem.email ? (
                        <span className="block truncate text-xs text-muted-foreground">{mem.email}</span>
                      ) : null}
                    </div>
                    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                      {roleLabel[mem.role]}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{statusLabel[mem.status]}</span>
                    {canManage ? (
                      <MemberRowActions
                        memberId={mem.id}
                        role={mem.role}
                        labels={{
                          membersMenu: s.membersMenu,
                          makeAdmin: s.makeAdmin,
                          makeMember: s.makeMember,
                          removeMember: s.removeMember,
                          removeConfirm: s.removeConfirm,
                          roleChangeSuccess: s.roleChangeSuccess,
                          removeSuccess: s.removeSuccess,
                          manageErrorLastOwner: s.manageErrorLastOwner,
                          manageErrorForbidden: s.manageErrorForbidden,
                          manageErrorFailed: s.manageErrorFailed,
                        }}
                      />
                    ) : (
                      <span aria-hidden className="h-9 w-9 shrink-0" />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {isAdminRole(me.role) && notifications ? (
        <NotificationSettings settings={notifications.settings} locale={locale} labels={n} />
      ) : null}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`truncate text-sm text-foreground ${mono ? 'font-mono' : ''}`} title={value}>
        {value}
      </dd>
    </div>
  );
}
