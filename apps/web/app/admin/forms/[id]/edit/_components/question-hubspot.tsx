'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { FormDestination } from '@quill/types';
import { Button, buttonVariants } from '@/components/ui/button';
import { Select, type SelectOption } from '@/components/ui/select';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';
import { TextField } from './fields';
import { bookingFieldsFor, contactKeyReadiness, type FormConfig, type FormStep } from '@quill/engine';
import { getMessages, type Locale } from '@quill/shared';
import { propertiesFor } from '@quill/types';
import { bookingLabel } from '@/lib/booking-fields';
import { loadConnectIntegrationsAction, type ConnectIntegrationsData } from './connect-actions';
import { saveQuestionMappingAction } from './question-hubspot-actions';
import type { BuilderMessages } from './builder-messages';
import { callAction, isTransportError } from '@/lib/call-action';

/**
 * QuestionHubspotSection — the Build tab's per-question "HubSpot / Map to"
 * block (Typeform parity): pick the contact property this answer writes to,
 * saved immediately against the LIVE config's hubspot destination (the same
 * single source of truth the Connect tab's "Map questions" list edits).
 *
 * A SCHEDULER step is the exception, and it gets a LIST instead of one picker.
 * Its answer is a booking, and a booking is several facts under several keys:
 * the meeting time under the step's own key, the invitee's name and phone under
 * {@link bookingFieldsFor}'s. A single unlabelled picker bound only the first of
 * those and never said which — an author could map "the booking" without ever
 * learning the value behind it is a timestamp, while the invitee's details were
 * reachable only from the Connect screen. Same rows, same labels, same keys as
 * Connect: the two screens read from `bookingFieldsFor` so they cannot drift.
 *
 * States:
 *  - account connected + enabled hubspot destination → searchable property
 *    picker with a "None" unmap row; picking saves optimistically via the
 *    destinations server action (flash on success, rollback + toast on error);
 *  - connected but the form has no enabled hubspot destination → hint + a
 *    button that switches the editor to the Connect tab;
 *  - no account connection at all → hint linking /admin/integrations.
 */

type HubspotMessages = BuilderMessages['hubspot'];
type HubspotDest = Extract<FormDestination, { type: 'hubspot' }>;
type LoadResult = Awaited<ReturnType<typeof loadConnectIntegrationsAction>>;

/**
 * Editor-level cache, module-scoped and keyed by form id: the section fetches
 * once per form (via the Connect tab's `loadConnectIntegrationsAction` — no
 * duplicated composition) and switching questions re-reads the cached result.
 * The editor drops the entry when the Connect tab activates (mappings can
 * change there), and a successful inline save refreshes it with the server's
 * confirmed destinations. Failures are never cached, so a remount retries.
 */
const cache = new Map<string, Promise<LoadResult>>();

export function invalidateQuestionHubspotCache(formId: string): void {
  cache.delete(formId);
}

function loadCached(formId: string, locale: string): Promise<LoadResult> {
  const hit = cache.get(formId);
  if (hit) return hit;
  const p: Promise<LoadResult> = loadConnectIntegrationsAction(formId, locale)
    .then((res) => {
      if (!res.ok) cache.delete(formId);
      return res;
    })
    .catch(() => {
      cache.delete(formId);
      return { ok: false as const, message: '' };
    });
  cache.set(formId, p);
  return p;
}

function cacheData(formId: string, data: ConnectIntegrationsData): void {
  cache.set(formId, Promise.resolve({ ok: true, data }));
}

const hubspotOf = (destinations: FormDestination[]): HubspotDest | undefined =>
  destinations.find((d): d is HubspotDest => d.type === 'hubspot');

/** Rebuild the loaded data with one question's mapping changed (empty unmaps). */
function withMapping(
  data: ConnectIntegrationsData,
  stepKey: string,
  property: string,
): ConnectIntegrationsData {
  return {
    ...data,
    destinations: data.destinations.map((d) => {
      if (d.type !== 'hubspot') return d;
      const fieldMappings = { ...(d.fieldMappings ?? {}) };
      // This panel edits ONE property — the first. A mapping that fans out to
      // several is authored in Connect, and clearing the field here must not
      // silently drop the others, so the tail is preserved either way.
      const rest = propertiesFor(fieldMappings[stepKey]).slice(1);
      const next = property ? [property, ...rest] : rest;
      if (next.length > 1) fieldMappings[stepKey] = next;
      else if (next.length === 1) fieldMappings[stepKey] = next[0]!;
      else delete fieldMappings[stepKey];
      return { ...d, fieldMappings };
    }),
  };
}

type SectionState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: ConnectIntegrationsData };

export function QuestionHubspotSection({
  formId,
  stepKey,
  steps,
  locale,
  onOpenConnect,
  m,
}: {
  formId: string;
  /** The selected question's answer key — the `fieldMappings` entry it owns. */
  stepKey: string;
  /** The form's steps, to answer "can this form key a contact at all?" here —
   *  an author who never opens Connect would otherwise map properties on a form
   *  that can never sync, and nothing would say so. */
  steps: FormStep[];
  locale: string;
  /** Switch the editor to the Connect tab (destination setup lives there). */
  onOpenConnect: () => void;
  m: HubspotMessages;
}) {
  const { error: toastError } = useToast();
  const [state, setState] = useState<SectionState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // Which mapping KEY is mid-save / just saved, not a bare boolean: a scheduler
  // renders five rows and each saves on its own, so the indicator has to name
  // the row it belongs to or it lights up on all of them at once.
  const [saving, setSaving] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Monotonic save id PER KEY — only the LATEST pick's response applies. */
  const saveSeq = useRef(new Map<string, number>());

  useEffect(() => {
    let cancelled = false;
    // Keep showing ready data while a retry refetches; skeleton only when empty.
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    void loadCached(formId, locale).then((res) => {
      if (cancelled) return;
      setState(res.ok ? { status: 'ready', data: res.data } : { status: 'error' });
    });
    return () => {
      cancelled = true;
    };
  }, [formId, locale, attempt]);

  // Transient indicators belong to the question that triggered them.
  useEffect(() => {
    setSaving(null);
    setFlash(null);
  }, [stepKey]);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const properties =
    state.status === 'ready' && state.data.hubspot.enabled ? state.data.hubspot.properties : [];
  const options = useMemo<SelectOption[]>(
    () => [
      { value: '', label: m.none },
      ...properties.map((p) => ({
        value: p.name,
        label: `${p.label} (${p.name})`,
      })),
    ],
    [properties, m.none],
  );
  // `email` is off the table on a booking's rows: the booking IS what supplies
  // the contact key, and pointing any field at that property takes the role over
  // and stops the sync. It can never be what the author meant, so it is not
  // offered rather than warned about once the leads have stopped arriving.
  const bookingOptions = useMemo<SelectOption[]>(
    () => options.filter((o) => o.value.trim().toLowerCase() !== 'email'),
    [options],
  );
  // Booking row labels come from the SHARED catalog — the same strings Connect
  // prints, so neither screen can rename a row the other still calls by its old
  // name.
  const im = useMemo(() => {
    const loc: Locale = locale === 'es' ? 'es' : 'en';
    return getMessages(loc).admin.integrations;
  }, [locale]);

  function retry() {
    invalidateQuestionHubspotCache(formId);
    setAttempt((n) => n + 1);
  }

  /** Bind ONE mapping key to a property (empty unmaps). `key` is the question's
   *  own step key, or one of the booking's keys on a scheduler. */
  function save(key: string, nextValue: string) {
    if (state.status !== 'ready') return;
    const before = state.data;
    const dest = hubspotOf(before.destinations);
    if (!dest) return;
    if ((propertiesFor(dest.fieldMappings?.[key])[0] ?? '') === nextValue) return;

    // Optimistic: show the pick immediately; roll back if the save fails.
    const optimistic = withMapping(before, key, nextValue);
    setState({ status: 'ready', data: optimistic });
    setSaving(key);
    setFlash(null);
    if (flashTimer.current) clearTimeout(flashTimer.current);

    const seq = (saveSeq.current.get(key) ?? 0) + 1;
    saveSeq.current.set(key, seq);
    void callAction(() => saveQuestionMappingAction(formId, key, nextValue || null))
      .then((res) => {
        if (seq !== saveSeq.current.get(key)) return; // superseded by a newer pick
        setSaving((k) => (k === key ? null : k));
        if (isTransportError(res)) {
          setState({ status: 'ready', data: before });
          toastError(m.saveError);
          return;
        }
        if (res.ok) {
          const confirmed: ConnectIntegrationsData = {
            ...optimistic,
            destinations: res.destinations,
          };
          setState({ status: 'ready', data: confirmed });
          cacheData(formId, confirmed);
          setFlash(key);
          flashTimer.current = setTimeout(() => setFlash((k) => (k === key ? null : k)), 2500);
        } else if (res.code === 'no_destination') {
          // Destination disabled/removed since load — resync to the CTA state.
          toastError(m.saveError);
          retry();
        } else {
          setState({ status: 'ready', data: before });
          toastError(res.message || m.saveError);
        }
      })
      .catch(() => {
        if (seq !== saveSeq.current.get(key)) return;
        setSaving((k) => (k === key ? null : k));
        setState({ status: 'ready', data: before });
        toastError(m.saveError);
      });
  }

  function body() {
    if (state.status === 'loading') {
      return <div aria-hidden className="h-9 animate-pulse rounded-md bg-muted" />;
    }
    if (state.status === 'error') {
      return (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-xs text-muted-foreground">
            {m.loadError}
          </p>
          <Button variant="outline" size="sm" onClick={retry}>
            <i aria-hidden className="pi pi-refresh" style={{ fontSize: 11 }} />
            {m.retry}
          </Button>
        </div>
      );
    }
    const data = state.data;
    // Can this form key a contact AT ALL? Config plus connections, the same
    // answer Connect shows — because an author can map every property from the
    // Build tab, publish, and never open Connect. Without this the mapping
    // looks finished and syncs nothing.
    const readiness = contactKeyReadiness({ version: 1, steps } as unknown as FormConfig, {
      scheduler: data.calendlyConnected,
    });
    if (!readiness.ok) {
      return (
        <div className="flex flex-col items-start gap-2" data-testid="qs-hubspot-unready">
          <p role="alert" className="text-xs text-muted-foreground">
            {readiness.blocker === 'no_source' ? m.needsEmail : m.schedulerDisconnected}
          </p>
          <Link
            href="/admin/integrations"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            {m.goToConnections}
            <i aria-hidden className="pi pi-arrow-right" style={{ fontSize: 11 }} />
          </Link>
        </div>
      );
    }
    // Usable when the account is connected OR the property picker resolved via
    // the server env fallback (self-host) — mirrors the integrations editor.
    if (!data.hubspotConnected && !data.hubspot.enabled) {
      return (
        <div className="flex flex-col items-start gap-2">
          <p className="text-xs text-muted-foreground">{m.notConnected}</p>
          <Link
            href="/admin/integrations"
            data-testid="qs-hubspot-connect-account"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            {m.goToConnections}
            <i aria-hidden className="pi pi-arrow-right" style={{ fontSize: 11 }} />
          </Link>
        </div>
      );
    }
    const dest = hubspotOf(data.destinations);
    if (!dest?.enabled) {
      return (
        <div className="flex flex-col items-start gap-2">
          <p className="text-xs text-muted-foreground">{m.notEnabled}</p>
          <Button
            data-testid="qs-hubspot-connect-cta"
            variant="outline"
            size="sm"
            onClick={onOpenConnect}
          >
            {m.configureInConnect}
            <i aria-hidden className="pi pi-arrow-right" style={{ fontSize: 11 }} />
          </Button>
        </div>
      );
    }
    /** The property a mapping key is bound to right now — the first of a fan-out. */
    const bound = (key: string) => propertiesFor(dest.fieldMappings?.[key])[0] ?? '';

    // A SCHEDULER answers with a BOOKING, which is several facts under several
    // keys — so it maps a list, not a value. The invitee rows appear only when
    // the booking is also what keys the contact: with an email question present
    // the adapter resolves the address itself, the booking-time enrichment never
    // runs, and those keys would stay empty forever. Same rule the Connect screen
    // applies to its system-key list.
    if (steps.find((s) => s.key === stepKey)?.type === 'scheduler') {
      const bookingKeysContact = readiness.source.kind === 'scheduler';
      const rows = bookingFieldsFor(stepKey).filter(
        (f) => f.kind === 'start_time' || bookingKeysContact,
      );
      return (
        <div data-testid="qs-hubspot-booking" className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">{m.bookingIntro}</p>
          {rows.map((f) => (
            <MappingRow
              key={f.key}
              testId={`qs-hubspot-booking-${f.kind}`}
              label={bookingLabel(f.kind, im)}
              // Only the meeting time needs explaining: it rides through as text,
              // exactly as the booking reported it, so a HubSpot `date` property
              // would reject it. The typed one is Connect's booking sync.
              hint={f.kind === 'start_time' ? m.bookingStartHint : undefined}
              value={bound(f.key)}
              options={bookingOptions}
              pickerReady={data.hubspot.enabled}
              locale={locale}
              saving={saving === f.key}
              saved={flash === f.key}
              m={m}
              onSave={(v) => save(f.key, v)}
            />
          ))}
          {/* Only true while the BOOKING is the contact key. With an email
              question present that question keys the contact, the invitee rows
              are gone above, and this note would name the wrong source. */}
          {bookingKeysContact ? (
            <p className="text-xs text-muted-foreground">{m.bookingEmailNote}</p>
          ) : null}
        </div>
      );
    }

    return (
      <MappingRow
        testId="qs-hubspot-mapto"
        label={m.mapTo}
        hint={m.mapToHint}
        value={bound(stepKey)}
        options={options}
        pickerReady={data.hubspot.enabled}
        locale={locale}
        saving={saving === stepKey}
        saved={flash === stepKey}
        m={m}
        onSave={(v) => save(stepKey, v)}
      />
    );
  }

  return (
    <section
      data-testid="qs-hubspot-section"
      className="flex flex-col gap-3 border-t border-border pt-4"
    >
      <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">
        <i aria-hidden className="pi pi-link text-secondary" style={{ fontSize: 11 }} />
        {m.title}
      </p>
      {body()}
    </section>
  );
}

/**
 * One "this value → that contact property" row, with its own save indicator.
 *
 * Shared by the ordinary one-answer case and every row of a scheduler's booking
 * list, so a five-row panel cannot drift from the single-picker one in layout,
 * ARIA, or how a failed lookup degrades.
 */
function MappingRow({
  label,
  hint,
  value,
  options,
  /** False when the property lookup failed — degrades to a free-text name. */
  pickerReady,
  locale,
  saving,
  saved,
  m,
  onSave,
  testId,
}: {
  label: string;
  hint?: string;
  value: string;
  options: SelectOption[];
  pickerReady: boolean;
  locale: string;
  saving: boolean;
  saved: boolean;
  m: HubspotMessages;
  onSave: (value: string) => void;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium text-foreground">{label}</label>
        <span
          aria-live="polite"
          className={cn('text-xs', saved ? 'text-primary' : 'text-muted-foreground')}
        >
          {saving ? m.saving : saved ? <span data-testid="qs-hubspot-saved">{m.saved}</span> : null}
        </span>
      </div>
      {pickerReady ? (
        <Select
          ariaLabel={label}
          value={value}
          onChange={onSave}
          options={options}
          // A mapped property missing from the list still shows its raw name.
          placeholder={value}
          searchable
          locale={locale}
        />
      ) : (
        // Picker unavailable (properties lookup failed) but the account is
        // connected: free-text property name, committed on blur/Enter —
        // mirrors the integrations editor's fallback input.
        <FreeTextMapping value={value} ariaLabel={label} onCommit={onSave} />
      )}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function FreeTextMapping({
  value,
  ariaLabel,
  onCommit,
}: {
  value: string;
  ariaLabel: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // Resync when a save (or a question switch) changes the bound value.
  useEffect(() => setDraft(value), [value]);
  return (
    <TextField
      value={draft}
      aria-label={ariaLabel}
      autoComplete="off"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft.trim() !== value) onCommit(draft.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}
