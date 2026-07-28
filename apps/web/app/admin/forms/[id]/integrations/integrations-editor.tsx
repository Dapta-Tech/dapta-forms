'use client';

import type { EmailSource } from '@quill/engine';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { FormsMessages, Locale } from '@quill/shared';
import { WEBHOOK_SECRET_MASK, type DestinationEvent, type FormDestination } from '@quill/types';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';
import type { HubSpotPropertiesResponse } from '@/lib/admin-api';
import { trackDestinationWrite } from '@/lib/connect-sync';
import { propertyLookup, suggestProperty, type QuestionMeta } from './auto-map';
import { pingWebhookAction, saveIntegrationsAction } from './actions';

type Msgs = FormsMessages['admin']['integrations'];

type SaveStatus = 'saved' | 'saving' | 'error' | 'partial';
/** Same debounce as the builder's autosave, so both tabs feel identical. */
const AUTOSAVE_MS = 900;
/** Same admin API base the server-side admin-api client uses (client-exposed). */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export type { QuestionMeta } from './auto-map';

/** Admin locale for the branded property picker's search box — a tiny context so
 *  `locale` need not thread through every PropertyField (kept minimal on purpose). */
const LocaleContext = createContext<Locale>('en');

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

/** Sentinel option values for the key pickers — never valid step keys. */
const CUSTOM_KEY_OPTION = '__custom_key__';
const KEY_GROUP_QUESTIONS = '__group_questions__';
const KEY_GROUP_SYSTEM = '__group_system__';

/** Question types whose answers come from a fixed option list — the typical
 *  "translate this answer" case, so they lead the value-map key picker. */
const CHOICE_TYPES = new Set(['multiple_choice', 'dropdown']);

/** Replace `{key}` tokens in a catalog string. */
const fill = (template: string, vars: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);

interface Pair {
  key: string;
  property: string;
}

/** One answer→CRM value translation row inside a value map. */
interface ValueMapRow {
  from: string;
  to: string;
}
/** Value translations for one form step: raw answer -> HubSpot picklist value. */
interface ValueMapGroup {
  stepKey: string;
  rows: ValueMapRow[];
}
/** One fixed property stamped on every completed submission. */
interface StaticPropertyRow {
  key: string;
  value: string;
}

interface WebhookState {
  /** Stable destination id (round-tripped so the server merges secrets by identity). */
  id?: string;
  enabled: boolean;
  url: string;
  /** What the user has typed. Empty + `hasSecret` = "keep the stored secret". */
  secret: string;
  /** A signing secret is already stored server-side (returned masked on READ). */
  hasSecret: boolean;
  /** Per-event triggers (both true = default; absent/empty on the wire = both). */
  firePartial: boolean;
  fireComplete: boolean;
}
interface HubspotState {
  enabled: boolean;
  fieldMappings: Pair[];
  utmMappings: Record<string, string>;
  scoreProperty: string;
  dateProperty: string;
  note: boolean;
  valueMaps: ValueMapGroup[];
  outcomeProperty: string;
  staticProperties: StaticPropertyRow[];
  inferCompanyFromEmail: boolean;
  bookingSync: BookingSyncState;
}

/** Contact properties stamped when a respondent books a meeting (all optional). */
interface BookingSyncState {
  stageProperty: string;
  stageValue: string;
  dateProperty: string;
  hoursProperty: string;
}

function initialWebhook(destinations: FormDestination[]): WebhookState {
  const w = destinations.find((d) => d.type === 'webhook');
  if (w && w.type === 'webhook') {
    // The API masks a stored secret to WEBHOOK_SECRET_MASK on READ — surface it
    // as "set" (empty input, placeholder) rather than leaking the ciphertext.
    const hasSecret = w.settings.secret === WEBHOOK_SECRET_MASK;
    // Absent/empty events = both phases (schema back-compat) → both boxes checked.
    const ev = w.events;
    const both = !ev || ev.length === 0;
    return {
      id: w.id,
      enabled: w.enabled,
      url: w.settings.url ?? '',
      secret: '',
      hasSecret,
      firePartial: both || ev!.includes('partial'),
      fireComplete: both || ev!.includes('complete'),
    };
  }
  return { enabled: false, url: '', secret: '', hasSecret: false, firePartial: true, fireComplete: true };
}

function initialHubspot(destinations: FormDestination[]): HubspotState {
  const h = destinations.find((d) => d.type === 'hubspot');
  if (h && h.type === 'hubspot') {
    return {
      enabled: h.enabled,
      fieldMappings: Object.entries(h.fieldMappings ?? {}).map(([key, property]) => ({ key, property })),
      utmMappings: { ...(h.utmMappings ?? {}) },
      scoreProperty: h.scoreProperty ?? '',
      dateProperty: h.dateProperty ?? '',
      note: h.settings?.note !== false,
      valueMaps: Object.entries(h.valueMaps ?? {}).map(([stepKey, map]) => ({
        stepKey,
        rows: Object.entries(map).map(([from, to]) => ({ from, to })),
      })),
      outcomeProperty: h.outcomeProperty ?? '',
      staticProperties: Object.entries(h.staticProperties ?? {}).map(([key, value]) => ({ key, value })),
      inferCompanyFromEmail: h.inferCompanyFromEmail === true,
      bookingSync: {
        stageProperty: h.bookingSync?.stageProperty ?? '',
        stageValue: h.bookingSync?.stageValue ?? '',
        dateProperty: h.bookingSync?.dateProperty ?? '',
        hoursProperty: h.bookingSync?.hoursProperty ?? '',
      },
    };
  }
  return {
    enabled: false,
    fieldMappings: [],
    utmMappings: {},
    scoreProperty: '',
    dateProperty: '',
    note: true,
    valueMaps: [],
    outcomeProperty: '',
    staticProperties: [],
    inferCompanyFromEmail: false,
    bookingSync: { stageProperty: '', stageValue: '', dateProperty: '', hoursProperty: '' },
  };
}

/**
 * https-only, with ONE documented exception: plain http is allowed for
 * localhost/127.0.0.1 so a developer can point a form at a local catcher while
 * testing. Any other http host is rejected (mirrors the server-side zod refine
 * on the webhook settings URL — keep the two in sync).
 */
const isHttpsOrLocalhostUrl = (v: string): boolean => {
  try {
    const u = new URL(v);
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
};

export function IntegrationsEditor({
  id,
  initialDestinations,
  hubspot: hubspotProps,
  hubspotConnected,
  questions,
  emailSource = null,
  messages: m,
  locale,
}: {
  id: string;
  initialDestinations: FormDestination[];
  hubspot: HubSpotPropertiesResponse;
  /** Account-level HubSpot connection status (gates the mapping UI). */
  hubspotConnected: boolean;
  /** The form's mappable questions (from its steps). */
  questions: QuestionMeta[];
  /** Where a HubSpot sync could get the address it keys contacts on. */
  emailSource?: EmailSource;
  messages: Msgs;
  locale: Locale;
}) {
  const { error } = useToast();
  const errorRef = useRef(error);
  errorRef.current = error;
  const [webhook, setWebhook] = useState<WebhookState>(() => initialWebhook(initialDestinations));
  const [hs, setHs] = useState<HubspotState>(() => initialHubspot(initialDestinations));
  const [webhookError, setWebhookError] = useState<string | null>(null);
  // The destinations as the server last accepted them. Seeded from the freshly
  // fetched mount props and advanced on every successful save, so the "protect
  // the working webhook from a transient bad keystroke" fallback below never
  // reverts to a stale page-load snapshot (V4-05). `initialDestinations` alone
  // was a mount-time value the tab's refetch never refreshed — a second edit
  // then restored it, and an actual submission was delivered to the old URL.
  const savedDestinations = useRef<FormDestination[]>(initialDestinations);

  const properties = hubspotProps.enabled ? hubspotProps.properties : [];
  const pickerEnabled = hubspotProps.enabled;
  // Show the mapping when HubSpot is usable for this account: an explicit
  // account connection, OR the property picker resolved via the server env
  // fallback (self-host). Otherwise prompt the user to connect first.
  const showMapping = hubspotConnected || pickerEnabled;

  /**
   * The destinations to persist, plus a webhook problem to report if there is
   * one (V5-QA).
   *
   * This used to return an error for the WHOLE tab as soon as the webhook URL
   * was malformed, which meant a HubSpot mapping typed inches away was blocked
   * and then silently discarded on leaving the page. The webhook's validity is
   * now scoped to the webhook: everything else still saves, the bad URL stays in
   * the field so nothing typed is lost, and the status line says which part did
   * not go through.
   *
   * The three webhook cases (V4-05):
   *  - EMPTY url → persist NO webhook. Clearing the field removes the
   *    destination; the old code carried the stored one forward, so a cleared
   *    URL kept silently delivering to a ghost endpoint.
   *  - malformed non-empty url → report it and carry the LAST SAVED webhook
   *    (`savedDestinations`, refreshed on every write) so one bad keystroke does
   *    not nuke a working destination — but never revert to something older than
   *    the last successful save.
   *  - valid url → persist it with the current enabled flag.
   */
  function buildDestinations(): { destinations: FormDestination[]; webhookError: string | null } {
    const out: FormDestination[] = [];
    let webhookError: string | null = null;
    const url = webhook.url.trim();
    if (url && !isHttpsOrLocalhostUrl(url)) {
      // Malformed draft: the bad value must not change what is stored. Carry the
      // last SUCCESSFULLY SAVED webhook (not the page-load snapshot) so a working
      // destination survives, and fall through to save the HubSpot half.
      webhookError = m.webhookUrlInvalid;
      const saved = savedDestinations.current.find((d) => d.type === 'webhook');
      if (saved) out.push(saved);
    } else if (url) {
      // Secret write semantics: a typed value overwrites; an empty field keeps
      // the stored secret (send the sentinel the server merges back) when one is
      // set, or stays cleared/null when none exists.
      const typed = webhook.secret.trim();
      const secret = typed ? typed : webhook.hasSecret ? WEBHOOK_SECRET_MASK : null;
      // Per-event triggers: both selected = omit `events` (schema default = both,
      // back-compat). Exactly one selected = persist it. The UI keeps ≥1 checked.
      const events: DestinationEvent[] = [];
      if (webhook.firePartial) events.push('partial');
      if (webhook.fireComplete) events.push('complete');
      out.push({
        type: 'webhook',
        ...(webhook.id ? { id: webhook.id } : {}),
        enabled: webhook.enabled,
        ...(events.length === 1 ? { events } : {}),
        settings: {
          url,
          secret,
        },
      });
    }
    // else: empty url (switch on or off) → no webhook persisted. An enabled
    // webhook with no URL is incomplete, not stored; clearing the URL removes it.
    const fieldMappings: Record<string, string> = {};
    for (const p of hs.fieldMappings) {
      if (p.key.trim() && p.property.trim()) fieldMappings[p.key.trim()] = p.property.trim();
    }
    const utmMappings: Record<string, string> = {};
    for (const [k, v] of Object.entries(hs.utmMappings)) {
      if (v && v.trim()) utmMappings[k] = v.trim();
    }
    const valueMaps: Record<string, Record<string, string>> = {};
    for (const group of hs.valueMaps) {
      const stepKey = group.stepKey.trim();
      if (!stepKey) continue;
      const rows: Record<string, string> = {};
      for (const r of group.rows) {
        if (r.from.trim() && r.to.trim()) rows[r.from.trim()] = r.to.trim();
      }
      if (Object.keys(rows).length > 0) valueMaps[stepKey] = rows;
    }
    const staticProperties: Record<string, string> = {};
    for (const p of hs.staticProperties) {
      if (p.key.trim() && p.value.trim()) staticProperties[p.key.trim()] = p.value.trim();
    }
    const bookingSync: Record<string, string> = {};
    for (const k of ['stageProperty', 'stageValue', 'dateProperty', 'hoursProperty'] as const) {
      if (hs.bookingSync[k].trim()) bookingSync[k] = hs.bookingSync[k].trim();
    }
    const hasHubspotConfig =
      hs.enabled ||
      Object.keys(fieldMappings).length > 0 ||
      Object.keys(utmMappings).length > 0 ||
      Object.keys(valueMaps).length > 0 ||
      Object.keys(staticProperties).length > 0 ||
      Object.keys(bookingSync).length > 0 ||
      hs.scoreProperty.trim() ||
      hs.dateProperty.trim() ||
      hs.outcomeProperty.trim() ||
      hs.inferCompanyFromEmail;
    if (hasHubspotConfig) {
      // Round-trip any stored HubSpot fields this screen does not manage (e.g.
      // booking-sync settings saved elsewhere) so a save here never clobbers them.
      const stored = initialDestinations.find((d) => d.type === 'hubspot');
      out.push({
        ...(stored && stored.type === 'hubspot' ? stored : {}),
        type: 'hubspot',
        enabled: hs.enabled,
        settings: { note: hs.note },
        fieldMappings,
        utmMappings,
        scoreProperty: hs.scoreProperty.trim() || null,
        dateProperty: hs.dateProperty.trim() || null,
        valueMaps,
        outcomeProperty: hs.outcomeProperty.trim() || null,
        staticProperties,
        inferCompanyFromEmail: hs.inferCompanyFromEmail,
        // All fields blank = booking sync off; undefined overrides the stored
        // spread above so clearing the fields actually removes the config.
        bookingSync: Object.keys(bookingSync).length > 0 ? bookingSync : undefined,
      });
    }
    return { destinations: out, webhookError };
  }

  // --- Autosave (V5-A4) ------------------------------------------------------
  // Connect was the last tab still gated behind an explicit Save button, so an
  // edit made here — flipping the connection on, re-pointing one property —
  // looked identical to an edit made in Build but was silently discarded on
  // leaving. Same contract as the builder now: debounce, flush on the way out,
  // and a status line that says which state you are in.
  const buildRef = useRef(buildDestinations);
  buildRef.current = buildDestinations;
  const dirty = useRef(false);
  const [status, setStatus] = useState<SaveStatus>('saved');
  /** What exactly was not saved — shown next to the status, never just a colour. */
  const [statusDetail, setStatusDetail] = useState<string | null>(null);

  const persist = useCallback(
    async (built: FormDestination[], blocked: string | null = null): Promise<boolean> => {
      setStatus('saving');
      const write = saveIntegrationsAction(id, built);
      // Register the write so a Connect-tab remount reads it back, not the state
      // it is about to overwrite (V4-05 race).
      trackDestinationWrite(id, write);
      const res = await write;
      if (!res.ok) {
        setStatus('error');
        setStatusDetail(res.message ?? m.saveError);
        errorRef.current(res.message ?? m.saveError);
        return false;
      }
      dirty.current = false;
      // This array is now the server truth — the malformed-URL fallback carries
      // it forward instead of the stale mount snapshot.
      savedDestinations.current = built;
      // Saved, but one card was left out — say WHICH, instead of a green check
      // that implies the webhook edit went through too.
      setStatus(blocked ? 'partial' : 'saved');
      setStatusDetail(blocked);
      return true;
    },
    [id, m.saveError],
  );

  /**
   * Every card edit funnels through these so an edit is marked dirty at the
   * moment it happens. Wrapping the setters (rather than watching state in an
   * effect) keeps the initial render from counting as an edit and autosaving
   * a form nobody touched.
   */
  const editWebhook = useCallback((next: WebhookState) => {
    dirty.current = true;
    setStatus('saving');
    setWebhook(next);
  }, []);
  const editHubspot = useCallback((next: HubspotState) => {
    dirty.current = true;
    setStatus('saving');
    setHs(next);
  }, []);

  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => {
      const built = buildRef.current();
      // A bad webhook URL is reported on its own card and blocks only itself —
      // the rest of the tab still persists.
      setWebhookError(built.webhookError);
      void persist(built.destinations, built.webhookError);
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [webhook, hs, persist]);

  // Leaving with an edit still in the debounce window: flush it. A hard tab
  // close cannot await a server action, so that path uses a `keepalive` PUT to
  // the same endpoint the action wraps; SPA nav and tab-hide use the
  // cookie-authed action while the component is still alive. Mirrors the
  // builder's flush exactly, so both tabs lose work in the same (zero) cases.
  useEffect(() => {
    function flush(beacon: boolean) {
      if (!dirty.current) return;
      const built = buildRef.current();
      if (beacon) {
        try {
          void fetch(`${API_BASE}/v1/forms/${id}/destinations`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ destinations: built.destinations }),
            keepalive: true,
            credentials: 'include',
          });
        } catch {
          /* best-effort on the unload path — nothing to recover to */
        }
      } else {
        // SPA nav / unmount: fire-and-forget, but register it so the tab's next
        // remount waits for this write before it re-reads (V4-05 race).
        const write = saveIntegrationsAction(id, built.destinations);
        trackDestinationWrite(id, write);
        void write;
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush(false);
    };
    const onBeforeUnload = () => flush(true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
      flush(false); // SPA nav / unmount → reliable server-action flush
    };
  }, [id]);

  return (
    <div className="flex flex-col gap-6">
      <WebhookCard
        state={webhook}
        onChange={editWebhook}
        urlError={webhookError}
        clearUrlError={() => setWebhookError(null)}
        formId={id}
        m={m}
      />
      <LocaleContext.Provider value={locale}>
        <HubspotCard
          state={hs}
          onChange={editHubspot}
          properties={properties}
          pickerEnabled={pickerEnabled}
          accountConnected={hubspotConnected}
          showMapping={showMapping}
          emailSource={emailSource}
          questions={questions}
          m={m}
        />
      </LocaleContext.Provider>

      {/* The Save button is gone (V5-A4) — everything here autosaves, so what
          belongs in this bar is the state of that save, not an action. */}
      <div
        data-testid="integrations-save-status"
        data-status={status}
        aria-live="polite"
        className="sticky bottom-0 flex items-center gap-2 border-t border-border bg-background/95 py-4 text-sm text-muted-foreground backdrop-blur"
      >
        <i
          aria-hidden
          className={cn(
            'pi',
            status === 'saved'
              ? 'pi-check text-primary'
              : status === 'error'
                ? 'pi-exclamation-triangle text-destructive'
                : status === 'partial'
                  ? 'pi-exclamation-circle text-secondary'
                  : 'pi-sync',
          )}
          style={{ fontSize: 12 }}
        />
        <span className={cn(status === 'error' && 'text-destructive')}>
          {status === 'saved'
            ? m.autosaved
            : status === 'error'
              ? (statusDetail ?? m.saveError)
              : status === 'partial'
                ? `${m.autosavedPartial} ${statusDetail ?? ''}`.trim()
                : m.saving}
        </span>
      </div>
    </div>
  );
}

/** A property picker: a searchable branded Select of live properties, or a
 *  free-text fallback when the HubSpot picker is unconfigured/unavailable. */
function PropertyField({
  value,
  onChange,
  properties,
  enabled,
  allowNone,
  m,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  properties: { name: string; label: string }[];
  enabled: boolean;
  allowNone?: boolean;
  m: Msgs;
  ariaLabel: string;
}) {
  const locale = useContext(LocaleContext);
  if (!enabled) {
    return (
      <Input
        value={value}
        aria-label={ariaLabel}
        placeholder={m.property}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  // Property lists are long, so the branded picker is searchable. The leading
  // empty option preserves the native "(no property)" / "Select…" prompt row.
  const options: SelectOption[] = [
    { value: '', label: allowNone ? m.noProperty : m.selectProperty },
    ...properties.map((p) => ({ value: p.name, label: `${p.label} (${p.name})` })),
  ];
  return (
    <Select
      ariaLabel={ariaLabel}
      value={value}
      onChange={onChange}
      options={options}
      searchable
      locale={locale}
    />
  );
}

/**
 * Step-key picker for "Custom field mappings" rows and "Value maps" groups: a
 * branded searchable Select over the form's own question keys (grouped, with
 * the UTM system fields where relevant) plus a "Custom key…" escape hatch that
 * swaps the row to the legacy free-text input for hidden/advanced keys — with
 * a "Back to list" way back. A stored key that matches no listed option opens
 * in custom mode so existing configs render (and keep saving) unchanged.
 *
 * Group headers are disabled options (the shared Select has no group concept),
 * so they render muted and are skipped by keyboard nav + click.
 */
function KeySelect({
  value,
  onChange,
  questionOptions,
  systemKeys,
  m,
  testId,
  customTestId,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Pickable question entries — already filtered/ordered by the caller. */
  questionOptions: QuestionMeta[];
  /** Auto-captured submission-data keys (UTMs). Empty = omit the group. */
  systemKeys: readonly string[];
  m: Msgs;
  testId: string;
  customTestId: string;
}) {
  const locale = useContext(LocaleContext);
  const selectable = (v: string): boolean =>
    systemKeys.includes(v) || questionOptions.some((q) => q.key === v);
  // Stored keys that match neither group (hidden/legacy) open in custom mode.
  const [customMode, setCustomMode] = useState(() => value !== '' && !selectable(value));

  if (customMode) {
    return (
      <div className="flex flex-1 items-center gap-2">
        <Input
          data-testid={customTestId}
          value={value}
          aria-label={m.stepKey}
          placeholder={m.stepKey}
          className="flex-1"
          onChange={(e) => onChange(e.target.value)}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            // A key the list can't show would silently look unselected — clear it.
            if (value !== '' && !selectable(value)) onChange('');
            setCustomMode(false);
          }}
        >
          {m.keyCustomBack}
        </Button>
      </div>
    );
  }

  const options: SelectOption[] = [];
  if (questionOptions.length > 0) {
    options.push({ value: KEY_GROUP_QUESTIONS, label: m.keyGroupQuestions, disabled: true });
    options.push(...questionOptions.map((q) => ({ value: q.key, label: `${q.label} (${q.key})` })));
  }
  if (systemKeys.length > 0) {
    options.push({ value: KEY_GROUP_SYSTEM, label: m.keyGroupSystem, disabled: true });
    options.push(...systemKeys.map((k) => ({ value: k, label: k })));
  }
  options.push({ value: CUSTOM_KEY_OPTION, label: m.keyCustomOption });

  return (
    <div data-testid={testId} className="min-w-0 flex-1">
      <Select
        ariaLabel={m.stepKey}
        value={value}
        placeholder={m.selectKeyPlaceholder}
        options={options}
        searchable
        locale={locale}
        onChange={(v) => {
          if (v === CUSTOM_KEY_OPTION) {
            setCustomMode(true);
            return;
          }
          onChange(v);
        }}
      />
    </div>
  );
}

function Card({
  title,
  desc,
  enabled,
  onToggle,
  m,
  badge,
  children,
}: {
  title: string;
  desc: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  m: Msgs;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{title}</h2>
            {badge ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-medium text-foreground">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />
                {badge}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted-foreground">{enabled ? m.enabled : m.disabled}</span>
          <Switch checked={enabled} onCheckedChange={onToggle} aria-label={title} />
        </div>
      </div>
      {enabled ? <div className="mt-5 flex flex-col gap-4">{children}</div> : null}
    </section>
  );
}

/** A grouped panel (Typeform-style) with a header, optional help, and an action slot. */
function Section({
  title,
  help,
  action,
  children,
}: {
  title: string;
  help?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {help ? <p className="mt-0.5 text-xs text-muted-foreground">{help}</p> : null}
        </div>
        {action ?? null}
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  help,
  intro,
  action,
  children,
}: {
  label: string;
  help?: string;
  /** Helper copy rendered directly UNDER the label (before the rows), for
   *  sections that need explaining before the controls make sense. */
  intro?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium">{label}</label>
        {action ?? null}
      </div>
      {intro ? (
        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">{intro}</div>
      ) : null}
      {children}
      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
    </div>
  );
}

function WebhookCard({
  state,
  onChange,
  urlError,
  clearUrlError,
  formId,
  m,
}: {
  state: WebhookState;
  onChange: (s: WebhookState) => void;
  urlError: string | null;
  clearUrlError: () => void;
  /** Needed for the test delivery — the API resolves the saved webhook by form. */
  formId: string;
  m: Msgs;
}) {
  const { success, error: toastError } = useToast();
  const [pinging, setPinging] = useState(false);

  /**
   * Ask the API to send one sample delivery. Deliberately server-side: the
   * browser must never fetch the endpoint itself (it would leak the signing
   * secret and bypass the SSRF guard), and the signature has to be computed
   * where the secret lives.
   */
  async function ping() {
    if (!state.url.trim()) {
      toastError(m.pingNeedsUrl);
      return;
    }
    setPinging(true);
    try {
      const res = await pingWebhookAction(formId);
      if (res.ok) success(m.pingOk);
      else toastError(fill(m.pingFailed, { reason: res.message ?? '' }));
    } finally {
      setPinging(false);
    }
  }
  // Keep at least one phase checked — a webhook with neither would never fire
  // (that is what the enable switch is for), and empty `events` means BOTH.
  function toggleEvent(which: 'partial' | 'complete', checked: boolean) {
    const nextPartial = which === 'partial' ? checked : state.firePartial;
    const nextComplete = which === 'complete' ? checked : state.fireComplete;
    if (!nextPartial && !nextComplete) return;
    onChange({ ...state, firePartial: nextPartial, fireComplete: nextComplete });
  }

  return (
    <Card
      title={m.webhookTitle}
      desc={m.webhookDesc}
      enabled={state.enabled}
      onToggle={(enabled) => onChange({ ...state, enabled })}
      m={m}
    >
      <Field label={m.webhookUrl}>
        <Input
          type="url"
          value={state.url}
          placeholder={m.webhookUrlPlaceholder}
          aria-invalid={urlError ? true : undefined}
          aria-describedby={urlError ? 'webhook-url-error' : undefined}
          onChange={(e) => {
            clearUrlError();
            onChange({ ...state, url: e.target.value });
          }}
        />
        {urlError ? (
          <p id="webhook-url-error" role="alert" className="text-xs text-destructive">
            {urlError}
          </p>
        ) : null}
        {/* Test delivery: the fastest way to find out the far end is wrong is to
            send it something, rather than waiting for a real respondent. */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={ping}
            disabled={pinging || !state.url.trim()}
            data-testid="webhook-ping"
          >
            <i aria-hidden className="pi pi-send" style={{ fontSize: 12 }} />
            {pinging ? m.pingSending : m.pingWebhook}
          </Button>
          <span className="text-xs text-muted-foreground">{m.pingHelp}</span>
        </div>
      </Field>
      <Field label={m.webhookSecret} help={m.webhookSecretHelp}>
        <Input
          type="text"
          value={state.secret}
          autoComplete="off"
          placeholder={state.hasSecret ? m.webhookSecretSetPlaceholder : undefined}
          onChange={(e) => onChange({ ...state, secret: e.target.value })}
        />
      </Field>
      <Field label={m.webhookEvents} help={m.webhookEventsHelp}>
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={state.firePartial}
              onChange={(e) => toggleEvent('partial', e.target.checked)}
              aria-label={m.eventPartial}
            />
            {m.eventPartial}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={state.fireComplete}
              onChange={(e) => toggleEvent('complete', e.target.checked)}
              aria-label={m.eventComplete}
            />
            {m.eventComplete}
          </label>
        </div>
      </Field>
    </Card>
  );
}

function HubspotCard({
  state,
  onChange,
  properties,
  pickerEnabled,
  accountConnected,
  showMapping,
  emailSource,
  questions,
  m,
}: {
  state: HubspotState;
  onChange: (s: HubspotState) => void;
  properties: { name: string; label: string }[];
  pickerEnabled: boolean;
  accountConnected: boolean;
  showMapping: boolean;
  emailSource: EmailSource;
  questions: QuestionMeta[];
  m: Msgs;
}) {
  const { success, toast } = useToast();
  const utmValues = useMemo(() => state.utmMappings, [state.utmMappings]);
  const questionKeys = useMemo(() => new Set(questions.map((q) => q.key)), [questions]);

  // Nothing to key a contact on → mapping is pointless and, worse, silently
  // lossy: HubSpot's upsert is BY EMAIL, so a submission with no address
  // resolves as a permanent no-op and that lead is never synced. Say so here,
  // while the form is being built, instead of letting it be discovered from a
  // CRM that stayed empty. This gate sits BEFORE the connect prompt: an account
  // with HubSpot ready still cannot sync a form that asks for no address.
  if (!emailSource) {
    return (
      <section data-testid="hubspot-card" className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">{m.hubspotTitle}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{m.hubspotDesc}</p>
        <div
          data-testid="hubspot-needs-email"
          className="mt-4 rounded-md border border-dashed border-border bg-muted/40 p-4"
        >
          <p className="text-sm font-medium text-foreground">{m.emailRequiredTitle}</p>
          <p className="mt-1 text-sm text-muted-foreground">{m.emailRequiredBody}</p>
        </div>
      </section>
    );
  }

  // Not usable at all → prompt the user to connect HubSpot for their account.
  if (!showMapping) {
    return (
      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">{m.hubspotTitle}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{m.hubspotDesc}</p>
        <div className="mt-4 rounded-md border border-dashed border-border bg-muted/40 p-4">
          <p className="text-sm font-medium text-foreground">{m.connectPromptTitle}</p>
          <p className="mt-1 text-sm text-muted-foreground">{m.connectPromptBody}</p>
          <Link
            href="/admin/integrations"
            className={cn(buttonVariants({ variant: 'default', size: 'sm' }), 'mt-3')}
          >
            {m.connectPromptCta}
            <i aria-hidden className="pi pi-arrow-right" style={{ fontSize: 12 }} />
          </Link>
        </div>
      </section>
    );
  }

  /** The property currently mapped for a question key (via the pairs array). */
  const questionProp = (key: string): string =>
    state.fieldMappings.find((p) => p.key === key)?.property ?? '';

  /** Upsert/clear the mapping for a question key (empty value removes the row). */
  const setQuestionProp = (key: string, value: string) => {
    // Drop any existing row for this key, then re-add when non-empty. Question
    // rows render from `questions`, so fieldMappings order is irrelevant here.
    const next = state.fieldMappings.filter((p) => p.key !== key);
    if (value.trim() !== '') next.push({ key, property: value });
    onChange({ ...state, fieldMappings: next });
  };

  // Custom rows = mappings whose key is not one of the form's questions (hidden
  // fields / legacy keys). Tracked with their real index for stable editing.
  const customRows = state.fieldMappings
    .map((pair, index) => ({ pair, index }))
    .filter(({ pair }) => !questionKeys.has(pair.key));

  // Keys already used by ANY mapping row (main section or custom). Questions
  // already mapped drop out of a custom row's picker (no double-mapping); a
  // row's own key is always kept so its selection stays visible.
  const usedKeys = new Set(state.fieldMappings.map((p) => p.key));
  const unmappedQuestions = questions.filter((q) => !usedKeys.has(q.key));

  // Value maps translate answers, so choice-type questions (fixed option
  // lists) lead the picker; free-text questions follow. Plain computation —
  // this sits below the connect-prompt early return, where hooks can't go.
  const valueMapQuestions = [
    ...questions.filter((q) => CHOICE_TYPES.has(q.type)),
    ...questions.filter((q) => !CHOICE_TYPES.has(q.type)),
  ];

  function autoMap() {
    const byLower = propertyLookup(properties);
    const alreadyMapped = new Set(
      state.fieldMappings.filter((p) => p.property.trim()).map((p) => p.key),
    );
    const additions: Pair[] = [];
    for (const q of questions) {
      if (alreadyMapped.has(q.key)) continue; // never overwrite an existing mapping
      const suggestion = suggestProperty(q, byLower);
      if (suggestion) additions.push({ key: q.key, property: suggestion });
    }
    if (additions.length === 0) {
      toast(m.autoMapNone);
      return;
    }
    // Replace any empty placeholder rows for these keys, then append suggestions.
    const filledKeys = new Set(additions.map((a) => a.key));
    const next = state.fieldMappings.filter((p) => !filledKeys.has(p.key));
    next.push(...additions);
    onChange({ ...state, fieldMappings: next });
    success(fill(m.autoMapFilled, { n: String(additions.length) }));
  }

  return (
    <Card
      title={m.hubspotTitle}
      desc={m.hubspotDesc}
      enabled={state.enabled}
      onToggle={(enabled) => onChange({ ...state, enabled })}
      m={m}
      badge={accountConnected ? m.connectedBadge : undefined}
    >
      {!pickerEnabled ? (
        <div className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          {m.propertiesUnavailable}
        </div>
      ) : null}

      {/* What the sync actually does. "Map a question to a property" does not
          tell anyone that the CONTACT is matched by email and created when
          absent — which is the one rule that decides whether a lead lands. */}
      <div
        data-testid="hubspot-how"
        className="rounded-md border border-border bg-muted/30 p-3"
      >
        <p className="text-xs font-medium text-foreground">{m.hubspotHowTitle}</p>
        <p className="mt-1 text-xs text-muted-foreground">{m.hubspotHowBody}</p>
        {emailSource?.kind === 'scheduler' ? (
          <p data-testid="hubspot-scheduler-note" className="mt-2 text-xs text-muted-foreground">
            {m.emailFromScheduler}
          </p>
        ) : null}
      </div>

      {/* Map questions — each form question → a HubSpot contact property */}
      <Section
        title={m.mapQuestions}
        help={m.mapQuestionsHelp}
        action={
          <Button variant="outline" size="sm" onClick={autoMap} disabled={questions.length === 0}>
            <i aria-hidden className="pi pi-bolt" style={{ fontSize: 12 }} />
            {m.autoMap}
          </Button>
        }
      >
        {questions.length === 0 ? (
          <p className="text-xs text-muted-foreground">{m.noQuestions}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="hidden grid-cols-[1fr_1fr] gap-3 px-1 sm:grid">
              <span className="text-xs font-medium text-muted-foreground">{m.yourQuestion}</span>
              <span className="text-xs font-medium text-muted-foreground">{m.property}</span>
            </div>
            {questions.map((q) => (
              <div
                key={q.key}
                className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_1fr] sm:gap-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{q.label}</p>
                  <code className="text-xs text-muted-foreground">{q.key}</code>
                </div>
                <PropertyField
                  value={questionProp(q.key)}
                  ariaLabel={`${q.label} → ${m.property}`}
                  properties={properties}
                  enabled={pickerEnabled}
                  allowNone
                  m={m}
                  onChange={(v) => setQuestionProp(q.key, v)}
                />
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Custom field mappings — keys not tied to a listed question */}
      <Field label={m.customMappings} intro={m.customMappingsHelp}>
        <div className="flex flex-col gap-2">
          {customRows.length === 0 ? (
            <p className="text-xs text-muted-foreground">{m.emptyMappings}</p>
          ) : (
            customRows.map(({ pair, index }) => (
              <div key={index} className="flex items-center gap-2">
                <KeySelect
                  value={pair.key}
                  questionOptions={unmappedQuestions}
                  systemKeys={UTM_KEYS.filter((k) => k === pair.key || !usedKeys.has(k))}
                  m={m}
                  testId="mapping-key-select"
                  customTestId="mapping-key-custom"
                  onChange={(v) => {
                    const next = [...state.fieldMappings];
                    next[index] = { ...pair, key: v };
                    onChange({ ...state, fieldMappings: next });
                  }}
                />
                <span aria-hidden className="text-muted-foreground">
                  →
                </span>
                <div className="flex-1">
                  <PropertyField
                    value={pair.property}
                    ariaLabel={m.property}
                    properties={properties}
                    enabled={pickerEnabled}
                    m={m}
                    onChange={(v) => {
                      const next = [...state.fieldMappings];
                      next[index] = { ...pair, property: v };
                      onChange({ ...state, fieldMappings: next });
                    }}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={m.remove}
                  onClick={() =>
                    onChange({
                      ...state,
                      fieldMappings: state.fieldMappings.filter((_, j) => j !== index),
                    })
                  }
                >
                  {m.remove}
                </Button>
              </div>
            ))
          )}
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                onChange({ ...state, fieldMappings: [...state.fieldMappings, { key: '', property: '' }] })
              }
            >
              {m.addMapping}
            </Button>
          </div>
        </div>
      </Field>

      {/* Value maps: per-step answer -> CRM picklist value translations */}
      <Field
        label={m.valueMaps}
        intro={
          <>
            <p>{m.valueMapsHelp}</p>
            <p>{m.valueMapsExample}</p>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {state.valueMaps.length === 0 ? (
            <p className="text-xs text-muted-foreground">{m.emptyValueMaps}</p>
          ) : (
            state.valueMaps.map((group, gi) => (
              <div key={gi} className="flex flex-col gap-2 rounded-md border border-border p-3">
                <div className="flex items-center gap-2">
                  <KeySelect
                    value={group.stepKey}
                    questionOptions={valueMapQuestions}
                    systemKeys={[]}
                    m={m}
                    testId="valuemap-key-select"
                    customTestId="valuemap-key-custom"
                    onChange={(v) => {
                      const next = [...state.valueMaps];
                      next[gi] = { ...group, stepKey: v };
                      onChange({ ...state, valueMaps: next });
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={m.remove}
                    onClick={() =>
                      onChange({ ...state, valueMaps: state.valueMaps.filter((_, j) => j !== gi) })
                    }
                  >
                    {m.remove}
                  </Button>
                </div>
                {group.rows.map((row, ri) => (
                  <div key={ri} className="flex items-center gap-2 pl-4">
                    <Input
                      value={row.from}
                      aria-label={m.valueMapAnswer}
                      placeholder={m.valueMapAnswer}
                      className="flex-1"
                      onChange={(e) => {
                        const next = [...state.valueMaps];
                        const rows = [...group.rows];
                        rows[ri] = { ...row, from: e.target.value };
                        next[gi] = { ...group, rows };
                        onChange({ ...state, valueMaps: next });
                      }}
                    />
                    <span aria-hidden className="text-muted-foreground">
                      →
                    </span>
                    <Input
                      value={row.to}
                      aria-label={m.valueMapCrmValue}
                      placeholder={m.valueMapCrmValue}
                      className="flex-1"
                      onChange={(e) => {
                        const next = [...state.valueMaps];
                        const rows = [...group.rows];
                        rows[ri] = { ...row, to: e.target.value };
                        next[gi] = { ...group, rows };
                        onChange({ ...state, valueMaps: next });
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={m.remove}
                      onClick={() => {
                        const next = [...state.valueMaps];
                        next[gi] = { ...group, rows: group.rows.filter((_, j) => j !== ri) };
                        onChange({ ...state, valueMaps: next });
                      }}
                    >
                      {m.remove}
                    </Button>
                  </div>
                ))}
                <div className="pl-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const next = [...state.valueMaps];
                      next[gi] = { ...group, rows: [...group.rows, { from: '', to: '' }] };
                      onChange({ ...state, valueMaps: next });
                    }}
                  >
                    {m.addValueMapRow}
                  </Button>
                </div>
              </div>
            ))
          )}
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                onChange({
                  ...state,
                  valueMaps: [...state.valueMaps, { stepKey: '', rows: [{ from: '', to: '' }] }],
                })
              }
            >
              {m.addValueMap}
            </Button>
          </div>
        </div>
      </Field>

      {/* Map form elements — captured metadata → HubSpot properties */}
      <Section title={m.mapElements} help={m.mapElementsHelp}>
        <Field label={m.utmMappings} help={m.utmMappingsHelp}>
          <div className="flex flex-col gap-2">
            {UTM_KEYS.map((k) => (
              <div key={k} className="flex items-center gap-2">
                <code className="w-32 shrink-0 text-xs text-muted-foreground">{k}</code>
                <span aria-hidden className="text-muted-foreground">
                  →
                </span>
                <div className="flex-1">
                  <PropertyField
                    value={utmValues[k] ?? ''}
                    ariaLabel={`${k} ${m.property}`}
                    properties={properties}
                    enabled={pickerEnabled}
                    allowNone
                    m={m}
                    onChange={(v) => onChange({ ...state, utmMappings: { ...state.utmMappings, [k]: v } })}
                  />
                </div>
              </div>
            ))}
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={m.scoreProperty} help={m.scorePropertyHelp}>
            <PropertyField
              value={state.scoreProperty}
              ariaLabel={m.scoreProperty}
              properties={properties}
              enabled={pickerEnabled}
              allowNone
              m={m}
              onChange={(v) => onChange({ ...state, scoreProperty: v })}
            />
          </Field>
          <Field label={m.dateProperty} help={m.datePropertyHelp}>
            <PropertyField
              value={state.dateProperty}
              ariaLabel={m.dateProperty}
              properties={properties}
              enabled={pickerEnabled}
              allowNone
              m={m}
              onChange={(v) => onChange({ ...state, dateProperty: v })}
            />
          </Field>
          <Field label={m.outcomeProperty} help={m.outcomePropertyHelp}>
            <PropertyField
              value={state.outcomeProperty}
              ariaLabel={m.outcomeProperty}
              properties={properties}
              enabled={pickerEnabled}
              allowNone
              m={m}
              onChange={(v) => onChange({ ...state, outcomeProperty: v })}
            />
          </Field>
        </div>
      </Section>

      {/* Static properties: fixed key -> value stamped on completed submissions */}
      <Field label={m.staticProperties} help={m.staticPropertiesHelp}>
        <div className="flex flex-col gap-2">
          {state.staticProperties.length === 0 ? (
            <p className="text-xs text-muted-foreground">{m.emptyStaticProperties}</p>
          ) : (
            state.staticProperties.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex-1">
                  <PropertyField
                    value={row.key}
                    ariaLabel={m.property}
                    properties={properties}
                    enabled={pickerEnabled}
                    m={m}
                    onChange={(v) => {
                      const next = [...state.staticProperties];
                      next[i] = { ...row, key: v };
                      onChange({ ...state, staticProperties: next });
                    }}
                  />
                </div>
                <span aria-hidden className="text-muted-foreground">
                  →
                </span>
                <Input
                  value={row.value}
                  aria-label={m.staticValue}
                  placeholder={m.staticValue}
                  className="flex-1"
                  onChange={(e) => {
                    const next = [...state.staticProperties];
                    next[i] = { ...row, value: e.target.value };
                    onChange({ ...state, staticProperties: next });
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={m.remove}
                  onClick={() =>
                    onChange({
                      ...state,
                      staticProperties: state.staticProperties.filter((_, j) => j !== i),
                    })
                  }
                >
                  {m.remove}
                </Button>
              </div>
            ))
          )}
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                onChange({
                  ...state,
                  staticProperties: [...state.staticProperties, { key: '', value: '' }],
                })
              }
            >
              {m.addStaticProperty}
            </Button>
          </div>
        </div>
      </Field>

      {/* Booking sync: contact properties stamped when a meeting is booked */}
      <Field label={m.bookingSync} help={m.bookingSyncHelp}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={m.bookingStageProperty}>
            <PropertyField
              value={state.bookingSync.stageProperty}
              ariaLabel={m.bookingStageProperty}
              properties={properties}
              enabled={pickerEnabled}
              allowNone
              m={m}
              onChange={(v) =>
                onChange({ ...state, bookingSync: { ...state.bookingSync, stageProperty: v } })
              }
            />
          </Field>
          <Field label={m.bookingStageValue}>
            <Input
              value={state.bookingSync.stageValue}
              aria-label={m.bookingStageValue}
              placeholder={m.bookingStageValue}
              onChange={(e) =>
                onChange({
                  ...state,
                  bookingSync: { ...state.bookingSync, stageValue: e.target.value },
                })
              }
            />
          </Field>
          <Field label={m.bookingDateProperty}>
            <PropertyField
              value={state.bookingSync.dateProperty}
              ariaLabel={m.bookingDateProperty}
              properties={properties}
              enabled={pickerEnabled}
              allowNone
              m={m}
              onChange={(v) =>
                onChange({ ...state, bookingSync: { ...state.bookingSync, dateProperty: v } })
              }
            />
          </Field>
          <Field label={m.bookingHoursProperty}>
            <PropertyField
              value={state.bookingSync.hoursProperty}
              ariaLabel={m.bookingHoursProperty}
              properties={properties}
              enabled={pickerEnabled}
              allowNone
              m={m}
              onChange={(v) =>
                onChange({ ...state, bookingSync: { ...state.bookingSync, hoursProperty: v } })
              }
            />
          </Field>
        </div>
      </Field>

      <div className="flex items-center justify-between gap-4">
        <div>
          <label className="text-sm font-medium">{m.inferCompany}</label>
          <p className="text-xs text-muted-foreground">{m.inferCompanyHelp}</p>
        </div>
        <Switch
          checked={state.inferCompanyFromEmail}
          onCheckedChange={(inferCompanyFromEmail) => onChange({ ...state, inferCompanyFromEmail })}
          aria-label={m.inferCompany}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <label className="text-sm font-medium">{m.createNote}</label>
          <p className="text-xs text-muted-foreground">{m.createNoteHelp}</p>
        </div>
        <Switch
          checked={state.note}
          onCheckedChange={(note) => onChange({ ...state, note })}
          aria-label={m.createNote}
        />
      </div>
    </Card>
  );
}
