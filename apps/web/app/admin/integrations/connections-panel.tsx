'use client';

import { useState, useTransition } from 'react';
import { getMessages, type FormsMessages, type Locale } from '@quill/shared';
import type { IntegrationProvider, IntegrationStatus } from '@/lib/admin-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/toast';
import { connectIntegrationAction, disconnectIntegrationAction } from './actions';

type Msgs = FormsMessages['admin']['connections'];

/** Replace `{key}` tokens in a catalog string (locale copy owns the wording). */
const fill = (template: string, vars: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);

interface ProviderMeta {
  id: IntegrationProvider;
  name: string;
  desc: string;
  icon: string;
}

/**
 * Account-level connections surface (Typeform's "General" tab): connect a
 * provider once per account with a pasted token, then map fields per form. The
 * token is entered in a password field and handed to a server action — it is
 * NEVER rendered back (status shows only a label + last4). When the server has
 * no encryption key, connecting is disabled with an explanation instead.
 */
export function ConnectionsPanel({
  initialProviders,
  encryptionAvailable,
  loadError,
  messages: m,
  locale,
}: {
  initialProviders: IntegrationStatus[];
  encryptionAvailable: boolean;
  loadError?: boolean;
  messages: Msgs;
  locale: Locale;
}) {
  const providers: ProviderMeta[] = [
    { id: 'hubspot', name: m.hubspotName, desc: m.hubspotDesc, icon: 'pi-sync' },
    { id: 'calendly', name: m.calendlyName, desc: m.calendlyDesc, icon: 'pi-calendar' },
  ];

  const [statuses, setStatuses] = useState<Record<string, IntegrationStatus | null>>(() => {
    const map: Record<string, IntegrationStatus | null> = { hubspot: null, calendly: null };
    for (const s of initialProviders) if (s.connected) map[s.provider] = s;
    return map;
  });

  return (
    <div className="flex flex-col gap-6">
      {loadError ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {m.loadError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {providers.map((meta) => (
          <ProviderCard
            key={meta.id}
            meta={meta}
            status={statuses[meta.id] ?? null}
            encryptionAvailable={encryptionAvailable}
            onStatusChange={(s) => setStatuses((prev) => ({ ...prev, [meta.id]: s }))}
            m={m}
            locale={locale}
          />
        ))}
      </div>

      <p className="text-sm text-muted-foreground">{m.perFormNote}</p>
    </div>
  );
}

function ProviderCard({
  meta,
  status,
  encryptionAvailable,
  onStatusChange,
  m,
  locale,
}: {
  meta: ProviderMeta;
  status: IntegrationStatus | null;
  encryptionAvailable: boolean;
  onStatusChange: (s: IntegrationStatus | null) => void;
  m: Msgs;
  locale: Locale;
}) {
  const { success, error } = useToast();
  const [pending, start] = useTransition();
  const { confirm: confirmDialog, dialog } = useConfirmDialog();
  const [showConnect, setShowConnect] = useState(false);
  const [token, setToken] = useState('');
  const connected = !!status;

  function connect() {
    const trimmed = token.trim();
    if (!trimmed) {
      error(m.tokenRequired);
      return;
    }
    start(async () => {
      const res = await connectIntegrationAction(meta.id, trimmed);
      if (res.ok) {
        onStatusChange(res.status);
        setToken('');
        setShowConnect(false);
        success(fill(m.connectSuccess, { provider: meta.name }));
      } else {
        error(m.connectError);
      }
    });
  }

  async function disconnect() {
    const ok = await confirmDialog({
      title: fill(getMessages(locale).dialog.disconnectIntegrationTitle, { provider: meta.name }),
      message: fill(m.disconnectConfirm, { provider: meta.name }),
      confirmLabel: m.disconnect,
      cancelLabel: m.cancel,
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const res = await disconnectIntegrationAction(meta.id);
      if (res.ok) {
        onStatusChange(null);
        success(fill(m.disconnectSuccess, { provider: meta.name }));
      } else {
        error(m.disconnectError);
      }
    });
  }

  return (
    <section className="flex flex-col rounded-lg border border-border bg-card p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-foreground"
            aria-hidden
          >
            <i className={`pi ${meta.icon}`} style={{ fontSize: 16 }} />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold tracking-tight">{meta.name}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{meta.desc}</p>
          </div>
        </div>
        <StatusBadge connected={connected} m={m} />
      </header>

      <div className="mt-4">
        {!encryptionAvailable ? (
          <div className="rounded-md border border-dashed border-border bg-muted/40 p-3">
            <p className="text-sm font-medium text-foreground">{m.encryptionOff}</p>
            <p className="mt-1 text-xs text-muted-foreground">{m.encryptionOffBody}</p>
          </div>
        ) : connected && status ? (
          <ConnectedView status={status} onDisconnect={disconnect} pending={pending} m={m} locale={locale} />
        ) : showConnect ? (
          <ConnectForm
            token={token}
            setToken={setToken}
            onConnect={connect}
            onCancel={() => {
              setShowConnect(false);
              setToken('');
            }}
            pending={pending}
            providerName={meta.name}
            m={m}
          />
        ) : (
          <Button onClick={() => setShowConnect(true)}>
            <i aria-hidden className="pi pi-link" style={{ fontSize: 12 }} />
            {m.connect}
          </Button>
        )}
      </div>
      {dialog}
    </section>
  );
}

function StatusBadge({ connected, m }: { connected: boolean; m: Msgs }) {
  return (
    <span
      className={
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ' +
        (connected
          ? 'border-primary/40 bg-primary/10 text-foreground'
          : 'border-border bg-muted/40 text-muted-foreground')
      }
    >
      <span
        aria-hidden
        className={'h-1.5 w-1.5 rounded-full ' + (connected ? 'bg-primary' : 'bg-muted-foreground')}
      />
      {connected ? m.connected : m.notConnected}
    </span>
  );
}

function ConnectedView({
  status,
  onDisconnect,
  pending,
  m,
  locale,
}: {
  status: IntegrationStatus;
  onDisconnect: () => void;
  pending: boolean;
  m: Msgs;
  locale: Locale;
}) {
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
    new Date(status.connectedAt),
  );
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <dl className="min-w-0 space-y-0.5 text-sm">
        {status.label ? (
          <dd className="font-medium text-foreground">{fill(m.connectedAs, { label: status.label })}</dd>
        ) : null}
        <dd className="text-xs text-muted-foreground">
          {status.last4 ? `${fill(m.endingIn, { last4: status.last4 })} · ` : ''}
          {fill(m.connectedOn, { date })}
        </dd>
      </dl>
      <Button variant="destructive" size="sm" onClick={onDisconnect} disabled={pending}>
        {pending ? m.disconnecting : m.disconnect}
      </Button>
    </div>
  );
}

function ConnectForm({
  token,
  setToken,
  onConnect,
  onCancel,
  pending,
  providerName,
  m,
}: {
  token: string;
  setToken: (v: string) => void;
  onConnect: () => void;
  onCancel: () => void;
  pending: boolean;
  providerName: string;
  m: Msgs;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium" htmlFor="connect-token">
        {fill(m.tokenLabel, { provider: providerName })}
      </label>
      <Input
        id="connect-token"
        type="password"
        value={token}
        autoComplete="off"
        placeholder={m.tokenPlaceholder}
        onChange={(e) => setToken(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onConnect();
        }}
      />
      <p className="text-xs text-muted-foreground">{m.tokenHelp}</p>
      <div className="mt-1 flex items-center gap-2">
        <Button onClick={onConnect} disabled={pending}>
          {pending ? m.connecting : m.connect}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          {m.cancel}
        </Button>
      </div>
    </div>
  );
}
