'use client';

import { useEffect, useId, useState } from 'react';
import { formatDateTime, type FormsMessages, type Locale } from '@quill/shared';
import { useWorkspaceTimeZone } from '@/components/workspace-timezone';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/modal';
import { cn } from '@/lib/cn';
import { callAction, isTransportError } from '@/lib/call-action';
import { WEBHOOK_PING_ACTION } from '@quill/types';
import type { DeliveryKind, DeliveryStatus, FormDelivery } from '@/lib/admin-api';
import { loadDeliveryHistoryAction } from './actions';

type Msgs = FormsMessages['admin']['integrations'];

/** `{n}`-style interpolation, same shape the rest of this screen uses. */
const fill = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

/** A delivery that ended without landing — what the summary chip counts. */
export const isFailure = (d: FormDelivery): boolean =>
  d.status === 'failed' || d.status === 'skipped';

export type HistoryState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; items: FormDelivery[] };

/**
 * One integration's delivery log, reachable from the card that configures it.
 *
 * This used to be a flat list of failures sitting loose in the Connect tab,
 * under every card and mixing all four kinds. It answered "something is broken"
 * without answering "which of these three integrations", and half a dozen
 * retries of one dead webhook pushed Tracking and Emails off the screen.
 *
 * The log now belongs to its card — but it does not live INSIDE it. A card is a
 * settings form, and twenty-five rows of delivery history in the middle of one
 * buries the endpoint URL the reader came for. So the card carries a single
 * line: a count, red when something failed, and a button. The log itself opens
 * in a dialog, where a long list is free to be long and scrolls on its own.
 */
export function DeliveryHistory({
  formId,
  kinds,
  title,
  locale,
  m,
  testId,
}: {
  formId: string;
  /** Which outbox kinds this card is responsible for. */
  kinds: DeliveryKind[];
  title: string;
  locale: Locale;
  m: Msgs;
  testId: string;
}) {
  const [state, setState] = useState<HistoryState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    // Through `callAction`: a bare invocation rejects when the call never
    // reaches the server — a dropped network, or a deploy rotating the compiled
    // action ids while this tab sits open. Unguarded, that rejection skips the
    // state update and the panel stays on its skeleton forever.
    callAction(() => loadDeliveryHistoryAction(formId, kinds))
      .then((res) => {
        if (cancelled) return;
        // A transport failure is retryable and Refresh is right there, so it
        // reads as an error rather than as "this form has no deliveries" — a
        // claim that would be worse than saying nothing.
        setState(isTransportError(res) ? { status: 'error' } : { status: 'ready', items: res });
      })
      .catch(() => {
        // A diagnostic panel must never break the thing it diagnoses.
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
    // `kinds` is a module constant at every call site; joining it keeps a fresh
    // array identity per render from re-firing the fetch forever.
  }, [formId, kinds.join(','), attempt]);

  return (
    <DeliveryHistoryView
      state={state}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      onRefresh={() => setAttempt((n) => n + 1)}
      title={title}
      locale={locale}
      m={m}
      testId={testId}
    />
  );
}

/**
 * The rendered half, with no data-fetching of its own — which is what makes
 * every state below reachable from a test.
 */
export function DeliveryHistoryView({
  state,
  open,
  onOpen,
  onClose,
  onRefresh,
  title,
  locale,
  m,
  testId,
}: {
  state: HistoryState;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onRefresh: () => void;
  title: string;
  locale: Locale;
  m: Msgs;
  testId: string;
}) {
  const labelId = useId();
  const items = state.status === 'ready' ? state.items : [];
  const failures = items.filter(isFailure).length;

  return (
    <div
      data-testid={testId}
      data-open={open}
      data-failures={failures}
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2.5"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{title}</span>
        {/* The card's only permanent signal that something is wrong. There is no
            badge for a healthy log: the count alone would read as an alert. */}
        {failures > 0 ? (
          <span
            data-testid={`${testId}-failed-chip`}
            className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
          >
            <i aria-hidden className="pi pi-exclamation-triangle" style={{ fontSize: 11 }} />
            {fill(m.historyFailedCount, { n: failures })}
          </span>
        ) : items.length > 0 ? (
          <span
            data-testid={`${testId}-count-chip`}
            className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
          >
            {fill(m.historyCount, { n: items.length })}
          </span>
        ) : null}
      </div>
      <Button
        variant="outline"
        size="sm"
        data-testid={`${testId}-open`}
        onClick={onOpen}
        disabled={state.status === 'loading'}
      >
        <i aria-hidden className="pi pi-history" style={{ fontSize: 12 }} />
        {m.historyOpen}
      </Button>

      <Modal open={open} onClose={onClose} title={title} labelId={labelId} size="xl">
        <div data-testid={`${testId}-dialog`} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-xs text-muted-foreground">{m.historyHelp}</p>
            <Button
              variant="outline"
              size="sm"
              data-testid={`${testId}-refresh`}
              disabled={state.status === 'loading'}
              onClick={onRefresh}
            >
              <i aria-hidden className="pi pi-refresh" style={{ fontSize: 12 }} />
              {m.historyRefresh}
            </Button>
          </div>

          {/* The reason this is a dialog at all: the list scrolls INSIDE the
              panel, so twenty-five rows cannot push anything else around. */}
          <div className="max-h-[55vh] overflow-y-auto">
            {state.status === 'loading' ? (
              <div aria-hidden className="flex flex-col gap-2">
                <div className="h-12 animate-pulse rounded-md border border-border bg-muted" />
                <div className="h-12 animate-pulse rounded-md border border-border bg-muted" />
              </div>
            ) : state.status === 'error' ? (
              <p className="text-xs text-muted-foreground" role="alert">
                {m.historyLoadError}
              </p>
            ) : items.length === 0 ? (
              <p className="text-xs text-muted-foreground">{m.historyEmpty}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {items.map((d) => (
                  <DeliveryRow key={d.id} delivery={d} locale={locale} m={m} />
                ))}
              </ul>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            <i aria-hidden className="pi pi-info-circle" style={{ fontSize: 11 }} />{' '}
            {m.historyPingNote}
          </p>

          {/* Esc and the backdrop close it too; this is the discoverable way. */}
          <div className="flex justify-end">
            <Button variant="outline" size="sm" data-testid={`${testId}-close`} onClick={onClose}>
              {m.historyClose}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** Status pill styling. `pending` is progress, not a problem — never red. */
const STATUS_CHIP: Record<DeliveryStatus, string> = {
  done: 'bg-primary/20 text-foreground',
  pending: 'bg-secondary/20 text-foreground',
  failed: 'border border-destructive/40 bg-destructive/10 text-destructive',
  skipped: 'bg-muted text-muted-foreground',
};

function statusLabel(status: DeliveryStatus, m: Msgs): string {
  switch (status) {
    case 'done':
      return m.historyDelivered;
    case 'pending':
      return m.historyRetrying;
    case 'failed':
      return m.historyFailed;
    case 'skipped':
      return m.historySkipped;
  }
}

/** Pretty-print a JSON body; anything unparseable is shown exactly as sent. */
function formatBody(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function DeliveryRow({
  delivery: d,
  locale,
  m,
}: {
  delivery: FormDelivery;
  locale: Locale;
  m: Msgs;
}) {
  const timeZone = useWorkspaceTimeZone();
  const [open, setOpen] = useState(false);
  const failed = isFailure(d);
  const isTest = d.action === WEBHOOK_PING_ACTION;
  // NULL is "not recorded", never "empty" — an older row, or a kind whose
  // adapter reports no single request. Saying so is the honest render; showing
  // an empty code block would read as "we sent nothing".
  const recorded = d.requestBody !== null || d.responseStatus !== null || d.responseBody !== null;

  return (
    <li
      data-testid="delivery-row"
      data-status={d.status}
      data-action={d.action}
      className={cn(
        'rounded-md border',
        failed ? 'border-destructive/40 bg-destructive/10' : 'border-border bg-background/40',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        disabled={!recorded}
        className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {recorded ? (
            <i
              aria-hidden
              className={`pi ${open ? 'pi-chevron-down' : 'pi-chevron-right'} text-muted-foreground`}
              style={{ fontSize: 10 }}
            />
          ) : null}
          <span
            className={cn(
              'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
              STATUS_CHIP[d.status],
            )}
          >
            {statusLabel(d.status, m)}
          </span>
          {/* A test delivery is a REAL signed POST to the real endpoint, so it
              belongs in the log — but it answers "did my endpoint accept this",
              not "did a respondent's lead arrive". Mislabelling it would send
              someone hunting for a submission that never happened. */}
          {isTest ? (
            <span
              data-testid="delivery-test-badge"
              className="inline-flex shrink-0 items-center rounded-full bg-secondary/20 px-2 py-0.5 text-[11px] font-medium text-foreground"
            >
              {m.historyTestBadge}
            </span>
          ) : (
            /* The queue's own action name. It is a stable identifier rather than
               copy, and inventing a label per action would go stale the moment a
               new one is enqueued. */
            <span className="truncate font-mono text-[11px] text-muted-foreground">{d.action}</span>
          )}
          {d.responseStatus !== null ? (
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
              HTTP {d.responseStatus}
            </span>
          ) : null}
          {d.attempts > 1 ? (
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {fill(m.historyAttempts, { n: d.attempts })}
            </span>
          ) : null}
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {formatDateTime(d.updatedAt, { locale, timeZone })}
        </span>
      </button>

      {/* The worker's own reason, verbatim. Paraphrasing it here would lose the
          one detail that says what to fix. */}
      {failed ? (
        <p className="px-3 pb-2 text-[11px] leading-relaxed text-muted-foreground">
          {d.lastError ?? m.historyNoReason}
        </p>
      ) : null}

      {open && recorded ? (
        <div className="flex flex-col gap-2 border-t border-border/60 px-3 py-2">
          <BodyBlock label={m.historyRequest} body={d.requestBody} empty={m.historyBodyNotRecorded} />
          <BodyBlock
            label={
              d.responseStatus !== null
                ? `${m.historyResponse} · HTTP ${d.responseStatus}`
                : m.historyResponse
            }
            body={d.responseBody}
            empty={d.responseStatus !== null ? m.historyBodyEmpty : m.historyBodyNotRecorded}
          />
        </div>
      ) : null}
    </li>
  );
}

/** One half of the transcript. Scrolls on its own — a payload can be long. */
function BodyBlock({
  label,
  body,
  empty,
}: {
  label: string;
  body: string | null;
  empty: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-medium text-foreground">{label}</span>
      {body ? (
        <pre className="max-h-56 overflow-auto rounded-md border border-border bg-background/60 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {formatBody(body)}
        </pre>
      ) : (
        <span className="text-[11px] italic text-muted-foreground">{empty}</span>
      )}
    </div>
  );
}
