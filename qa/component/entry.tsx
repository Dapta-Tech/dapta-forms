import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Modal } from '../../apps/web/components/modal';
import { Select, type SelectOption } from '../../apps/web/components/ui/select';
import { ConnectionsPanel } from '../../apps/web/app/admin/integrations/connections-panel';
import { AdminShell } from '../../apps/web/components/admin-shell';
import { AgentCard } from '../../apps/web/app/admin/_components/agent-card';
import { getMessages, type Locale } from '@quill/shared';
import type { IntegrationStatus } from '../../apps/web/lib/admin-api';

/**
 * Browser entry for qa/component: turns placeholders in the page into real
 * components. Bundled by `mount.ts`; never imported by the app.
 *
 *   <div data-select='{"options":[...],"value":"a","searchable":true}'></div>
 *   <div data-modal-select='{"options":[...]}'></div>
 *   <div data-connections='{"locale":"en","providers":[...],"dcal":true}'></div>
 *   <div data-admin-home='{"locale":"en"}'></div>
 *
 * A `data-select` placeholder is `display: contents`, so the component's own
 * root is what takes part in the surrounding layout (a flex row sizes the
 * Select, not a wrapper around it), exactly as it would in the app.
 * `data-modal-select` puts the same Select inside the app's real `Modal`.
 * `data-admin-home` is the real admin shell (desktop rail, mobile drawer, two
 * workspaces so the switcher has a list) around the Home's "Connect your
 * agent" card, the animated content that sits under the rail's dialogs.
 *
 * A spec can replace a mounted Select's options, the way a list that finishes
 * loading would, by dispatching `qa:options` on its placeholder:
 *
 *   host.dispatchEvent(new CustomEvent('qa:options', { detail: [...] }))
 */

interface SelectSpec {
  options: SelectOption[];
  value?: string;
  searchable?: boolean;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
  labelClassName?: string;
}

function Controlled({ spec, host }: { spec: SelectSpec; host: HTMLElement }) {
  const [value, setValue] = useState(spec.value ?? '');
  const [options, setOptions] = useState(spec.options);
  useEffect(() => {
    const onOptions = (e: Event) => setOptions((e as CustomEvent<SelectOption[]>).detail);
    host.addEventListener('qa:options', onOptions);
    return () => host.removeEventListener('qa:options', onOptions);
  }, [host]);
  return (
    <Select
      value={value}
      onChange={setValue}
      options={options}
      searchable={spec.searchable}
      ariaLabel={spec.ariaLabel}
      placeholder={spec.placeholder}
      className={spec.className}
      labelClassName={spec.labelClassName}
    />
  );
}

function InModal({ spec, host }: { spec: SelectSpec; host: HTMLElement }) {
  const [open, setOpen] = useState(true);
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Invite a teammate" labelId="qa-modal-title">
      <Controlled spec={spec} host={host} />
    </Modal>
  );
}

for (const host of document.querySelectorAll<HTMLElement>('[data-select]')) {
  host.style.display = 'contents';
  const spec = JSON.parse(host.dataset.select ?? '{}') as SelectSpec;
  flushSync(() => createRoot(host).render(<Controlled spec={spec} host={host} />));
}
for (const host of document.querySelectorAll<HTMLElement>('[data-modal-select]')) {
  const spec = JSON.parse(host.dataset.modalSelect ?? '{}') as SelectSpec;
  flushSync(() => createRoot(host).render(<InModal spec={spec} host={host} />));
}
for (const host of document.querySelectorAll<HTMLElement>('[data-connections]')) {
  // The Integrations page's card grid (its server actions are stubbed in mount.ts).
  const spec = JSON.parse(host.dataset.connections ?? '{}') as {
    locale?: Locale;
    providers?: IntegrationStatus[];
    unavailable?: IntegrationStatus['provider'][];
    dcal?: boolean;
  };
  const locale = spec.locale ?? 'en';
  flushSync(() =>
    createRoot(host).render(
      <ConnectionsPanel
        initialProviders={spec.providers ?? []}
        encryptionAvailable
        unavailable={spec.unavailable ?? []}
        dcal={spec.dcal ? { createEventUrl: 'https://cal.example.com/event-types' } : null}
        messages={getMessages(locale).admin.connections}
        locale={locale}
      />,
    ),
  );
}
for (const host of document.querySelectorAll<HTMLElement>('[data-admin-home]')) {
  const spec = JSON.parse(host.dataset.adminHome ?? '{}') as { locale?: Locale };
  const messages = getMessages(spec.locale ?? 'en').admin;
  const workspace = (accountId: string, accountName: string) => ({
    accountId,
    workspaceId: null,
    accountCode: accountId,
    accountName,
    memberId: `m-${accountId}`,
    role: 'owner' as const,
    status: 'active' as const,
    memberCount: 1,
    accessGrant: null,
  });
  flushSync(() =>
    createRoot(host).render(
      <AdminShell
        user={{ displayName: 'Ada Lovelace', email: 'ada@example.com' }}
        messages={messages.chrome}
        accountNav={messages.account.nav}
        workspaces={[workspace('acme', 'Acme Inc.'), workspace('globex', 'Globex')]}
        currentAccountId="acme"
      >
        <div className="mx-auto max-w-[1520px] px-4 py-8 sm:px-8 sm:py-10">
          {/* Stands in for the greeting and the stats band above the card on
              Home, so the card's demo lands mid-viewport, under the dialog. */}
          <div aria-hidden style={{ height: 200 }} />
          <AgentCard m={messages.home.agentCard} />
        </div>
      </AdminShell>,
    ),
  );
}
document.documentElement.dataset.mounted = 'true';
