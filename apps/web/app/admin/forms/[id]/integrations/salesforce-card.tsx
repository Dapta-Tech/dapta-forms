'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import type { FormsMessages } from '@quill/shared';
import { propertiesFor, type FormDestination } from '@quill/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { callAction } from '@/lib/call-action';
import type { SalesforceField, SalesforceFieldsResponse } from '@/lib/admin-api';
import type { QuestionMeta } from './auto-map';
import { Card } from './integrations-card';
import { salesforceFieldsAction } from './actions';
import { DeliveryHistory } from './delivery-history';
import type { Locale } from '@quill/shared';

type Msgs = FormsMessages['admin']['integrations'];

/** Salesforce's own stand-in for a required field nothing supplied. */
const NOT_PROVIDED = '[not provided]';
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;
const NUMERIC = new Set(['double', 'currency', 'percent', 'int', 'long']);
const DATES = new Set(['date', 'datetime']);

const fill = (template: string, vars: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);

/** One "question fills field" row. Rows with the same question group on save. */
export interface SalesforceMappingRow {
  key: string;
  field: string;
}

export interface SalesforceState {
  enabled: boolean;
  mappings: SalesforceMappingRow[];
  utm: Record<string, string>;
  scoreField: string;
  dateField: string;
  dayTimezone: string;
  statics: { field: string; value: string }[];
}

/** The card's state, read out of the FIRST stored Salesforce destination. */
export function initialSalesforce(destinations: FormDestination[]): SalesforceState {
  const stored = destinations.find((d) => d.type === 'salesforce');
  if (!stored || stored.type !== 'salesforce') {
    return {
      enabled: false,
      mappings: [],
      utm: {},
      scoreField: '',
      dateField: '',
      dayTimezone: '',
      statics: [],
    };
  }
  const mappings: SalesforceMappingRow[] = [];
  for (const [key, target] of Object.entries(stored.fieldMappings ?? {})) {
    for (const field of propertiesFor(target)) mappings.push({ key, field });
  }
  return {
    enabled: stored.enabled !== false,
    mappings,
    utm: { ...(stored.utmMappings ?? {}) },
    scoreField: stored.scoreField ?? '',
    dateField: stored.dateField ?? '',
    dayTimezone: stored.dayTimezone ?? '',
    statics: Object.entries(stored.staticFields ?? {}).map(([field, value]) => ({ field, value })),
  };
}

/**
 * The destination to store, or null when the card holds nothing at all.
 *
 * Half-filled rows are dropped rather than stored, and a time zone is kept only
 * beside a date field, the one place it means anything: a zone stored with no
 * date field would come back as a setting that silently does nothing.
 */
export function builtSalesforce(state: SalesforceState): FormDestination | null {
  const grouped = new Map<string, string[]>();
  for (const row of state.mappings) {
    const key = row.key.trim();
    const field = row.field.trim();
    if (!key || !field) continue;
    const list = grouped.get(key) ?? [];
    if (!list.includes(field)) list.push(field);
    grouped.set(key, list);
  }
  const fieldMappings: Record<string, string | string[]> = {};
  for (const [key, list] of grouped) fieldMappings[key] = list.length === 1 ? list[0]! : list;
  const utmMappings: Record<string, string> = {};
  for (const [k, v] of Object.entries(state.utm)) if (v?.trim()) utmMappings[k] = v.trim();
  const staticFields: Record<string, string> = {};
  for (const row of state.statics) {
    if (row.field.trim() && row.value.trim()) staticFields[row.field.trim()] = row.value.trim();
  }
  const dateField = state.dateField.trim();
  const holds =
    state.enabled ||
    Object.keys(fieldMappings).length > 0 ||
    Object.keys(utmMappings).length > 0 ||
    Object.keys(staticFields).length > 0 ||
    state.scoreField.trim() ||
    dateField;
  if (!holds) return null;
  return {
    type: 'salesforce',
    enabled: state.enabled,
    fieldMappings,
    utmMappings,
    ...(state.scoreField.trim() ? { scoreField: state.scoreField.trim() } : {}),
    ...(dateField ? { dateField } : {}),
    ...(dateField && state.dayTimezone.trim() ? { dayTimezone: state.dayTimezone.trim() } : {}),
    ...(Object.keys(staticFields).length ? { staticFields } : {}),
  };
}

/**
 * What the author should know about the mapping as it stands: a missing Email
 * (the delivery cannot run), the fallbacks a new Lead will get, and which
 * mapped fields a matched Contact will skip. Pure, so it can be tested.
 */
export function salesforceWarnings(
  state: SalesforceState,
  contact: string[],
  /** The form has a question keyed `email`, which a delivery falls back to. */
  hasEmailQuestion = false,
): { emailMissing: boolean; fallbacks: string[]; contactSkips: string[] } {
  const mapped = new Set<string>();
  for (const row of state.mappings) if (row.key.trim() && row.field.trim()) mapped.add(row.field.trim());
  for (const v of Object.values(state.utm)) if (v?.trim()) mapped.add(v.trim());
  for (const row of state.statics) if (row.field.trim() && row.value.trim()) mapped.add(row.field.trim());
  if (state.scoreField.trim()) mapped.add(state.scoreField.trim());
  if (state.dateField.trim()) mapped.add(state.dateField.trim());
  const has = (name: string) => [...mapped].some((f) => f.toLowerCase() === name.toLowerCase());

  const emailMissing =
    !hasEmailQuestion &&
    !state.mappings.some((r) => r.key.trim() && r.field.trim().toLowerCase() === 'email');
  // LastName and Company are filled by the delivery itself; any OTHER field the
  // org requires on create has no fallback, and is the one worth naming.
  const fallbacks = ['LastName', 'Company'].filter((f) => !has(f));
  const contactSet = new Set(contact.map((c) => c.toLowerCase()));
  const contactSkips = contact.length
    ? [...mapped].filter((f) => f.toLowerCase() !== 'email' && !contactSet.has(f.toLowerCase()))
    : [];
  return { emailMissing, fallbacks, contactSkips };
}

export function SalesforceCard({
  state,
  setState,
  questions,
  connected,
  initialFields,
  extraStored = false,
  formId,
  locale,
  m,
}: {
  state: SalesforceState;
  setState: (next: SalesforceState) => void;
  questions: QuestionMeta[];
  /** Account-level Salesforce connection. */
  connected: boolean;
  /** The org's fields as the tab loaded them. */
  initialFields: SalesforceFieldsResponse;
  /** A stored config carries a second Salesforce destination this card drops. */
  extraStored?: boolean;
  /** For the delivery history. Absent in isolated specs, which then skip it. */
  formId?: string;
  locale?: string;
  m: Msgs;
}) {
  const sm = m.salesforce;
  const [fields, setFields] = useState<SalesforceFieldsResponse>(initialFields);
  const [refreshing, startRefresh] = useTransition();
  const ticket = useRef(0);
  const lead = fields.enabled ? fields.lead : [];
  const contact = fields.enabled ? fields.contact : [];
  const patch = (next: Partial<SalesforceState>) => setState({ ...state, ...next });

  function refresh() {
    const mine = ++ticket.current;
    startRefresh(async () => {
      const res = await callAction(() => salesforceFieldsAction(true));
      if (mine !== ticket.current) return;
      if ('fields' in res) setFields(res.fields);
      else setFields({ enabled: false, reason: 'unavailable' });
    });
  }

  const fieldOptions = (filter?: (f: SalesforceField) => boolean, current?: string) => {
    const list = lead.filter((f) => (filter ? filter(f) : true));
    const options = list.map((f) => ({
      value: f.name,
      label: `${f.label} (${f.name})${f.required ? ' *' : ''}`,
    }));
    // A field the org no longer lists (renamed, deleted, or fields not loaded)
    // stays selectable as itself, so opening the card never silently changes
    // what is stored.
    if (current && !options.some((o) => o.value === current)) options.unshift({ value: current, label: current });
    return options;
  };
  const optional = (options: { value: string; label: string }[]) => [{ value: '', label: sm.none }, ...options];
  // A file answer is an object (name, url, size), which no Salesforce text
  // field can hold sensibly, so file questions are not offered.
  const questionOptions = questions
    .filter((q) => q.type !== 'file')
    .map((q) => ({ value: q.key, label: q.label }));
  const warnings = useMemo(
    () => salesforceWarnings(state, contact, questions.some((q) => q.key === 'email')),
    [state, contact, questions],
  );
  const dateType = lead.find((f) => f.name === state.dateField)?.type;

  return (
    <Card
      title={sm.title}
      desc={sm.desc}
      enabled={state.enabled}
      onToggle={(enabled) => patch({ enabled })}
      logo="salesforce"
      m={m}
      notice={
        extraStored ? (
          <p className="mt-3 text-xs text-secondary" data-testid="salesforce-extra-stored">
            {sm.extraStored}
          </p>
        ) : null
      }
    >
      {!connected ? (
        <p className="text-sm text-muted-foreground" data-testid="salesforce-not-connected">
          {sm.notConnected}{' '}
          <a className="font-medium text-foreground underline" href="/admin/integrations">
            {sm.connectLink}
          </a>
        </p>
      ) : (
        <div className="flex flex-col gap-5" data-testid="salesforce-mapping">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="max-w-prose text-xs text-muted-foreground">{sm.howItMatches}</p>
            <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
              <i aria-hidden className="pi pi-refresh" style={{ fontSize: 12 }} />
              {refreshing ? sm.refreshing : sm.refreshFields}
            </Button>
          </div>
          {!fields.enabled && fields.reason !== 'not_connected' ? (
            <p role="alert" className="text-sm text-destructive" data-testid="salesforce-fields-problem">
              {fields.reason === 'rejected' ? sm.fieldsRejected : sm.fieldsUnavailable}
            </p>
          ) : null}

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{sm.mappingTitle}</h3>
            <p className="text-xs text-muted-foreground">{sm.mappingHint}</p>
            {state.mappings.map((row, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]" data-testid="salesforce-row">
                <Select
                  value={row.key}
                  onChange={(key) =>
                    patch({ mappings: state.mappings.map((r, j) => (j === i ? { ...r, key } : r)) })
                  }
                  options={questionOptions}
                  placeholder={sm.questionPlaceholder}
                  ariaLabel={sm.questionPlaceholder}
                  searchable
                  locale={locale}
                />
                <Select
                  value={row.field}
                  onChange={(field) =>
                    patch({ mappings: state.mappings.map((r, j) => (j === i ? { ...r, field } : r)) })
                  }
                  options={fieldOptions(undefined, row.field)}
                  placeholder={sm.fieldPlaceholder}
                  ariaLabel={sm.fieldPlaceholder}
                  searchable
                  locale={locale}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => patch({ mappings: state.mappings.filter((_, j) => j !== i) })}
                >
                  {sm.remove}
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => patch({ mappings: [...state.mappings, { key: '', field: '' }] })}
            >
              <i aria-hidden className="pi pi-plus" style={{ fontSize: 12 }} />
              {sm.addMapping}
            </Button>
            {warnings.emailMissing ? (
              <p role="alert" className="text-sm text-destructive" data-testid="salesforce-email-missing">
                {sm.emailMissing}
              </p>
            ) : null}
            {warnings.fallbacks.length ? (
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground" data-testid="salesforce-fallbacks">
                {warnings.fallbacks.map((f) => (
                  <li key={f}>
                    {f === 'Company'
                      ? fill(sm.companyFallback, { value: NOT_PROVIDED })
                      : fill(sm.requiredFallback, { field: f, value: NOT_PROVIDED })}
                  </li>
                ))}
              </ul>
            ) : null}
            {warnings.contactSkips.length ? (
              <p className="text-xs text-muted-foreground" data-testid="salesforce-contact-skips">
                {fill(sm.contactSkips, { fields: warnings.contactSkips.join(', ') })}
              </p>
            ) : null}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{sm.utmTitle}</h3>
            <p className="text-xs text-muted-foreground">{sm.utmHint}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {UTM_KEYS.map((k) => (
                <label key={k} className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {k}
                  <Select
                    value={state.utm[k] ?? ''}
                    onChange={(v) => patch({ utm: { ...state.utm, [k]: v } })}
                    options={optional(fieldOptions((f) => !NUMERIC.has(f.type) && !DATES.has(f.type), state.utm[k]))}
                    ariaLabel={k}
                    searchable
                    locale={locale}
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {sm.scoreLabel}
              <Select
                value={state.scoreField}
                onChange={(scoreField) => patch({ scoreField })}
                options={optional(fieldOptions((f) => NUMERIC.has(f.type) || f.type === 'string', state.scoreField))}
                ariaLabel={sm.scoreLabel}
                searchable
                locale={locale}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {sm.dateLabel}
              <Select
                value={state.dateField}
                onChange={(dateField) => patch({ dateField })}
                options={optional(fieldOptions((f) => DATES.has(f.type), state.dateField))}
                ariaLabel={sm.dateLabel}
                searchable
                locale={locale}
              />
            </label>
            {/* The zone names a calendar DAY, so it exists only beside a date
                field; a datetime keeps the instant and Salesforce shows it in
                the viewer's own zone. */}
            {state.dateField && dateType !== 'datetime' ? (
              <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
                {sm.dayTimezoneLabel}
                <Input
                  value={state.dayTimezone}
                  placeholder="America/Bogota"
                  onChange={(e) => patch({ dayTimezone: e.target.value })}
                />
                <span className="text-xs font-normal text-muted-foreground">{sm.dayTimezoneHint}</span>
              </label>
            ) : null}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{sm.staticTitle}</h3>
            <p className="text-xs text-muted-foreground">{sm.staticHint}</p>
            {state.statics.map((row, i) => {
              const picklist = lead.find((f) => f.name === row.field)?.options;
              const setRow = (next: Partial<{ field: string; value: string }>) =>
                patch({ statics: state.statics.map((r, j) => (j === i ? { ...r, ...next } : r)) });
              return (
                <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]" data-testid="salesforce-static">
                  <Select
                    value={row.field}
                    onChange={(field) => setRow({ field, value: '' })}
                    options={fieldOptions(undefined, row.field)}
                    placeholder={sm.fieldPlaceholder}
                    ariaLabel={sm.fieldPlaceholder}
                    searchable
                    locale={locale}
                  />
                  {/* A picklist offers only its active values: a typed value the
                      org does not have is a rejected record later. */}
                  {picklist ? (
                    <Select
                      value={row.value}
                      onChange={(value) => setRow({ value })}
                      options={picklist.map((o) => ({ value: o.value, label: o.label }))}
                      placeholder={sm.valuePlaceholder}
                      ariaLabel={sm.valuePlaceholder}
                      locale={locale}
                    />
                  ) : (
                    <Input
                      value={row.value}
                      placeholder={sm.valuePlaceholder}
                      aria-label={sm.valuePlaceholder}
                      onChange={(e) => setRow({ value: e.target.value })}
                    />
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => patch({ statics: state.statics.filter((_, j) => j !== i) })}
                  >
                    {sm.remove}
                  </Button>
                </div>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => patch({ statics: [...state.statics, { field: '', value: '' }] })}
            >
              <i aria-hidden className="pi pi-plus" style={{ fontSize: 12 }} />
              {sm.addStatic}
            </Button>
          </section>
        </div>
      )}
      {/* The org's own refusals (a validation rule, a required field) are only
          ever reported here: without it an author would never learn that a
          mapping is being rejected. */}
      {formId ? (
        <DeliveryHistory
          formId={formId}
          kinds={['salesforce']}
          title={m.historySalesforceTitle}
          locale={(locale === 'es' ? 'es' : 'en') as Locale}
          m={m}
          testId="salesforce-history"
        />
      ) : null}
    </Card>
  );
}
