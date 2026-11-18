'use client';

import { propertiesFor } from '@quill/types';
import {
  bookingFieldsFor,
  emailMappingsConflictingWithScheduler,
  type ContactKeyReadiness,
} from '@quill/engine';
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getMessages, type FormsMessages, type Locale } from '@quill/shared';
import {
  sheetCells,
  WEBHOOK_SECRET_MASK,
  sheetBaselineHeaders,
  type DestinationEvent,
  type FormDestination,
} from '@quill/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ProviderLogo } from '@/components/ui/provider-logo';
import { useToast } from '@/components/toast';
import { callAction, callActionWithRetry, isTransportError } from '@/lib/call-action';
import { browserTimezones, isKnownTimezone } from '@/lib/timezones';
import { useAutosave } from '@/lib/use-autosave';
import { cn } from '@/lib/cn';
import { bookingLabel } from '@/lib/booking-fields';
import type {
  DeliveryKind,
  HubSpotPropertiesResponse,
  HubSpotPropertyOption,
  SheetHeaderSync,
  WebhookPingReason,
  WebhookPingResult,
} from '@/lib/admin-api';
import { TokenConnectForm } from '@/app/admin/integrations/connect-forms';
import { ConnectInPlace, DEFAULT_CONNECT_ACCESS, type ConnectAccess } from './connect-in-place';
import {
  acknowledgeLostIntegrationsSave,
  markLostSaveAnnounced,
  publishIntegrationsSave,
  readIntegrationsSave,
  setConnectTabOpen,
  useCombinedSave,
  useIntegrationsSave,
} from '@/lib/integrations-save-status';
import { enqueueIntegrationsSave, runDestinationWrite, subscribeIntegrationsSave } from '@/lib/integrations-save-queue';
import { propertyLookup, suggestProperty, type QuestionMeta } from './auto-map';
import { GoogleSheetsCard, type GoogleSheetsState } from './google-sheets-card';
import {
  builtSalesforce,
  initialSalesforce,
  RowHint,
  SalesforceCard,
  type SalesforceState,
} from './salesforce-card';
import type { GoHighLevelFieldsResponse, SalesforceFieldsResponse } from '@/lib/admin-api';
import {
  builtGoHighLevel,
  GoHighLevelCard,
  initialGoHighLevel,
  type GoHighLevelState,
} from './gohighlevel-card';
import { storedColumns } from './sheet-columns';
import { DeliveryHistory } from './delivery-history';
import { CrmPartialsSwitch } from './crm-partials-switch';
import { Card } from './integrations-card';
import {
  isCustomValue,
  optionsForProperty,
  sharedOptionsFor,
  targetPropertiesFor,
} from './property-options';
import {
  hubspotPropertiesAction,
  mergeIntegrationCardAction,
  pingWebhookAction,
  saveIntegrationsAction,
} from './actions';

type Msgs = FormsMessages['admin']['integrations'];

/** Same debounce as the builder's autosave, so both tabs feel identical. */
const AUTOSAVE_MS = 900;


/** Module constants, not literals in JSX: the history's fetch keys off these. */
const WEBHOOK_HISTORY_KINDS: DeliveryKind[] = ['webhook'];
const HUBSPOT_HISTORY_KINDS: DeliveryKind[] = ['hubspot', 'booking_sync'];

export type { QuestionMeta } from './auto-map';

/** Admin locale for the branded property picker's search box — a tiny context so
 *  `locale` need not thread through every PropertyField (kept minimal on purpose). */
const LocaleContext = createContext<Locale>('en');

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

/**
 * A submission-data key the form never asks for but still carries — a UTM off
 * the URL, or something the booking page collected. Labelled because the key
 * itself is a token: `@invitee_first_name` is not a name anyone wants to read
 * in a dropdown.
 */
interface SystemKey {
  key: string;
  label: string;
}

/** No config supplied → nothing can key a contact. Never claims readiness. */
const NOT_READY: ContactKeyReadiness = {
  ok: false,
  blocker: 'no_source',
  source: null,
};

/** Sentinel option values for the key pickers — never valid step keys. */
const CUSTOM_KEY_OPTION = '__custom_key__';
const KEY_GROUP_QUESTIONS = '__group_questions__';
const KEY_GROUP_SYSTEM = '__group_system__';
/** Same idea for the value pickers — never a valid HubSpot picklist value. */
const CUSTOM_VALUE_OPTION = '__custom_value__';

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
  /**
   * Whether completed submissions are recorded as a HubSpot FORM SUBMISSION
   * activity, not just a note. The mirror form the API builds for it is stored
   * beside this flag and is not the author's to edit — see `settings.formGuid`.
   */
  formActivity: boolean;
  valueMaps: ValueMapGroup[];
  outcomeProperty: string;
  staticProperties: StaticPropertyRow[];
  inferCompanyFromEmail: boolean;
  bookingSync: BookingSyncState;
  /**
   * IANA zone naming the calendar day for every `date`-type property this
   * destination writes (submitted date, booking date). Blank = UTC. One zone
   * per destination — the pickers render it beside each date-type target, all
   * editing this same value. `datetime` targets keep the exact instant and
   * never use it.
   */
  dayTimezone: string;
  /**
   * The stored phases, untouched until the partials switch is flipped. Absent
   * = HubSpot's default (both), and stays absent on save (`CrmPartialsSwitch`).
   */
  events?: DestinationEvent[];
}

/** Contact properties stamped when a respondent books a meeting (all optional). */
interface BookingSyncState {
  stageProperty: string;
  stageValue: string;
  dateProperty: string;
  hoursProperty: string;
}

/**
 * The webhooks this screen does NOT edit, to be written back untouched.
 *
 * The card edits the FIRST stored webhook (`initialWebhook` below) and used to
 * be the only one `buildDestinations` emitted — so a form legitimately storing
 * two lost the second the moment anything on this tab was touched, including a
 * HubSpot toggle, because autosave rewrites the whole array. Silently, and with
 * no way to notice: the deleted one was never rendered here in the first place.
 *
 * Several webhooks is a legal configuration — only HubSpot is capped at one —
 * so the answer is to carry them rather than to warn about destroying them,
 * which is what the HubSpot notice has to do for a shape the API refuses.
 *
 * Identity is positional, matching how the card picks its own: the first
 * webhook is edited, the rest ride along in their stored order. Matching by
 * `id` would look tidier and be wrong, since a config written before ids
 * existed has none and the server mints them on write.
 *
 * Exported for the spec beside this file.
 */
/**
 * The HubSpot settings to store: what this screen edits, MERGED onto what it
 * does not.
 *
 * `settings` also carries `formGuid` and `formSignature`, which the API writes
 * when it builds the mirror form in the customer's portal. This screen has no
 * control for either and no business rewriting them — but it saves the whole
 * destination, so replacing the object wholesale (as `settings: { note }` did)
 * would drop the guid on the very next keystroke and strand a form in their
 * portal that nothing points at. The next save would then make another one.
 */
export function mergeHubspotSettings(
  stored: Record<string, unknown> | undefined,
  edited: { note: boolean; formActivity: boolean },
): Record<string, unknown> {
  return { ...(stored ?? {}), ...edited };
}

export function carriedWebhooks(destinations: FormDestination[]): FormDestination[] {
  return destinations.filter((d) => d.type === 'webhook').slice(1);
}

/**
 * Every destination this screen does not edit at all.
 *
 * `buildDestinations` assembles the array it saves from scratch, out of the two
 * things this tab shows: the webhook and the HubSpot mapping. That was complete
 * while those were the only kinds there were. It stopped being complete the
 * moment a Google Sheets destination could exist, and the consequence is not a
 * missing control but DATA LOSS: opening this tab and pressing save on an
 * unrelated field would delete a spreadsheet sync configured through the API,
 * silently, with the form still reporting a healthy save.
 *
 * So anything that is neither a webhook nor a HubSpot destination rides along
 * untouched. Written as "not the two kinds this screen knows" rather than as a
 * list of kinds to carry, so the next destination type is carried by default
 * instead of being quietly dropped until somebody notices.
 *
 * They go at the END of the saved array. `enqueueSubmissionDeliveries` builds a
 * delivery's idempotency key from its index, so a destination that changes
 * position can have one in-flight retry re-keyed and delivered twice. Appending
 * keeps the webhooks contiguous and in their stored order, which is what the
 * key scheme is most sensitive to, and costs at most that one duplicate on a
 * destination nobody is editing.
 */
export function carriedOthers(destinations: FormDestination[]): FormDestination[] {
  return destinations.filter(
    (d) =>
      d.type !== 'webhook' &&
      d.type !== 'hubspot' &&
      d.type !== 'google-sheets' &&
      d.type !== 'salesforce' &&
      d.type !== 'gohighlevel',
  );
}

/** The card's state, read out of the stored destination (or its empty start). */
export function initialGoogleSheets(destinations: FormDestination[]): GoogleSheetsState {
  const stored = destinations.find((d) => d.type === 'google-sheets');
  if (!stored || stored.type !== 'google-sheets') {
    return { enabled: false, spreadsheetId: '', sheetTitle: '', columns: [] };
  }
  return {
    enabled: stored.enabled !== false,
    spreadsheetId: stored.settings?.spreadsheetId ?? '',
    sheetTitle: stored.settings?.sheetTitle ?? '',
    columns: stored.columns ?? [],
    // What the API will count the columns against on the next save: the row
    // 1 it has on record, or for a config older than that, the stored
    // columns' own headings.
    writtenHeaders: sheetBaselineHeaders(stored),
  };
}

/**
 * Whether the spreadsheet card is shown at all.
 *
 * A deployment with no Google OAuth client cannot connect Google Sheets, and a
 * card there could only send the author to a page with nothing to click. The
 * exception is a form that already stores a spreadsheet destination: its card
 * stays, because a destination nobody can see is one nobody can switch off.
 *
 * Hiding the card never drops the destination. The state behind it is built
 * from the form and written back on save either way.
 */
export function showsGoogleSheetsCard(
  available: boolean,
  destinations: FormDestination[],
): boolean {
  return available || destinations.some((d) => d.type === 'google-sheets');
}

/**
 * The destination to store, or null only when the card holds nothing at all.
 *
 * A card the author has started (switched on, a spreadsheet, any column, even
 * a half-filled one) is stored as it stands, so everything the save pill calls
 * saved survives a reload. An unfinished destination is never delivered to:
 * the API skips it at enqueue time (`destinationIsDeliverable`) and leaves
 * incomplete columns out of the sheet, so storing it costs a respondent nothing.
 */
export function builtGoogleSheets(state: GoogleSheetsState): FormDestination | null {
  const columns = storedColumns(state.columns);
  if (!state.enabled && !state.spreadsheetId && columns.length === 0) return null;
  return {
    type: 'google-sheets',
    enabled: state.enabled,
    settings: {
      ...(state.spreadsheetId ? { spreadsheetId: state.spreadsheetId } : {}),
      ...(state.sheetTitle.trim() ? { sheetTitle: state.sheetTitle.trim() } : {}),
    },
    columns,
  };
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
  return {
    enabled: false,
    url: '',
    secret: '',
    hasSecret: false,
    firePartial: true,
    fireComplete: true,
  };
}

/** A row with something in it, but not everything it needs to be sent. */
const halfRow = (a: string, b: string): boolean => (!!a.trim() || !!b.trim()) && !(a.trim() && b.trim());

type HubspotDrafts = NonNullable<Extract<FormDestination, { type: 'hubspot' }>['drafts']>;

/**
 * The HubSpot rows the author started and has not finished, to store beside
 * the complete mappings (`drafts`), or undefined when there are none. Stored so
 * everything the save pill calls saved survives a reload; a delivery and the
 * mirror form read only the complete mappings. A row with nothing in it is
 * nothing to keep.
 */
export function hubspotDrafts(hs: HubspotState): HubspotDrafts | undefined {
  const mappings = hs.fieldMappings
    .filter((p) => halfRow(p.key, p.property))
    .map((p) => ({ key: p.key.trim(), property: p.property.trim() }));
  const statics = hs.staticProperties
    .filter((p) => halfRow(p.key, p.value))
    .map((p) => ({ key: p.key.trim(), value: p.value.trim() }));
  const valueMaps: { stepKey: string; rows: { from: string; to: string }[] }[] = [];
  for (const group of hs.valueMaps) {
    const stepKey = group.stepKey.trim();
    const unfinished = group.rows
      .filter((r) => (stepKey ? halfRow(r.from, r.to) : r.from.trim() || r.to.trim()))
      .map((r) => ({ from: r.from.trim(), to: r.to.trim() }));
    const anyComplete = !!stepKey && group.rows.some((r) => r.from.trim() && r.to.trim());
    // A question chosen with no complete row yet is kept too, so the choice
    // itself survives; a group with only complete rows lives in `valueMaps`.
    if (unfinished.length || (stepKey && !anyComplete)) valueMaps.push({ stepKey, rows: unfinished });
  }
  const out: HubspotDrafts = {
    ...(mappings.length ? { mappings } : {}),
    ...(statics.length ? { statics } : {}),
    ...(valueMaps.length ? { valueMaps } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

/** Put stored unfinished rows back on the card, after the complete ones. */
function withHubspotDrafts(state: HubspotState, drafts: HubspotDrafts | undefined): HubspotState {
  if (!drafts) return state;
  const valueMaps = state.valueMaps.map((g) => ({ ...g, rows: [...g.rows] }));
  for (const draft of drafts.valueMaps ?? []) {
    const existing = draft.stepKey ? valueMaps.find((g) => g.stepKey === draft.stepKey) : undefined;
    if (existing) existing.rows.push(...draft.rows);
    else valueMaps.push({ stepKey: draft.stepKey, rows: draft.rows.length ? draft.rows : [{ from: '', to: '' }] });
  }
  return {
    ...state,
    fieldMappings: [...state.fieldMappings, ...(drafts.mappings ?? [])],
    staticProperties: [...state.staticProperties, ...(drafts.statics ?? [])],
    valueMaps,
  };
}

export function initialHubspot(destinations: FormDestination[]): HubspotState {
  const h = destinations.find((d) => d.type === 'hubspot');
  if (h && h.type === 'hubspot') {
    return withHubspotDrafts({
      enabled: h.enabled,
      // One ROW per target property: a mapping that fans out to several shows
      // as several rows with the same key, which is the shape the editor can
      // actually author. `buildDestinations` groups them back.
      fieldMappings: Object.entries(h.fieldMappings ?? {}).flatMap(([key, target]) =>
        propertiesFor(target).map((property) => ({ key, property })),
      ),
      utmMappings: { ...(h.utmMappings ?? {}) },
      scoreProperty: h.scoreProperty ?? '',
      dateProperty: h.dateProperty ?? '',
      note: h.settings?.note !== false,
      // Opt-in: the mirror form creates an object in the customer's portal and
      // needs scopes their token may not carry, so an existing form never
      // starts doing it by surprise.
      formActivity: h.settings?.formActivity === true,
      valueMaps: Object.entries(h.valueMaps ?? {}).map(([stepKey, map]) => ({
        stepKey,
        rows: Object.entries(map).map(([from, to]) => ({ from, to })),
      })),
      outcomeProperty: h.outcomeProperty ?? '',
      staticProperties: Object.entries(h.staticProperties ?? {}).map(([key, value]) => ({
        key,
        value,
      })),
      inferCompanyFromEmail: h.inferCompanyFromEmail === true,
      bookingSync: {
        stageProperty: h.bookingSync?.stageProperty ?? '',
        stageValue: h.bookingSync?.stageValue ?? '',
        dateProperty: h.bookingSync?.dateProperty ?? '',
        hoursProperty: h.bookingSync?.hoursProperty ?? '',
      },
      // The old per-bookingSync zone is the fallback so a config saved before
      // the shared field keeps the zone it was saved with.
      dayTimezone: h.dayTimezone ?? h.bookingSync?.dateTimezone ?? '',
      ...(h.events ? { events: h.events } : {}),
    }, h.drafts);
  }
  return {
    enabled: false,
    fieldMappings: [],
    utmMappings: {},
    scoreProperty: '',
    dateProperty: '',
    note: true,
    formActivity: false,
    valueMaps: [],
    outcomeProperty: '',
    staticProperties: [],
    inferCompanyFromEmail: false,
    bookingSync: {
      stageProperty: '',
      stageValue: '',
      dateProperty: '',
      hoursProperty: '',
    },
    dayTimezone: '',
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
  googleSheetsConnected = false,
  googleSheetsAvailable = true,
  googlePickerAvailable = false,
  salesforceConnected = false,
  salesforceFields = { enabled: false, reason: 'not_connected' },
  goHighLevelConnected = false,
  goHighLevelRejected = false,
  goHighLevelFields = { enabled: false, reason: 'not_connected' },
  access = DEFAULT_CONNECT_ACCESS,
  googleJustConnected = false,
  formName = '',
  questions,
  scoring,
  readiness = NOT_READY,
  partialsHeld = false,
  messages: m,
  locale,
}: {
  id: string;
  initialDestinations: FormDestination[];
  hubspot: HubSpotPropertiesResponse;
  /** Account-level HubSpot connection status (gates the mapping UI). */
  hubspotConnected: boolean;
  /** Account-level Google connection: without it the spreadsheet card cannot list tabs. */
  googleSheetsConnected?: boolean;
  /**
   * Whether this deployment can connect Google Sheets at all. When it cannot,
   * the spreadsheet card is left out, unless this form already stores a
   * spreadsheet destination: that one stays visible so it can be switched off.
   */
  googleSheetsAvailable?: boolean;
  /** Whether an existing spreadsheet can be chosen in Google's Picker. */
  googlePickerAvailable?: boolean;
  /** Account-level Salesforce connection. */
  salesforceConnected?: boolean;
  /** The connected org's fields as the tab loaded them. */
  salesforceFields?: SalesforceFieldsResponse;
  /** Account-level HighLevel connection. */
  goHighLevelConnected?: boolean;
  /** HighLevel stopped accepting the stored token. */
  goHighLevelRejected?: boolean;
  /** The connected location's fields as the tab loaded them. */
  goHighLevelFields?: GoHighLevelFieldsResponse;
  /**
   * Whether the viewer can connect an account from these cards (owners and
   * admins, on a deployment with an encryption key). The cards connect in
   * place, so nobody has to leave the form to do it.
   */
  access?: ConnectAccess;
  /**
   * The author just came back from connecting Google on this tab. Their card
   * was switched on before they left, but a spreadsheet destination with no
   * spreadsheet is never stored, so without this it would come back closed.
   */
  googleJustConnected?: boolean;
  /** Names the spreadsheet the card creates for this form. */
  formName?: string;
  /** The form's mappable questions (from its steps). */
  questions: QuestionMeta[];
  /**
   * Which of the score and outcome columns the form can fill (`scoringColumns`),
   * for the spreadsheet card's default plan. Absent offers both.
   */
  scoring?: { score: boolean; outcome: boolean };
  /**
   * Spam protection holds this form's partial answers: saved, delivered to no
   * destination. The cards say so; the stored triggers are left as they are.
   */
  partialsHeld?: boolean;
  /**
   * Whether this form can key a CRM contact — config AND connections. The
   * screen must not promise a sync it cannot deliver, so the copy below reads
   * this rather than the config alone.
   */
  readiness?: ContactKeyReadiness;
  messages: Msgs;
  locale: Locale;
}) {
  const { error } = useToast();
  const errorRef = useRef(error);
  // The form's save queue retries a failed save itself only while nobody is
  // on the tab; while this editor is mounted, its controller does.
  useEffect(() => subscribeIntegrationsSave(id), [id]);
  // While this editor is on screen, a card left out of a save (`partial`) is
  // the save state; elsewhere it is only marked on the Connect tab.
  useEffect(() => {
    setConnectTabOpen(id, true);
    return () => setConnectTabOpen(id, false);
  }, [id]);
  // Whether this editor is still on screen. A card action can finish after
  // the tab was left (a spreadsheet being created in Drive), and what it does
  // then must neither claim a save that will never run nor be thrown away.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  errorRef.current = error;
  const [webhook, setWebhook] = useState<WebhookState>(() => initialWebhook(initialDestinations));
  const [hs, setHs] = useState<HubspotState>(() => initialHubspot(initialDestinations));
  const [sheets, setSheets] = useState<GoogleSheetsState>(() => {
    const initial = initialGoogleSheets(initialDestinations);
    // Opened, not saved: nothing about the destination is storable until a
    // spreadsheet is chosen, and choosing one is an edit that saves itself.
    return googleJustConnected && !initial.spreadsheetId ? { ...initial, enabled: true } : initial;
  });
  // Back from Google: put the card the author left from in front of them.
  useEffect(() => {
    if (!googleJustConnected) return;
    document.getElementById('gsheets-card')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [googleJustConnected]);
  const [sf, setSf] = useState<SalesforceState>(() => initialSalesforce(initialDestinations));
  const [ghl, setGhl] = useState<GoHighLevelState>(() => initialGoHighLevel(initialDestinations));
  const [formActivityError, setFormActivityError] = useState<string | null>(null);
  /** What the last save (or the header button) did to the sheet's row 1. */
  const [sheetHeaderSync, setSheetHeaderSync] = useState<SheetHeaderSync | null>(null);
  const [webhookError, setWebhookError] = useState<string | null>(null);
  // The destinations as the server last accepted them. Seeded from the freshly
  // fetched mount props and advanced on every successful save, so the "protect
  // the working webhook from a transient bad keystroke" fallback below never
  // reverts to a stale page-load snapshot (V4-05). `initialDestinations` alone
  // was a mount-time value the tab's refetch never refreshed — a second edit
  // then restored it, and an actual submission was delivered to the old URL.
  const savedDestinations = useRef<FormDestination[]>(initialDestinations);

  // Local copies of the tab's HubSpot load, so connecting HubSpot from its own
  // card opens the mapping without a reload.
  const [hubspotData, setHubspotData] = useState<HubSpotPropertiesResponse>(hubspotProps);
  const [hubspotLive, setHubspotLive] = useState(hubspotConnected);
  const properties = hubspotData.enabled ? hubspotData.properties : [];
  const pickerEnabled = hubspotData.enabled;
  // Show the mapping when HubSpot is usable for this account: an explicit
  // account connection, OR the property picker resolved via the server env
  // fallback (self-host). Otherwise prompt the user to connect first.
  const showMapping = hubspotLive || pickerEnabled;

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
  function buildDestinations(): {
    destinations: FormDestination[];
    webhookError: string | null;
    /** The webhook is switched on with no URL: not stored, so not "saved". */
    webhookNeedsUrl: boolean;
  } {
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

    // Every webhook this screen does not edit rides along, in all three cases
    // above — including the empty-URL one, where clearing the field removes the
    // FIRST webhook and must not take its siblings with it.
    //
    // They sit here, next to the edited one and before HubSpot, rather than at
    // the end: `enqueueSubmissionDeliveries` builds its idempotency key from a
    // destination's index in this array, so keeping the webhooks contiguous and
    // in their stored order is the arrangement that moves the fewest of them.
    out.push(...carriedWebhooks(savedDestinations.current));

    // Rows GROUP by key rather than overwriting. The old flatten was
    // last-one-wins and silent: two rows on the same question — the escape
    // hatch the UI itself offers via "Custom key…" — quietly discarded the
    // first mapping on save.
    const grouped = new Map<string, string[]>();
    for (const p of hs.fieldMappings) {
      const key = p.key.trim();
      const property = p.property.trim();
      if (!key || !property) continue;
      const list = grouped.get(key) ?? [];
      if (!list.includes(property)) list.push(property);
      grouped.set(key, list);
    }
    const fieldMappings: Record<string, string | string[]> = {};
    for (const [key, list] of grouped) fieldMappings[key] = list.length === 1 ? list[0]! : list;
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
    const dayTimezone = hs.dayTimezone.trim();
    // Mirrored into the legacy per-bookingSync field whenever booking sync is
    // in use, so a server that predates the shared zone (a rolling deploy)
    // still collapses the booking day in it. Cleared together too — the
    // server-side fallback reads the old field when the new one is absent, and
    // a stale mirror would resurrect a zone the author removed.
    if (dayTimezone && Object.keys(bookingSync).length > 0) {
      bookingSync.dateTimezone = dayTimezone;
    }
    // Half-filled rows, kept so a reload brings them back (never delivered).
    const drafts = hubspotDrafts(hs);
    const hasHubspotConfig =
      hs.enabled ||
      drafts !== undefined ||
      Object.keys(fieldMappings).length > 0 ||
      Object.keys(utmMappings).length > 0 ||
      Object.keys(valueMaps).length > 0 ||
      Object.keys(staticProperties).length > 0 ||
      Object.keys(bookingSync).length > 0 ||
      hs.scoreProperty.trim() ||
      hs.dateProperty.trim() ||
      hs.outcomeProperty.trim() ||
      hs.inferCompanyFromEmail ||
      hs.events !== undefined;
    if (hasHubspotConfig) {
      // Round-trip any stored HubSpot fields this screen does not manage (e.g.
      // booking-sync settings saved elsewhere) so a save here never clobbers them.
      const stored = initialDestinations.find((d) => d.type === 'hubspot');
      out.push({
        ...(stored && stored.type === 'hubspot' ? stored : {}),
        type: 'hubspot',
        enabled: hs.enabled,
        settings: mergeHubspotSettings(
          stored && stored.type === 'hubspot' ? stored.settings : undefined,
          { note: hs.note, formActivity: hs.formActivity },
        ),
        fieldMappings,
        utmMappings,
        scoreProperty: hs.scoreProperty.trim() || null,
        dateProperty: hs.dateProperty.trim() || null,
        valueMaps,
        outcomeProperty: hs.outcomeProperty.trim() || null,
        staticProperties,
        inferCompanyFromEmail: hs.inferCompanyFromEmail,
        // Blank = UTC; undefined overrides the stored spread so clearing the
        // zone actually removes it instead of resurrecting the stored value.
        dayTimezone: dayTimezone || undefined,
        // All fields blank = booking sync off; undefined overrides the stored
        // spread above so clearing the fields actually removes the config.
        bookingSync: Object.keys(bookingSync).length > 0 ? bookingSync : undefined,
        // undefined overrides the stored spread, so finishing the last
        // unfinished row clears them instead of resurrecting them.
        drafts,
        // As the card holds them: stored, or what the partials switch wrote.
        // Absent stays absent, so an untouched legacy config is unchanged.
        ...(hs.events !== undefined ? { events: hs.events } : {}),
      });
    }
    // The spreadsheet destination, when the card says enough to store one.
    const sheetsDestination = builtGoogleSheets(sheets);
    if (sheetsDestination) out.push(sheetsDestination);

    // Salesforce: the first stored one, as this card edits it. A stored second
    // is dropped on save (the card says so), the same rule as HubSpot's.
    const salesforceDestination = builtSalesforce(sf);
    if (salesforceDestination) out.push(salesforceDestination);

    // HighLevel: the first stored one, same rule. Everything the card does not
    // change (events, tags, drafts) is read in and written back as it was.
    const goHighLevelDestination = builtGoHighLevel(ghl);
    if (goHighLevelDestination) out.push(goHighLevelDestination);

    // Last: every destination kind this screen does not edit (see
    // `carriedOthers`). Without this, saving here deletes them.
    out.push(...carriedOthers(savedDestinations.current));
    return { destinations: out, webhookError, webhookNeedsUrl: webhook.enabled && !url };
  }

  // --- Autosave (V5-A4) ------------------------------------------------------
  // Connect was the last tab still gated behind an explicit Save button, so an
  // edit made here — flipping the connection on, re-pointing one property —
  // looked identical to an edit made in Build but was silently discarded on
  // leaving. Same contract as the builder now: debounce, flush on the way out,
  // and a status line that says which state you are in.
  const buildRef = useRef(buildDestinations);
  buildRef.current = buildDestinations;

  // The debounce/serialize/retry machinery is `useAutosave`, shared with the
  // builder — including the beforeunload guard and the same-origin keepalive
  // flush (the old direct-to-API beacon sent cookies to a host that only
  // accepts identity headers, so it never authenticated).
  const autosave = useAutosave<{
    destinations: FormDestination[];
    webhookError: string | null;
    /** The webhook is switched on with no URL: not stored, so not "saved". */
    webhookNeedsUrl: boolean;
  }>({
    getSnapshot: () => buildRef.current(),
    // `buildDestinations` already quarantines the only invalid input (a bad
    // webhook URL) onto its own card, so a snapshot is always sendable.
    validate: useCallback(() => ({ ok: true as const }), []),
    save: async (built) => {
      // A bad webhook URL is reported on its own card and blocks only itself —
      // the rest of the tab still persists.
      setWebhookError(built.webhookError);
      // The editor's topbar shows this save too (see `integrations-save-status`).
      // Published from HERE, the one function every save runs through, the
      // terminal save the controller fires after the tab unmounts included:
      // a component effect is gone by then, and the topbar would be left
      // saying "Saving" (or "Not saved" after a retry that succeeded).
      // Through the form's save queue (`integrations-save-queue`), not
      // straight to the server: it serializes writes, only ever writes or
      // retries the LATEST snapshot, keeps going after the tab unmounts, and
      // is what the topbar and the pill both read.
      const outcome = await enqueueIntegrationsSave(
        id,
        () => callAction(() => saveIntegrationsAction(id, built.destinations)),
        {
          // Partial, not saved: a webhook URL that is not valid, or a webhook
          // switched on with no URL at all (a webhook cannot be stored without
          // one, so "saved" would come back switched off after a reload).
          partial: built.webhookError
            ? `${m.autosavedPartial} ${built.webhookError}`.trim()
            : built.webhookNeedsUrl
              ? `${m.autosavedPartial} ${m.webhookNeedsUrl}`
              : null,
          messages: { saveOffline: m.saveOffline, saveError: m.saveError, lost: m.saveLostAfterLeave },
        },
      );
      // A newer snapshot took this one's place: it decides what is stored.
      if (outcome.kind === 'superseded') return { ok: true };
      const res = outcome.result;
      if (isTransportError(res)) return res;
      if (!res.ok) return { ok: false, message: res.message ?? m.saveError };
      // HubSpot refused to build the mirror form. The save itself went through,
      // so this is a NOTICE on the card and not a save error — losing the
      // author's mappings because a portal is missing a scope would be worse
      // than the missing activity.
      setFormActivityError(res.formActivityError ?? null);
      // Only a save that touched the headings or the spreadsheet reports one;
      // any other save leaves the last outcome on the card.
      if (res.sheetHeaders) setSheetHeaderSync(res.sheetHeaders);
      // What the API now has on record for row 1: not an edit (nothing is
      // marked dirty), only what the card's letters are counted against.
      if (res.sheetWritten !== undefined) {
        const written = res.sheetWritten;
        setSheets((prev) => ({ ...prev, writtenHeaders: written }));
      }
      // This array is now the server truth — the malformed-URL fallback carries
      // it forward instead of the stale mount snapshot.
      savedDestinations.current = built.destinations;
      // A card left out (a webhook URL that is not valid) is reported by the
      // queue as `partial`, to the pill AND the topbar: it is not saved.
      return { ok: true };
    },
    beacon: (built) => {
      try {
        void fetch(`/admin/forms/${id}/flush`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'destinations',
            destinations: built.destinations,
          }),
          keepalive: true,
        });
      } catch {
        /* best-effort on the unload path */
      }
    },
    onFailure: (message, kind) => errorRef.current(kind === 'transport' ? m.saveOffline : message),
    debounceMs: AUTOSAVE_MS,
  });
  const { markDirty: markDirtyRaw } = autosave;
  // On mount the tab shows what the server holds (it waited for any write a
  // previous mount left in flight), so that is the truth to publish: never a
  // status inherited from an earlier visit. A change that was lost after the
  // author left is the exception: it is not on the screen they see, so the
  // state STAYS an error (topbar, pill, and the notice below) until they
  // dismiss the notice or a later save succeeds. It is said in a toast ONCE
  // per lost change (`announced`), not on every visit to the tab.
  useEffect(() => {
    const previous = readIntegrationsSave(id);
    if (previous?.lost) {
      if (!previous.announced) {
        markLostSaveAnnounced(id);
        errorRef.current(previous.detail ?? m.saveLostAfterLeave);
      }
      return;
    }
    publishIntegrationsSave(id, { status: 'saved' });
  }, [id, m]);
  const integrationsSave = useIntegrationsSave(id);
  // Whether the author has edited anything on this visit. The pill says
  // nothing before that: no "saved" (or any advisory) on a page just opened.
  const [saveTouched, setSaveTouched] = useState(false);
  // An edit makes the topbar and the pill say "Saving" at once, rather than
  // only when the debounced save starts.
  const markDirty = useCallback(() => {
    // Nothing saves an edit made on an editor that is gone (its controller
    // is disposed), so nothing may say "Saving" for it: the topbar would sit
    // on it until the next visit to this tab. See `editSheets` for what a
    // card action that finishes late does instead.
    if (!mountedRef.current) return;
    setSaveTouched(true);
    publishIntegrationsSave(id, { status: 'saving' });
    markDirtyRaw();
  }, [id, markDirtyRaw]);
  // The pill reads the SAME state the topbar reads (the form's save queue
  // publishes it), so the two can never disagree, not even for a frame.
  const shared = useCombinedSave(id);
  const status: SaveStatus = shared.status;
  const statusDetail = shared.detail;

  /**
   * Every card edit funnels through these so an edit is marked dirty at the
   * moment it happens. Wrapping the setters (rather than watching state in an
   * effect) keeps the initial render from counting as an edit and autosaving
   * a form nobody touched.
   */
  const editWebhook = useCallback(
    (next: WebhookState) => {
      setWebhook(next);
      markDirty();
    },
    [markDirty],
  );
  const editHubspot = useCallback(
    (next: HubspotState) => {
      setHs(next);
      markDirty();
    },
    [markDirty],
  );
  const editSheets = useCallback(
    (next: GoogleSheetsState) => {
      if (!mountedRef.current) {
        // The card's action finished after the tab was left: "Create sheet"
        // was pressed, the author moved to Build, and the spreadsheet now
        // exists in their Drive. It is attached to the form as an OUTSIDE
        // write on the form's save lane (`runDestinationWrite`): one card,
        // merged onto what the form stores at that moment.
        //
        // NOT as a snapshot. It was enqueued as one, and a snapshot replaces
        // the save waiting behind it and cancels the retry of a failed one:
        // with Salesforce switched on just before leaving and that last save
        // failing once, only the spreadsheet was sent, the topbar said
        // "saved" and the Salesforce change was gone. As an outside write it
        // waits for that save (and its retries) and lands on top of it.
        const card = builtGoogleSheets(next);
        if (!card) return;
        void runDestinationWrite(
          id,
          // The merge is idempotent (it sets this one card), so a dropped
          // connection is retried in place before the change is called lost.
          () => callActionWithRetry(() => mergeIntegrationCardAction(id, card), { attempts: 3, baseDelayMs: 1500 }),
          { report: { lost: m.saveLostAfterLeave } },
        );
        return;
      }
      setSheets(next);
      markDirty();
    },
    [id, m, markDirty],
  );
  const editSalesforce = useCallback(
    (next: SalesforceState) => {
      setSf(next);
      markDirty();
    },
    [markDirty],
  );
  const editGoHighLevel = useCallback(
    (next: GoHighLevelState) => {
      setGhl(next);
      markDirty();
    },
    [markDirty],
  );

  return (
    <div className="flex flex-col gap-6">
      {integrationsSave?.lost ? (
        <LostChangeNotice
          text={integrationsSave.detail ?? m.saveLostAfterLeave}
          dismissLabel={m.saveLostDismiss}
          onDismiss={() => acknowledgeLostIntegrationsSave(id)}
        />
      ) : null}
      <WebhookCard
        state={webhook}
        onChange={editWebhook}
        urlError={webhookError}
        clearUrlError={() => setWebhookError(null)}
        formId={id}
        // From the mount props, like HubSpot's own count: the Connect tab
        // refetches the live config every time it is opened, so this is as
        // fresh as the array the card was seeded from.
        carriedCount={carriedWebhooks(initialDestinations).length}
        canTest={access.canConnect}
        partialsHeld={partialsHeld}
        locale={locale}
        m={m}
      />
      <LocaleContext.Provider value={locale}>
        <HubspotCard
          state={hs}
          onChange={editHubspot}
          properties={properties}
          pickerEnabled={pickerEnabled}
          accountConnected={hubspotLive}
          showMapping={showMapping}
          access={access}
          locale={locale}
          onConnected={async () => {
            setHubspotLive(true);
            const res = await callAction(() => hubspotPropertiesAction());
            // A transport failure leaves the picker as it was; the mapping
            // still opens (the account IS connected) and a reload refills it.
            if (!isTransportError(res)) setHubspotData(res);
          }}
          // Legacy shape: this screen edits the FIRST HubSpot destination and
          // saves exactly one, so a stored second silently disappears on the
          // next save. Say so rather than letting it vanish (`buildDestinations`).
          extraHubspotStored={initialDestinations.filter((d) => d.type === 'hubspot').length > 1}
          formActivityError={formActivityError}
          readiness={readiness}
          questions={questions}
          partialsHeld={partialsHeld}
          formId={id}
          m={m}
        />
      </LocaleContext.Provider>

      {showsGoogleSheetsCard(googleSheetsAvailable, initialDestinations) ? (
        <GoogleSheetsCard
          state={sheets}
          setState={editSheets}
          questions={questions}
          scoring={scoring}
          connected={googleSheetsConnected}
          pickerAvailable={googlePickerAvailable}
          formName={formName}
          formId={id}
          access={access}
          headerSync={sheetHeaderSync}
          onHeaderSync={(sync) => {
            setSheetHeaderSync(sync);
            // The button (or the confirmed replace) left row 1 equal to the
            // stored columns: that is the row the card counts against now.
            if (sync?.outcome === 'written' || sync?.outcome === 'unchanged') {
              setSheets((prev) => ({
                ...prev,
                writtenHeaders: sheetCells(storedColumns(prev.columns), prev.writtenHeaders).map((c) => c.header),
              }));
            }
          }}
          beforeHeaderSync={autosave.flush}
          locale={locale}
          m={m}
        />
      ) : null}

      <SalesforceCard
        state={sf}
        setState={editSalesforce}
        partialsHeld={partialsHeld}
        questions={questions}
        connected={salesforceConnected}
        initialFields={salesforceFields}
        extraStored={initialDestinations.filter((d) => d.type === 'salesforce').length > 1}
        formId={id}
        access={access}
        locale={locale}
        m={m}
      />

      <GoHighLevelCard
        state={ghl}
        setState={editGoHighLevel}
        questions={questions}
        connected={goHighLevelConnected}
        rejected={goHighLevelRejected}
        initialFields={goHighLevelFields}
        extraStored={initialDestinations.filter((d) => d.type === 'gohighlevel').length > 1}
        formId={id}
        formName={formName}
        access={access}
        partialsHeld={partialsHeld}
        locale={locale}
        m={m}
      />

      {/* The Save button is gone (V5-A4): everything here autosaves, so what
          belongs on screen is the state of that save, not an action. */}
      <SaveStatusPill
        status={status}
        detail={statusDetail}
        touched={saveTouched || shared.lost}
        m={m}
      />
    </div>
  );
}

/**
 * "Your last change here was not saved", on the page, with a way to put it
 * down. The tab under it already shows what the server holds, so once the
 * author has read it there is nothing left to warn about: dismissing it
 * clears the error from the topbar and the pill. Until then it stays.
 */
function LostChangeNotice({
  text,
  dismissLabel,
  onDismiss,
}: {
  text: string;
  dismissLabel: string;
  onDismiss: () => void;
}) {
  // Brought into view once: the tab can open scrolled down to the card the
  // author was last on, and the way to dismiss this must not be off screen.
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'center' });
  }, []);
  return (
    <div
      ref={ref}
      role="alert"
      data-testid="integrations-lost-notice"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      <i aria-hidden className="pi pi-exclamation-triangle shrink-0" style={{ fontSize: 14 }} />
      <p className="min-w-0 flex-1 basis-56 leading-snug">{text}</p>
      <Button
        variant="outline"
        size="sm"
        // On the card surface, in ink: a button, not more red text in a red box.
        className="border-destructive/40 bg-card text-foreground hover:bg-muted"
        onClick={onDismiss}
        data-testid="integrations-lost-dismiss"
      >
        {dismissLabel}
      </Button>
    </div>
  );
}

type SaveStatus = 'saved' | 'saving' | 'retrying' | 'error' | 'partial' | 'conflict';

/** The pill's look for each save state. Tokens only, so both themes follow. */
const PILL_TONE: Record<SaveStatus, { box: string; icon: string; dot: string }> = {
  saved: {
    box: 'border-signal-edge/60 bg-signal/15 text-foreground',
    icon: 'pi-check',
    // A solid signal disc carrying the check: the one unmistakable "done".
    dot: 'bg-signal text-signal-foreground',
  },
  saving: { box: 'border-border bg-card text-muted-foreground', icon: 'pi-spinner pi-spin', dot: 'text-muted-foreground' },
  retrying: { box: 'border-warning/50 bg-warning/10 text-foreground', icon: 'pi-sync pi-spin', dot: 'text-warning-ink' },
  partial: { box: 'border-warning/50 bg-warning/10 text-foreground', icon: 'pi-exclamation-circle', dot: 'text-warning-ink' },
  error: {
    box: 'border-destructive/60 bg-destructive/10 text-destructive',
    icon: 'pi-exclamation-triangle',
    dot: 'text-destructive',
  },
  // The form's draft was saved elsewhere: the topbar's state, so the pill's too.
  conflict: {
    box: 'border-destructive/60 bg-destructive/10 text-destructive',
    icon: 'pi-exclamation-triangle',
    dot: 'text-destructive',
  },
};

/** How long a "saved" pill stays spelled out before it folds to its short form. */
const PILL_FOLD_MS = 1500;
/**
 * How long a "saved" pill stays before it steps out of the way. ONLY "saved"
 * goes away on its own: saving, retrying, partial, error and a lost change
 * stay on screen until they resolve, at every width. The topbar status is not
 * a fallback for them, since it is hidden below 1280 px.
 */
const PILL_SAVED_HIDE_MS = 2500;

/** Below `sm`, where any floating element sits on the controls being scrolled. */
const NARROW_QUERY = '(max-width: 639px)';

/**
 * The autosave state, as a pill fixed to the bottom-right corner of the window.
 *
 * It shows the SAME state as the editor's topbar (both read what the form's
 * save queue publishes), so the two never disagree. Fixed and portalled to
 * `body`, because `position: fixed` inside the editor would be pinned to
 * whichever ancestor opens a stacking context instead of the window.
 *
 * It is a status, never a control, and it never stands in the way:
 *  - nothing before the author edits something on this visit: no "saved",
 *    and no advisory either (those live in the cards themselves, inline);
 *  - it never takes a tap: `pointer-events: none` in every state, so a button
 *    under it is always pressable;
 *  - a plain "saved" folds to a short, flat "Saved" after a moment;
 *  - once settled it steps away after a few seconds, at every width (the
 *    topbar keeps saying the state), so it never sits over content for long;
 *  - it reads the same store snapshot as the topbar (`useCombinedSave`), so
 *    the two never show different states.
 *
 * A lost change (failed after the tab was left) shows even before an edit:
 * it is an error the author has to know about.
 */
export function SaveStatusPill({
  status,
  detail,
  touched = true,
  m,
}: {
  status: SaveStatus;
  detail: string | null;
  /** The author edited something on this visit. Before that the pill is absent. */
  touched?: boolean;
  m: Msgs;
}) {
  const [mounted, setMounted] = useState(false);
  const [folded, setFolded] = useState(false);
  const [gone, setGone] = useState(false);
  const visible = touched && !gone;
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!visible) return;
    // Lets the toast stack start above the pill (globals.css).
    document.documentElement.classList.add('has-save-pill');
    return () => document.documentElement.classList.remove('has-save-pill');
  }, [visible]);
  // The pill wraps (a partial or failed save can take two or three lines), so
  // the toast stack is lifted by the pill's real height, not a one-line guess:
  // a toast never lands on top of the pill.
  const [pillEl, setPillEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!pillEl || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const lift = () =>
      root.style.setProperty(
        '--toast-offset',
        `calc(${Math.ceil(pillEl.getBoundingClientRect().height) + 12}px + env(safe-area-inset-bottom, 0px))`,
      );
    lift();
    const observer = new ResizeObserver(lift);
    observer.observe(pillEl);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--toast-offset');
    };
  }, [pillEl]);
  useEffect(() => {
    setGone(false);
    setFolded(false);
    // A state that is not "saved" stays until it resolves: no fold, no exit.
    if (status !== 'saved') return;
    const narrow = typeof window !== 'undefined' && window.matchMedia?.(NARROW_QUERY).matches;
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (narrow) setFolded(true);
    else timers.push(setTimeout(() => setFolded(true), PILL_FOLD_MS));
    timers.push(setTimeout(() => setGone(true), PILL_SAVED_HIDE_MS));
    return () => timers.forEach(clearTimeout);
  }, [status, detail]);
  const tone = PILL_TONE[status];
  const text =
    status === 'saved'
      ? m.autosaved
      : status === 'error' || status === 'conflict'
        ? (detail ?? m.saveError)
        : status === 'partial'
          ? (detail ?? m.autosavedPartial)
          : status === 'retrying'
            ? m.saveRetrying
            : m.saving;
  if (!mounted || !visible) return null;
  return createPortal(
    <div
      ref={setPillEl}
      data-testid="integrations-save-status"
      data-status={status}
      data-folded={folded || undefined}
      role="status"
      aria-live="polite"
      className={cn(
        // `pointer-events-none` in EVERY state: a status never takes a tap.
        'pointer-events-none fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-40 max-w-[calc(100vw-2rem)] rounded-[1.25rem] bg-card sm:right-5 sm:bottom-5 sm:max-w-[28rem]',
        folded ? '' : 'shadow-lg',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 rounded-[1.25rem] border text-sm font-medium',
          folded ? 'py-1 pl-1 pr-3 text-xs' : 'py-1.5 pl-1.5 pr-4',
          tone.box,
        )}
      >
        <span
          aria-hidden
          className={cn(
            'flex shrink-0 items-center justify-center rounded-full',
            folded ? 'h-5 w-5' : 'h-6 w-6',
            tone.dot,
          )}
        >
          <i className={cn('pi', tone.icon)} style={{ fontSize: folded ? 10 : 12 }} />
        </span>
        {/* Never clipped: a partial or failed save names what did not go
            through, and that sentence is the point of the state. It wraps. */}
        <span className="min-w-0 break-words leading-snug">{folded ? m.autosavedShort : text}</span>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The shared Day-timezone control — rendered beside EACH `date`-type property
 * pick so the zone is discoverable where it matters, every instance editing
 * the ONE destination-level value. A `datetime` target never shows it: it
 * keeps the exact instant, which the portal renders in its own zone.
 */
function DayTimezoneField({
  value,
  onChange,
  m,
}: {
  value: string;
  onChange: (v: string) => void;
  m: Msgs;
}) {
  const locale = useContext(LocaleContext);
  const errorId = useId();
  const timezones = browserTimezones();
  const tzKnown = isKnownTimezone(value);
  return (
    <Field label={m.bookingDateTimezone} help={m.bookingDateTimezoneHelp}>
      {timezones ? (
        <Select
          ariaLabel={m.bookingDateTimezone}
          value={value}
          // A stored zone the browser cannot enumerate (saved elsewhere, or
          // before this was a picker) still renders as its own option — the
          // trigger must show what is actually configured, and picking any
          // list entry replaces it.
          options={[
            { value: '', label: m.bookingDateTimezoneUtc },
            ...(value && !timezones.includes(value) ? [{ value, label: value }] : []),
            ...timezones.map((zone) => ({ value: zone, label: zone })),
          ]}
          searchable
          locale={locale}
          onChange={onChange}
        />
      ) : (
        /* The zone check is advisory — the value still saves, and the SERVER's
           ICU data is what decides. So the message sits ALONGSIDE the help
           rather than replacing it: the help carries the format, and a person
           who has just mistyped a zone is exactly who still needs to read it.
           The message carries an id because `aria-invalid` with nothing
           pointed at announces "invalid" and no reason. */
        <Input
          value={value}
          aria-label={m.bookingDateTimezone}
          // A real zone name, so the format is legible without reading the help.
          placeholder={m.bookingDateTimezonePlaceholder}
          aria-invalid={tzKnown ? undefined : true}
          aria-describedby={tzKnown ? undefined : errorId}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {tzKnown ? null : (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {m.bookingDateTimezoneInvalid}
        </p>
      )}
    </Field>
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
    ...properties.map((p) => ({
      value: p.name,
      label: `${p.label} (${p.name})`,
    })),
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
 * A VALUE picker: the same free-text `Input` as before when nothing constrains
 * the value, or a searchable Select of the property's own picklist when
 * something does — plus a "Custom value…" escape hatch back to text.
 *
 * Deliberately NOT folded into `PropertyField` or `KeySelect`. Their branches
 * turn on different questions (is the picker connected at all? / is this key one
 * of the form's questions?), and `KeySelect`'s markup is asserted by two
 * Playwright suites. ~25 duplicated lines is the cheaper side of that trade.
 *
 * `options === undefined` is the whole "no picklist" test — the API omits the
 * key rather than sending `[]` (see `HubSpotProperty`).
 */
function OptionValueField({
  value,
  onChange,
  options,
  m,
  ariaLabel,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  /** The values this may legally be, or undefined for free text. */
  options: HubSpotPropertyOption[] | undefined;
  m: Msgs;
  ariaLabel: string;
  placeholder: string;
}) {
  const locale = useContext(LocaleContext);
  // A value the list can't show opens in text mode with the value VISIBLE. In a
  // Select it would render as an empty box — configured, still written to
  // HubSpot, and looking unset. Initial state only: switching modes later is
  // the author's choice, made through the two buttons below.
  const [customMode, setCustomMode] = useState(() => isCustomValue(options, value));

  if (!options || customMode) {
    return (
      <div className="flex flex-1 items-center gap-2">
        <Input
          value={value}
          aria-label={ariaLabel}
          placeholder={placeholder}
          className="flex-1"
          onChange={(e) => onChange(e.target.value)}
        />
        {/* Only offered when there IS a list to go back to. */}
        {options ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // Never destroy a typed value on a mis-click — but a value the
              // list cannot show would look unselected, so clear that one.
              if (isCustomValue(options, value)) onChange('');
              setCustomMode(false);
            }}
          >
            {m.valueCustomBack}
          </Button>
        ) : null}
      </div>
    );
  }

  const selectOptions: SelectOption[] = [
    { value: '', label: m.selectValue },
    // HubSpot's own order, never re-sorted — a picklist's order means something.
    // The internal value is shown next to the label because it is what actually
    // gets written, and the two routinely differ ("1-10 employees" → `1`).
    ...options.map((o) => ({
      value: o.value,
      label: `${o.label} (${o.value})`,
    })),
    { value: CUSTOM_VALUE_OPTION, label: m.valueCustomOption },
  ];
  return (
    <div className="min-w-0 flex-1">
      <Select
        ariaLabel={ariaLabel}
        value={value}
        options={selectOptions}
        searchable
        locale={locale}
        onChange={(v) => {
          if (v === CUSTOM_VALUE_OPTION) {
            setCustomMode(true);
            return;
          }
          onChange(v);
        }}
      />
    </div>
  );
}

/**
 * One value-map group: a question, and the answer→HubSpot-value rows for it.
 *
 * **Collapsed by default**, unlike `AdvancedSettings`, and for the opposite
 * reason. There a closed group could hide behaviour someone didn't configure,
 * so it opens when anything is set. Here the long group IS the complaint — an
 * industry question with fifty values turns this panel into a scroll with no
 * landmarks — and nothing is hidden by closing it: the header carries the
 * question and the row count. A group with no question and no filled rows is
 * brand new, so it opens; there is nothing to summarise yet.
 *
 * The header is a ROW of controls, not one big `<button>` like
 * `AdvancedSettings`. It contains the key picker (itself a button) and Remove;
 * nesting those inside a button is invalid HTML and the clicks fight. So the
 * chevron is its own button and owns `aria-expanded`.
 *
 * No `overflow-hidden` on the wrapper — same flex `min-height:auto` trap
 * documented at length in `advanced-settings.tsx`. Corners round on the header.
 */
function ValueMapGroupCard({
  group,
  questionOptions,
  targets,
  properties,
  pickerEnabled,
  m,
  onGroupChange,
  onRemove,
}: {
  group: ValueMapGroup;
  questionOptions: QuestionMeta[];
  /** Contact properties this question's answer is written to (0, 1, or many). */
  targets: string[];
  properties: {
    name: string;
    label: string;
    options?: HubSpotPropertyOption[];
  }[];
  pickerEnabled: boolean;
  m: Msgs;
  onGroupChange: (next: ValueMapGroup) => void;
  onRemove: () => void;
}) {
  // Nothing filled in yet = nothing for a collapsed header to summarise, so it
  // opens. That covers a brand-new group AND the moment right after picking the
  // question — collapsing the rows out from under someone who just chose one
  // would be worse than the long scroll this is fixing.
  const filled = group.rows.filter((r) => r.from.trim() || r.to.trim()).length;
  // A group with a half-filled row opens too: that row says what it still
  // needs, and a collapsed header ("1 value(s)") would hide it after a reload.
  const unfinished = group.rows.some((r) => halfRow(r.from, r.to)) || (!group.stepKey.trim() && filled > 0);
  const [open, setOpen] = useState(filled === 0 || unfinished);

  // INTERSECTION, not union: the HubSpot adapter writes the one translated
  // value to every target property, so a value only one of them accepts is a
  // guaranteed partial write. `undefined` → the rows keep their text boxes.
  const options = pickerEnabled ? sharedOptionsFor(properties, targets) : undefined;

  const setRows = (rows: ValueMapRow[]) => onGroupChange({ ...group, rows });

  return (
    <div className="flex flex-col rounded-md border border-border" data-testid="valuemap-group">
      <div className={cn('flex items-center gap-2 p-3', open && 'border-b border-border')}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? m.collapseGroup : m.expandGroup}
          data-testid="valuemap-toggle"
          className="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <i
            aria-hidden
            className={`pi ${open ? 'pi-chevron-down' : 'pi-chevron-right'}`}
            style={{ fontSize: 11 }}
          />
        </button>
        <KeySelect
          value={group.stepKey}
          questionOptions={questionOptions}
          systemKeys={[]}
          m={m}
          testId="valuemap-key-select"
          customTestId="valuemap-key-custom"
          onChange={(v) => onGroupChange({ ...group, stepKey: v })}
        />
        {/* What a closed group would otherwise hide. Counts filled rows only —
            a trailing blank row is scaffolding, not a configured translation. */}
        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
          {fill(m.valueMapRowCount, { n: String(filled) })}
        </span>
        <Button variant="ghost" size="sm" aria-label={m.remove} onClick={onRemove}>
          {m.remove}
        </Button>
      </div>

      {open ? (
        <div className="flex flex-col gap-2 p-3">
          {/* Why the right-hand side looks the way it does. Without this, a text
              box on a fanned-out question reads as the picker being broken. */}
          {pickerEnabled ? (
            <p className="pl-4 text-xs text-muted-foreground" data-testid="valuemap-targets-hint">
              {targets.length === 0
                ? m.valueMapNoTarget
                : fill(m.valueMapTargets, { properties: targets.join(', ') })}
            </p>
          ) : null}
          {group.rows.map((row, ri) => (
            <div key={ri} className="flex flex-col gap-1 pl-4">
            <div className="flex items-center gap-2">
              {/* The LEFT side stays free text: it is the answer as the form
                  stores it, and `QuestionMeta` is built without the question's
                  own options — surfacing those is a separate change. */}
              <Input
                value={row.from}
                aria-label={m.valueMapAnswer}
                placeholder={m.valueMapAnswer}
                className="flex-1"
                onChange={(e) => {
                  const rows = [...group.rows];
                  rows[ri] = { ...row, from: e.target.value };
                  setRows(rows);
                }}
              />
              <span aria-hidden className="text-muted-foreground">
                →
              </span>
              {/* Keyed by the constraint, not the row: `OptionValueField`
                  decides text-vs-dropdown once, on mount. Re-pointing the group
                  at another question changes which values are legal, so the
                  control has to re-derive — otherwise a stored value that the
                  NEW picklist doesn't contain would render as an empty Select
                  (configured, still saved, looking unset). */}
              <OptionValueField
                key={targets.join('|')}
                value={row.to}
                ariaLabel={m.valueMapCrmValue}
                placeholder={m.valueMapCrmValue}
                options={options}
                m={m}
                onChange={(v) => {
                  const rows = [...group.rows];
                  rows[ri] = { ...row, to: v };
                  setRows(rows);
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label={m.remove}
                onClick={() => setRows(group.rows.filter((_, j) => j !== ri))}
              >
                {m.remove}
              </Button>
            </div>
            <RowHint
              text={
                !group.stepKey.trim() && (row.from.trim() || row.to.trim())
                  ? m.hubspotRowNeedsQuestion
                  : halfRow(row.from, row.to)
                    ? m.hubspotRowNeedsValue
                    : null
              }
            />
            </div>
          ))}
          <div className="pl-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRows([...group.rows, { from: '', to: '' }])}
            >
              {m.addValueMapRow}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
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
  /**
   * Submission-data keys the form does not ask for but still carries: UTMs from
   * the URL, and what the booking page collected about the invitee. Labelled,
   * because a raw `@invitee_first_name` is a token, not a name. Empty = omit
   * the group.
   */
  systemKeys: readonly SystemKey[];
  m: Msgs;
  testId: string;
  customTestId: string;
}) {
  const locale = useContext(LocaleContext);
  const selectable = (v: string): boolean =>
    systemKeys.some((k) => k.key === v) || questionOptions.some((q) => q.key === v);
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
    options.push({
      value: KEY_GROUP_QUESTIONS,
      label: m.keyGroupQuestions,
      disabled: true,
    });
    options.push(
      ...questionOptions.map((q) => ({
        value: q.key,
        label: `${q.label} (${q.key})`,
      })),
    );
  }
  if (systemKeys.length > 0) {
    options.push({
      value: KEY_GROUP_SYSTEM,
      label: m.keyGroupSystem,
      disabled: true,
    });
    options.push(...systemKeys.map((k) => ({ value: k.key, label: k.label })));
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

/**
 * Turn a failed test delivery into a sentence someone can act on.
 *
 * The old toast said "Test failed: webhook delivery failed: HTTP 400" — a true
 * statement that sends the reader to the wrong place. What actually helps is
 * three things in order: what the endpoint did, what we sent it (POST with a
 * JSON body — the assumption most often wrong), and the endpoint's OWN response,
 * which usually names the real reason.
 *
 * Only 405/501 lets us say outright that POST is refused. On a 400 the endpoint
 * read the request and rejected the body; claiming the method was wrong there
 * would be a guess dressed as a diagnosis.
 */
export function explainPingFailure(res: WebhookPingResult, m: Msgs): string {
  const REASON: Record<WebhookPingReason, string> = {
    method_not_allowed: m.pingMethodNotAllowed,
    unsupported_media_type: m.pingUnsupportedMedia,
    rejected_body: m.pingRejectedBody,
    unauthorized: m.pingUnauthorized,
    not_found: m.pingNotFound,
    rate_limited: m.pingRateLimited,
    server_error: m.pingServerError,
    redirect: m.pingRedirect,
    blocked: m.pingBlocked,
    unreachable: m.pingUnreachable,
    unknown: m.pingUnknown,
  };
  const headline = res.reason ? REASON[res.reason] : m.pingUnknown;
  const parts = [
    res.status ? fill(m.pingStatus, { status: String(res.status) }) : null,
    headline,
    // Not shown for `blocked` / `unreachable`: nothing was ever POSTed, so
    // telling the reader what we send would only be noise.
    res.status ? m.pingWeSend : null,
    res.detail ? fill(m.pingEndpointSaid, { detail: res.detail }) : null,
  ].filter(Boolean);
  return parts.join(' ');
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

/** Exported for `integrations-card.spec.tsx` — see the notice-slot cases there. */
export function WebhookCard({
  state,
  onChange,
  urlError,
  clearUrlError,
  formId,
  carriedCount,
  partialsHeld = false,
  canTest = true,
  locale,
  m,
}: {
  state: WebhookState;
  onChange: (s: WebhookState) => void;
  /** Owners and admins: the API refuses a test delivery from anyone else. */
  canTest?: boolean;
  urlError: string | null;
  clearUrlError: () => void;
  /** Spam protection holds partials: the Partial trigger is paused, not fired. */
  partialsHeld?: boolean;
  /** Needed for the test delivery — the API resolves the saved webhook by form. */
  formId: string;
  /** Webhooks stored on this form that the card does not edit. */
  carriedCount: number;
  /** Formats the delivery-history timestamps. */
  locale: Locale;
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
      const res = await callAction(() => pingWebhookAction(formId));
      if (isTransportError(res)) toastError(m.saveOffline);
      else if (res.ok) success(m.pingOk);
      else toastError(explainPingFailure(res, m));
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
    onChange({
      ...state,
      firePartial: nextPartial,
      fireComplete: nextComplete,
    });
  }

  // Goes in the `notice` slot rather than among the children, for the same
  // reason HubSpot's does: children are hidden when the toggle is off, and a
  // card toggled off is where a statement about the OTHER stored webhooks
  // matters most — flipping the switch is itself an edit that rewrites the
  // whole array. Unlike HubSpot's, this one reports something kept rather than
  // something about to be lost: `buildDestinations` carries them through.
  const carriedNotice =
    carriedCount > 0 ? (
      <div
        data-testid="webhook-carried"
        className="mt-4 rounded-md border border-border bg-muted/40 p-3"
      >
        <p className="text-xs font-medium text-foreground">
          {fill(m.carriedWebhooksTitle, { count: String(carriedCount) })}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{m.carriedWebhooksBody}</p>
      </div>
    ) : null;

  return (
    <Card
      title={m.webhookTitle}
      desc={m.webhookDesc}
      enabled={state.enabled}
      onToggle={(enabled) => onChange({ ...state, enabled })}
      notice={carriedNotice}
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
        ) : !state.url.trim() ? (
          // Switched on, nothing to send to: said here, on the card.
          <RowHint text={m.webhookNeedsUrl} />
        ) : null}
        {/* Test delivery: the fastest way to find out the far end is wrong is to
            send it something, rather than waiting for a real respondent. */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={ping}
            // The API sends a test for owners and admins only.
            disabled={pinging || !state.url.trim() || !canTest}
            data-testid="webhook-ping"
          >
            <i aria-hidden className="pi pi-send" style={{ fontSize: 12 }} />
            {pinging ? m.pingSending : m.pingWebhook}
          </Button>
          <span className="text-xs text-muted-foreground" data-testid={canTest ? undefined : 'webhook-ping-admin-only'}>
            {canTest ? m.pingHelp : m.pingAdminOnly}
          </span>
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
          <label className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
            <Checkbox
              checked={state.firePartial}
              onChange={(e) => toggleEvent('partial', e.target.checked)}
              aria-label={m.eventPartial}
            />
            {m.eventPartial}
            {/* The trigger stays as saved (switching protection off restores
                it); what changes is that nothing partial is sent meanwhile. */}
            {partialsHeld && state.firePartial ? (
              <span
                data-testid="webhook-partial-held"
                className="rounded-full bg-secondary/15 px-2 py-0.5 text-xs font-medium text-secondary"
              >
                {m.eventPartialHeld}
              </span>
            ) : null}
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
        {partialsHeld && state.firePartial && !state.fireComplete ? (
          <p data-testid="webhook-partial-only-held" role="alert" className="text-xs text-destructive">
            {m.webhookPartialOnlyHeld}
          </p>
        ) : null}
      </Field>
      {/* Inside the card body, so it hides with the enable switch: a webhook
          that is off has no deliveries to explain, and the settings it belongs
          to are hidden alongside it. */}
      <DeliveryHistory
        formId={formId}
        kinds={WEBHOOK_HISTORY_KINDS}
        title={m.historyWebhookTitle}
        locale={locale}
        m={m}
        testId="webhook-history"
      />
    </Card>
  );
}

/** Exported for `integrations-card.spec.tsx` — see the notice-slot cases there. */
export function HubspotCard({
  state,
  onChange,
  properties,
  pickerEnabled,
  accountConnected,
  showMapping,
  extraHubspotStored,
  formActivityError,
  readiness,
  questions,
  formId,
  partialsHeld = false,
  access = DEFAULT_CONNECT_ACCESS,
  locale: localeProp,
  onConnected,
  m,
}: {
  state: HubspotState;
  onChange: (s: HubspotState) => void;
  /** Who may connect HubSpot from this card (see `ConnectInPlace`). */
  access?: ConnectAccess;
  /** For the connect form's copy; falls back to the editor's locale context. */
  locale?: Locale;
  /** HubSpot was connected from this card: the caller loads the properties. */
  onConnected?: () => void | Promise<void>;
  /** Which form's delivery history the card reads. */
  formId: string;
  /** Spam protection holds partials: the contact is written on complete only. */
  partialsHeld?: boolean;
  /** Why HubSpot refused to build the mirror form on the last save, if it did. */
  formActivityError?: string | null;
  /** `options` rides along for the value pickers; absent = not an enumeration.
   *  `type` decides which date controls a pick reveals (`date` needs the day
   *  timezone; `datetime` keeps the instant and needs nothing). */
  properties: {
    name: string;
    label: string;
    type?: string;
    options?: HubSpotPropertyOption[];
  }[];
  pickerEnabled: boolean;
  accountConnected: boolean;
  showMapping: boolean;
  /** The stored config carries a second HubSpot destination this tab will drop. */
  extraHubspotStored: boolean;
  readiness: ContactKeyReadiness;
  questions: QuestionMeta[];
  m: Msgs;
}) {
  const { success, toast } = useToast();
  const contextLocale = useContext(LocaleContext);
  const locale = localeProp ?? contextLocale;
  const cm = getMessages(locale).admin.connections;
  const emailSource = readiness.source;
  const utmValues = useMemo(() => state.utmMappings, [state.utmMappings]);
  const questionKeys = useMemo(() => new Set(questions.map((q) => q.key)), [questions]);

  // What this form carries beyond its own answers. The invitee's details only
  // exist when a SCHEDULER is what supplies the address — a form that asks for
  // an email itself never books, so offering them there would map keys that
  // stay empty forever.
  const systemKeyOptions = useMemo<SystemKey[]>(() => {
    const utm: SystemKey[] = UTM_KEYS.map((k) => ({ key: k, label: k }));
    if (emailSource?.kind !== 'scheduler') return utm;
    // One list with the builder's question panel, so neither screen can offer a
    // booking field the other has never heard of. The meeting time is dropped
    // here: it lives under the scheduler's own step key and is already a
    // QUESTION row, so keeping it would put the same mapping on screen twice.
    return [
      ...utm,
      ...bookingFieldsFor(emailSource.key)
        .filter((f) => f.kind !== 'start_time')
        .map((f) => ({ key: f.key, label: bookingLabel(f.kind, m) })),
    ];
  }, [emailSource, m]);

  // Questions pointed at the `email` property while a SCHEDULER is what supplies
  // the address. The booking-time sync only runs when the adapter cannot resolve
  // an address itself, so this mapping switches it off and the lead stops
  // arriving — with no error anywhere.
  const emailConflicts = useMemo(
    () =>
      emailMappingsConflictingWithScheduler(
        emailSource,
        Object.fromEntries(
          state.fieldMappings
            .filter((p) => p.key.trim() && p.property.trim())
            .map((p) => [p.key.trim(), p.property.trim()]),
        ),
      ),
    [emailSource, state.fieldMappings],
  );

  // A stored SECOND HubSpot destination, which the next save deletes.
  //
  // Its removal is a real loss whichever way the pair is arranged, because the
  // three readers resolve it three different ways. This card edits the FIRST
  // regardless of `enabled` (`initialHubspot`); submit delivers EVERY enabled
  // destination (`destination-effects`); booking resolves the first ENABLED one
  // (`findHubspotDestination`). So on a disabled-first pair the second is the
  // one running bookings, and on an enabled pair it is delivering its own
  // mappings at submit — the copy therefore promises neither, only that
  // something invisible here is about to be deleted with it. New configs cannot
  // reach this state: the authoring write-paths refuse to raise the count.
  //
  // Goes in `Card`'s `notice` slot, not among its children — children are
  // hidden when the toggle is off, and a card toggled off is where this matters
  // most: flipping the switch is itself an edit, and the autosave it triggers
  // is what performs the collapse.
  const extraHubspotNotice = extraHubspotStored ? (
    <div
      data-testid="hubspot-extra-destination"
      className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3"
    >
      <p className="text-xs font-medium text-foreground">{m.extraHubspotTitle}</p>
      <p className="mt-1 text-xs text-muted-foreground">{m.extraHubspotBody}</p>
    </div>
  ) : null;

  // Nothing to key a contact on → mapping is pointless and, worse, silently
  // lossy: HubSpot's upsert is BY EMAIL, so a submission with no address
  // resolves as a permanent no-op and that lead is never synced. Say so here,
  // while the form is being built, instead of letting it be discovered from a
  // CRM that stayed empty. This gate sits BEFORE the connect prompt: an account
  // with HubSpot ready still cannot sync a form that asks for no address.
  if (!emailSource) {
    return (
      <section data-testid="hubspot-card" className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <ProviderLogo provider="hubspot" size={20} />
          <h2 className="text-lg font-semibold">{m.hubspotTitle}</h2>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{m.hubspotDesc}</p>
        {extraHubspotNotice}
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
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <ProviderLogo provider="hubspot" size={20} />
          <h2 className="text-lg font-semibold">{m.hubspotTitle}</h2>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{m.hubspotDesc}</p>
        {extraHubspotNotice}
        <div className="mt-4">
          <ConnectInPlace
            provider={m.hubspotTitle}
            title={m.connectPromptTitle}
            body={m.connectPromptBody}
            access={access}
            m={m}
            cm={cm}
            testId="hubspot-connect-prompt"
          >
            <TokenConnectForm
              provider="hubspot"
              providerName={cm.hubspotName}
              m={cm}
              onConnected={() => {
                success(cm.connectSuccess.replace('{provider}', cm.hubspotName));
                void onConnected?.();
              }}
            />
          </ConnectInPlace>
        </div>
      </section>
    );
  }

  /** The property currently mapped for a question key (via the pairs array). */
  const questionProp = (key: string): string =>
    state.fieldMappings.find((p) => p.key === key && p.property.trim())?.property ?? '';

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
  // A row keyed on one of the form's questions but with no property yet is a
  // half-filled row, stored as a draft: it is shown here, with its note, rather
  // than folded into that question's own row, which would show nothing and so
  // make a saved row look gone after a reload.
  const customRows = state.fieldMappings
    .map((pair, index) => ({ pair, index }))
    .filter(({ pair }) => !questionKeys.has(pair.key) || !pair.property.trim());

  // Keys already used by ANY mapping row (main section or custom). Questions
  // already mapped drop out of a custom row's picker (no double-mapping); a
  // row's own key is always kept so its selection stays visible.
  const usedKeys = new Set(state.fieldMappings.map((p) => p.key));
  // Every question stays pickable. Hiding the mapped ones was how the editor
  // enforced one-property-per-answer; now a second row on the same question IS
  // the way to send it somewhere else too.
  const unmappedQuestions = questions;

  // Value maps translate answers, so choice-type questions (fixed option
  // lists) lead the picker; free-text questions follow. Plain computation —
  // this sits below the connect-prompt early return, where hooks can't go.
  const valueMapQuestions = [
    ...questions.filter((q) => CHOICE_TYPES.has(q.type)),
    ...questions.filter((q) => !CHOICE_TYPES.has(q.type)),
  ];

  // The portal-reported type of one picked property, or undefined when it
  // cannot be known (picker disabled, or the pick predates the live list).
  const typeOf = (name: string) => properties.find((p) => p.name === name.trim())?.type;
  // Whether a DAY-property pick reveals the shared Day-timezone control. Only
  // a KNOWN `datetime` hides it: the instant needs no zone. An unknown type
  // shows it, because the server day-collapses when it cannot know either.
  const revealsDayTimezone = (name: string) => name.trim() !== '' && typeOf(name) !== 'datetime';

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
      logo="hubspot"
      enabled={state.enabled}
      onToggle={(enabled) => onChange({ ...state, enabled })}
      m={m}
      badge={accountConnected ? m.connectedBadge : undefined}
      // Under the header, NOT among the children: `Card` hides children when the
      // toggle is off, and a card toggled off is the state where this warning
      // matters most — flipping the switch is itself an edit, and the autosave
      // it triggers is what performs the collapse.
      notice={extraHubspotNotice}
    >
      {!pickerEnabled ? (
        <div className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          {m.propertiesUnavailable}
        </div>
      ) : null}

      {/* What the sync actually does. "Map a question to a property" does not
          tell anyone that the CONTACT is matched by email and created when
          absent — which is the one rule that decides whether a lead lands.

          The body is per-source, not one paragraph for everyone: the generic
          copy ends "a form that never asks for an email cannot be synced",
          which is FALSE for a form whose address comes from the booking — and
          it sat directly above the note saying the opposite. */}
      <div data-testid="hubspot-how" className="rounded-md border border-border bg-muted/30 p-3">
        <p className="text-xs font-medium text-foreground">{m.hubspotHowTitle}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {emailSource?.kind === 'scheduler' ? m.hubspotHowBodyScheduler : m.hubspotHowBody}
        </p>
        {emailSource?.kind === 'scheduler' ? (
          <p data-testid="hubspot-scheduler-note" className="mt-2 text-xs text-muted-foreground">
            {readiness.ok ? m.emailFromScheduler : m.schedulerDisconnected}
          </p>
        ) : null}
        {/* Spam protection: a partial no longer upserts the contact. Said here,
            beside the rule it changes, rather than discovered from a CRM that
            only fills in when a form is finished. */}
        {partialsHeld ? (
          <p data-testid="hubspot-partial-held" className="mt-2 text-xs text-muted-foreground">
            {m.hubspotPartialHeld}
          </p>
        ) : null}
      </div>

      {/* The mapping the old help text INSTRUCTED, which switches the sync off.
          Named per question so it can be found, not just described. */}
      {emailConflicts.length > 0 ? (
        <div
          data-testid="hubspot-email-conflict"
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3"
        >
          <p className="text-xs font-medium text-foreground">{m.emailMappingConflictTitle}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {fill(m.emailMappingConflictBody, {
              keys: emailConflicts.join(', '),
            })}
          </p>
        </div>
      ) : null}

      {/* Map questions — each form question → a HubSpot contact property */}
      <Section
        title={m.mapQuestions}
        help={emailSource?.kind === 'scheduler' ? m.mapQuestionsHelpScheduler : m.mapQuestionsHelp}
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
              <div key={index} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <KeySelect
                  value={pair.key}
                  questionOptions={unmappedQuestions}
                  systemKeys={systemKeyOptions.filter(
                    (k) => k.key === pair.key || !usedKeys.has(k.key),
                  )}
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
              <RowHint
                text={
                  halfRow(pair.key, pair.property)
                    ? pair.key.trim()
                      ? m.hubspotRowNeedsProperty
                      : m.hubspotRowNeedsKey
                    : null
                }
              />
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
                  fieldMappings: [...state.fieldMappings, { key: '', property: '' }],
                })
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
              <ValueMapGroupCard
                key={gi}
                group={group}
                questionOptions={valueMapQuestions}
                // Which properties this question's answer is written to — the
                // whole reason the right-hand side can offer a picklist at all.
                targets={targetPropertiesFor(state.fieldMappings, group.stepKey)}
                properties={properties}
                pickerEnabled={pickerEnabled}
                m={m}
                onGroupChange={(next) => {
                  const all = [...state.valueMaps];
                  all[gi] = next;
                  onChange({ ...state, valueMaps: all });
                }}
                onRemove={() =>
                  onChange({
                    ...state,
                    valueMaps: state.valueMaps.filter((_, j) => j !== gi),
                  })
                }
              />
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
                    onChange={(v) =>
                      onChange({
                        ...state,
                        utmMappings: { ...state.utmMappings, [k]: v },
                      })
                    }
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
          {revealsDayTimezone(state.dateProperty) ? (
            <DayTimezoneField
              value={state.dayTimezone}
              onChange={(v) => onChange({ ...state, dayTimezone: v })}
              m={m}
            />
          ) : null}
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
              <div key={i} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
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
                {/* The property is picked right here, so its allowed values are
                    known — no reason to make anyone retype an internal value.
                    Keyed by the property so switching it re-reads the picklist,
                    while the VALUE itself is deliberately left alone: a
                    mis-click on the property must not destroy typed work. */}
                <OptionValueField
                  key={row.key}
                  value={row.value}
                  ariaLabel={m.staticValue}
                  placeholder={m.staticValue}
                  options={pickerEnabled ? optionsForProperty(properties, row.key) : undefined}
                  m={m}
                  onChange={(v) => {
                    const next = [...state.staticProperties];
                    next[i] = { ...row, value: v };
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
              <RowHint
                text={
                  halfRow(row.key, row.value)
                    ? row.key.trim()
                      ? m.hubspotRowNeedsValue
                      : m.hubspotRowNeedsProperty
                    : null
                }
              />
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

      {/* Booking sync: contact properties stamped when a meeting is booked.
          The Day-timezone control appears beside whichever pick is a `date`-type
          property (see DayTimezoneField) — a datetime pick needs nothing. */}
      <Field label={m.bookingSync} help={m.bookingSyncHelp}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={m.bookingStageProperty} help={m.bookingStagePropertyHelp}>
            <PropertyField
              value={state.bookingSync.stageProperty}
              ariaLabel={m.bookingStageProperty}
              properties={properties}
              enabled={pickerEnabled}
              allowNone
              m={m}
              onChange={(v) =>
                onChange({
                  ...state,
                  bookingSync: { ...state.bookingSync, stageProperty: v },
                })
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
                  bookingSync: {
                    ...state.bookingSync,
                    stageValue: e.target.value,
                  },
                })
              }
            />
          </Field>
          <Field label={m.bookingDateProperty} help={m.bookingDatePropertyHelp}>
            <PropertyField
              value={state.bookingSync.dateProperty}
              ariaLabel={m.bookingDateProperty}
              properties={properties}
              enabled={pickerEnabled}
              allowNone
              m={m}
              onChange={(v) =>
                onChange({
                  ...state,
                  bookingSync: { ...state.bookingSync, dateProperty: v },
                })
              }
            />
          </Field>
          {revealsDayTimezone(state.bookingSync.dateProperty) ? (
            <DayTimezoneField
              value={state.dayTimezone}
              onChange={(v) => onChange({ ...state, dayTimezone: v })}
              m={m}
            />
          ) : null}
          <Field label={m.bookingHoursProperty} help={m.bookingHoursPropertyHelp}>
            <PropertyField
              value={state.bookingSync.hoursProperty}
              ariaLabel={m.bookingHoursProperty}
              properties={properties}
              enabled={pickerEnabled}
              allowNone
              m={m}
              onChange={(v) =>
                onChange({
                  ...state,
                  bookingSync: { ...state.bookingSync, hoursProperty: v },
                })
              }
            />
          </Field>
          {/* Only a KNOWN `date` pick — the instant default needs no zone, so
              an unknown type stays quiet here, unlike the two day fields. */}
          {typeOf(state.bookingSync.hoursProperty) === 'date' ? (
            <DayTimezoneField
              value={state.dayTimezone}
              onChange={(v) => onChange({ ...state, dayTimezone: v })}
              m={m}
            />
          ) : null}
        </div>
      </Field>

      <CrmPartialsSwitch
        type="hubspot"
        events={state.events}
        onChange={(events) => onChange({ ...state, events })}
        partialsHeld={partialsHeld}
        testId="hubspot"
        m={m}
      />

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

      {/* The form-submission activity. Sits below the note because it is the
          better version of the same idea: a note says something happened, this
          says WHAT the submission set, on an activity the CRM already knows how
          to read. Both can be on; neither disables the other. */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <label className="text-sm font-medium">{m.formActivity}</label>
          <p className="text-xs text-muted-foreground">{m.formActivityHelp}</p>
        </div>
        <Switch
          checked={state.formActivity}
          data-testid="hubspot-form-activity"
          onCheckedChange={(formActivity) => onChange({ ...state, formActivity })}
          aria-label={m.formActivity}
        />
      </div>

      {/* The save went through; only the portal side did not. Said here, next to
          the switch that caused it, rather than as a save error — losing an
          author's mappings because their token is missing a scope would be a
          far worse trade than the missing activity. */}
      {state.formActivity && formActivityError ? (
        <p
          role="alert"
          data-testid="hubspot-form-activity-error"
          className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-xs leading-relaxed text-destructive"
        >
          <i
            aria-hidden
            className="pi pi-exclamation-triangle mt-0.5 shrink-0"
            style={{ fontSize: 11 }}
          />
          {fill(m.formActivityError, { reason: formActivityError })}
        </p>
      ) : null}

      {/* `booking_sync` rides along with `hubspot`: it IS a HubSpot write — the
          contact update a scheduling callback triggers — so its failures belong
          next to the mapping that decides what it writes, not in a section of
          their own. */}
      <DeliveryHistory
        formId={formId}
        kinds={HUBSPOT_HISTORY_KINDS}
        title={m.historyHubspotTitle}
        locale={locale}
        m={m}
        testId="hubspot-history"
      />
    </Card>
  );
}
