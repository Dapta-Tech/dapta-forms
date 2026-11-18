'use client';

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FOCUSABLE_SELECTOR } from '@/lib/focusable';
import { useRouter } from 'next/navigation';
import { getMessages, type FormsMessages, type Locale } from '@quill/shared';
import type { IntegrationProvider, IntegrationStatus } from '@/lib/admin-api';
import { Button, buttonVariants } from '@/components/ui/button';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/toast';
import { IntegrationMark } from '@/components/ui/provider-logo';
import { DcalLogo } from '@/components/ui/dcal-logo';
import { disconnectIntegrationAction } from './actions';
import { callAction } from '@/lib/call-action';
import {
  GoHighLevelConnectForm,
  GoogleConnectButton,
  SalesforceConnectForm,
  TokenConnectForm,
  salesforceProblem,
} from './connect-forms';

// Re-exported for the callers that learned it here before the connect forms
// moved out to be shared with a form's Connect tab.
export { salesforceProblem };

type Msgs = FormsMessages['admin']['connections'];

/**
 * How a provider's consent round trip ended, as the API's callback reports it
 * in the query it redirects back with.
 */
export type OauthOutcome = 'connected' | 'cancelled' | 'error' | 'scope';

/** Replace `{key}` tokens in a catalog string (locale copy owns the wording). */
const fill = (template: string, vars: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);

/**
 * The card frame, shared by every card in the grid below.
 *
 * Each card is two grid rows of a SUBGRID: its header in the first, its body
 * (button, form, connection) in the second. The two cards of a row share both
 * tracks, and the parts behave differently in them on purpose:
 *
 *  - the headers STRETCH to the row's tallest header, so at rest every
 *    Connect / How it works button of a row starts on the same line, however
 *    many lines each description wraps to;
 *  - the bodies sit at the TOP of their track (`self-start`) at their own
 *    height, so a card whose connect form opens grows alone. Its neighbour
 *    keeps the exact height it had.
 *
 * It used to be one box per card, stretched to the row with its button pinned
 * to the bottom (`mt-auto`). That aligned the buttons at rest, and then pushed
 * the neighbour's button to the bottom of a card as tall as the open form,
 * leaving a hole in the middle of it.
 *
 * The section itself draws nothing (it is the subgrid); the header draws the
 * top of the card and the body the bottom, with no seam between them. Its own
 * `gap-y-0` replaces the grid's row gap between its two rows, and
 * `grid-cols-1` (`minmax(0, 1fr)`) keeps a long unbroken word inside the
 * column instead of widening the card over its neighbour.
 */
const CARD = 'row-span-2 grid grid-cols-1 grid-rows-subgrid gap-y-0';
const CARD_TOP =
  'flex items-start justify-between gap-3 rounded-t-xl border border-b-0 border-border bg-card px-5 pt-5';
const CARD_BODY = 'self-start rounded-b-xl border border-t-0 border-border bg-card px-5 pb-5 pt-4';

interface ProviderMeta {
  id: IntegrationProvider;
  name: string;
  desc: string;
  /**
   * How this provider is connected. `paste` asks for a token; `oauth` sends the
   * browser to the provider's own consent screen and comes back through the
   * API's callback, so there is no token field and nothing to validate here.
   */
  how: 'paste' | 'oauth' | 'salesforce' | 'gohighlevel';
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
  canManage = true,
  messages: m,
  locale,
}: {
  /**
   * Owners and admins. The API refuses a connect or a disconnect from anyone
   * else, so a member sees what is connected and a sentence, no buttons.
   */
  canManage?: boolean;
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
    // Two values, like Salesforce's three: a Private Integration token and the
    // sub-account it belongs to, proved together by the API.
    { id: 'gohighlevel', name: m.highlevel.name, desc: m.highlevel.desc, how: 'gohighlevel' },
  ];

  const [statuses, setStatuses] = useState<Record<string, IntegrationStatus | null>>(() => {
    const map: Record<string, IntegrationStatus | null> = {
      hubspot: null,
      calendly: null,
      'google-sheets': null,
      salesforce: null,
      gohighlevel: null,
    };
    for (const s of initialProviders) if (s.connected) map[s.provider] = s;
    return map;
  });

  // Every provider gets a card, including one this deployment cannot connect:
  // the page is also where people learn what dForms can talk to. A card for an
  // unavailable provider carries no button (it could only fail) and says why
  // instead. An account that is ALREADY connected keeps its normal card, the
  // only place that connection can be seen and removed.
  const visibleProviders = providers;
  const isUnavailable = (id: IntegrationProvider) => unavailable.includes(id) && statuses[id] == null;

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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="connections-grid">
        {visibleProviders.map((meta) => [
          // dCal sits right above Calendly: it is the scheduler we would
          // rather people pick, so it comes first where the two are compared.
          // Always shown, configured or not: the card is presence for the
          // scheduler we would rather people pick. Only its link depends on
          // the deployment having dCal.
          meta.id === 'calendly' ? (
            <DcalCard key="dcal" createEventUrl={dcal?.createEventUrl ?? null} m={m} />
          ) : null,
          <ProviderCard
            key={meta.id}
            meta={meta}
            status={statuses[meta.id] ?? null}
            encryptionAvailable={encryptionAvailable}
            serverProvided={serverProvided.includes(meta.id)}
            unavailable={isUnavailable(meta.id)}
            canManage={canManage}
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
  unavailable = false,
  canManage = true,
  onStatusChange,
  m,
  locale,
}: {
  /** See `ConnectionsPanel`. */
  canManage?: boolean;
  meta: ProviderMeta;
  status: IntegrationStatus | null;
  encryptionAvailable: boolean;
  serverProvided?: boolean;
  /** This deployment cannot connect the provider: say so, offer no button. */
  unavailable?: boolean;
  onStatusChange: (s: IntegrationStatus | null) => void;
  m: Msgs;
  locale: Locale;
}) {
  const { success, error } = useToast();
  const [pending, start] = useTransition();
  const { confirm: confirmDialog, dialog } = useConfirmDialog();
  const [showConnect, setShowConnect] = useState(false);
  // HighLevel only: the connected card's "Replace token" form is open.
  const [replacing, setReplacing] = useState(false);
  const connected = !!status;
  // HighLevel refuses the stored token (a delivery got a 401 or 403 since it
  // was connected). The connection still exists; it only needs a new token.
  const rejectedAt = meta.id === 'gohighlevel' && status?.rejectedAt ? status.rejectedAt : null;

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

  // A credential form is open in this card (connect, or HighLevel's replace).
  const formOpen = (showConnect && !connected) || (replacing && connected);

  return (
    <section className={CARD} data-provider={meta.id} data-open={formOpen || undefined}>
      <header className={CARD_TOP}>
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
        <StatusBadge
          connected={connected}
          serverProvided={serverProvided}
          rejected={rejectedAt !== null}
          m={m}
        />
      </header>

      {/* The body: at its own height, under a header as tall as its row's
          tallest (see CARD). That is what lines the buttons up at rest
          without stretching a neighbour when this card's form opens. */}
      <div className={CARD_BODY} data-testid="card-body">
        {unavailable ? (
          <div
            data-testid="provider-unavailable"
            className="rounded-md border border-dashed border-border bg-muted/40 p-3"
          >
            <p className="text-sm font-medium text-foreground">{m.unavailableTitle}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {fill(m.unavailableBody, { provider: meta.name })}
            </p>
          </div>
        ) : !encryptionAvailable ? (
          // Still say the integration works when the server supplies the token:
          // "connecting is unavailable" on its own reads as "nothing works here".
          <div className="flex flex-col gap-3">
            {serverProvided ? <ServerProvidedNote providerName={meta.name} m={m} /> : null}
            <div className="rounded-md border border-dashed border-border bg-muted/40 p-3">
              <p className="text-sm font-medium text-foreground">{m.encryptionOff}</p>
              <p className="mt-1 text-xs text-muted-foreground">{m.encryptionOffBody}</p>
            </div>
          </div>
        ) : !canManage && !connected ? (
          <div className="flex flex-col gap-3">
            {serverProvided ? <ServerProvidedNote providerName={meta.name} m={m} /> : null}
            <p className="text-sm text-muted-foreground" data-testid="provider-admin-only">
              {fill(m.manageAdminOnly, { provider: meta.name })}
            </p>
          </div>
        ) : connected && status && meta.how === 'gohighlevel' && replacing && canManage ? (
          <Reveal>
          <GoHighLevelConnectForm
            replacing
            initialLocationId={status.locationId ?? ''}
            onConnected={(s) => {
              onStatusChange(s);
              setReplacing(false);
              success(m.highlevel.replaceSuccess);
            }}
            onCancel={() => setReplacing(false)}
            m={m}
          />
          </Reveal>
        ) : connected && status ? (
          <ConnectedView
            status={status}
            onDisconnect={canManage ? disconnect : null}
            adminOnly={canManage ? null : fill(m.manageAdminOnly, { provider: meta.name })}
            pending={pending}
            m={m}
            locale={locale}
            note={meta.id === 'calendly' ? m.calendlyScopeNote : null}
            {...(meta.how === 'gohighlevel'
              ? {
                  labelTemplate: m.highlevel.connectedTo,
                  locationId: status.locationId ?? null,
                  onReplace: canManage ? () => setReplacing(true) : null,
                  replaceLabel: m.highlevel.replaceToken,
                  rejected:
                    rejectedAt !== null
                      ? {
                          title: m.highlevel.rejectedTitle,
                          body: fill(canManage ? m.highlevel.rejectedBody : m.highlevel.rejectedBodyMember, {
                            date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
                              new Date(rejectedAt),
                            ),
                          }),
                        }
                      : null,
                }
              : {})}
          />
        ) : meta.how === 'oauth' ? (
          // No token field and no second step: the consent screen IS the form.
          // The button first and the note under it, like every body here: a
          // note above it would push it below its neighbour's.
          <div className="flex flex-col gap-3">
            <GoogleConnectButton m={m} className="self-start" />
            {meta.note ? (
              <p className="text-xs text-muted-foreground">{meta.note}</p>
            ) : null}
          </div>
        ) : meta.how === 'gohighlevel' && showConnect ? (
          <Reveal>
          <GoHighLevelConnectForm
            onConnected={(s) => {
              onStatusChange(s);
              setShowConnect(false);
              success(fill(m.connectSuccess, { provider: meta.name }));
            }}
            onCancel={() => setShowConnect(false)}
            m={m}
          />
          </Reveal>
        ) : meta.how === 'salesforce' && showConnect ? (
          <Reveal>
          <SalesforceConnectForm
            onConnected={(s) => {
              onStatusChange(s);
              setShowConnect(false);
              success(fill(m.connectSuccess, { provider: meta.name }));
            }}
            onCancel={() => setShowConnect(false)}
            m={m}
          />
          </Reveal>
        ) : showConnect ? (
          // Connecting stays available while the server supplies a token — an
          // account can override the shared one with its own.
          <Reveal>
          <TokenConnectForm
            provider={meta.id}
            providerName={meta.name}
            onConnected={(s) => {
              onStatusChange(s);
              setShowConnect(false);
              success(fill(m.connectSuccess, { provider: meta.name }));
            }}
            onCancel={() => setShowConnect(false)}
            m={m}
          />
          </Reveal>
        ) : (
          // Button first, note under it (see the oauth branch above).
          <div className="flex flex-col gap-3">
            <Button onClick={() => setShowConnect(true)} className="self-start">
              <i aria-hidden className="pi pi-link" style={{ fontSize: 12 }} />
              {m.connect}
            </Button>
            {serverProvided ? <ServerProvidedNote providerName={meta.name} m={m} /> : null}
          </div>
        )}
        {dialog}
      </div>
    </section>
  );
}

/**
 * A credential form arriving in its card: a short fade and settle, so the card
 * growing reads as the form opening rather than as a jump. Only the card that
 * opens moves (see CARD). Still under reduced motion (globals.css).
 */
function Reveal({ children }: { children: ReactNode }) {
  return <div className="connect-reveal">{children}</div>;
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
  rejected = false,
  m,
}: {
  connected: boolean;
  serverProvided?: boolean;
  /** Connected, but the provider refuses the stored credential (HighLevel). */
  rejected?: boolean;
  m: Msgs;
}) {
  // A connected account outranks the server token — its own credential is what
  // actually gets used, so the badge must name that one. A refused credential
  // outranks "connected": green over a token nothing accepts would be a lie.
  const state = connected ? (rejected ? 'rejected' : 'account') : serverProvided ? 'server' : 'none';
  const tone =
    state === 'rejected'
      ? 'border-destructive/40 bg-destructive/10 text-destructive'
      : state === 'account'
        ? 'border-signal-edge/40 bg-signal/15 text-foreground'
        : state === 'server'
          ? 'border-border bg-muted/60 text-foreground'
          : 'border-border bg-muted/40 text-muted-foreground';
  const dot =
    state === 'rejected'
      ? 'bg-destructive'
      : state === 'account'
        ? 'bg-signal-edge'
        : state === 'server'
          ? 'bg-signal-edge/50'
          : 'bg-muted-foreground';
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
      {state === 'rejected'
        ? m.highlevel.rejectedBadge
        : state === 'account'
          ? m.connected
          : state === 'server'
            ? m.serverProvided
            : m.notConnected}
    </span>
  );
}

function ConnectedView({
  status,
  onDisconnect,
  adminOnly = null,
  pending,
  m,
  locale,
  note,
  labelTemplate,
  locationId = null,
  onReplace = null,
  replaceLabel,
  rejected = null,
}: {
  /** How the identity line reads (`{label}`); "Connected as" by default. */
  labelTemplate?: string;
  /** HighLevel: the sub-account's Location ID, so the admin can check it is the right one. */
  locationId?: string | null;
  /** HighLevel: replace the token in place. Null for a member. */
  onReplace?: (() => void) | null;
  replaceLabel?: string;
  /** The provider stopped accepting the credential: said above everything else. */
  rejected?: { title: string; body: string } | null;
  status: IntegrationStatus;
  /** Null for a member: the API would refuse, so there is no button. */
  onDisconnect: (() => void) | null;
  /** The sentence a member reads where the button would be. */
  adminOnly?: string | null;
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
      {rejected ? (
        <div
          role="alert"
          data-testid="connection-rejected"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3"
        >
          <p className="text-sm font-medium text-destructive">{rejected.title}</p>
          <p className="mt-1 text-xs text-foreground">{rejected.body}</p>
        </div>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <dl className="min-w-0 space-y-0.5 text-sm">
          {status.label ? (
            <dd className="font-medium text-foreground [overflow-wrap:anywhere]">
              {fill(labelTemplate ?? m.connectedAs, { label: status.label })}
            </dd>
          ) : null}
          {locationId ? (
            <dd className="break-all text-xs text-muted-foreground" data-testid="connection-location">
              {fill(m.highlevel.locationLine, { id: locationId })}
            </dd>
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
        {onDisconnect || onReplace ? (
          <div className="flex flex-wrap items-center gap-2">
            {onReplace ? (
              <Button
                variant={rejected ? 'default' : 'outline'}
                size="sm"
                onClick={onReplace}
                disabled={pending}
                data-testid="connection-replace"
              >
                {replaceLabel}
              </Button>
            ) : null}
            {onDisconnect ? (
              <Button variant="destructive" size="sm" onClick={onDisconnect} disabled={pending}>
                {pending ? m.disconnecting : m.disconnect}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {adminOnly ? (
        <p className="text-xs text-muted-foreground" data-testid="provider-admin-only">
          {adminOnly}
        </p>
      ) : null}
      {note ? (
        <p className="text-xs text-muted-foreground" data-testid="connection-scope-note">
          {note}
        </p>
      ) : null}
    </div>
  );
}

/**
 * dCal's card. Not a connection: the scheduler picker forwards the author's
 * own Dapta session to dCal, so there is no credential to paste and nothing to
 * disconnect. The card is here for presence, beside the provider it replaces,
 * and its button opens the three steps it takes to use it instead, so it is
 * labelled for that ("How it works"), never "Connect".
 *
 * "Included" only where this deployment actually has dCal (`createEventUrl`
 * is null otherwise): elsewhere the badge says it is not available, and the
 * steps say why.
 */
function DcalCard({ createEventUrl, m }: { createEventUrl: string | null; m: Msgs }) {
  const [showSteps, setShowSteps] = useState(false);
  const available = createEventUrl !== null;
  return (
    <section className={CARD} data-testid="dcal-card">
      <header className={CARD_TOP}>
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
        {available ? (
          <span
            data-testid="connection-status"
            data-state="included"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-signal-edge/40 bg-signal/15 px-2.5 py-1 text-xs font-medium text-foreground"
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-signal-edge" />
            {m.dcalIncluded}
          </span>
        ) : (
          <span
            data-testid="connection-status"
            data-state="unavailable"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground"
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
            {m.dcalUnavailable}
          </span>
        )}
      </header>
      <div className={CARD_BODY} data-testid="card-body">
        <Button
          onClick={() => setShowSteps(true)}
          variant={available ? 'default' : 'outline'}
          className="self-start"
          data-testid="dcal-how"
        >
          <i aria-hidden className="pi pi-info-circle" style={{ fontSize: 12 }} />
          {m.dcalHow}
        </Button>
        {/* In a dialog, not inside the card: three steps are reading matter,
            not a form, and a modal keeps them clear of the grid. (It also
            predates CARD, from when a card opened in place stretched its
            neighbour.) Portalled, so it takes no grid cell. */}
        {showSteps ? (
          <DcalStepsDialog createEventUrl={createEventUrl} onClose={() => setShowSteps(false)} m={m} />
        ) : null}
      </div>
    </section>
  );
}

/**
 * dCal's three steps, as a modal. Same contract as the app's confirm dialog
 * (focus trap, Escape and the backdrop close, focus returns to the button),
 * rendered through a portal so no ancestor's stacking context can clip it.
 */
function DcalStepsDialog({
  createEventUrl,
  onClose,
  m,
}: {
  createEventUrl: string | null;
  onClose: () => void;
  m: Msgs;
}) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!items || items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const inside = cardRef.current?.contains(document.activeElement) ?? false;
      if (e.shiftKey && (!inside || document.activeElement === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      restoreRef.current?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="dcal-steps"
        className="relative w-full max-w-md rounded-xl border border-border bg-card p-6 text-card-foreground shadow-lg"
      >
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-foreground"
            aria-hidden
          >
            <DcalLogo width={30} />
          </span>
          <h2 id={titleId} className="text-base font-semibold tracking-tight">
            {m.dcalHowTitle}
          </h2>
        </div>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
          {m.dcalSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {createEventUrl ? null : (
          <div
            data-testid="provider-unavailable"
            className="mt-4 rounded-md border border-dashed border-border bg-muted/40 p-3"
          >
            <p className="text-sm font-medium text-foreground">{m.unavailableTitle}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {fill(m.unavailableBody, { provider: m.dcalName })}
            </p>
          </div>
        )}
        <div className="mt-6 flex items-center justify-end gap-2">
          <Button ref={closeRef} variant="ghost" onClick={onClose}>
            {m.dcalClose}
          </Button>
          {/* A real link, styled as the primary button: it opens dCal in a
              new tab, so the author keeps this page. Only where the
              deployment has dCal; elsewhere it could only 404. */}
          {createEventUrl ? (
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
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
