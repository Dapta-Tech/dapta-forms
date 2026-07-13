'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { BookingMessages } from '@slate/shared';
import type { Connection } from '@/lib/admin-api';
import { FieldHelp } from '@/components/field-help';
import {
  connectCalendarAction,
  createConnectionAction,
  deleteConnectionAction,
  discoverConnectionsAction,
  pingConnectionAction,
  toggleConnectionAction,
} from './actions';

type ConnectionsMessages = BookingMessages['admin']['connections'];

/** The end-provider kind for a stored provider slug (R15-safe: Google/Outlook
 *  are end-provider names). Single source of truth for icon + label branching. */
type ProviderKind = 'google' | 'outlook' | 'other';
function providerKind(provider: string): ProviderKind {
  const p = provider.toLowerCase();
  if (p.includes('google')) return 'google';
  if (p.includes('outlook') || p.includes('microsoft')) return 'outlook';
  return 'other';
}

/** End-provider mark (R15-safe: Google/Outlook are end-provider names). Generic
 *  calendar glyph for anything else. */
function ProviderIcon({ provider }: { provider: string }) {
  const kind = providerKind(provider);
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', 'aria-hidden': true } as const;
  if (kind === 'google') {
    return (
      <svg {...common}>
        <path fill="#4285F4" d="M21.6 12.2c0-.6-.05-1.2-.15-1.7H12v3.4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.2Z" />
        <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.7-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z" />
        <path fill="#FBBC05" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14Z" />
        <path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.4L6.4 10c.8-2.4 3-4.1 5.6-4.1Z" />
      </svg>
    );
  }
  if (kind === 'outlook') {
    return (
      <svg {...common}>
        <rect x="3" y="6" width="12" height="12" rx="2" fill="#0A6ED1" />
        <path fill="#fff" d="M9 9.2c1.6 0 2.6 1.2 2.6 2.9S10.6 15 9 15s-2.6-1.2-2.6-2.9S7.4 9.2 9 9.2Zm0 1.4c-.8 0-1.2.7-1.2 1.5s.4 1.5 1.2 1.5 1.2-.7 1.2-1.5-.4-1.5-1.2-1.5Z" />
        <path fill="#0A6ED1" d="M15 8.5 21 7v10l-6-1.5Z" />
      </svg>
    );
  }
  return (
    <svg {...common} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4.5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 2.5v4M16 2.5v4" />
    </svg>
  );
}

const PROVIDERS: Array<{ key: string; labelKey: 'providerGoogle' | 'providerOutlook' }> = [
  { key: 'google', labelKey: 'providerGoogle' },
  { key: 'outlook', labelKey: 'providerOutlook' },
];

/** Friendly end-provider name (R15-safe) for a stored provider slug. */
function providerLabel(provider: string, m: ConnectionsMessages): string {
  switch (providerKind(provider)) {
    case 'google':
      return m.providerGoogle;
    case 'outlook':
      return m.providerOutlook;
    default:
      return provider.charAt(0).toUpperCase() + provider.slice(1);
  }
}

/** Human label for a connection: account email first, else a readable manual
 *  calendar id; NEVER the opaque connection ref (an OAuth-discovered
 *  connection's externalId is an unreadable token). */
function connectionLabel(
  c: { primaryEmail: string | null; externalId: string; provider: string },
  m: ConnectionsMessages,
): string {
  if (c.primaryEmail) return c.primaryEmail;
  if (c.externalId.includes('@')) return c.externalId;
  return providerLabel(c.provider, m);
}

/**
 * The connect flow. Popup-blocker-safe: the popup is opened SYNCHRONOUSLY inside
 * the click gesture (to about:blank), then redirected to the minted connect URL
 * once the server responds — so Safari/Chrome never treat it as programmatic.
 * After the popup, we poll `discover` (server-side detection; no vendor SDK in
 * the browser — R15) until the new connection appears, then refresh.
 */
function ConnectDialog({
  open,
  onClose,
  enabled,
  baselineCount,
  m,
}: {
  open: boolean;
  onClose: () => void;
  enabled: boolean;
  baselineCount: number;
  m: ConnectionsMessages;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<'choose' | 'waiting'>('choose');
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeProvider = useRef<string>('google');

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
    popupRef.current = null;
    setStage('choose');
    setMsg(null);
    setErr(null);
  }, [stopPolling]);

  const finish = useCallback(
    (success: boolean) => {
      reset();
      onClose();
      if (success) router.refresh();
    },
    [reset, onClose, router],
  );

  // Poll for the just-connected account; success when the connection count grows.
  const checkForNew = useCallback(() => {
    void discoverConnectionsAction(activeProvider.current).then((r) => {
      if (r.ok && r.count > baselineCount) {
        setMsg(m.connectSuccess);
        finish(true);
      }
    });
  }, [baselineCount, finish, m.connectSuccess]);

  const beginConnect = (provider: string) => {
    setErr(null);
    activeProvider.current = provider;
    // Open the popup NOW, in the gesture, so it is not blocked.
    const popup = window.open('about:blank', 'slate-connect', 'width=520,height=720');
    if (!popup) {
      setErr(m.popupBlocked);
      return;
    }
    popupRef.current = popup;
    setStage('waiting');
    setMsg(m.connectHint);
    start(async () => {
      const r = await connectCalendarAction(provider);
      if (!r.enabled || !r.connectUrl) {
        if (!popup.closed) popup.close();
        setErr(r.message || m.connectFailed);
        setStage('choose');
        return;
      }
      popup.location.href = r.connectUrl;
      // Detect completion by polling the server (revalidated by the action).
      stopPolling();
      pollRef.current = setInterval(checkForNew, 2500);
    });
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && finish(false);
    window.addEventListener('keydown', onKey);
    // A refocus of our window is a strong signal the popup flow finished.
    const onFocus = () => {
      if (stage === 'waiting') checkForNew();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('focus', onFocus);
    };
  }, [open, stage, checkForNew, finish]);

  // Clean up timers/popup if the dialog unmounts.
  useEffect(() => () => reset(), [reset]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-hidden tabIndex={-1} onClick={() => finish(false)} className="absolute inset-0 bg-background/80" />
      <div role="dialog" aria-modal="true" aria-label={m.dialogTitle} className="relative w-full max-w-md rounded-xl border border-border bg-popover p-6 shadow-lg">
        <h2 className="mb-1 text-lg font-semibold">{m.dialogTitle}</h2>
        <p className="mb-4 text-sm text-muted-foreground">{m.dialogSubtitle}</p>

        {stage === 'choose' ? (
          <div className="flex flex-col gap-2">
            {PROVIDERS.map(({ key, labelKey }) => (
              <button
                key={key}
                type="button"
                disabled={pending}
                onClick={() => beginConnect(key)}
                className="flex items-center gap-3 rounded-md border border-border px-4 py-3 text-sm transition-colors hover:border-primary disabled:opacity-60"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                  <ProviderIcon provider={key} />
                </span>
                <span className="flex-1 text-left font-medium">{m[labelKey]}</span>
                <span aria-hidden className="text-muted-foreground">→</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-md border border-border bg-muted/30 p-5 text-center">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" aria-hidden />
            <span className="text-sm font-medium text-foreground">{m.connectWaiting}</span>
            <p className="text-sm text-muted-foreground">{msg ?? m.connectHint}</p>
            <button
              type="button"
              onClick={checkForNew}
              className="rounded-md border border-border px-4 py-2 text-sm hover:border-primary"
            >
              {m.connectDone}
            </button>
          </div>
        )}

        {err ? <p className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{err}</p> : null}

        {!enabled ? (
          <p className="mt-4 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
            {m.syncOffDesc} {m.syncOffSetPre}{' '}
            <code className="rounded-sm bg-background px-1">CALENDAR_PROVIDER=external</code> {m.syncOffSetPost}
          </p>
        ) : null}

        {/* Advanced: manual reference add, kept OUT of the list surface (R30). */}
        <div className="mt-5 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => setShowManual((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {showManual ? '▾' : '▸'} {m.manualTitle}
          </button>
          {showManual ? <ManualAddForm m={m} onAdded={() => finish(true)} /> : null}
        </div>

        <div className="mt-5 flex justify-end">
          <button type="button" onClick={() => finish(false)} className="rounded-md border border-border px-4 py-2 text-sm">
            {m.close}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Advanced manual-add: record a calendar reference by id (adapter/testing use). */
function ManualAddForm({ m, onAdded }: { m: ConnectionsMessages; onAdded: () => void }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="mt-3 flex flex-col gap-3"
      action={(form) =>
        start(async () => {
          const r = await createConnectionAction(null, form);
          if (r.ok) onAdded();
          else setErr(r.message ?? m.disconnectError);
        })
      }
    >
      <p className="text-xs text-muted-foreground">{m.manualDesc}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{m.provider}</span>
          <select name="provider" className="rounded-md border border-input bg-background px-3 py-2">
            <option value="google">google</option>
            <option value="outlook">outlook</option>
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{m.calendarId}</span>
          <input name="externalId" required className="rounded-md border border-input bg-background px-3 py-2" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="checkConflicts" defaultChecked /> {m.conflictCheck.toLowerCase()}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isDestination" /> {m.destination.toLowerCase()}
        </label>
        <button
          type="submit"
          disabled={pending}
          className="ml-auto rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground disabled:opacity-60"
        >
          {pending ? '…' : m.addConnection}
        </button>
      </div>
      {err ? <p className="text-sm text-destructive">{err}</p> : null}
    </form>
  );
}

/** Per-connection health: seeded from the PERSISTED last probe (so the badge
 *  is meaningful on first paint), refreshed silently on mount, re-checkable on
 *  click. Every probe also persists its outcome server-side (last-checked).
 *  When no provider is wired (OSS default) the record is stored but never synced
 *  — we say so plainly instead of showing a misleading green light. */
type Health = 'off' | 'checking' | 'ok' | 'error';

function HealthPill({ c, enabled, m }: { c: Connection; enabled: boolean; m: ConnectionsMessages }) {
  const [state, setState] = useState<Health>(
    !enabled ? 'off' : c.lastCheckOk == null ? 'checking' : c.lastCheckOk ? 'ok' : 'error',
  );
  const [detail, setDetail] = useState<string | null>(c.lastCheckDetail);
  const [lastCheckAt, setLastCheckAt] = useState<number | null>(c.lastCheckAt);
  const [pending, start] = useTransition();

  const probe = useCallback(
    (silent = false) => {
      if (!enabled) return;
      // Silent mount-refresh keeps the persisted state on screen instead of a
      // spinner flash; the explicit re-check click shows progress.
      if (!silent) setState('checking');
      start(async () => {
        try {
          const r = await pingConnectionAction(c.id);
          setDetail(r.message);
          setState(!r.enabled ? 'off' : r.ok ? 'ok' : 'error');
          setLastCheckAt(Date.now());
        } catch {
          // A thrown probe must not leave the pill spinning forever.
          setDetail(m.healthError);
          setState('error');
        }
      });
    },
    [enabled, c.id, m.healthError],
  );

  // Probe once when this row mounts (only when a provider is actually wired).
  // Silent when persisted health exists — the badge already shows real state.
  const ran = useRef(false);
  useEffect(() => {
    if (!enabled || ran.current) return;
    ran.current = true;
    probe(c.lastCheckOk != null);
  }, [enabled, probe, c.lastCheckOk]);

  const dot =
    state === 'ok'
      ? 'bg-primary'
      : state === 'error'
        ? 'bg-destructive'
        : state === 'checking'
          ? 'bg-muted-foreground/60'
          : 'bg-muted-foreground/40';
  const label =
    state === 'ok'
      ? m.healthOk
      : state === 'error'
        ? m.healthError
        : state === 'checking'
          ? m.healthChecking
          : m.healthRecorded;

  const checkedCaption = !enabled
    ? null
    : lastCheckAt
      ? m.lastChecked.replace(
          '{time}',
          new Intl.DateTimeFormat(undefined, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          }).format(new Date(lastCheckAt)),
        )
      : m.neverChecked;

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => probe()}
        disabled={!enabled || pending}
        title={detail ?? (enabled ? m.recheck : m.syncOffTitle)}
        // Detail is in the accessible name too, so screen-reader / touch users
        // get the reason without a hover-only tooltip.
        aria-label={`${label}${detail ? `: ${detail}` : ''}${enabled ? ` — ${m.recheck}` : ''}`}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors enabled:hover:border-primary disabled:cursor-default"
      >
        {state === 'checking' ? (
          <span className="h-2 w-2 animate-spin rounded-full border border-muted-foreground/40 border-t-primary" aria-hidden />
        ) : (
          <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
        )}
        <span>{label}</span>
      </button>
      {state === 'error' && detail ? (
        <span className="max-w-[220px] text-right text-[11px] leading-tight text-destructive">{detail}</span>
      ) : null}
      {checkedCaption ? (
        <span className="text-[11px] leading-tight text-muted-foreground">{checkedCaption}</span>
      ) : null}
    </span>
  );
}

function ConnectionRow({
  c,
  m,
  enabled,
  busy,
  error,
  onSetDestination,
  onToggleConflicts,
  onDisconnect,
}: {
  c: Connection;
  m: ConnectionsMessages;
  enabled: boolean;
  // True while any mutation on THIS row is in flight — disables every control
  // so a toggle and a disconnect (or two rapid toggles) can't race.
  busy: boolean;
  error: string | null;
  onSetDestination: (id: string) => void;
  onToggleConflicts: (id: string, value: boolean) => void;
  onDisconnect: (id: string) => void;
}) {
  return (
    <li
      className={`flex flex-col gap-4 rounded-lg border p-4 transition-colors ${
        c.isDestination ? 'border-primary/60 bg-primary/5' : 'border-border bg-card'
      }`}
    >
      {/* Identity + health + disconnect */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-background">
            <ProviderIcon provider={c.provider} />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium text-foreground">{connectionLabel(c, m)}</span>
              {c.isDestination ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  {m.destination}
                </span>
              ) : null}
            </span>
            <span className="truncate text-sm text-muted-foreground">{providerLabel(c.provider, m)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <HealthPill c={c} enabled={enabled} m={m} />
          <button
            type="button"
            disabled={busy}
            onClick={() => onDisconnect(c.id)}
            className="rounded-md border border-border px-3 py-1 text-sm text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-60"
          >
            {m.disconnect}
          </button>
        </div>
      </div>

      {/* Per-calendar controls: destination is radio-exclusive (R20), conflicts
          is an independent checkbox. Labels match the mission wording. */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-md border border-border bg-background/60 px-3 py-2.5 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="destination-calendar"
            className="accent-primary"
            checked={c.isDestination}
            disabled={busy}
            onChange={() => onSetDestination(c.id)}
          />
          <span className={c.isDestination ? 'font-medium text-foreground' : 'text-foreground'}>{m.addEventsHere}</span>
          <FieldHelp text={m.addEventsHereHelp} />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="accent-primary"
            checked={c.checkConflicts}
            disabled={busy}
            onChange={(e) => onToggleConflicts(c.id, e.target.checked)}
          />
          <span className="text-foreground">{m.checkForConflicts}</span>
          <FieldHelp text={m.checkForConflictsHelp} />
        </label>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </li>
  );
}

/** At-a-glance summary above the list: where events land + how many are
 *  conflict-checked. This is the "which is which" scan-line (mission #3). */
function SummaryStrip({ connections, m }: { connections: Connection[]; m: ConnectionsMessages }) {
  const destination = connections.find((c) => c.isDestination);
  const conflictCount = connections.filter((c) => c.checkConflicts).length;
  const conflictText =
    conflictCount === 0
      ? m.summaryConflictsNone
      : conflictCount === 1
        ? m.summaryConflictsOne
        : m.summaryConflictsMany.replace('{n}', String(conflictCount));

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm sm:flex-row sm:items-center sm:gap-6">
      <span className="flex items-center gap-2">
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-primary" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="4.5" />
          <circle cx="12" cy="12" r="0.5" fill="currentColor" />
        </svg>
        {destination ? (
          <span className="text-muted-foreground">
            {m.summaryDestination}{' '}
            <span className="font-medium text-foreground">{connectionLabel(destination, m)}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">{m.summaryNoDestination}</span>
        )}
      </span>
      <span className="flex items-center gap-2 text-muted-foreground">
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
        {conflictText}
      </span>
    </div>
  );
}

export interface ProviderStatus {
  enabled: boolean;
  message: string;
}

export function ConnectionsClient({
  connections,
  status,
  messages: m,
}: {
  connections: Connection[];
  status: ProviderStatus;
  messages: ConnectionsMessages;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  // Optimistic mirror of the server list so the destination radio and conflict
  // toggles respond instantly; the server action revalidates in the background
  // and re-seeds this state when the fresh props arrive.
  const [rows, setRows] = useState<Connection[]>(connections);
  // The row with a mutation in flight (disables that row's controls), plus its
  // error if the write failed. One-at-a-time per row prevents toggle/disconnect
  // and rapid-toggle races.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [, startToggle] = useTransition();
  // Don't clobber an in-flight optimistic toggle when an unrelated action
  // revalidates first; reseed from server only when nothing is pending.
  const pendingRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingRef.current) setRows(connections);
  }, [connections]);

  // Shared runner: optimistic update (if any) → server write → on failure roll
  // back and surface the reason. `prev` is captured from the committed rows.
  const run = useCallback(
    (
      id: string,
      optimistic: ((rs: Connection[]) => Connection[]) | null,
      call: () => Promise<{ ok: boolean; message?: string }>,
    ) => {
      const prev = rows;
      setRowError(null);
      pendingRef.current = id;
      setPendingId(id);
      if (optimistic) setRows(optimistic(prev));
      startToggle(async () => {
        const r = await call();
        if (!r.ok) {
          if (optimistic) setRows(prev);
          setRowError({ id, message: r.message ?? m.disconnectError });
        }
        pendingRef.current = null;
        setPendingId((cur) => (cur === id ? null : cur));
      });
    },
    [rows, m.disconnectError],
  );

  const setDestination = useCallback(
    // R20: exactly one destination — mirror the server's exclusive update.
    (id: string) =>
      run(
        id,
        (rs) => rs.map((r) => ({ ...r, isDestination: r.id === id })),
        () => toggleConnectionAction(id, { isDestination: true }),
      ),
    [run],
  );

  const toggleConflicts = useCallback(
    (id: string, value: boolean) =>
      run(
        id,
        (rs) => rs.map((r) => (r.id === id ? { ...r, checkConflicts: value } : r)),
        () => toggleConnectionAction(id, { checkConflicts: value }),
      ),
    [run],
  );

  // No optimistic removal: the row disappears on revalidation; on failure
  // (e.g. R20 last-destination guard) the row stays and shows the reason.
  const disconnect = useCallback((id: string) => run(id, null, () => deleteConnectionAction(id)), [run]);

  return (
    <div className="flex flex-col gap-5">
      {/* Header: honest sync status on the left, primary Connect at top-right
          (R30 list/create pattern — creation happens in the dialog surface). */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm">
          <span
            className={`flex h-2.5 w-2.5 rounded-full ${status.enabled ? 'bg-primary' : 'bg-muted-foreground/60'}`}
            aria-hidden
          />
          <span className="font-medium text-foreground">{status.enabled ? m.syncOnTitle : m.syncOffTitle}</span>
        </span>
        {/* One-CTA-per-screen (R30): with no rows the empty state below carries
            the single centered CTA — no top-right duplicate. */}
        {rows.length > 0 ? (
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
          >
            {m.connectAnother}
          </button>
        ) : null}
      </div>

      {rows.length > 0 ? (
        <>
          <SummaryStrip connections={rows} m={m} />
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold text-muted-foreground">{m.yourCalendars}</h2>
            <ul className="flex flex-col gap-2">
              {rows.map((c) => (
                <ConnectionRow
                  key={c.id}
                  c={c}
                  m={m}
                  enabled={status.enabled}
                  busy={pendingId === c.id}
                  error={rowError?.id === c.id ? rowError.message : null}
                  onSetDestination={setDestination}
                  onToggleConflicts={toggleConflicts}
                  onDisconnect={disconnect}
                />
              ))}
            </ul>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border p-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/60">
            <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground" aria-hidden>
              <rect x="3" y="4.5" width="18" height="16" rx="2" />
              <path d="M3 9h18M8 2.5v4M16 2.5v4M12 13v4M10 15h4" />
            </svg>
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-base font-semibold text-foreground">{m.emptyTitle}</p>
            <p className="mx-auto max-w-sm text-sm text-muted-foreground">{m.emptyBody}</p>
          </div>
          <ul className="mx-auto flex max-w-sm flex-col gap-2 text-left text-sm text-muted-foreground">
            {[m.emptyConflicts, m.emptyDestination].map((t) => (
              <li key={t} className="flex items-start gap-2">
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-primary" aria-hidden>
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <span>{t}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="mt-1 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
          >
            {m.connectButton}
          </button>
        </div>
      )}

      <ConnectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        enabled={status.enabled}
        baselineCount={rows.length}
        m={m}
      />
    </div>
  );
}
