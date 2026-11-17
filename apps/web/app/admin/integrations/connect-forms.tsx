'use client';

import { useState, useTransition } from 'react';
import type { FormsMessages } from '@quill/shared';
import type { IntegrationProvider, IntegrationStatus, SalesforceConnectError } from '@/lib/admin-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IntegrationMark } from '@/components/ui/provider-logo';
import { useToast } from '@/components/toast';
import { callAction } from '@/lib/call-action';
import {
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
      else error(res.message || m.connectError);
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
        setProblem(m.connectError);
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
 * The sentence for a refused Salesforce connection. Every path names a cause:
 * Salesforce's own refusal by reason, a role that may not connect, no answer
 * in time, and otherwise the API's message beside the generic line, so nobody
 * is left with "could not connect" and nothing to act on.
 */
export function salesforceProblem(
  res:
    | { ok: false; transport: true; message: string }
    | { ok: false; reason?: SalesforceConnectError; status?: number; message?: string; cause?: string },
  m: Msgs,
): string {
  if ('transport' in res) return m.salesforceErrors.timeout;
  // "Did not answer" carries how the call died, which is what tells an
  // operator whether this server is blocked from Salesforce.
  if (res.reason === 'unreachable' && res.cause) return `${m.salesforceErrors.unreachable} (${res.cause})`;
  if (res.reason) return m.salesforceErrors[res.reason];
  if (res.status === 403) return m.salesforceErrors.forbidden;
  return res.message ? `${m.connectError} (${res.message})` : m.connectError;
}
