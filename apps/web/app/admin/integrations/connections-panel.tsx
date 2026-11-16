'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { getMessages, type FormsMessages, type Locale } from '@quill/shared';
import type { IntegrationProvider, IntegrationStatus, SalesforceConnectError } from '@/lib/admin-api';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/toast';
import { IntegrationMark } from '@/components/ui/provider-logo';
import { DcalLogo } from '@/components/ui/dcal-logo';
import {
  connectIntegrationAction,
  connectSalesforceAction,
  disconnectIntegrationAction,
  startGoogleSheetsAuthAction,
} from './actions';
import { callAction } from '@/lib/call-action';

type Msgs = FormsMessages['admin']['connections'];

/**
 * How a provider's consent round trip ended, as the API's callback reports it
 * in the query it redirects back with.
 */
export type OauthOutcome = 'connected' | 'cancelled' | 'error' | 'scope';

/** Replace `{key}` tokens in a catalog string (locale copy owns the wording). */
const fill = (template: string, vars: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);

interface ProviderMeta {
  id: IntegrationProvider;
  name: string;
  desc: string;
  /**
   * How this provider is connected. `paste` asks for a token; `oauth` sends the
   * browser to the provider's own consent screen and comes back through the
   * API's callback, so there is no token field and nothing to validate here.
   */
  how: 'paste' | 'oauth' | 'salesforce';
  /** Shown above the Connect button on an `oauth` card, so the round trip is no surprise. */
  note?: string;
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
  serverProvided = [],
  unavailable = [],
  dcal = null,
  loadError,
  oauthOutcome = null,
  messages: m,
  locale,
}: {
  initialProviders: IntegrationStatus[];
  encryptionAvailable: boolean;
  /** Providers the deployment already supplies a token for. */
  serverProvided?: IntegrationProvider[];
  /**
   * Providers this deployment cannot connect (see `IntegrationsResponse`).
   * Their cards are left out, unless the account is already connected.
   */
  unavailable?: IntegrationProvider[];
  /** dCal on this deployment; null leaves its card out. */
  dcal?: { createEventUrl: string } | null;
  loadError?: boolean;
  /**
   * How a consent round trip ended, read off the query by the page. Null on an
   * ordinary visit.
   */
  oauthOutcome?: OauthOutcome | null;
  messages: Msgs;
  locale: Locale;
}) {
  const providers: ProviderMeta[] = [
    { id: 'hubspot', name: m.hubspotName, desc: m.hubspotDesc, how: 'paste' },
    { id: 'calendly', name: m.calendlyName, desc: m.calendlyDesc, how: 'paste' },
    {
      id: 'google-sheets',
      name: m.gsheetsName,
      desc: m.gsheetsDesc,
      how: 'oauth',
      note: m.gsheetsConnectNote,
    },
    // Three values, not one token: Salesforce has no API keys, and Client
    // Credentials is the one server-to-server credential an admin can paste.
    { id: 'salesforce', name: m.salesforceName, desc: m.salesforceDesc, how: 'salesforce' },
  ];

  const [statuses, setStatuses] = useState<Record<string, IntegrationStatus | null>>(() => {
    const map: Record<string, IntegrationStatus | null> = {
      hubspot: null,
      calendly: null,
      'google-sheets': null,
      salesforce: null,
    };
    for (const s of initialProviders) if (s.connected) map[s.provider] = s;
    return map;
  });

  // A provider the deployment cannot connect gets no card: its button could
  // only fail. The exception is an account that is ALREADY connected (the
  // operator took the configuration away afterwards): that card stays, because
  // it is the only place the connection can be seen and removed.
  const visibleProviders = providers.filter(
    (meta) => !unavailable.includes(meta.id) || statuses[meta.id] != null,
  );

  /**
   * Say how the consent round trip went, once, and take the flag out of the URL.
   *
   * The flag has to go: left in place, a reload or a shared link would announce
   * a connection that is not happening now, and the back button would walk the
   * visitor through old outcomes. `router.replace` rewrites the address without
   * a navigation, so nothing refetches.
   *
   * The ref guards against React running the effect twice in development, which
   * would otherwise show every toast in duplicate.
   */
  const router = useRouter();
  const { success: toastSuccess, error: toastError } = useToast();
  const announced = useRef(false);
  useEffect(() => {
    if (!oauthOutcome || announced.current) return;
    announced.current = true;
    if (oauthOutcome === 'connected') toastSuccess(m.googleConnected);
    else if (oauthOutcome === 'cancelled') toastError(m.googleCancelled);
    else if (oauthOutcome === 'scope') toastError(m.googleScopeError);
    else toastError(m.googleError);
    router.replace('/admin/integrations');
  }, [oauthOutcome, router, toastSuccess, toastError, m]);

  return (
    <div className="flex flex-col gap-6">
      {loadError ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {m.loadError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {visibleProviders.map((meta) => [
          // dCal sits right above Calendly: it is the scheduler we would
          // rather people pick, so it comes first where the two are compared.
          meta.id === 'calendly' && dcal ? (
            <DcalCard key="dcal" createEventUrl={dcal.createEventUrl} m={m} />
          ) : null,
          <ProviderCard
            key={meta.id}
            meta={meta}
            status={statuses[meta.id] ?? null}
            encryptionAvailable={encryptionAvailable}
            serverProvided={serverProvided.includes(meta.id)}
            onStatusChange={(s) => setStatuses((prev) => ({ ...prev, [meta.id]: s }))}
            m={m}
            locale={locale}
          />,
        ])}
      </div>

      <p className="text-sm text-muted-foreground">{m.perFormNote}</p>
    </div>
  );
}

function ProviderCard({
  meta,
  status,
  encryptionAvailable,
  serverProvided = false,
  onStatusChange,
  m,
  locale,
}: {
  meta: ProviderMeta;
  status: IntegrationStatus | null;
  encryptionAvailable: boolean;
  serverProvided?: boolean;
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

  /**
   * Hand the browser to the provider's consent screen.
   *
   * `window.location.assign` rather than the router: the destination is another
   * origin, so there is nothing for Next to prefetch or soft-navigate, and the
   * way back in is the API's callback redirecting to this page with an outcome
   * flag. Nothing is stored on this side, so a visitor who abandons the consent
   * screen leaves no half-made connection behind.
   */
  function connectWithOauth() {
    start(async () => {
      const res = await callAction(() => startGoogleSheetsAuthAction());
      if (res.ok) window.location.assign(res.authUrl);
      else error(res.message || m.connectError);
    });
  }

  function connect() {
    const trimmed = token.trim();
    if (!trimmed) {
      error(m.tokenRequired);
      return;
    }
    start(async () => {
      const res = await callAction(() => connectIntegrationAction(meta.id, trimmed));
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
      title: fill(getMessages(locale).dialog.disconnectIntegrationTitle, {
        provider: meta.name,
      }),
      message: fill(m.disconnectConfirm, { provider: meta.name }),
      confirmLabel: m.disconnect,
      cancelLabel: m.cancel,
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const res = await callAction(() => disconnectIntegrationAction(meta.id));
      if (res.ok) {
        onStatusChange(null);
        success(fill(m.disconnectSuccess, { provider: meta.name }));
      } else {
        error(m.disconnectError);
      }
    });
  }

  return (
    <section className="flex flex-col rounded-xl border border-border bg-card p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted"
            aria-hidden
          >
            <IntegrationMark provider={meta.id} size={20} />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold tracking-tight">{meta.name}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{meta.desc}</p>
          </div>
        </div>
        <StatusBadge connected={connected} serverProvided={serverProvided} m={m} />
      </header>

      {/* `mt-auto` pins the action row to the bottom of the card. Without it the
          button followed its description, and HubSpot's two-line copy pushed its
          Connect button a line lower than Calendly's — the two never lined up. */}
      <div className="mt-auto pt-4">
        {!encryptionAvailable ? (
          // Still say the integration works when the server supplies the token:
          // "connecting is unavailable" on its own reads as "nothing works here".
          <div className="flex flex-col gap-3">
            {serverProvided ? <ServerProvidedNote providerName={meta.name} m={m} /> : null}
            <div className="rounded-md border border-dashed border-border bg-muted/40 p-3">
              <p className="text-sm font-medium text-foreground">{m.encryptionOff}</p>
              <p className="mt-1 text-xs text-muted-foreground">{m.encryptionOffBody}</p>
            </div>
          </div>
        ) : connected && status ? (
          <ConnectedView
            status={status}
            onDisconnect={disconnect}
            pending={pending}
            m={m}
            locale={locale}
            note={meta.id === 'calendly' ? m.calendlyScopeNote : null}
          />
        ) : meta.how === 'oauth' ? (
          // No token field and no second step: the consent screen IS the form.
          <div className="flex flex-col gap-3">
            {meta.note ? (
              <p className="text-xs text-muted-foreground">{meta.note}</p>
            ) : null}
            <Button onClick={connectWithOauth} disabled={pending} className="self-start">
              <IntegrationMark provider={meta.id} size={14} />
              {pending ? m.connecting : m.connectWithGoogle}
            </Button>
          </div>
        ) : meta.how === 'salesforce' && showConnect ? (
          <SalesforceConnectForm
            onConnected={(s) => {
              onStatusChange(s);
              setShowConnect(false);
              success(fill(m.connectSuccess, { provider: meta.name }));
            }}
            onCancel={() => setShowConnect(false)}
            m={m}
          />
        ) : showConnect ? (
          // Connecting stays available while the server supplies a token — an
          // account can override the shared one with its own.
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
          <div className="flex flex-col gap-3">
            {serverProvided ? <ServerProvidedNote providerName={meta.name} m={m} /> : null}
            <Button onClick={() => setShowConnect(true)} className="self-start">
              <i aria-hidden className="pi pi-link" style={{ fontSize: 12 }} />
              {m.connect}
            </Button>
          </div>
        )}
      </div>
      {dialog}
    </section>
  );
}

/** "The deployment already gave us a token" — shown wherever Connect would be. */
function ServerProvidedNote({ providerName, m }: { providerName: string; m: Msgs }) {
  return (
    <div
      data-testid="server-provided-note"
      className="rounded-md border border-dashed border-border bg-muted/40 p-3"
    >
      <p className="text-sm font-medium text-foreground">{m.serverProvidedTitle}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {fill(m.serverProvidedBody, { provider: providerName })}
      </p>
    </div>
  );
}

/**
 * Three states, not two. "Not connected" alone was wrong whenever the deployment
 * supplied the token: the account really has connected nothing, and the
 * integration really is working, and only saying the first half reads as broken.
 */
function StatusBadge({
  connected,
  serverProvided = false,
  m,
}: {
  connected: boolean;
  serverProvided?: boolean;
  m: Msgs;
}) {
  // A connected account outranks the server token — its own credential is what
  // actually gets used, so the badge must name that one.
  const state = connected ? 'account' : serverProvided ? 'server' : 'none';
  const tone =
    state === 'account'
      ? 'border-signal-edge/40 bg-signal/15 text-foreground'
      : state === 'server'
        ? 'border-border bg-muted/60 text-foreground'
        : 'border-border bg-muted/40 text-muted-foreground';
  const dot =
    state === 'account' ? 'bg-signal-edge' : state === 'server' ? 'bg-signal-edge/50' : 'bg-muted-foreground';
  return (
    <span
      data-testid="connection-status"
      data-state={state}
      className={
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ' +
        tone
      }
    >
      <span aria-hidden className={'h-1.5 w-1.5 rounded-full ' + dot} />
      {state === 'account' ? m.connected : state === 'server' ? m.serverProvided : m.notConnected}
    </span>
  );
}

function ConnectedView({
  status,
  onDisconnect,
  pending,
  m,
  locale,
  note,
}: {
  status: IntegrationStatus;
  onDisconnect: () => void;
  pending: boolean;
  m: Msgs;
  locale: Locale;
  /** A provider-specific line under the identity (what this connection can see). */
  note?: string | null;
}) {
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
    new Date(status.connectedAt),
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <dl className="min-w-0 space-y-0.5 text-sm">
          {status.label ? (
            <dd className="font-medium text-foreground">{fill(m.connectedAs, { label: status.label })}</dd>
          ) : null}
          <dd className="text-xs text-muted-foreground">
            {/* "Ending in" is how somebody recognises the token THEY pasted.
                A Google connection has no such token: what is stored is a
                refresh token Google issued, whose last characters mean nothing
                to anyone, and the account's email above already says which
                connection this is. */}
            {status.last4 && status.provider !== 'google-sheets'
              ? `${fill(m.endingIn, { last4: status.last4 })} · `
              : ''}
            {fill(m.connectedOn, { date })}
          </dd>
        </dl>
        <Button variant="destructive" size="sm" onClick={onDisconnect} disabled={pending}>
          {pending ? m.disconnecting : m.disconnect}
        </Button>
      </div>
      {note ? (
        <p className="text-xs text-muted-foreground" data-testid="connection-scope-note">
          {note}
        </p>
      ) : null}
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

/**
 * Salesforce's connect form: the org's My Domain and an External Client App's
 * consumer key and secret, with the one-time setup the admin has to do first.
 *
 * The setup steps are ON the card rather than behind a docs link because the
 * person filling this in is often not the Salesforce admin, and they need to
 * be able to forward exactly what to ask for. A refusal names which of the
 * three things to fix, including the ten-minute wait after creating the app,
 * which otherwise reads as "I did something wrong".
 */
function SalesforceConnectForm({
  onConnected,
  onCancel,
  m,
}: {
  onConnected: (status: IntegrationStatus) => void;
  onCancel: () => void;
  m: Msgs;
}) {
  const [domain, setDomain] = useState('');
  const [consumerKey, setConsumerKey] = useState('');
  const [consumerSecret, setConsumerSecret] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function connect() {
    const input = {
      domain: domain.trim(),
      consumerKey: consumerKey.trim(),
      consumerSecret: consumerSecret.trim(),
    };
    if (!input.domain || !input.consumerKey || !input.consumerSecret) {
      setProblem(m.salesforceFieldsRequired);
      return;
    }
    setProblem(null);
    start(async () => {
      // Thirty seconds, not the default fifteen: connecting waits on two calls
      // to the org, each bounded server-side, and the button must not give up
      // before the server has had the chance to say why.
      const res = await callAction(() => connectSalesforceAction(input), { timeoutMs: 30_000 });
      if (res.ok) {
        setConsumerSecret('');
        onConnected(res.status);
        return;
      }
      setProblem(salesforceProblem(res, m));
    });
  }

  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    opts: { secret?: boolean; placeholder?: string } = {},
  ) => (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      <Input
        id={id}
        type={opts.secret ? 'password' : 'text'}
        value={value}
        autoComplete="off"
        spellCheck={false}
        placeholder={opts.placeholder}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') connect();
        }}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-3" data-testid="salesforce-connect-form">
      <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">{m.salesforceSetupTitle}</p>
        <ol className="mt-1.5 list-decimal space-y-1 pl-4">
          {m.salesforceSetupSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="mt-2">{m.salesforceEditionNote}</p>
      </div>
      {field('sf-domain', m.salesforceDomainLabel, domain, setDomain, {
        placeholder: m.salesforceDomainPlaceholder,
      })}
      {field('sf-key', m.salesforceKeyLabel, consumerKey, setConsumerKey)}
      {field('sf-secret', m.salesforceSecretLabel, consumerSecret, setConsumerSecret, { secret: true })}
      <p className="text-xs text-muted-foreground">{m.tokenHelp}</p>
      {problem ? (
        <p role="alert" data-testid="salesforce-connect-problem" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}
      <div className="mt-1 flex items-center gap-2">
        <Button onClick={connect} disabled={pending}>
          {pending ? m.connecting : m.connect}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          {m.cancel}
        </Button>
      </div>
    </div>
  );
}

/**
 * dCal's card. Not a connection: the scheduler picker forwards the author's
 * own Dapta session to dCal, so there is no credential to paste and nothing to
 * disconnect. The card is here for presence, beside the provider it replaces,
 * and its "Connect" opens the three steps it takes to use it instead.
 */
function DcalCard({ createEventUrl, m }: { createEventUrl: string; m: Msgs }) {
  const [showSteps, setShowSteps] = useState(false);
  return (
    <section className="flex flex-col rounded-xl border border-border bg-card p-5" data-testid="dcal-card">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-foreground"
            aria-hidden
          >
            <DcalLogo width={30} />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold tracking-tight">{m.dcalName}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{m.dcalDesc}</p>
          </div>
        </div>
        <span
          data-testid="connection-status"
          data-state="included"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-signal-edge/40 bg-signal/15 px-2.5 py-1 text-xs font-medium text-foreground"
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-signal-edge" />
          {m.dcalIncluded}
        </span>
      </header>
      <div className="mt-auto pt-4">
        {showSteps ? (
          <div className="flex flex-col gap-3" data-testid="dcal-steps">
            <p className="text-sm font-medium text-foreground">{m.dcalHowTitle}</p>
            <ol className="list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
              {m.dcalSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <div className="flex items-center gap-2">
              {/* A real link, styled as the primary button: it opens dCal in a
                  new tab, so the author keeps this page and the steps. */}
              <a
                href={createEventUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants()}
                data-testid="dcal-open"
              >
                <i aria-hidden className="pi pi-external-link" style={{ fontSize: 12 }} />
                {m.dcalOpen}
              </a>
              <Button variant="ghost" onClick={() => setShowSteps(false)}>
                {m.dcalHide}
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={() => setShowSteps(true)} className="self-start">
            <i aria-hidden className="pi pi-link" style={{ fontSize: 12 }} />
            {m.connect}
          </Button>
        )}
      </div>
    </section>
  );
}

/**
 * The sentence for a refused Salesforce connection. Every path names a cause:
 * Salesforce's own refusal by reason, a role that may not connect, no answer
 * in time, and otherwise the API's message beside the generic line, so nobody
 * is left with "could not connect" and nothing to act on.
 */
export function salesforceProblem(
  res:
    | { ok: false; transport: true; message: string }
    | { ok: false; reason?: SalesforceConnectError; status?: number; message?: string },
  m: Msgs,
): string {
  if ('transport' in res) return m.salesforceErrors.timeout;
  if (res.reason) return m.salesforceErrors[res.reason];
  if (res.status === 403) return m.salesforceErrors.forbidden;
  return res.message ? `${m.connectError} (${res.message})` : m.connectError;
}
