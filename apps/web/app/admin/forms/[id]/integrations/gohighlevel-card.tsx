'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { getMessages, type FormsMessages, type Locale } from '@quill/shared';
import {
  GOHIGHLEVEL_STANDARD_FIELDS,
  GOHIGHLEVEL_UTM_KEYS,
  GOHIGHLEVEL_VALUE_KIND,
  goHighLevelSlotAccepts,
  isGoHighLevelMappableDataType,
  type DestinationEvent,
  type FormDestination,
  type GoHighLevelCustomFieldDto,
  type GoHighLevelCustomFieldTarget,
  type GoHighLevelFieldsResponse,
  type GoHighLevelFieldTarget,
  type GoHighLevelMappingSlot,
  type GoHighLevelStandardFieldKey,
  type GoHighLevelUtmKey,
} from '@quill/types';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import { callAction } from '@/lib/call-action';
import type { DeliveryKind } from '@/lib/admin-api';
import { useToast } from '@/components/toast';
import { GoHighLevelConnectForm } from '@/app/admin/integrations/connect-forms';
import { suggestProperty, type QuestionMeta } from './auto-map';
import { Card } from './integrations-card';
import { goHighLevelFieldsAction } from './actions';
import { DeliveryHistory } from './delivery-history';
import { CrmPartialsSwitch } from './crm-partials-switch';
import { ConnectInPlace, DEFAULT_CONNECT_ACCESS, type ConnectAccess } from './connect-in-place';
import { RowHint } from './salesforce-card';

type Msgs = FormsMessages['admin']['integrations'];
type CustomTarget = GoHighLevelCustomFieldTarget;

/** A module constant: the history panel keys its fetch on the joined list. */
const HISTORY_KINDS: DeliveryKind[] = ['gohighlevel'];

/** Standard fields GHL deduplicates on: never a fixed value (the API refuses one too). */
const IDENTITY_FIELDS: ReadonlySet<string> = new Set(['email', 'phone']);

/** Where the editor sends people to connect, or to replace a refused token. */
const INTEGRATIONS_PAGE = '/admin/integrations';

const fill = (template: string, vars: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);

/**
 * One "question fills field" row. Standard and custom rows live in ONE list,
 * in stored order, and the card shows them in two groups by `kind`: regrouping
 * the list itself would reorder a stored mapping on the first save, and the
 * API's save check matches an untouched target by its position.
 */
export interface GoHighLevelRow {
  key: string;
  kind: 'standard' | 'custom';
  target: GoHighLevelFieldTarget | null;
}

export interface GoHighLevelStaticRow {
  target: GoHighLevelFieldTarget | null;
  value: string;
}

export interface GoHighLevelState {
  enabled: boolean;
  /**
   * As stored. Absent means the destination's default (complete only), and it
   * stays absent until the author touches the partials switch, so opening the
   * card never rewrites a config nobody changed.
   */
  events: DestinationEvent[] | undefined;
  mappings: GoHighLevelRow[];
  utm: Partial<Record<GoHighLevelUtmKey, CustomTarget>>;
  scoreField: CustomTarget | null;
  dateField: CustomTarget | null;
  dayTimezone: string;
  statics: GoHighLevelStaticRow[];
  tags: string[];
  source: string;
}

export const EMPTY_GOHIGHLEVEL: GoHighLevelState = {
  enabled: false,
  events: undefined,
  mappings: [],
  utm: {},
  scoreField: null,
  dateField: null,
  dayTimezone: '',
  statics: [],
  tags: [],
  source: '',
};

/** The card's state, read out of the FIRST stored HighLevel destination. */
export function initialGoHighLevel(destinations: FormDestination[]): GoHighLevelState {
  const stored = destinations.find((d) => d.type === 'gohighlevel');
  if (!stored || stored.type !== 'gohighlevel') return { ...EMPTY_GOHIGHLEVEL };
  const mappings: GoHighLevelRow[] = [];
  for (const [key, targets] of Object.entries(stored.fieldMappings ?? {})) {
    for (const target of targets) mappings.push({ key, kind: target.kind, target });
  }
  // Unfinished rows come back after the complete ones (see `builtGoHighLevel`).
  for (const row of stored.drafts?.mappings ?? []) {
    mappings.push({ key: row.key, kind: row.target?.kind ?? 'standard', target: row.target ?? null });
  }
  return {
    enabled: stored.enabled !== false,
    events: stored.events,
    mappings,
    utm: { ...(stored.utmMappings ?? {}) },
    scoreField: stored.scoreField ?? null,
    dateField: stored.dateField ?? null,
    dayTimezone: stored.dayTimezone ?? '',
    statics: [
      ...(stored.staticFields ?? []).map((s) => ({ target: s.target, value: s.value })),
      ...(stored.drafts?.statics ?? []).map((s) => ({ target: s.target ?? null, value: s.value })),
    ],
    tags: [...(stored.tags ?? [])],
    source: stored.source ?? '',
  };
}

/** Two targets name the same HighLevel field. */
const sameTarget = (a: GoHighLevelFieldTarget, b: GoHighLevelFieldTarget): boolean =>
  a.kind === 'standard' ? b.kind === 'standard' && a.field === b.field : b.kind === 'custom' && a.id === b.id;

/**
 * The destination to store, or null when the card holds nothing at all.
 *
 * Half-filled rows are kept as `drafts` (never delivered), so the author's
 * work survives a reload. A complete config read in and built back out is the
 * same config: what the card does not change, it does not rewrite.
 */
export function builtGoHighLevel(state: GoHighLevelState): FormDestination | null {
  const fieldMappings: Record<string, GoHighLevelFieldTarget[]> = {};
  const draftMappings: { key: string; target: GoHighLevelFieldTarget | null }[] = [];
  for (const row of state.mappings) {
    const key = row.key.trim();
    if (key && row.target) {
      const list = (fieldMappings[key] ??= []);
      if (!list.some((t) => sameTarget(t, row.target!))) list.push(row.target);
    } else if (key || row.target) {
      draftMappings.push({ key, target: row.target });
    }
  }
  const staticFields: { target: GoHighLevelFieldTarget; value: string }[] = [];
  const draftStatics: { target: GoHighLevelFieldTarget | null; value: string }[] = [];
  for (const row of state.statics) {
    const value = row.value.trim();
    if (row.target && value) staticFields.push({ target: row.target, value });
    else if (row.target || value) draftStatics.push({ target: row.target, value });
  }
  const utmMappings: Partial<Record<GoHighLevelUtmKey, CustomTarget>> = {};
  for (const k of GOHIGHLEVEL_UTM_KEYS) if (state.utm[k]) utmMappings[k] = state.utm[k];
  const tags = state.tags.map((t) => t.trim()).filter(Boolean);
  const source = state.source.trim();
  const dayTimezone = state.dayTimezone.trim();
  const drafts = {
    ...(draftMappings.length ? { mappings: draftMappings } : {}),
    ...(draftStatics.length ? { statics: draftStatics } : {}),
  };
  const holds =
    state.enabled ||
    Object.keys(fieldMappings).length > 0 ||
    Object.keys(utmMappings).length > 0 ||
    staticFields.length > 0 ||
    Object.keys(drafts).length > 0 ||
    tags.length > 0 ||
    !!source ||
    !!state.scoreField ||
    !!state.dateField ||
    state.events !== undefined;
  if (!holds) return null;
  return {
    type: 'gohighlevel',
    enabled: state.enabled,
    ...(state.events !== undefined ? { events: state.events } : {}),
    fieldMappings,
    utmMappings,
    ...(state.scoreField ? { scoreField: state.scoreField } : {}),
    ...(state.dateField ? { dateField: state.dateField } : {}),
    ...(dayTimezone ? { dayTimezone } : {}),
    ...(staticFields.length ? { staticFields } : {}),
    ...(tags.length ? { tags } : {}),
    ...(source ? { source } : {}),
    ...(Object.keys(drafts).length ? { drafts } : {}),
  };
}

// --- Which field a question may fill -----------------------------------------

/**
 * The question types whose answer each kind of custom field can take, beyond
 * the slot rule every layer shares (`goHighLevelSlotAccepts`). A file answer
 * is an object, which no HighLevel field holds, so it is never offered.
 */
const CUSTOM_SOURCES: Record<string, ReadonlySet<string> | 'any'> = {
  text: 'any',
  number: new Set(['slider', 'text']),
  date: new Set(['text']),
  option: new Set(['dropdown', 'multiple_choice', 'text']),
  options: new Set(['multiple_choice', 'dropdown', 'checkbox']),
};

/** Whether a custom field of `dataType` can take this question's answer. */
export function customFieldSuits(questionType: string | undefined, dataType: string): boolean {
  if (!goHighLevelSlotAccepts('field', dataType) || !isGoHighLevelMappableDataType(dataType)) return false;
  if (questionType === undefined) return true;
  if (questionType === 'file') return false;
  if (dataType === 'PHONE') return questionType === 'phone' || questionType === 'text';
  if (dataType === 'EMAIL') return questionType === 'email' || questionType === 'text';
  const sources = CUSTOM_SOURCES[GOHIGHLEVEL_VALUE_KIND[dataType]];
  return sources === 'any' || !!sources?.has(questionType);
}

/** Whether a standard field can take this question's answer (`GOHIGHLEVEL_STANDARD_FIELDS` `sources`). */
export function standardFieldSuits(questionType: string | undefined, field: GoHighLevelStandardFieldKey): boolean {
  if (questionType === undefined) return true;
  const spec = GOHIGHLEVEL_STANDARD_FIELDS.find((f) => f.key === field);
  return !!spec && (spec.sources as readonly string[]).includes(questionType);
}

/** A stored target, as the custom field it names. */
const asTarget = (f: GoHighLevelCustomFieldDto): CustomTarget => ({
  kind: 'custom',
  id: f.id,
  key: f.key,
  dataType: f.dataType,
});

// --- Auto-map -----------------------------------------------------------------

/** HubSpot's spelling (what `suggestProperty` returns) to HighLevel's standard key. */
const SUGGESTION_TO_STANDARD: Record<string, GoHighLevelStandardFieldKey> = {
  email: 'email',
  mobilephone: 'phone',
  firstname: 'firstName',
  lastname: 'lastName',
  company: 'companyName',
};
const SUGGESTION_LOOKUP = new Map(Object.keys(SUGGESTION_TO_STANDARD).map((k) => [k, k]));

/**
 * What switching the card on for the first time fills in: email, phone, name
 * and company from the questions that look like them, and each `utm_*` to a
 * text custom field of the same name when the sub-account has one. Each
 * standard field once, from the first question that suits it.
 */
export function goHighLevelAutoMap(
  questions: QuestionMeta[],
  custom: GoHighLevelCustomFieldDto[],
): Pick<GoHighLevelState, 'mappings' | 'utm'> {
  const mappings: GoHighLevelRow[] = [];
  const taken = new Set<string>();
  for (const q of questions) {
    if (q.type === 'file' || q.type === 'checkbox') continue;
    const suggestion = suggestProperty(q, SUGGESTION_LOOKUP);
    const field = suggestion ? SUGGESTION_TO_STANDARD[suggestion] : undefined;
    if (!field || taken.has(field) || !standardFieldSuits(q.type, field)) continue;
    taken.add(field);
    mappings.push({ key: q.key, kind: 'standard', target: { kind: 'standard', field } });
  }
  const utm: Partial<Record<GoHighLevelUtmKey, CustomTarget>> = {};
  for (const k of GOHIGHLEVEL_UTM_KEYS) {
    const match = custom.find(
      (f) =>
        goHighLevelSlotAccepts('utm', f.dataType) &&
        (f.key.toLowerCase() === `contact.${k}` || f.name.trim().toLowerCase() === k),
    );
    if (match) utm[k] = asTarget(match);
  }
  return { mappings, utm };
}

// --- Warnings -------------------------------------------------------------------

/** Neither Email nor Phone is mapped: HighLevel has nothing to find the contact by. */
export function goHighLevelIdentityMissing(state: GoHighLevelState): boolean {
  return !state.mappings.some(
    (r) =>
      r.key.trim() &&
      r.target?.kind === 'standard' &&
      (r.target.field === 'email' || r.target.field === 'phone'),
  );
}

/** Normalize a typed tag as HighLevel will store it; null for nothing. */
export function normalizeTag(raw: string): string | null {
  const tag = raw.trim().toLowerCase().slice(0, 100);
  return tag ? tag : null;
}

// --- The card -------------------------------------------------------------------

export function GoHighLevelCard({
  state,
  setState,
  questions,
  connected,
  rejected = false,
  initialFields,
  extraStored = false,
  formId,
  formName = '',
  access = DEFAULT_CONNECT_ACCESS,
  partialsHeld = false,
  locale,
  m,
}: {
  state: GoHighLevelState;
  setState: (next: GoHighLevelState) => void;
  questions: QuestionMeta[];
  /** Account-level HighLevel connection. */
  connected: boolean;
  /** HighLevel stopped accepting the stored token (a delivery got a 401 or 403). */
  rejected?: boolean;
  /** The location's fields as the tab loaded them. */
  initialFields: GoHighLevelFieldsResponse;
  /** A stored config carries a second HighLevel destination this card drops. */
  extraStored?: boolean;
  /** For the delivery history. Absent in isolated specs, which then skip it. */
  formId?: string;
  /** Names the default `source`. */
  formName?: string;
  /** Who may connect HighLevel from here (see `ConnectInPlace`). */
  access?: ConnectAccess;
  /** Spam protection holds this form's partials. */
  partialsHeld?: boolean;
  locale?: string;
  m: Msgs;
}) {
  const hm = m.highlevel;
  const cm = getMessages(locale ?? 'en').admin.connections;
  const { success } = useToast();
  // Local, seeded from the tab's load: connecting from this card opens the
  // mapping without a reload.
  const [isConnected, setConnected] = useState(connected);
  const [fields, setFields] = useState<GoHighLevelFieldsResponse>(initialFields);
  const [refreshing, startRefresh] = useTransition();
  const [tagDraft, setTagDraft] = useState('');
  const ticket = useRef(0);
  const custom = fields.enabled ? fields.custom : [];
  const isRejected = rejected || (!fields.enabled && fields.reason === 'rejected');
  const patch = (next: Partial<GoHighLevelState>) => setState({ ...state, ...next });

  function refresh() {
    const mine = ++ticket.current;
    startRefresh(async () => {
      const res = await callAction(() => goHighLevelFieldsAction(true));
      if (mine !== ticket.current) return;
      if ('fields' in res) setFields(res.fields);
      else setFields({ enabled: false, reason: 'unavailable' });
    });
  }

  /**
   * The switch. Turned on for the first time (the card holds nothing), it
   * proposes the mapping instead of leaving the author with an empty list.
   */
  function toggle(enabled: boolean) {
    if (enabled && builtGoHighLevel(state) === null) {
      setState({ ...state, enabled, ...goHighLevelAutoMap(questions, custom) });
      return;
    }
    patch({ enabled });
  }

  const questionType = (key: string): string | undefined =>
    key ? questions.find((q) => q.key === key)?.type : undefined;
  // A file answer is an object (name, url, size): no HighLevel field holds it.
  const questionOptions = questions.filter((q) => q.type !== 'file').map((q) => ({ value: q.key, label: q.label }));
  // A stored key the form no longer offers stays on screen as itself.
  const keyOptions = (current: string) =>
    current && !questionOptions.some((o) => o.value === current)
      ? [{ value: current, label: current }, ...questionOptions]
      : questionOptions;

  const standardLabel = (field: string): string =>
    (hm.standardFields as Record<string, string>)[field] ?? field;
  const customLabel = (t: CustomTarget): string => {
    const live = custom.find((f) => f.id === t.id);
    return live ? `${live.name} (${live.key})` : t.key || t.id;
  };
  const targetValue = (t: GoHighLevelFieldTarget | null): string =>
    !t ? '' : t.kind === 'standard' ? `std:${t.field}` : `cf:${t.id}`;
  /** The target a picked option names, read back from the lists it came from. */
  const targetOf = (value: string, current: GoHighLevelFieldTarget | null): GoHighLevelFieldTarget | null => {
    if (!value) return null;
    if (current && targetValue(current) === value) return current;
    if (value.startsWith('std:')) {
      const field = value.slice(4) as GoHighLevelStandardFieldKey;
      return { kind: 'standard', field };
    }
    const live = custom.find((f) => `cf:${f.id}` === value);
    return live ? asTarget(live) : null;
  };

  const standardOptions = (questionKind: string | undefined, current: GoHighLevelFieldTarget | null, fixed = false) => {
    const list: SelectOption[] = GOHIGHLEVEL_STANDARD_FIELDS.filter(
      (f) => (fixed ? !IDENTITY_FIELDS.has(f.key) : standardFieldSuits(questionKind, f.key)),
    ).map((f) => ({ value: `std:${f.key}`, label: standardLabel(f.key) }));
    // What is stored stays selectable as itself, so opening the card never
    // silently changes it.
    if (current?.kind === 'standard' && !list.some((o) => o.value === targetValue(current))) {
      list.unshift({ value: targetValue(current), label: standardLabel(current.field) });
    }
    return list;
  };
  const customOptions = (accepts: (dataType: string) => boolean, current: GoHighLevelFieldTarget | null) => {
    const list: SelectOption[] = custom
      .filter((f) => accepts(f.dataType))
      .map((f) => ({ value: `cf:${f.id}`, label: `${f.name} (${f.key})` }));
    if (current?.kind === 'custom' && !list.some((o) => o.value === targetValue(current))) {
      list.unshift({ value: targetValue(current), label: customLabel(current) });
    }
    return list;
  };
  const slotOptions = (slot: GoHighLevelMappingSlot, current: CustomTarget | null): SelectOption[] => [
    { value: '', label: hm.none },
    ...customOptions((t) => goHighLevelSlotAccepts(slot, t), current),
  ];

  const identityMissing = useMemo(() => goHighLevelIdentityMissing(state), [state]);
  const showTimezone =
    !!state.dateField ||
    !!state.dayTimezone.trim() ||
    state.mappings.some(
      (r) =>
        (r.target?.kind === 'custom' && r.target.dataType === 'DATE') ||
        (r.target?.kind === 'standard' && r.target.field === 'dateOfBirth'),
    );

  function addTag() {
    const tag = normalizeTag(tagDraft);
    setTagDraft('');
    if (!tag || state.tags.some((t) => t.toLowerCase() === tag) || state.tags.length >= 50) return;
    patch({ tags: [...state.tags, tag] });
  }

  const setRow = (i: number, next: Partial<GoHighLevelRow>) =>
    patch({ mappings: state.mappings.map((r, j) => (j === i ? { ...r, ...next } : r)) });

  /** One group of mapping rows; `kind` decides which picker and which rows. */
  const group = (kind: 'standard' | 'custom') => {
    const rows = state.mappings.map((row, i) => ({ row, i })).filter(({ row }) => row.kind === kind);
    return (
      <div className="flex flex-col gap-2" data-testid={`highlevel-group-${kind}`}>
        <h4 className="text-xs font-semibold text-foreground">
          {kind === 'standard' ? hm.standardGroup : hm.customGroup}
        </h4>
        {kind === 'custom' ? <p className="text-xs text-muted-foreground">{hm.customHint}</p> : null}
        {kind === 'custom' && fields.enabled && custom.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="highlevel-no-custom">
            {hm.noCustomFields}
          </p>
        ) : null}
        {rows.map(({ row, i }) => {
          const qType = questionType(row.key);
          const incompatible =
            !!row.target &&
            !!row.key &&
            (row.target.kind === 'standard'
              ? !standardFieldSuits(qType, row.target.field)
              : !customFieldSuits(qType, row.target.dataType));
          return (
            <div
              key={i}
              className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]"
              data-testid={`highlevel-row-${kind}`}
            >
              <Select
                value={row.key}
                onChange={(key) => setRow(i, { key })}
                options={keyOptions(row.key)}
                placeholder={hm.questionPlaceholder}
                ariaLabel={hm.questionPlaceholder}
                searchable
                locale={locale}
              />
              <Select
                value={targetValue(row.target)}
                onChange={(v) => setRow(i, { target: targetOf(v, row.target) })}
                options={
                  kind === 'standard'
                    ? standardOptions(qType, row.target)
                    : customOptions((t) => customFieldSuits(qType, t), row.target)
                }
                placeholder={kind === 'standard' ? hm.fieldPlaceholder : hm.customFieldPlaceholder}
                ariaLabel={kind === 'standard' ? hm.fieldPlaceholder : hm.customFieldPlaceholder}
                searchable
                locale={locale}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => patch({ mappings: state.mappings.filter((_, j) => j !== i) })}
              >
                {hm.remove}
              </Button>
              <RowHint
                text={
                  !row.key.trim() && row.target
                    ? hm.rowNeedsQuestion
                    : row.key.trim() && !row.target
                      ? hm.rowNeedsField
                      : incompatible
                        ? hm.rowIncompatible
                        : null
                }
              />
            </div>
          );
        })}
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => patch({ mappings: [...state.mappings, { key: '', kind, target: null }] })}
        >
          <i aria-hidden className="pi pi-plus" style={{ fontSize: 12 }} />
          {kind === 'standard' ? hm.addStandard : hm.addCustom}
        </Button>
      </div>
    );
  };

  const connectionsLink = (
    <a
      href={INTEGRATIONS_PAGE}
      className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' self-start'}
      data-testid="highlevel-open-connections"
    >
      <i aria-hidden className="pi pi-external-link" style={{ fontSize: 12 }} />
      {hm.openConnections}
    </a>
  );

  return (
    <Card
      title={hm.title}
      desc={hm.desc}
      enabled={state.enabled}
      onToggle={toggle}
      logo="gohighlevel"
      m={m}
      notice={
        extraStored ? (
          <p className="mt-3 text-xs text-secondary" data-testid="highlevel-extra-stored">
            {hm.extraStored}
          </p>
        ) : null
      }
    >
      {!isConnected ? (
        <div className="flex flex-col gap-3">
          <ConnectInPlace
            provider={hm.title}
            title={hm.connectTitle}
            body={hm.notConnected}
            access={access}
            m={m}
            cm={cm}
            testId="highlevel-not-connected"
          >
            <GoHighLevelConnectForm
              m={cm}
              onConnected={() => {
                setConnected(true);
                success(fill(cm.connectSuccess, { provider: hm.title }));
                // The location's fields, read fresh: the tab loaded none.
                refresh();
              }}
            />
          </ConnectInPlace>
          {connectionsLink}
        </div>
      ) : (
        <div className="flex flex-col gap-5" data-testid="highlevel-mapping">
          {isRejected ? (
            <div
              role="alert"
              data-testid="highlevel-rejected"
              className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3"
            >
              <p className="text-sm text-destructive">{hm.rejected}</p>
              {connectionsLink}
            </div>
          ) : null}
          <p className="max-w-prose text-xs text-muted-foreground" data-testid="highlevel-duplicates">
            {hm.duplicates}
          </p>

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{hm.mappingTitle}</h3>
                <p className="text-xs text-muted-foreground">{hm.mappingHint}</p>
              </div>
              <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
                <i aria-hidden className="pi pi-refresh" style={{ fontSize: 12 }} />
                {refreshing ? hm.refreshing : hm.refreshFields}
              </Button>
            </div>
            {fields.enabled && fields.warning ? (
              <p role="alert" className="text-sm text-destructive" data-testid="highlevel-fields-problem">
                {hm.fieldsUnavailable}
              </p>
            ) : !fields.enabled && fields.reason === 'unavailable' ? (
              <p role="alert" className="text-sm text-destructive" data-testid="highlevel-fields-problem">
                {hm.fieldsUnavailable}
              </p>
            ) : null}
            {group('standard')}
            {group('custom')}
            {identityMissing ? (
              <p role="alert" className="text-sm text-destructive" data-testid="highlevel-identity-missing">
                {hm.emailPhoneMissing}
              </p>
            ) : null}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{hm.tagsTitle}</h3>
            <p className="text-xs text-muted-foreground">{hm.tagsHint}</p>
            {state.tags.length ? (
              <ul className="flex flex-wrap gap-1.5" data-testid="highlevel-tags">
                {state.tags.map((tag) => (
                  <li
                    key={tag}
                    className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/60 py-0.5 pl-2.5 pr-1 text-xs text-foreground"
                  >
                    <span className="truncate">{tag}</span>
                    <button
                      type="button"
                      aria-label={fill(hm.removeTag, { tag })}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => patch({ tags: state.tags.filter((t) => t !== tag) })}
                    >
                      <i aria-hidden className="pi pi-times" style={{ fontSize: 9 }} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex items-center gap-2">
              <Input
                value={tagDraft}
                placeholder={hm.tagsPlaceholder}
                aria-label={hm.tagsTitle}
                maxLength={100}
                className="min-w-0 flex-1 sm:max-w-xs"
                data-testid="highlevel-tag-input"
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addTag();
                  }
                }}
              />
              <Button variant="outline" size="sm" onClick={addTag} disabled={!tagDraft.trim()}>
                {hm.addTag}
              </Button>
            </div>
          </section>

          <section className="flex flex-col gap-1">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {hm.sourceLabel}
              <Input
                value={state.source}
                maxLength={200}
                placeholder={`dForms: ${formName}`}
                onChange={(e) => patch({ source: e.target.value })}
                data-testid="highlevel-source"
              />
            </label>
            <span className="text-xs text-muted-foreground">
              {fill(hm.sourceHint, { default: `dForms: ${formName}` })}
            </span>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{hm.utmTitle}</h3>
            <p className="text-xs text-muted-foreground">{hm.utmHint}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {GOHIGHLEVEL_UTM_KEYS.map((k) => (
                <label key={k} className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
                  {k}
                  <Select
                    value={targetValue(state.utm[k] ?? null)}
                    onChange={(v) => {
                      const target = targetOf(v, state.utm[k] ?? null);
                      const utm = { ...state.utm };
                      if (target?.kind === 'custom') utm[k] = target;
                      else delete utm[k];
                      patch({ utm });
                    }}
                    options={slotOptions('utm', state.utm[k] ?? null)}
                    ariaLabel={k}
                    searchable
                    locale={locale}
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
              {hm.scoreLabel}
              <Select
                value={targetValue(state.scoreField)}
                onChange={(v) => {
                  const t = targetOf(v, state.scoreField);
                  patch({ scoreField: t?.kind === 'custom' ? t : null });
                }}
                options={slotOptions('score', state.scoreField)}
                ariaLabel={hm.scoreLabel}
                searchable
                locale={locale}
              />
              <span className="text-xs font-normal text-muted-foreground">{hm.scoreHint}</span>
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
              {hm.dateLabel}
              <Select
                value={targetValue(state.dateField)}
                onChange={(v) => {
                  const t = targetOf(v, state.dateField);
                  patch({ dateField: t?.kind === 'custom' ? t : null });
                }}
                options={slotOptions('date', state.dateField)}
                ariaLabel={hm.dateLabel}
                searchable
                locale={locale}
              />
              <span className="text-xs font-normal text-muted-foreground">{hm.dateHint}</span>
            </label>
            {/* The zone names a calendar DAY, so it only shows beside something
                that writes one: the submitted date, a date field, a birthday. */}
            {showTimezone ? (
              <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
                {hm.dayTimezoneLabel}
                <Input
                  value={state.dayTimezone}
                  placeholder="America/Bogota"
                  onChange={(e) => patch({ dayTimezone: e.target.value })}
                  data-testid="highlevel-timezone"
                />
                <span className="text-xs font-normal text-muted-foreground">{hm.dayTimezoneHint}</span>
              </label>
            ) : null}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{hm.staticTitle}</h3>
            <p className="text-xs text-muted-foreground">{hm.staticHint}</p>
            {state.statics.map((row, i) => {
              const setStatic = (next: Partial<GoHighLevelStaticRow>) =>
                patch({ statics: state.statics.map((r, j) => (j === i ? { ...r, ...next } : r)) });
              const chosen = row.target;
              const live = chosen?.kind === 'custom' ? custom.find((f) => f.id === chosen.id) : undefined;
              const picklist = live?.options?.length ? live.options : null;
              const ignored = row.target?.kind === 'standard' && IDENTITY_FIELDS.has(row.target.field);
              const options: SelectOption[] = [
                { value: '__std__', label: hm.standardGroup, disabled: true },
                ...standardOptions(undefined, row.target, true),
                ...(custom.length || row.target?.kind === 'custom'
                  ? [
                      { value: '__cf__', label: hm.customGroup, disabled: true },
                      ...customOptions((t) => goHighLevelSlotAccepts('field', t), row.target),
                    ]
                  : []),
              ];
              return (
                <div
                  key={i}
                  className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]"
                  data-testid="highlevel-static"
                >
                  <Select
                    value={targetValue(row.target)}
                    onChange={(v) => setStatic({ target: targetOf(v, row.target), value: '' })}
                    options={options}
                    placeholder={hm.fieldPlaceholder}
                    ariaLabel={hm.fieldPlaceholder}
                    searchable
                    locale={locale}
                  />
                  {/* An option field offers only its choices: a typed value
                      HighLevel does not list is stored as junk. */}
                  {picklist ? (
                    <Select
                      value={row.value}
                      onChange={(value) => setStatic({ value })}
                      options={picklist.map((o) => ({ value: o, label: o }))}
                      placeholder={hm.valuePlaceholder}
                      ariaLabel={hm.valuePlaceholder}
                      locale={locale}
                    />
                  ) : (
                    <Input
                      value={row.value}
                      placeholder={hm.valuePlaceholder}
                      aria-label={hm.valuePlaceholder}
                      maxLength={500}
                      onChange={(e) => setStatic({ value: e.target.value })}
                    />
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => patch({ statics: state.statics.filter((_, j) => j !== i) })}
                  >
                    {hm.remove}
                  </Button>
                  <RowHint
                    text={
                      ignored
                        ? hm.staticIdentityIgnored
                        : row.target && !row.value.trim()
                          ? hm.rowNeedsValue
                          : !row.target && row.value.trim()
                            ? hm.rowNeedsField
                            : null
                    }
                  />
                </div>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => patch({ statics: [...state.statics, { target: null, value: '' }] })}
            >
              <i aria-hidden className="pi pi-plus" style={{ fontSize: 12 }} />
              {hm.addStatic}
            </Button>
          </section>

          <CrmPartialsSwitch
            type="gohighlevel"
            events={state.events}
            onChange={(events) => patch({ events })}
            partialsHeld={partialsHeld}
            testId="highlevel"
            m={m}
          />
        </div>
      )}
      {formId ? (
        <DeliveryHistory
          formId={formId}
          kinds={HISTORY_KINDS}
          title={m.historyHighlevelTitle}
          locale={(locale === 'es' ? 'es' : 'en') as Locale}
          m={m}
          testId="highlevel-history"
        />
      ) : null}
    </Card>
  );
}
