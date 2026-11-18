'use client';

import { useState, useTransition, type KeyboardEvent } from 'react';
import type { FormsMessages } from '@quill/shared';
import { GOHIGHLEVEL_CONNECT_REJECTIONS, GOHIGHLEVEL_TOKEN_PREFIX } from '@quill/types';
import type {
  GoHighLevelConnectError,
  IntegrationProvider,
  IntegrationStatus,
  SalesforceConnectError,
} from '@/lib/admin-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IntegrationMark } from '@/components/ui/provider-logo';
import { useToast } from '@/components/toast';
import { callAction } from '@/lib/call-action';
import {
  connectGoHighLevelAction,
  connectIntegrationAction,
  connectSalesforceAction,
  startGoogleSheetsAuthAction,
} from './actions';

type Msgs = FormsMessages['admin']['connections'];

/**
 * The connect controls, shared by the two places an account can be connected
 * from: the workspace's Integrations page and a form's own Connect tab.
 *
 * One implementation on purpose. The Salesforce form carries the setup steps
 * and the refusal sentences an admin needs to act on, and a second copy on the
 * Connect tab would drift from the first the next time either was edited.
 * Each control reports a finished connection to its caller and leaves the
 * rest (a toast, switching the card to its mapping) to the page it is on.
 */

/** Replace `{key}` tokens in a catalog string (locale copy owns the wording). */
const fill = (template: string, vars: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);

/**
 * The sentence for a connect attempt the API refused, in the author's
 * language, by the API's reason code. Never the API's own message: that is
 * English written for a log ("server encryption key not configured"), and a
 * toast is not where anyone should meet it.
 */
export function connectProblem(
  res: { code?: string; status?: number },
  m: Msgs,
  providerName: string,
  /** What to say when the API gave no reason this screen knows. */
  fallback: string = m.connectFailedGeneric,
): string {
  if (res.code === 'ENCRYPTION_UNAVAILABLE') return `${m.encryptionOff}. ${m.encryptionOffBody}`;
  if (res.code === 'INTEGRATION_UNAVAILABLE') return fill(m.unavailableBody, { provider: providerName });
  if (res.status === 403 || res.code === 'FORBIDDEN') return fill(m.manageAdminOnly, { provider: providerName });
  return fallback;
}

/**
 * "Continue with Google": hand the browser to Google's consent screen.
 *
 * `window.location.assign` rather than the router: the destination is another
 * origin, and the way back in is the API's callback redirecting with an
 * outcome flag. `returnTo` is the dashboard path that callback should land on
 * (a form's editor); the API checks it against its own allowlist and signs it
 * into the state, so this side can only ask, never decide. Nothing is stored
 * here, so an abandoned consent screen leaves no half-made connection.
 */
export function GoogleConnectButton({
  returnTo,
  m,
  className,
}: {
  returnTo?: string;
  m: Msgs;
  className?: string;
}) {
  const { error } = useToast();
  const [pending, start] = useTransition();
  function connect() {
    start(async () => {
      const res = await callAction(() => startGoogleSheetsAuthAction(returnTo));
      if (res.ok) window.location.assign(res.authUrl);
      else error('transport' in res ? m.connectFailedGeneric : connectProblem(res, m, m.gsheetsName));
    });
  }
  return (
    <Button onClick={connect} disabled={pending} className={className} data-testid="google-connect">
      <IntegrationMark provider="google-sheets" size={14} />
      {pending ? m.connecting : m.connectWithGoogle}
    </Button>
  );
}

/**
 * Connect a provider with a pasted token (HubSpot, Calendly).
 *
 * The token goes to a server action and is never rendered back: the field is
 * a password input, cleared on success, and only the token-free status comes
 * back. A refusal is said on the form itself, next to the field it is about.
 */
export function TokenConnectForm({
  provider,
  providerName,
  onConnected,
  onCancel,
  m,
}: {
  provider: IntegrationProvider;
  providerName: string;
  onConnected: (status: IntegrationStatus) => void;
  /** Absent where there is nothing to go back to (the form's Connect tab). */
  onCancel?: () => void;
  m: Msgs;
}) {
  const [token, setToken] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const id = `connect-token-${provider}`;

  function connect() {
    const trimmed = token.trim();
    if (!trimmed) {
      setProblem(m.tokenRequired);
      return;
    }
    setProblem(null);
    start(async () => {
      const res = await callAction(() => connectIntegrationAction(provider, trimmed));
      if (res.ok) {
        setToken('');
        onConnected(res.status);
      } else {
        // A pasted token that was refused is the usual case, and its own
        // sentence says to check the token; a role or a server without an
        // encryption key gets the sentence for that instead.
        setProblem('transport' in res ? m.connectError : connectProblem(res, m, providerName, m.connectError));
      }
    });
  }

  return (
    <div className="flex flex-col gap-2" data-testid="token-connect-form">
      <label className="text-sm font-medium" htmlFor={id}>
        {fill(m.tokenLabel, { provider: providerName })}
      </label>
      <Input
        id={id}
        type="password"
        value={token}
        autoComplete="off"
        placeholder={m.tokenPlaceholder}
        onChange={(e) => setToken(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') connect();
        }}
      />
      <p className="text-xs text-muted-foreground">{m.tokenHelp}</p>
      {problem ? (
        <p role="alert" data-testid="token-connect-problem" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}
      <div className="mt-1 flex items-center gap-2">
        <Button onClick={connect} disabled={pending}>
          {pending ? m.connecting : m.connect}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            {m.cancel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Salesforce's connect form: the org's My Domain and an External Client App's
 * consumer key and secret, with the one-time setup the admin has to do first.
 *
 * The setup steps are ON the form rather than behind a docs link because the
 * person filling this in is often not the Salesforce admin, and they need to
 * be able to forward exactly what to ask for. A refusal names which of the
 * three things to fix, including the ten-minute wait after creating the app,
 * which otherwise reads as "I did something wrong".
 */
export function SalesforceConnectForm({
  onConnected,
  onCancel,
  m,
}: {
  onConnected: (status: IntegrationStatus) => void;
  /** Absent where there is nothing to go back to (the form's Connect tab). */
  onCancel?: () => void;
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
      <p className="text-xs text-muted-foreground">{m.salesforceSecretHelp}</p>
      {problem ? (
        <p role="alert" data-testid="salesforce-connect-problem" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}
      <div className="mt-1 flex items-center gap-2">
        <Button onClick={connect} disabled={pending}>
          {pending ? m.connecting : m.connect}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            {m.cancel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The sentence for a refused Salesforce connection. Every path names a cause
 * where one is known: Salesforce's own refusal by reason, a role that may not
 * connect, no answer in time, a server that cannot store credentials. What is
 * left gets a generic sentence in the author's language (`connectProblem`).
 */
export function salesforceProblem(
  res:
    | { ok: false; transport: true; message: string }
    | { ok: false; reason?: SalesforceConnectError; status?: number; code?: string; message?: string; cause?: string },
  m: Msgs,
): string {
  if ('transport' in res) return m.salesforceErrors.timeout;
  // "Did not answer" carries how the call died, which is what tells an
  // operator whether this server is blocked from Salesforce.
  if (res.reason === 'unreachable' && res.cause) return `${m.salesforceErrors.unreachable} (${res.cause})`;
  if (res.reason) return m.salesforceErrors[res.reason];
  if (res.status === 403) return m.salesforceErrors.forbidden;
  // No reason this form knows: a localized sentence by the API's code, never
  // the API's own English message.
  return connectProblem(res, m, m.salesforceName);
}

/**
 * HighLevel's connect form: a Private Integration token and the sub-account's
 * Location ID (or its URL, from which the API takes the ID), with the setup on
 * the form in HighLevel's own menu labels, the scopes as its scope search
 * lists them, and where to find Private Integrations when it is hidden.
 *
 * The same form replaces the token of a connection that exists (`replacing`):
 * the API rewrites the row in place, so every form keeps its mapping, and the
 * Location ID comes filled in from the connection.
 */
export function GoHighLevelConnectForm({
  onConnected,
  onCancel,
  initialLocationId = '',
  replacing = false,
  m,
}: {
  onConnected: (status: IntegrationStatus) => void;
  /** Absent where there is nothing to go back to (the form's Connect tab). */
  onCancel?: () => void;
  /** The connected Location ID, when replacing its token. */
  initialLocationId?: string;
  /** Replace the token of the existing connection: no setup steps, a note instead. */
  replacing?: boolean;
  m: Msgs;
}) {
  const hm = m.highlevel;
  const [token, setToken] = useState('');
  const [locationId, setLocationId] = useState(initialLocationId);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function connect() {
    const input = { token: token.trim(), locationId: locationId.trim() };
    if (!input.token || !input.locationId) {
      setProblem(hm.fieldsRequired);
      return;
    }
    // The API refuses any other shape without calling HighLevel; saying it
    // here spares the round trip and names the usual mistake (an API key or
    // an agency token pasted instead).
    if (!input.token.startsWith(GOHIGHLEVEL_TOKEN_PREFIX)) {
      setProblem(hm.errors.token_format);
      return;
    }
    setProblem(null);
    start(async () => {
      // One call per scope server-side, each bounded: thirty seconds, so the
      // button never gives up before the server has said why.
      const res = await callAction(() => connectGoHighLevelAction(input), { timeoutMs: 30_000 });
      if (res.ok) {
        setToken('');
        onConnected(res.status);
        return;
      }
      setProblem(goHighLevelProblem(res, m));
    });
  }

  const onEnter = (e: KeyboardEvent) => {
    if (e.key === 'Enter') connect();
  };

  return (
    <div className="flex flex-col gap-3" data-testid="highlevel-connect-form">
      {replacing ? (
        <p className="text-xs text-muted-foreground" data-testid="highlevel-replace-note">
          {hm.replaceNote}
        </p>
      ) : (
        <div
          className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground"
          data-testid="highlevel-setup"
        >
          <p className="font-medium text-foreground">{hm.setupTitle}</p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-4">
            {hm.setupSteps.map((step, i) => (
              <li key={step}>
                {step}
                {/* The scopes hang off the step that asks for them, each as
                    HighLevel's scope search lists it, so it can be pasted. */}
                {i === 1 ? (
                  <ul className="mt-1 flex flex-col gap-1">
                    {hm.scopes.map((scope) => (
                      <li key={scope}>
                        <code className="break-all rounded bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                          {scope}
                        </code>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
          <p className="mt-2">{hm.labsNote}</p>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="ghl-token">
          {hm.tokenLabel}
        </label>
        <Input
          id="ghl-token"
          type="password"
          value={token}
          autoComplete="off"
          spellCheck={false}
          placeholder={hm.tokenPlaceholder}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={onEnter}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="ghl-location">
          {hm.locationLabel}
        </label>
        <Input
          id="ghl-location"
          type="text"
          value={locationId}
          autoComplete="off"
          spellCheck={false}
          placeholder={hm.locationPlaceholder}
          aria-describedby="ghl-location-help"
          // Replacing keeps the sub-account: the forms' mappings point at its
          // custom field ids, so another one is a disconnect and a new connect.
          readOnly={replacing}
          onChange={(e) => setLocationId(e.target.value)}
          onKeyDown={onEnter}
        />
        <p id="ghl-location-help" className="text-xs text-muted-foreground">
          {replacing ? hm.replaceLocationFixed : hm.locationHelp}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">{hm.secretHelp}</p>
      {problem ? (
        <p role="alert" data-testid="highlevel-connect-problem" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}
      <div className="mt-1 flex items-center gap-2">
        <Button onClick={connect} disabled={pending}>
          {pending ? m.connecting : replacing ? hm.replaceToken : m.connect}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            {m.cancel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

const isGoHighLevelError = (reason: unknown): reason is GoHighLevelConnectError =>
  (GOHIGHLEVEL_CONNECT_REJECTIONS as readonly unknown[]).includes(reason) ||
  reason === 'timeout' ||
  reason === 'forbidden';

/**
 * The sentence for a refused HighLevel connection, by the API's reason: which
 * of the two values to fix, a missing scope, or HighLevel not answering (with
 * how the call died, which tells an operator whether this server is blocked).
 * A role that may not connect, no answer in time and a server that cannot
 * store credentials get their own sentences; never the API's English.
 */
export function goHighLevelProblem(
  res:
    | { ok: false; transport: true; message: string }
    | { ok: false; reason?: GoHighLevelConnectError; status?: number; code?: string; message?: string; cause?: string },
  m: Msgs,
): string {
  const errors = m.highlevel.errors;
  if ('transport' in res) return errors.timeout;
  if (res.reason === 'unreachable' && res.cause) return `${errors.unreachable} (${res.cause})`;
  if (isGoHighLevelError(res.reason)) return errors[res.reason];
  if (res.status === 403) return errors.forbidden;
  return connectProblem(res, m, m.highlevel.name);
}
