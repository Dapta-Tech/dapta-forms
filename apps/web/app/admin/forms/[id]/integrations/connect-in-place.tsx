'use client';

import type React from 'react';
import type { FormsMessages } from '@quill/shared';

type Msgs = FormsMessages['admin']['integrations'];
type ConnectionMsgs = FormsMessages['admin']['connections'];

/** Who is looking, and whether this deployment can store a credential at all. */
export interface ConnectAccess {
  /** Owners and admins. The API refuses a connect from anyone else with a 403. */
  canConnect: boolean;
  /** The server has `FORMS_ENCRYPTION_KEY`; without it nothing can be stored. */
  encryptionAvailable: boolean;
}

/** Until the tab has said otherwise: offer the control, the API is the real gate. */
export const DEFAULT_CONNECT_ACCESS: ConnectAccess = { canConnect: true, encryptionAvailable: true };

const fill = (template: string, vars: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);

/**
 * What a card on a form's Connect tab shows while its provider is not
 * connected: a title, one sentence, and the control that connects it right
 * here, so nobody has to leave the form they are wiring up.
 *
 * Who is looking decides the control. Only owners and admins can connect an
 * account (the API refuses anyone else), so a member gets a sentence saying
 * an admin has to, and no button that could only fail. A deployment with no
 * encryption key cannot store a credential for anyone, and says that instead.
 */
export function ConnectInPlace({
  provider,
  title,
  body,
  access,
  m,
  cm,
  testId,
  children,
}: {
  /** The provider's display name, for the admin-only sentence. */
  provider: string;
  title: string;
  body: string;
  access: ConnectAccess;
  m: Msgs;
  cm: ConnectionMsgs;
  testId: string;
  /** The connect control itself (a button or a form). */
  children: React.ReactNode;
}) {
  const blocked = !access.encryptionAvailable ? 'encryption' : !access.canConnect ? 'role' : null;
  return (
    <div
      data-testid={testId}
      data-blocked={blocked ?? undefined}
      className="rounded-lg border border-dashed border-border bg-muted/40 p-4"
    >
      <p className="text-sm font-medium text-foreground">{title}</p>
      {blocked === 'encryption' ? (
        <>
          <p className="mt-1 text-sm text-muted-foreground">{cm.encryptionOff}</p>
          <p className="mt-1 text-xs text-muted-foreground">{cm.encryptionOffBody}</p>
        </>
      ) : blocked === 'role' ? (
        <p className="mt-1 text-sm text-muted-foreground" data-testid="connect-admin-only">
          {fill(m.connectAdminOnly, { provider })}
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">{body}</p>
          <div className="mt-4">{children}</div>
        </>
      )}
    </div>
  );
}
