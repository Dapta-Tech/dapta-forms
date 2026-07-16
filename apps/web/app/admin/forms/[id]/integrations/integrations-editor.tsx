'use client';

import { createContext, useContext, useMemo, useState, useTransition } from 'react';
import type { FormsMessages, Locale } from '@quill/shared';
import { WEBHOOK_SECRET_MASK, type FormDestination } from '@quill/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/toast';
import type { HubSpotPropertiesResponse } from '@/lib/admin-api';
import { saveIntegrationsAction } from './actions';

type Msgs = FormsMessages['admin']['integrations'];

/** Admin locale for the branded property picker's search box — a tiny context so
 *  `locale` need not thread through every PropertyField (kept minimal on purpose). */
const LocaleContext = createContext<Locale>('en');

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

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
    return { id: w.id, enabled: w.enabled, url: w.settings.url ?? '', secret: '', hasSecret };
  }
  return { enabled: false, url: '', secret: '', hasSecret: false };
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
  messages: m,
  locale,
}: {
  id: string;
  initialDestinations: FormDestination[];
  hubspot: HubSpotPropertiesResponse;
  messages: Msgs;
  locale: Locale;
}) {
  const { success, error } = useToast();
  const [pending, start] = useTransition();
  const [webhook, setWebhook] = useState<WebhookState>(() => initialWebhook(initialDestinations));
  const [hs, setHs] = useState<HubspotState>(() => initialHubspot(initialDestinations));
  const [webhookError, setWebhookError] = useState<string | null>(null);

  const properties = hubspotProps.enabled ? hubspotProps.properties : [];

  function buildDestinations(): FormDestination[] | { error: string } {
    const out: FormDestination[] = [];
    if (webhook.enabled || webhook.url.trim()) {
      if (!isHttpsOrLocalhostUrl(webhook.url.trim())) return { error: m.webhookUrlInvalid };
      // Secret write semantics: a typed value overwrites; an empty field keeps
      // the stored secret (send the sentinel the server merges back) when one is
      // set, or stays cleared/null when none exists.
      const typed = webhook.secret.trim();
      const secret = typed ? typed : webhook.hasSecret ? WEBHOOK_SECRET_MASK : null;
      out.push({
        type: 'webhook',
        ...(webhook.id ? { id: webhook.id } : {}),
        enabled: webhook.enabled,
        settings: {
          url: webhook.url.trim(),
          secret,
        },
      });
    }
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
    return out;
  }

  function save() {
    setWebhookError(null);
    const built = buildDestinations();
    if ('error' in built) {
      setWebhookError(built.error);
      error(built.error);
      return;
    }
    start(async () => {
      const res = await saveIntegrationsAction(id, built);
      if (res.ok) success(m.saved);
      else error(res.message ?? m.saveError);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <WebhookCard
        state={webhook}
        onChange={setWebhook}
        urlError={webhookError}
        clearUrlError={() => setWebhookError(null)}
        m={m}
      />
      <LocaleContext.Provider value={locale}>
        <HubspotCard state={hs} onChange={setHs} properties={properties} hubspotMeta={hubspotProps} m={m} />
      </LocaleContext.Provider>

      <div className="sticky bottom-0 flex items-center gap-3 border-t border-border bg-background/95 py-4 backdrop-blur">
        <Button onClick={save} disabled={pending}>
          {pending ? m.saving : m.save}
        </Button>
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

function Card({
  title,
  desc,
  enabled,
  onToggle,
  m,
  children,
}: {
  title: string;
  desc: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  m: Msgs;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
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

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium">{label}</label>
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
  m,
}: {
  state: WebhookState;
  onChange: (s: WebhookState) => void;
  urlError: string | null;
  clearUrlError: () => void;
  m: Msgs;
}) {
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
          onChange={(e) => {
            clearUrlError();
            onChange({ ...state, url: e.target.value });
          }}
        />
        {urlError ? <p className="text-xs text-destructive">{urlError}</p> : null}
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
    </Card>
  );
}

function HubspotCard({
  state,
  onChange,
  properties,
  hubspotMeta,
  m,
}: {
  state: HubspotState;
  onChange: (s: HubspotState) => void;
  properties: { name: string; label: string }[];
  hubspotMeta: HubSpotPropertiesResponse;
  m: Msgs;
}) {
  const pickerEnabled = hubspotMeta.enabled;
  const utmValues = useMemo(() => state.utmMappings, [state.utmMappings]);

  return (
    <Card
      title={m.hubspotTitle}
      desc={m.hubspotDesc}
      enabled={state.enabled}
      onToggle={(enabled) => onChange({ ...state, enabled })}
      m={m}
    >
      {!pickerEnabled ? (
        <div className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          {hubspotMeta.enabled ? m.hubspotLoading : hubspotMeta.reason || m.hubspotDisabled}
        </div>
      ) : null}

      {/* Field mappings */}
      <Field label={m.fieldMappings} help={m.fieldMappingsHelp}>
        <div className="flex flex-col gap-2">
          {state.fieldMappings.length === 0 ? (
            <p className="text-xs text-muted-foreground">{m.emptyMappings}</p>
          ) : (
            state.fieldMappings.map((pair, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={pair.key}
                  aria-label={m.stepKey}
                  placeholder={m.stepKey}
                  className="flex-1"
                  onChange={(e) => {
                    const next = [...state.fieldMappings];
                    next[i] = { ...pair, key: e.target.value };
                    onChange({ ...state, fieldMappings: next });
                  }}
                />
                <span aria-hidden className="text-muted-foreground">→</span>
                <div className="flex-1">
                  <PropertyField
                    value={pair.property}
                    ariaLabel={m.property}
                    properties={properties}
                    enabled={pickerEnabled}
                    m={m}
                    onChange={(v) => {
                      const next = [...state.fieldMappings];
                      next[i] = { ...pair, property: v };
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
                      fieldMappings: state.fieldMappings.filter((_, j) => j !== i),
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
      <Field label={m.valueMaps} help={m.valueMapsHelp}>
        <div className="flex flex-col gap-3">
          {state.valueMaps.length === 0 ? (
            <p className="text-xs text-muted-foreground">{m.emptyValueMaps}</p>
          ) : (
            state.valueMaps.map((group, gi) => (
              <div key={gi} className="flex flex-col gap-2 rounded-md border border-border p-3">
                <div className="flex items-center gap-2">
                  <Input
                    value={group.stepKey}
                    aria-label={m.stepKey}
                    placeholder={m.stepKey}
                    className="flex-1"
                    onChange={(e) => {
                      const next = [...state.valueMaps];
                      next[gi] = { ...group, stepKey: e.target.value };
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
                    <span aria-hidden className="text-muted-foreground">→</span>
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

      {/* UTM mappings */}
      <Field label={m.utmMappings} help={m.utmMappingsHelp}>
        <div className="flex flex-col gap-2">
          {UTM_KEYS.map((k) => (
            <div key={k} className="flex items-center gap-2">
              <code className="w-32 shrink-0 text-xs text-muted-foreground">{k}</code>
              <span aria-hidden className="text-muted-foreground">→</span>
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
        <Field label={m.scoreProperty}>
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
        <Field label={m.dateProperty}>
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
                <span aria-hidden className="text-muted-foreground">→</span>
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
