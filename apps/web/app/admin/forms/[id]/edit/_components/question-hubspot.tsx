'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { FormDestination } from '@quill/types';
import { Button, buttonVariants } from '@/components/ui/button';
import { Select, type SelectOption } from '@/components/ui/select';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';
import { TextField } from './fields';
import { contactKeyReadiness, type FormConfig, type FormStep } from '@quill/engine';
import { loadConnectIntegrationsAction, type ConnectIntegrationsData } from './connect-actions';
import { saveQuestionMappingAction } from './question-hubspot-actions';
import type { BuilderMessages } from './builder-messages';

/**
 * QuestionHubspotSection — the Build tab's per-question "HubSpot / Map to"
 * block (Typeform parity): pick the contact property this answer writes to,
 * saved immediately against the LIVE config's hubspot destination (the same
 * single source of truth the Connect tab's "Map questions" list edits).
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
      if (property) fieldMappings[stepKey] = property;
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
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Monotonic save id — only the LATEST pick's response applies (rapid rebinds). */
  const saveSeq = useRef(0);

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
    setSaving(false);
    setFlash(false);
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
      ...properties.map((p) => ({ value: p.name, label: `${p.label} (${p.name})` })),
    ],
    [properties, m.none],
  );

  function retry() {
    invalidateQuestionHubspotCache(formId);
    setAttempt((n) => n + 1);
  }

  function save(nextValue: string) {
    if (state.status !== 'ready') return;
    const before = state.data;
    const dest = hubspotOf(before.destinations);
    if (!dest) return;
    if ((dest.fieldMappings?.[stepKey] ?? '') === nextValue) return;

    // Optimistic: show the pick immediately; roll back if the save fails.
    const optimistic = withMapping(before, stepKey, nextValue);
    setState({ status: 'ready', data: optimistic });
    setSaving(true);
    setFlash(false);
    if (flashTimer.current) clearTimeout(flashTimer.current);

    const seq = ++saveSeq.current;
    void saveQuestionMappingAction(formId, stepKey, nextValue || null)
      .then((res) => {
        if (seq !== saveSeq.current) return; // superseded by a newer pick
        setSaving(false);
        if (res.ok) {
          const confirmed: ConnectIntegrationsData = {
            ...optimistic,
            destinations: res.destinations,
          };
          setState({ status: 'ready', data: confirmed });
          cacheData(formId, confirmed);
          setFlash(true);
          flashTimer.current = setTimeout(() => setFlash(false), 2500);
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
        if (seq !== saveSeq.current) return;
        setSaving(false);
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
    const value = dest.fieldMappings?.[stepKey] ?? '';
    return (
      <div data-testid="qs-hubspot-mapto" className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-sm font-medium text-foreground">{m.mapTo}</label>
          <span
            aria-live="polite"
            className={cn('text-[11px]', flash ? 'text-primary' : 'text-muted-foreground')}
          >
            {saving ? (
              m.saving
            ) : flash ? (
              <span data-testid="qs-hubspot-saved">{m.saved}</span>
            ) : null}
          </span>
        </div>
        {data.hubspot.enabled ? (
          <Select
            ariaLabel={m.mapTo}
            value={value}
            onChange={save}
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
          <FreeTextMapping value={value} ariaLabel={m.mapTo} onCommit={save} />
        )}
        <p className="text-xs text-muted-foreground">{m.mapToHint}</p>
      </div>
    );
  }

  return (
    <section
      data-testid="qs-hubspot-section"
      className="flex flex-col gap-3 border-t border-border pt-4"
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <i aria-hidden className="pi pi-link text-secondary" style={{ fontSize: 11 }} />
        {m.title}
      </p>
      {body()}
    </section>
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
