'use client';

import { useEffect, useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { formatDate, formatDateTime, t, type FormsMessages, type Locale } from '@quill/shared';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
// Types only: the module itself is server-side (it reads the session cookie).
import type { AccountRole, ApiKey, CreatedApiKey } from '@/lib/admin-api';
import { callAction, isTransportError } from '@/lib/call-action';
import { exportKeyCommand } from '@/lib/developer-skill/agent-setup';
import { createApiKeyAction, revokeApiKeyAction } from './actions';
import { CodePanel } from './docs/code-panel';
import { API_KEY_NAME_MAX } from './limits';
import { SetupGuide } from './setup-guide';

type KeysMessages = FormsMessages['admin']['developers']['keys'];
type GuideMessages = FormsMessages['admin']['developers']['guide'];

/** What the setup guide above the list needs from the page: its copy and the skill download. */
export interface ApiKeysGuide {
  m: GuideMessages;
  skill: { available: boolean; href: string; button: string; unavailable: string };
}

/** The person looking at the page, as `/v1/me` describes them in this workspace. */
export interface ApiKeysViewer {
  memberId: string;
  role: AccountRole;
  displayName: string | null;
  email: string | null;
}

/**
 * The API keys of the MCP page: the setup guide, the list, the create dialog
 * and revoke. The guide lives in here so its "Create key" opens the same dialog
 * and its steps see the same list.
 *
 * What the list holds is the API's call: a member is sent their own keys, an
 * owner or admin every active key in the workspace. The page only decides how
 * much to SHOW, which is the "Created by" column for owners and admins.
 *
 * The full key exists on this page for one moment: between a successful create
 * and the dialog closing. It lives in the dialog's state alone (never in the
 * list, never in a toast), so closing the dialog any way at all drops it.
 */
export function ApiKeysPanel({
  initialKeys,
  loadError,
  viewer,
  m,
  locale,
  timeZone,
  guide,
}: {
  initialKeys: ApiKey[];
  loadError: boolean;
  viewer: ApiKeysViewer;
  m: KeysMessages;
  locale: Locale;
  timeZone: string;
  /** Left out, the panel is the list alone. */
  guide?: ApiKeysGuide;
}) {
  const [keys, setKeys] = useState(initialKeys);
  // A server refresh (the actions revalidate this route) hands down the list
  // the API now holds; it wins over the optimistic edits made here.
  useEffect(() => setKeys(initialKeys), [initialKeys]);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [, startRevoke] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const toast = useToast();
  const showCreator = viewer.role === 'owner' || viewer.role === 'admin';

  const onCreated = (created: CreatedApiKey) => {
    const row: ApiKey = {
      id: created.id,
      name: created.name,
      last4: created.last4,
      createdAt: created.createdAt,
      lastUsedAt: null,
      createdBy: { memberId: viewer.memberId, name: viewer.displayName, email: viewer.email },
    };
    setKeys((prev) => [row, ...prev.filter((k) => k.id !== row.id)]);
  };

  const revoke = (k: ApiKey) => {
    void confirm({
      title: m.revokeTitle,
      message: t(m.revokeConfirm, { name: k.name }),
      confirmLabel: m.revoke,
      cancelLabel: m.cancel,
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      setRevokingId(k.id);
      startRevoke(async () => {
        const res = await callAction(() => revokeApiKeyAction(k.id));
        // Only clear our own spinner: another revoke may have started meanwhile.
        setRevokingId((cur) => (cur === k.id ? null : cur));
        if (!isTransportError(res) && res.ok) {
          setKeys((prev) => prev.filter((row) => row.id !== k.id));
          toast.success(m.revokeSuccess);
          return;
        }
        const code = isTransportError(res) ? 'FAILED' : res.code;
        toast.error(
          code === 'FORBIDDEN' ? m.revokeErrorForbidden : code === 'GONE' ? m.revokeErrorGone : m.revokeErrorFailed,
        );
      });
    });
  };

  // Name | Key | Created | Last used | (Created by) | action. Only from `md`;
  // below it every row stacks, so a phone never scrolls sideways.
  const cols = showCreator
    ? 'md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.3fr)_auto]'
    : 'md:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]';

  // A failed list knows nothing, so the guide claims nothing from it either.
  const hasOwnKey = !loadError && keys.some((k) => k.createdBy.memberId === viewer.memberId);
  const agentConnected = !loadError && keys.some((k) => k.lastUsedAt != null);

  return (
    <>
      {guide ? (
        <SetupGuide
          m={guide.m}
          copy={{ copy: m.copy, copied: m.copied, copyFailed: m.copyFailed }}
          skill={guide.skill}
          createLabel={m.create}
          hasKey={hasOwnKey}
          agentConnected={agentConnected}
          onCreate={() => setCreating(true)}
        />
      ) : null}
      <section aria-labelledby="api-keys-title" className="mb-10" data-testid="api-keys">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 id="api-keys-title" className="text-lg font-semibold text-foreground">
              {m.title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{showCreator ? m.subtitleAdmin : m.subtitle}</p>
          </div>
          <Button data-testid="api-key-create" onClick={() => setCreating(true)} className="shrink-0">
            <i aria-hidden className="pi pi-plus" style={{ fontSize: 13 }} />
            {m.create}
          </Button>
        </div>

        {loadError ? (
          <p
            role="alert"
            data-testid="api-keys-error"
            className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-foreground"
          >
            {m.loadError}
          </p>
        ) : keys.length === 0 ? (
          <div
            data-testid="api-keys-empty"
            className="rounded-xl border border-dashed border-border bg-card/40 px-6 py-10 text-center"
          >
            <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <i aria-hidden className="pi pi-key" style={{ fontSize: 18 }} />
            </span>
            <p className="font-medium text-foreground">{m.emptyTitle}</p>
            <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">{m.emptyBody}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card">
            <div
              aria-hidden
              className={`hidden gap-4 border-b border-border px-4 py-3 text-xs font-medium uppercase tracking-wider text-faint md:grid ${cols}`}
            >
              <span>{m.colName}</span>
              <span>{m.colKey}</span>
              <span>{m.colCreated}</span>
              <span>{m.colLastUsed}</span>
              {showCreator ? <span>{m.colCreatedBy}</span> : null}
              <span className="sr-only">{m.colActions}</span>
            </div>
            <ul>
              {keys.map((k) => {
                const mine = k.createdBy.memberId === viewer.memberId;
                const creator = mine
                  ? m.you
                  : k.createdBy.name?.trim() || k.createdBy.email || m.unknownCreator;
                const busy = revokingId === k.id;
                return (
                  <li
                    key={k.id}
                    data-testid="api-key-row"
                    className={`flex flex-col gap-1.5 border-b border-border px-4 py-3.5 text-sm last:border-b-0 md:grid md:items-center md:gap-4 ${cols}`}
                  >
                    <span className="min-w-0 truncate font-medium text-foreground" title={k.name}>
                      {k.name}
                    </span>
                    <Cell label={m.colKey}>
                      <code
                        aria-label={t(m.maskedLabel, { last4: k.last4 })}
                        className="font-mono text-xs text-muted-foreground"
                      >
                        {t(m.masked, { last4: k.last4 })}
                      </code>
                    </Cell>
                    <Cell label={m.colCreated}>{formatDate(k.createdAt, { locale, timeZone })}</Cell>
                    <Cell label={m.colLastUsed} testId="api-key-last-used">
                      {k.lastUsedAt == null ? m.neverUsed : formatDateTime(k.lastUsedAt, { locale, timeZone })}
                    </Cell>
                    {showCreator ? (
                      <Cell label={m.colCreatedBy} testId="api-key-created-by">
                        <span className="truncate" title={k.createdBy.email ?? undefined}>
                          {creator}
                        </span>
                      </Cell>
                    ) : null}
                    <div className="pt-1 md:pt-0 md:text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid="api-key-revoke"
                        aria-label={t(m.revokeLabel, { name: k.name })}
                        disabled={busy}
                        onClick={() => revoke(k)}
                        className="-ml-3 text-destructive hover:bg-destructive/10 md:ml-0"
                      >
                        <i
                          aria-hidden
                          className={`pi ${busy ? 'pi-spinner pi-spin' : 'pi-trash'}`}
                          style={{ fontSize: 13 }}
                        />
                        {m.revoke}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <CreateKeyDialog open={creating} onClose={() => setCreating(false)} onCreated={onCreated} m={m} />
        {confirmDialog}
      </section>
    </>
  );
}

/** One value of a row. On a phone it carries its own label, since the header row is desktop only. */
function Cell({ label, testId, children }: { label: string; testId?: string; children: ReactNode }) {
  return (
    <span data-testid={testId} className="flex min-w-0 items-baseline gap-2 text-muted-foreground">
      <span className="shrink-0 text-xs text-faint md:sr-only">{label}</span>
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

type CreateError = 'INVALID' | 'KEY_LIMIT' | 'FORBIDDEN' | 'FAILED';

/**
 * Two steps in one dialog: name the key, then see it once. Unmounted while
 * closed, so every way of closing it (Done, Escape, the backdrop) throws the
 * key away with the rest of its state.
 */
function CreateKeyDialog({
  open,
  onClose,
  onCreated,
  m,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (key: CreatedApiKey) => void;
  m: KeysMessages;
}) {
  if (!open) return null;
  return <CreateKeyDialogBody onClose={onClose} onCreated={onCreated} m={m} />;
}

function CreateKeyDialogBody({
  onClose,
  onCreated,
  m,
}: {
  onClose: () => void;
  onCreated: (key: CreatedApiKey) => void;
  m: KeysMessages;
}) {
  const labelId = useId();
  const nameId = useId();
  const helpId = useId();
  const secretId = useId();
  const [name, setName] = useState('');
  const [error, setError] = useState<CreateError | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [pending, start] = useTransition();
  const secretRef = useRef<HTMLInputElement>(null);
  // While the create is in flight the dialog stays up (Esc and the backdrop
  // included): closing it then would create a key whose secret nobody sees.
  const close = () => {
    if (!pending) onClose();
  };

  useEffect(() => {
    if (secret) secretRef.current?.select();
  }, [secret]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    setError(null);
    start(async () => {
      const res = await callAction(() => createApiKeyAction(trimmed));
      if (isTransportError(res)) {
        setError('FAILED');
        return;
      }
      if (!res.ok) {
        setError(res.code);
        return;
      }
      onCreated(res.key);
      setSecret(res.key.key);
    });
  };

  const copySecret = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopy('copied');
    } catch {
      setCopy('failed');
      secretRef.current?.select();
    }
  };

  const errorText: Record<CreateError, string> = {
    INVALID: m.errorInvalid,
    KEY_LIMIT: m.errorLimit,
    FORBIDDEN: m.errorForbidden,
    FAILED: m.errorFailed,
  };

  if (secret) {
    return (
      <Modal open onClose={onClose} title={m.createdTitle} labelId={labelId}>
        <div className="mb-4 flex gap-3 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm text-foreground">
          <i aria-hidden className="pi pi-exclamation-triangle mt-0.5 shrink-0" style={{ fontSize: 15 }} />
          <p>{m.createdWarning}</p>
        </div>
        <label htmlFor={secretId} className="mb-1.5 block text-sm font-medium text-foreground">
          {m.keyLabel}
        </label>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
          <Input
            ref={secretRef}
            id={secretId}
            readOnly
            value={secret}
            data-testid="api-key-secret"
            spellCheck={false}
            autoComplete="off"
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 font-mono text-xs"
          />
          <Button variant="soft" data-testid="api-key-copy" onClick={() => void copySecret()} className="shrink-0">
            <i aria-hidden className={`pi ${copy === 'copied' ? 'pi-check' : 'pi-copy'}`} style={{ fontSize: 13 }} />
            {copy === 'copied' ? m.copied : m.copy}
          </Button>
        </div>
        <p aria-live="polite" className="mt-2 min-h-[1.25rem] text-xs text-destructive">
          {copy === 'failed' ? m.copyFailed : ''}
        </p>
        <p className="mb-2 mt-2 text-sm text-foreground">{m.createdNext}</p>
        <CodePanel
          label={m.exportLabel}
          code={exportKeyCommand(secret)}
          language="curl"
          copyLabel={m.copyExport}
          m={{ copy: m.copy, copied: m.copied, copyFailed: m.copyFailed }}
          testId="api-key-export"
        />
        <div className="mt-4 flex justify-end">
          <Button data-testid="api-key-done" onClick={onClose}>
            {m.done}
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={close} title={m.createTitle} labelId={labelId}>
      <form onSubmit={submit} noValidate>
        <label htmlFor={nameId} className="mb-1.5 block text-sm font-medium text-foreground">
          {m.nameLabel}
        </label>
        <Input
          id={nameId}
          value={name}
          maxLength={API_KEY_NAME_MAX}
          placeholder={m.namePlaceholder}
          aria-describedby={helpId}
          aria-invalid={error === 'INVALID' || undefined}
          autoComplete="off"
          data-testid="api-key-name"
          onChange={(e) => setName(e.target.value)}
        />
        <p id={helpId} className="mt-1.5 text-xs text-muted-foreground">
          {m.nameHelp}
        </p>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {errorText[error]}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="soft" onClick={onClose} disabled={pending}>
            {m.cancel}
          </Button>
          <Button type="submit" data-testid="api-key-create-submit" disabled={pending || !name.trim()}>
            {pending ? m.creating : m.createSubmit}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
