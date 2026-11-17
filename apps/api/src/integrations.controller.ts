import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  Param,
  Post,
  Put,
  Query,
  Redirect,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z, ZodError } from 'zod';
import type { Db, IntegrationProvider, IntegrationStatus } from '@quill/db';
import {
  deleteIntegration,
  hasEncryptionKey,
  integrationProviders,
  listAccountWebhooks,
  listIntegrationStatuses,
  resolveProviderToken,
  getFormById,
  recordSettledDelivery,
  WEBHOOK_PING_ACTION,
  summarizeFailedDeliveriesByForm,
  updateFormDestinations,
  upsertIntegration,
} from '@quill/db';
import {
  destinationFiresForPhase,
  formDestinationSchema,
  MAX_SHEET_COLUMNS,
  hasExtraHubspotDestination,
  hasExtraSalesforceDestination,
  isWritableSheetColumn,
  maskConfigSecrets,
  ONE_HUBSPOT_DESTINATION_MESSAGE,
  ONE_SALESFORCE_DESTINATION_MESSAGE,
  type DestinationEvent,
  type FormDestination,
} from '@quill/types';
import { transcriptOfError, WebhookDestination, WebhookHttpError } from '@quill/destinations';
import {
  createSpreadsheet,
  listSheetTabs,
  syncHeaderRow,
  writeHeaderRow,
  type SheetTabDto,
} from './google-sheets-api';
import { GoogleSheetsAccessTokens } from './google-sheets-token';
import {
  mintSalesforceToken,
  normalizeSalesforceDomain,
  readOrgName,
  SalesforceAccessTokens,
  salesforceLast4,
} from './salesforce-auth';
import { SalesforceFieldsService, type SalesforceFieldsResponse } from './salesforce-fields';
import {
  exchangeGoogleCode,
  googleAuthorizeUrl,
  googleOAuthClient,
  googlePickerConfig,
  googleStateKey,
  safeGoogleReturnTo,
  grantedSheetsAccess,
  signGoogleState,
  verifyGoogleState,
  type GoogleOAuthClient,
} from './google-oauth';
import { isInputlessStep, type FormStep } from '@quill/engine';
import { syncMirrorForm, type MirrorSyncResult } from './hubspot-mirror';
import type { ServerEnv } from '@quill/config/env';
import { AuthService, type ReqLike } from './auth.service';
import { header } from './auth.provider';
import { apiKeyFromRequest } from './api-keys';
import { DcalService, type DcalEventTypesResponse, dcalCreateEventUrl } from './dcal.service';
import { assertAdmin } from './permissions';
import { parse } from './validation';
import { keyDestinationsBodyIssues } from './strict-config';
import { RateLimitGuard } from './rate-limit';
import { captchaActive, type CaptchaVerifier } from './captcha';
import { fileLinksFor } from './file-link';
import { CAPTCHA, DB, ENV } from './tokens';

/**
 * One allowed value of an enumeration property, as HubSpot defines it.
 *
 * `value` is what an integration must WRITE; `label` is what a human sees in
 * HubSpot's own UI. They are routinely different (`value: "2"` /
 * `label: "11-50 employees"`), which is precisely why typing the value by hand
 * is error-prone enough to be worth a picker.
 */
export interface HubSpotPropertyOptionDto {
  value: string;
  label: string;
}

/** A HubSpot contact property surfaced to the mapping UI. */
export interface HubSpotPropertyDto {
  name: string;
  label: string;
  type: string;
  /**
   * The allowed values, for enumeration properties only — absent (not `[]`) on
   * the text/number/date majority, so the response doesn't carry ~400 empty
   * arrays. Order is HubSpot's own and is deliberately NOT sorted: a picklist's
   * order carries meaning (deal stages, seniority levels, sizes).
   */
  options?: HubSpotPropertyOptionDto[];
}

/** The property-picker response: disabled (no token) or the cached property list. */
export type HubSpotPropertiesResponse =
  | { enabled: false; reason: string }
  | { enabled: true; cached: boolean; properties: HubSpotPropertyDto[] };

/**
 * One extra field an event type's booking form asks for, beyond the built-in
 * name + email. `id` is the prefill parameter Calendly assigns by position
 * (`a1`, `a2`, …) — which is why the position, not the order in the array, is
 * what determines it.
 */
export interface CalendlyBookingFieldDto {
  id: string;
  label: string;
  required: boolean;
}

/** A Calendly event type surfaced to the scheduler-step event-type picker. */
export interface CalendlyEventTypeDto {
  /** Stable Calendly URI (what a scheduler step stores). */
  uri: string;
  name: string;
  /** The public booking page for this event type (embedded in the form). */
  schedulingUrl: string;
  active: boolean;
  durationMinutes: number;
  /**
   * The event type's own custom questions, so the builder maps the fields this
   * booking form ACTUALLY asks for instead of assuming name/email/phone.
   */
  customQuestions: CalendlyBookingFieldDto[];
}

/**
 * The event-type-picker response: disabled (no token) or the cached list.
 *
 * `connectedAs` names the Calendly user the list is scoped to (its email, else
 * its name). Calendly only returns event types that user owns or hosts, so a
 * team round robin the user is not a host of is simply absent — the builder
 * shows this so an author knows whose events they are looking at instead of
 * concluding the picker is broken.
 */
export type CalendlyEventTypesResponse =
  | { enabled: false; reason: string }
  | { enabled: true; cached: boolean; connectedAs: string | null; eventTypes: CalendlyEventTypeDto[] };

const PLACEHOLDER_TOKENS = new Set(['', 'your_private_app_token_here', 'your_token_here']);
const CACHE_TTL_MS = 5 * 60 * 1000;
const HUBSPOT_PROPERTIES_URL = 'https://api.hubapi.com/crm/v3/properties/contacts';
/** Calendly identity probe: validates a pasted token + yields its display label. */
const CALENDLY_ME_URL = 'https://api.calendly.com/users/me';
const CALENDLY_EVENT_TYPES_URL = 'https://api.calendly.com/event_types';

interface HubSpotPropertyOptionApi {
  value?: string;
  label?: string;
  hidden?: boolean;
}
interface HubSpotPropertiesApiResponse {
  results?: Array<{
    name: string;
    label?: string;
    type?: string;
    options?: HubSpotPropertyOptionApi[];
  }>;
}

/**
 * The values a mapping may legally write to one property, or `undefined` when
 * the property is not an enumeration.
 *
 * Hidden options are dropped: HubSpot hides them from its own pickers (retired
 * values kept for historical records), so offering one would let an author
 * configure a write that HubSpot then rejects. An option with no `value` is
 * dropped for the same reason — there is nothing to write.
 */
function toPropertyOptions(
  options: HubSpotPropertyOptionApi[] | undefined,
): HubSpotPropertyOptionDto[] | undefined {
  if (!Array.isArray(options)) return undefined;
  const usable = options
    .filter((o) => o && o.hidden !== true && typeof o.value === 'string' && o.value !== '')
    .map((o) => ({ value: o.value as string, label: o.label?.trim() || (o.value as string) }));
  return usable.length ? usable : undefined;
}

/**
 * Server-side HubSpot property lookup for the mapping UI. The private-app token
 * lives only here (never in the browser); results are cached 5 minutes to stay
 * well under HubSpot rate limits. Without a token it reports a clear disabled
 * state instead of erroring — a webhook-only deployment needs no HubSpot config.
 */
@Injectable()
export class HubspotPropertiesService {
  // Per-ACCOUNT cache: HubSpot contact properties are portal-specific, so one
  // account's connected token must never surface another account's list. Keyed
  // by accountId (accounts sharing the env fallback cache separately — a minor
  // duplication, never a cross-account leak).
  //
  // The keying carries MORE weight now that entries include enumeration options:
  // a global cache would leak not just property names but their values — a
  // portal's internal sales taxonomy (deal stages, lead grades, account tiers).
  // Do not "optimize" this into a single shared map.
  private readonly cache = new Map<string, { data: HubSpotPropertyDto[]; expires: number }>();

  constructor(
    @Inject(ENV) private readonly env: ServerEnv,
    @Inject(DB) private readonly db: Db,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * Drop the account's cached list. Called on connect/disconnect: the cache is
   * keyed by ACCOUNT, not by token, so without this a re-connect kept serving
   * the previous token's properties for up to the TTL.
   */
  invalidate(accountId: string): void {
    this.cache.delete(accountId);
  }

  /**
   * The live HubSpot token for an account: its connected (decrypted) token if
   * present, else the single-tenant env fallback. Placeholder env values count
   * as absent so a bare clone reports disabled instead of 401-ing HubSpot.
   */
  private async resolveToken(accountId: string): Promise<string | null> {
    const token = await resolveProviderToken(
      this.db,
      accountId,
      'hubspot',
      this.env.FORMS_ENCRYPTION_KEY,
      this.env.HUBSPOT_PRIVATE_APP_TOKEN,
    );
    if (!token || PLACEHOLDER_TOKENS.has(token.trim())) return null;
    return token;
  }

  async listProperties(accountId: string, now = Date.now()): Promise<HubSpotPropertiesResponse> {
    const token = await this.resolveToken(accountId);
    if (!token) {
      return {
        enabled: false,
        reason: 'No HubSpot token. Connect HubSpot for this account or set the server token.',
      };
    }
    const cached = this.cache.get(accountId);
    if (cached && cached.expires > now) {
      return { enabled: true, cached: true, properties: cached.data };
    }
    const res = await this.fetchImpl(HUBSPOT_PROPERTIES_URL, {
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
    if (!res.ok) {
      // Don't cache a failure; report disabled with the status so the UI can show it.
      return { enabled: false, reason: `HubSpot rejected the request (HTTP ${res.status}).` };
    }
    const body = (await res.json().catch(() => ({}))) as HubSpotPropertiesApiResponse;
    const properties = (body.results ?? [])
      .map((prop) => {
        const options = toPropertyOptions(prop.options);
        const dto: HubSpotPropertyDto = {
          name: prop.name,
          label: prop.label || prop.name,
          type: prop.type ?? 'string',
        };
        // Omitted, not empty — see the DTO. Sorting PROPERTIES by label is right
        // (an author scans them alphabetically); sorting their options is not.
        if (options) dto.options = options;
        return dto;
      })
      .sort((a, b) => a.label.localeCompare(b.label));
    this.cache.set(accountId, { data: properties, expires: now + CACHE_TTL_MS });
    return { enabled: true, cached: false, properties };
  }
}

interface CalendlyMeApiResponse {
  resource?: { uri?: string; email?: string; name?: string };
}
interface CalendlyCustomQuestionApi {
  name?: string;
  position?: number;
  enabled?: boolean;
  required?: boolean;
}
interface CalendlyEventTypesApiResponse {
  collection?: Array<{
    uri?: string;
    name?: string;
    scheduling_url?: string;
    active?: boolean;
    duration?: number;
    custom_questions?: CalendlyCustomQuestionApi[];
  }>;
}

/**
 * The extra fields an event type's booking form asks for. Calendly prefills a
 * custom question by its POSITION (`a1` = position 0), so the id comes from
 * `position` and falls back to the array index only when it is absent.
 * Disabled questions are dropped — they are never rendered, so mapping one
 * would silently do nothing.
 */
function toBookingFields(questions: CalendlyCustomQuestionApi[] | undefined): CalendlyBookingFieldDto[] {
  if (!Array.isArray(questions)) return [];
  return questions
    .filter((q) => q && q.enabled !== false)
    .map((q, i) => ({
      id: `a${typeof q.position === 'number' ? q.position + 1 : i + 1}`,
      label: q.name?.trim() || `Question ${i + 1}`,
      required: q.required === true,
    }));
}

/**
 * Server-side Calendly event-type lookup for the scheduler step's picker. The
 * token lives only here (never in the browser); results are cached 5 minutes.
 * Without a token it reports a clear disabled state instead of erroring — a form
 * with no scheduler needs no Calendly config. Mirrors {@link HubspotPropertiesService}.
 */
@Injectable()
export class CalendlyEventTypesService {
  // Per-ACCOUNT cache: event types are portal-specific to the connected token.
  // `connectedAs` is cached alongside so a cache hit still says whose list it is.
  private readonly cache = new Map<
    string,
    { data: CalendlyEventTypeDto[]; connectedAs: string | null; expires: number }
  >();

  constructor(
    @Inject(ENV) private readonly env: ServerEnv,
    @Inject(DB) private readonly db: Db,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * Drop the account's cached list. Called on connect/disconnect — see
   * {@link HubspotPropertiesService.invalidate}. This is the one that bit: an
   * author re-connected Calendly as a different user and the picker kept
   * showing the previous user's event types for five minutes.
   */
  invalidate(accountId: string): void {
    this.cache.delete(accountId);
  }

  /** The live Calendly token for an account: connected (decrypted) else env fallback. */
  private async resolveToken(accountId: string): Promise<string | null> {
    const token = await resolveProviderToken(
      this.db,
      accountId,
      'calendly',
      this.env.FORMS_ENCRYPTION_KEY,
      this.env.CALENDLY_API_TOKEN,
    );
    if (!token || PLACEHOLDER_TOKENS.has(token.trim())) return null;
    return token;
  }

  async listEventTypes(accountId: string, now = Date.now()): Promise<CalendlyEventTypesResponse> {
    const token = await this.resolveToken(accountId);
    if (!token) {
      return {
        enabled: false,
        reason: 'No Calendly token. Connect Calendly for this account or set the server token.',
      };
    }
    const cached = this.cache.get(accountId);
    if (cached && cached.expires > now) {
      return { enabled: true, cached: true, connectedAs: cached.connectedAs, eventTypes: cached.data };
    }
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    // Calendly scopes event types by user, so resolve the token's own user first.
    const meRes = await this.fetchImpl(CALENDLY_ME_URL, { headers });
    if (!meRes.ok) return { enabled: false, reason: `Calendly rejected the request (HTTP ${meRes.status}).` };
    const me = (await meRes.json().catch(() => ({}))) as CalendlyMeApiResponse;
    const userUri = me.resource?.uri;
    if (!userUri) return { enabled: false, reason: 'Calendly did not return a user for this token.' };
    // From the token itself, not the stored connection label: this is the user
    // Calendly actually scoped the list to.
    const connectedAs = me.resource?.email?.trim() || me.resource?.name?.trim() || null;

    const url = `${CALENDLY_EVENT_TYPES_URL}?user=${encodeURIComponent(userUri)}&active=true&count=100`;
    const res = await this.fetchImpl(url, { headers });
    if (!res.ok) return { enabled: false, reason: `Calendly rejected the request (HTTP ${res.status}).` };
    const body = (await res.json().catch(() => ({}))) as CalendlyEventTypesApiResponse;
    const eventTypes = (body.collection ?? [])
      .filter((e) => e.uri && e.scheduling_url)
      .map((e) => ({
        uri: e.uri as string,
        name: e.name?.trim() || 'Untitled event',
        schedulingUrl: e.scheduling_url as string,
        active: e.active !== false,
        durationMinutes: typeof e.duration === 'number' ? e.duration : 0,
        customQuestions: toBookingFields(e.custom_questions),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    this.cache.set(accountId, { data: eventTypes, connectedAs, expires: now + CACHE_TTL_MS });
    return { enabled: true, cached: false, connectedAs, eventTypes };
  }
}

/**
 * The caller's own bearer, for the one integration that forwards it rather than
 * holding a credential of its own (dCal). Absent on the `local` auth provider
 * of a bare fork, which mints no token, and absent for an API-key caller: both
 * mean "no session to forward", which the service reports as unavailable.
 */
function bearerOf(req: ReqLike): string | null {
  // A dForms API key arrives in this same header, and must never be forwarded
  // to another service: it is a credential for THIS app. `ApiKeyRouteGuard`
  // already refuses the one route that calls this, but a guard somebody later
  // relaxes should not be the only thing standing in the way.
  if (apiKeyFromRequest(req) !== null) return null;
  const raw = header(req, 'authorization')?.trim() ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match?.[1]?.trim() || null;
}

/** Connect-body contract: a non-empty pasted provider token. */
const connectBodySchema = z.object({ token: z.string().min(1) });

/** The three values a Salesforce Client Credentials connection is made of. */
const salesforceConnectSchema = z.object({
  domain: z.string().trim().min(1).max(300),
  consumerKey: z.string().trim().min(1).max(500),
  consumerSecret: z.string().trim().min(1).max(500),
});

/**
 * Why a Salesforce connection was refused, as a code the admin UI turns into a
 * sentence. Never Salesforce's own error body.
 */
export type SalesforceConnectError =
  | 'domain_invalid'
  | 'invalid_client'
  | 'no_run_as'
  | 'rejected'
  | 'unreachable';

const headerRowBodySchema = z.object({
  spreadsheetId: z.string().min(1).max(200),
  sheetTitle: z.string().max(200).optional(),
  headers: z.array(z.string().max(200)).min(1).max(MAX_SHEET_COLUMNS),
});

const createSpreadsheetBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  sheetTitle: z.string().trim().min(1).max(100),
  headers: z.array(z.string().max(200)).max(MAX_SHEET_COLUMNS).default([]),
});

/** A spreadsheet created for a form, or why it could not be. */
export type GoogleSheetsCreateResponse =
  | { ok: true; spreadsheetId: string; spreadsheetTitle: string; sheetTitle: string; gid: number }
  | { ok: false; reason: 'not_connected' | 'forbidden' | 'unavailable' };

/**
 * What the browser needs to open Google's Picker.
 *
 * `accessToken` is the one credential in this API that is handed to a browser.
 * The Picker cannot run without it, and what it can reach is bounded by the
 * `drive.file` scope: the files this app created or was handed, for an hour.
 */
export type GoogleSheetsPickerResponse =
  | { enabled: true; accessToken: string; apiKey: string; appId: string }
  | { enabled: false; reason: 'not_connected' | 'unavailable' };

/** The tab picker's answer: the spreadsheet's tabs, or why there are none to show. */
export type GoogleSheetsTabsResponse =
  | { enabled: true; spreadsheetTitle: string; tabs: SheetTabDto[] }
  | { enabled: false; reason: 'not_connected' | 'not_found' | 'forbidden' | 'unavailable' };

/** What pressing "write the header row" did. */
export type GoogleSheetsHeaderRowResponse =
  | { ok: true; written: true }
  | { ok: true; written: false; reason: 'not_empty' }
  | { ok: false; reason: 'not_connected' | 'not_found' | 'forbidden' | 'unavailable' };

/**
 * What keeping a form's header row in line with its columns did.
 *
 * Reported by the destinations save (when that save changed the headers or
 * the spreadsheet) and by the form's "update the header row" button. Never a
 * reason for the save itself to fail: the columns are stored either way.
 */
export type SheetHeaderSync =
  | { outcome: 'written' | 'unchanged' }
  /** A `check` found row 1 is dForms' own but out of date; the next save fixes it. */
  | { outcome: 'stale' }
  /**
   * Row 1 does not match and was left alone. `current` is what it holds and
   * `headers` what would be written, for the card's side-by-side.
   */
  | { outcome: 'foreign'; current: string[]; headers: string[] }
  | { outcome: 'failed'; reason: 'not_connected' | 'not_found' | 'forbidden' | 'unavailable' };

/** The form-scoped header button's answer. */
export type FormSheetHeaderRowResponse =
  | ({ ok: true } & SheetHeaderSync)
  | { ok: false; reason: 'not_configured' };

/** Narrow a path param to a known provider, or 400 (never echoes the raw input). */
function parseProvider(raw: string): IntegrationProvider {
  if ((integrationProviders as readonly string[]).includes(raw)) return raw as IntegrationProvider;
  throw new BadRequestException({
    error: 'BAD_REQUEST',
    message: `unknown integration provider (expected one of ${integrationProviders.join(', ')})`,
  });
}

/**
 * Providers whose credential is pasted, and which `POST :provider/connect`
 * therefore serves.
 *
 * `google-sheets` is excluded on purpose. Its credential is a refresh token
 * minted by the consent flow below, so a token "pasted" for it would either be
 * something the operator cannot have or an access token that stops working
 * within the hour. Letting it through that route would store a credential that
 * looks connected on the card and fails on the first delivery.
 */
const PASTE_TOKEN_PROVIDERS: ReadonlySet<IntegrationProvider> = new Set([
  'hubspot',
  'calendly',
]);

/**
 * Account-level integration connect/status + the HubSpot property picker. Every
 * route is host-authed and account-scoped — the principal's `accountId` is the
 * only tenant key. Writes (connect/disconnect) additionally require an
 * admin/owner: connecting an account-wide CRM token is a workspace-settings
 * action. A pasted token is VALIDATED against the provider before it is stored,
 * and is NEVER echoed back — the status view is token-free (last4 + label only),
 * and a provider error body is never surfaced.
 */
/**
 * One row of the account's webhook inventory.
 *
 * Built field by field from the repository's projection rather than spread from
 * a destination object, so there is no field a signing secret could ride in and
 * no masking pass to forget. `WEBHOOK_SECRET_MASK` never appears here either —
 * the sentinel is a read artefact of the form endpoints, and surfacing it in a
 * list would read as a value.
 */
export interface AccountWebhookDto {
  formId: string;
  formName: string;
  /** Null on configs written before destinations carried stable ids. */
  webhookId: string | null;
  url: string;
  enabled: boolean;
  /** Resolved, not stored: absent `events` means both phases fire. */
  firesPartial: boolean;
  firesComplete: boolean;
  /**
   * True while the owning form's spam protection is on AND this deployment can
   * run the check: the API then delivers no partial to any destination, so a
   * partial trigger here is paused. `firesPartial` keeps saying what the owner
   * saved, which is what comes back when protection is turned off.
   */
  partialsHeld: boolean;
  hasSecret: boolean;
  /** Null when nothing has failed — never a claim that anything succeeded. */
  failures: { count: number; lastError: string | null; lastAt: number } | null;
}

export interface AccountWebhooksResponse {
  items: AccountWebhookDto[];
}

@Controller('v1/integrations')
export class IntegrationsController {
  /** Injectable for tests; defaults to global fetch for provider validation. */
  fetchImpl: typeof fetch = fetch;

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(HubspotPropertiesService) private readonly hubspot: HubspotPropertiesService,
    @Inject(CalendlyEventTypesService) private readonly calendly: CalendlyEventTypesService,
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: ServerEnv,
    // Only to say whether a form's partials are held on THIS deployment.
    // Optional: specs build this controller positionally.
    @Optional() @Inject(CAPTCHA) private readonly captcha?: CaptchaVerifier,
    // After `captcha` and optional for the same reason stated there: the specs
    // build this controller positionally, so a new required parameter in the
    // middle would silently shift every one of them.
    @Optional() @Inject(DcalService) private readonly dcal?: DcalService,
    /**
     * The account's Google access token, shared with the delivery path so a
     * disconnect clears the one cache both of them read.
     *
     * LAST, and after `captcha`, for the same reason `captcha` is late: the
     * specs construct this controller positionally, so a parameter inserted
     * above would silently shift what each of them receives.
     */
    @Optional()
    @Inject(GoogleSheetsAccessTokens)
    private readonly googleTokens: GoogleSheetsAccessTokens = new GoogleSheetsAccessTokens(),
    /** Salesforce's token cache and field list. Last, for the positional specs. */
    @Optional()
    @Inject(SalesforceAccessTokens)
    private readonly salesforceTokens: SalesforceAccessTokens = new SalesforceAccessTokens(),
    @Optional()
    @Inject(SalesforceFieldsService)
    private readonly salesforceFields?: SalesforceFieldsService,
  ) {}

  /**
   * This account's connections (token-free) + whether server encryption is
   * available + which providers the DEPLOYMENT already supplies a token for.
   *
   * That last list closes a reporting hole: a provider can be fully working
   * through its env fallback (`HUBSPOT_PRIVATE_APP_TOKEN` / `CALENDLY_API_TOKEN`)
   * while `account_integration` is empty, so the page said "Not connected" about
   * an integration that was syncing submissions. Both statements were true and
   * together they were a lie. Env knowledge stays here rather than in
   * `@quill/db`, which must not read the environment.
   */
  @Get()
  async list(@Req() req: ReqLike): Promise<{
    encryptionAvailable: boolean;
    providers: IntegrationStatus[];
    serverProvided: IntegrationProvider[];
    unavailable: IntegrationProvider[];
    googlePicker: boolean;
    /**
     * dCal is not a connection (the scheduler picker forwards the author's own
     * session), so it is not in `providers`. The Connections page still shows
     * it, and this says whether it exists on this deployment and where event
     * types are created. Null when the deployment has no dCal.
     */
    dcal: { createEventUrl: string } | null;
  }> {
    const p = await this.auth.resolveHost(req);
    const providers = await listIntegrationStatuses(this.db, p.accountId);
    const usable = (token: string | undefined): boolean =>
      !!token?.trim() && !PLACEHOLDER_TOKENS.has(token.trim());
    const serverProvided: IntegrationProvider[] = [];
    if (usable(this.env.HUBSPOT_PRIVATE_APP_TOKEN)) serverProvided.push('hubspot');
    if (usable(this.env.CALENDLY_API_TOKEN)) serverProvided.push('calendly');
    // Providers this DEPLOYMENT cannot connect at all. Google Sheets needs an
    // OAuth client the operator registers with Google, and without one the
    // authorize route can only refuse, so the page must not offer the card.
    // Asked through the same `googleOAuthClient` the authorize route asks, so
    // the list and the button cannot disagree about it.
    const unavailable: IntegrationProvider[] = [];
    if (!googleOAuthClient(this.env)) unavailable.push('google-sheets');
    return {
      encryptionAvailable: hasEncryptionKey(this.env.FORMS_ENCRYPTION_KEY),
      providers,
      serverProvided,
      unavailable,
      // Whether "choose an existing spreadsheet" can be offered. Asked through
      // the same function the picker route asks, for the same reason as above.
      googlePicker: googlePickerConfig(this.env) !== null,
      dcal: (() => {
        const createEventUrl = dcalCreateEventUrl(this.env);
        return createEventUrl ? { createEventUrl } : null;
      })(),
    };
  }

  /**
   * Every webhook this account's forms POST to, as an inventory.
   *
   * Webhooks are the one destination configured PER FORM rather than connected
   * once per account, so until now the only way to answer "which of my forms
   * send data out, and where?" was to open each form's Connect tab in turn. The
   * account page can now answer it; editing still belongs to the form.
   *
   * Declared ahead of `:provider/connect` so a future `@Get(':provider')` cannot
   * capture `webhooks` as a provider name.
   *
   * Not admin-gated, matching the sibling `@Get()`: this is a read, and it
   * discloses nothing a member cannot reach already — `PUT /forms/:id/destinations`
   * is itself open to members, so anyone who can open a form's Connect tab can
   * already see these URLs.
   *
   * `events` is resolved here rather than in the client. Absent or empty means
   * BOTH phases, a back-compat rule whose only home is `destinationFiresForPhase`
   * — the repository returns what is stored, this returns what it means.
   */
  @Get('webhooks')
  async webhooks(@Req() req: ReqLike): Promise<AccountWebhooksResponse> {
    const p = await this.auth.resolveHost(req);
    const [webhooks, failures] = await Promise.all([
      listAccountWebhooks(this.db, p.accountId),
      // Only webhook rows: a HubSpot delivery that died belongs to the HubSpot
      // card, not to a webhook's row.
      summarizeFailedDeliveriesByForm(this.db, p.accountId, 'webhook'),
    ]);
    const byForm = new Map(failures.map((f) => [f.formId, f]));

    return {
      items: webhooks.map((w) => {
        const events = w.events as DestinationEvent[] | null;
        const hit = byForm.get(w.formId);
        return {
          formId: w.formId,
          formName: w.formName,
          webhookId: w.webhookId,
          url: w.url,
          enabled: w.enabled,
          firesPartial: destinationFiresForPhase(
            { type: 'webhook', events: events ?? undefined },
            'partial',
          ),
          firesComplete: destinationFiresForPhase(
            { type: 'webhook', events: events ?? undefined },
            'complete',
          ),
          // The same answer the submit path acts on, from the same published config.
          partialsHeld: captchaActive({ spamProtection: { captcha: w.captcha } }, this.captcha),
          hasSecret: w.hasSecret,
          // Per FORM, not per webhook — the queue records `ctx.formId`, never the
          // destination id, so two webhooks on one form share one figure.
          failures: hit ? { count: hit.count, lastError: hit.lastError, lastAt: hit.lastAt } : null,
        };
      }),
    };
  }

  /**
   * Connect a Salesforce org with Client Credentials: the org's My Domain plus
   * an External Client App's consumer key and secret.
   *
   * Declared ahead of `:provider/connect`, which would otherwise capture it and
   * ask for a single `token`. The three values are proved BEFORE anything is
   * stored: a token is minted with them and the org's name is read with it, so
   * a connection the card shows as connected is one a delivery can use.
   */
  @Post('salesforce/connect')
  async connectSalesforce(@Req() req: ReqLike, @Body() body: unknown): Promise<IntegrationStatus> {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const refuse = (reason: SalesforceConnectError, cause?: string): never => {
      throw new BadRequestException({
        error: 'SALESFORCE_REJECTED',
        reason,
        ...(cause ? { cause } : {}),
        message: `salesforce: ${reason}`,
      });
    };
    let input: z.infer<typeof salesforceConnectSchema>;
    try {
      input = salesforceConnectSchema.parse(body);
    } catch (err) {
      if (err instanceof ZodError)
        throw new BadRequestException({ error: 'BAD_REQUEST', message: err.issues[0]?.message });
      throw err;
    }
    // Checked before anything leaves the server: the secret is posted to this
    // host, so it must be the org's own My Domain and nothing else.
    const domain = normalizeSalesforceDomain(input.domain);
    if (!domain) refuse('domain_invalid');
    const key = this.env.FORMS_ENCRYPTION_KEY;
    if (!hasEncryptionKey(key)) {
      throw new BadRequestException({
        error: 'ENCRYPTION_UNAVAILABLE',
        message: 'server encryption key not configured',
      });
    }
    const creds = { domain: domain!, consumerKey: input.consumerKey, consumerSecret: input.consumerSecret };
    let minted: Awaited<ReturnType<typeof mintSalesforceToken>>;
    try {
      minted = await mintSalesforceToken(creds, this.fetchImpl);
    } catch (err) {
      // Which way the call died (DNS, a reset connection, a certificate, a
      // timeout) is what tells an operator whether egress is blocked, so the
      // code goes back with the refusal. Only the code: never a message, which
      // can carry the URL and the body.
      return refuse('unreachable', networkCause(err));
    }
    if (!minted.ok) return refuse(minted.reason);
    const orgName = await readOrgName(minted, this.fetchImpl);
    const status = await upsertIntegration(
      this.db,
      p.accountId,
      'salesforce',
      JSON.stringify(creds),
      key!,
      orgName ?? 'Salesforce',
      salesforceLast4(creds),
    );
    this.invalidatePickerCache(p.accountId, 'salesforce');
    return status;
  }

  /**
   * Connect (or re-connect) a provider by pasting its token. The token is
   * VALIDATED against the provider (HubSpot → list contact properties; Calendly
   * → GET /users/me) before it is encrypted + stored, and a display label is
   * derived from the response. Returns the token-free status.
   */
  @Post(':provider/connect')
  async connect(
    @Req() req: ReqLike,
    @Param('provider') providerParam: string,
    @Body() body: unknown,
  ): Promise<IntegrationStatus> {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const provider = parseProvider(providerParam);
    if (!PASTE_TOKEN_PROVIDERS.has(provider)) {
      throw new BadRequestException({
        error: 'BAD_REQUEST',
        message: `${provider} is connected through its own authorization flow, not a pasted token`,
      });
    }

    let token: string;
    try {
      token = connectBodySchema.parse(body).token.trim();
    } catch (err) {
      if (err instanceof ZodError)
        throw new BadRequestException({ error: 'BAD_REQUEST', message: err.issues[0]?.message });
      throw err;
    }
    if (!token) throw new BadRequestException({ error: 'BAD_REQUEST', message: 'token is required' });

    // Storing requires the server encryption key — without it the paste-token
    // model can't persist a token safely, so reject clearly (a fork on env-only
    // tokens simply never calls connect).
    const key = this.env.FORMS_ENCRYPTION_KEY;
    if (!hasEncryptionKey(key)) {
      throw new BadRequestException({
        error: 'ENCRYPTION_UNAVAILABLE',
        message: 'server encryption key not configured',
      });
    }

    const validation = await this.validateToken(provider, token);
    if (!validation.ok) {
      throw new BadRequestException({
        error: 'TOKEN_REJECTED',
        message: `the token was rejected by ${provider}`,
      });
    }

    const status = await upsertIntegration(this.db, p.accountId, provider, token, key!, validation.label);
    // The picker caches are keyed by account, so a new token must not keep
    // serving the old one's list for the rest of the TTL.
    this.invalidatePickerCache(p.accountId, provider);
    return status;
  }

  /**
   * Start the Google Sheets consent flow: returns the Google URL the browser
   * should go to. An ordinary admin route, which is the point (see
   * `google-oauth.ts`): this is where the principal is resolved, and the signed
   * `state` it mints is what the unauthenticated callback trusts afterwards.
   *
   * Returns the URL instead of a 302 so the caller stays in control of the
   * navigation: the connections panel reaches this through a server action, and
   * a redirect answer there would be followed by `fetch`, not by the browser.
   */
  @Post('google-sheets/authorize')
  async googleAuthorize(@Req() req: ReqLike, @Body() body?: unknown): Promise<{ authUrl: string }> {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    // Where to land afterwards, when the flow starts on a form's Connect tab
    // instead of this page. Anything that is not one of the allowed dashboard
    // paths is dropped rather than refused: the flow still works, it just
    // returns to the connections page, and nothing the caller sends can turn
    // the callback into an open redirect.
    const returnTo = safeGoogleReturnTo(isRecord(body) ? body.returnTo : undefined);

    const client = googleOAuthClient(this.env);
    if (!client) {
      throw new BadRequestException({
        error: 'INTEGRATION_UNAVAILABLE',
        message: 'this deployment has no Google OAuth client configured',
      });
    }
    // Same gate as the paste-token providers: without the encryption key there
    // is nowhere safe to put the refresh token at the end of the round trip, so
    // refuse before sending anyone to a consent screen.
    const key = googleStateKey(this.env);
    if (!hasEncryptionKey(this.env.FORMS_ENCRYPTION_KEY) || !key) {
      throw new BadRequestException({
        error: 'ENCRYPTION_UNAVAILABLE',
        message: 'server encryption key not configured',
      });
    }

    return {
      authUrl: googleAuthorizeUrl(client, signGoogleState(p.accountId, key, Date.now(), returnTo)),
    };
  }

  /**
   * Where Google sends the operator back. Unauthenticated by necessity and safe
   * by signature: the `state` is the only thing trusted here, and it carries the
   * account the flow was started for.
   *
   * Always ends in a redirect to the connections page, never in a JSON error: a
   * person is sitting in a browser at this point. The outcome rides as a query
   * flag the page turns into a toast, and every failure uses the same
   * `error=google` value, because distinguishing "bad signature" from "expired"
   * for an anonymous caller only helps someone probing the endpoint.
   */
  @Get('google-sheets/callback')
  // The decorator supplies the default; every return below overrides both the
  // URL and the status, which is Nest's contract for a dynamic redirect.
  @Redirect('/', 302)
  async googleCallback(
    @Query('code') rawCode: unknown,
    @Query('state') rawState: unknown,
    @Query('error') denied: unknown,
  ): Promise<{ url: string; statusCode: number }> {
    // `?code=a&code=b` arrives as an array. Only a single string is a usable
    // value; anything else is treated as missing and ends in `error=google`.
    const code = typeof rawCode === 'string' ? rawCode : undefined;
    const state = typeof rawState === 'string' ? rawState : undefined;
    const client = googleOAuthClient(this.env);
    const key = googleStateKey(this.env);
    // Verified up front, even on the paths that end in an error, because the
    // state is also what says WHERE the operator started: a form's Connect tab
    // gets its outcome there, not on a page they never opened. Only a verified
    // state is read for it; an unverified one returns to the connections page.
    const claims = key && state ? verifyGoogleState(state, key) : null;
    const done = (params: string) => ({
      url: this.returnUrl(claims?.returnTo, params),
      statusCode: 302,
    });
    // The operator pressed Cancel on the consent screen. Not an error worth a
    // scary toast, and nothing was stored.
    if (denied) return done('google=cancelled');

    if (!client || !key || !code || !state) return done('error=google');
    if (!claims) return done('error=google');

    const tokens = await this.exchangeGoogle(client, code);
    if (!tokens) return done('error=google');
    // A consent screen lets scopes be unticked, and Google answers 200 with
    // whatever was granted. Storing that would look connected and 403 on the
    // first delivery, so it is refused with its own flag.
    if (!grantedSheetsAccess(tokens.scopes)) return done('error=google_scope');

    await upsertIntegration(
      this.db,
      claims.accountId,
      'google-sheets',
      tokens.refreshToken,
      this.env.FORMS_ENCRYPTION_KEY!,
      tokens.email ?? 'Google Sheets',
    );
    // This pod drops its token at once; the others miss on their own because
    // the cache entry is tied to the refresh token that minted it.
    this.googleTokens.invalidate(claims.accountId);
    return done('google=connected');
  }

  /**
   * The tabs of one spreadsheet, for the Connect tab's picker.
   *
   * Any authenticated host may read it: it drives their own mapping UI, and it
   * discloses only what the account's own connected Google account can already
   * open. Not cached, unlike the HubSpot and Calendly pickers: an author opens
   * this once while choosing a sheet, and a cache would mostly serve a stale
   * tab list to the one person who just renamed a tab.
   */
  @Get('google-sheets/tabs')
  async googleSheetsTabs(
    @Req() req: ReqLike,
    @Query('spreadsheetId') spreadsheetId?: string,
  ): Promise<GoogleSheetsTabsResponse> {
    const p = await this.auth.resolveHost(req);
    const id = spreadsheetId?.trim();
    if (!id) throw new BadRequestException({ error: 'BAD_REQUEST', message: 'spreadsheetId is required' });

    const accessToken = await this.googleTokens.resolve(this.db, p.accountId, this.env, this.fetchImpl);
    if (!accessToken) return { enabled: false, reason: 'not_connected' };

    const result = await listSheetTabs(accessToken, id, this.fetchImpl);
    if (!result.ok) return { enabled: false, reason: result.reason };
    return {
      enabled: true,
      spreadsheetTitle: result.spreadsheetTitle,
      tabs: result.tabs,
    };
  }

  /**
   * Create a spreadsheet for a form in the connected Google account, header
   * row included.
   *
   * The path that needs nothing but the consent already given, and the default
   * one: under the `drive.file` scope the app reaches a spreadsheet only if it
   * created it or the author chose it in Google's Picker.
   *
   * Any authenticated host, like the tab list: it writes into the Google
   * account this workspace connected, the same thing every delivery from a form
   * they can already edit does.
   */
  @Post('google-sheets/spreadsheets')
  @HttpCode(200)
  async googleSheetsCreate(
    @Req() req: ReqLike,
    @Body() body: unknown,
  ): Promise<GoogleSheetsCreateResponse> {
    const p = await this.auth.resolveHost(req);
    let input: { title: string; sheetTitle: string; headers: string[] };
    try {
      input = createSpreadsheetBodySchema.parse(body);
    } catch (err) {
      if (err instanceof ZodError)
        throw new BadRequestException({ error: 'BAD_REQUEST', message: err.issues[0]?.message });
      throw err;
    }

    const accessToken = await this.googleTokens.resolve(this.db, p.accountId, this.env, this.fetchImpl);
    if (!accessToken) return { ok: false, reason: 'not_connected' };

    const result = await createSpreadsheet(accessToken, input, this.fetchImpl);
    if (!result.ok) return { ok: false, reason: result.reason };
    return {
      ok: true,
      spreadsheetId: result.spreadsheetId,
      spreadsheetTitle: result.spreadsheetTitle,
      sheetTitle: result.sheetTitle,
      gid: result.gid,
    };
  }

  /**
   * What the browser needs to open Google's Picker on this account's Drive.
   *
   * Choosing a file in the Picker is what grants this app access to it, so the
   * Picker is the only way an EXISTING spreadsheet reaches a form. It runs in
   * the browser, which is why this route hands out an access token: see
   * `GoogleSheetsPickerResponse` for what that token can and cannot reach.
   *
   * Never cached by anything in between: the body is a credential.
   */
  @Get('google-sheets/picker')
  @Header('Cache-Control', 'no-store')
  async googleSheetsPicker(@Req() req: ReqLike): Promise<GoogleSheetsPickerResponse> {
    const p = await this.auth.resolveHost(req);
    // Admins only, like connect and disconnect. The other Google routes do one
    // bounded thing on the server; this one hands the browser a bearer token
    // that reaches every spreadsheet the account's `drive.file` grant covers.
    // A member can still create a new spreadsheet for their form.
    assertAdmin(p);
    const config = googlePickerConfig(this.env);
    if (!config) return { enabled: false, reason: 'unavailable' };

    const accessToken = await this.googleTokens.resolve(this.db, p.accountId, this.env, this.fetchImpl);
    if (!accessToken) return { enabled: false, reason: 'not_connected' };
    return { enabled: true, accessToken, apiKey: config.apiKey, appId: config.appId };
  }

  /**
   * Write the header row of the chosen tab, once.
   *
   * An author-pressed button rather than part of a delivery: it READS before it
   * writes, and a delivery that read the sheet first would double what every
   * submission costs against a 60-a-minute quota. Refuses to overwrite a row 1
   * that already holds anything, because a spreadsheet does not remember what
   * used to be in a cell.
   */
  @Post('google-sheets/header-row')
  async googleSheetsHeaderRow(
    @Req() req: ReqLike,
    @Body() body: unknown,
  ): Promise<GoogleSheetsHeaderRowResponse> {
    const p = await this.auth.resolveHost(req);
    let input: { spreadsheetId: string; sheetTitle?: string; headers: string[] };
    try {
      input = headerRowBodySchema.parse(body);
    } catch (err) {
      if (err instanceof ZodError)
        throw new BadRequestException({ error: 'BAD_REQUEST', message: err.issues[0]?.message });
      throw err;
    }

    const accessToken = await this.googleTokens.resolve(this.db, p.accountId, this.env, this.fetchImpl);
    if (!accessToken) return { ok: false, reason: 'not_connected' };

    const result = await writeHeaderRow(
      accessToken,
      input.spreadsheetId,
      input.sheetTitle,
      input.headers,
      this.fetchImpl,
    );
    if (!result.ok) return { ok: false, reason: result.reason };
    return result.written ? { ok: true, written: true } : { ok: true, written: false, reason: 'not_empty' };
  }

  /**
   * The admin page a finished consent flow returns to, with its outcome flag.
   *
   * The connections page by default, or the form the flow was started from
   * when the signed state names one (its Connect tab, so the author lands back
   * on the card they pressed the button on). The origin is always the
   * deployment's own `PUBLIC_APP_URL`; the state contributes a path from a
   * fixed allowlist and nothing else.
   */
  private returnUrl(returnTo: string | undefined, params: string): string {
    const base = (this.env.PUBLIC_APP_URL ?? '').trim().replace(/\/+$/, '');
    const path = safeGoogleReturnTo(returnTo) ?? '/admin/integrations';
    const query = path.startsWith('/admin/forms/') ? `tab=connect&${params}` : params;
    return `${base}${path}?${query}`;
  }

  /** Seam for the specs: the one network call the callback makes. */
  private exchangeGoogle(client: GoogleOAuthClient, code: string) {
    return exchangeGoogleCode(client, code, this.fetchImpl);
  }

  /** Disconnect a provider for this account. Idempotent → 204. */
  @Delete(':provider')
  @HttpCode(204)
  async disconnect(@Req() req: ReqLike, @Param('provider') providerParam: string): Promise<void> {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const provider = parseProvider(providerParam);
    await deleteIntegration(this.db, p.accountId, provider);
    this.invalidatePickerCache(p.accountId, provider);
  }

  /**
   * Drop the one provider's picker cache for this account (see the services).
   *
   * A switch for the same reason `validateToken` is one: as an if/else with
   * Calendly as the tail, connecting Google Sheets would have cleared the
   * CALENDLY cache and left its own untouched. Providers with no picker cache
   * fall through to nothing, which is correct rather than accidental.
   */
  private invalidatePickerCache(accountId: string, provider: IntegrationProvider): void {
    switch (provider) {
      case 'hubspot':
        this.hubspot.invalidate(accountId);
        return;
      case 'google-sheets':
        // NOT a picker cache but the ACCESS TOKEN cache, and the reason this
        // case has to exist: disconnecting deletes the stored refresh token,
        // but a token already minted from it stays valid for up to its cached
        // life. Without this, a form kept writing into the author's spreadsheet
        // for the best part of an hour after they revoked access, which reads
        // as the disconnect button not working.
        this.googleTokens.invalidate(accountId);
        return;
      case 'calendly':
        this.calendly.invalidate(accountId);
        return;
      case 'salesforce':
        // Both caches: the token (so a disconnect stops deliveries now, not in
        // ten minutes) and the field list (so a reconnect to ANOTHER org does
        // not keep offering the previous org's fields).
        this.salesforceTokens.invalidate(accountId);
        this.salesforceFields?.invalidate(accountId);
        return;
      default:
        return;
    }
  }

  /** HubSpot contact-property picker (per-account token, 5-min cache). */
  @Get('hubspot/properties')
  async hubspotProperties(@Req() req: ReqLike): Promise<HubSpotPropertiesResponse> {
    // Any authenticated host may read the property list (it drives their mapping UI).
    const p = await this.auth.resolveHost(req);
    return this.hubspot.listProperties(p.accountId);
  }

  /**
   * The connected org's writable Lead fields (and Contact's field names) for
   * the Salesforce mapping UI. `refresh=1` re-reads the org, which is what an
   * author needs after adding a custom field; rate-limited because a cache
   * bypass with outbound calls behind it can be looped.
   */
  @Get('salesforce/fields')
  @UseGuards(RateLimitGuard)
  async salesforceFieldList(
    @Req() req: ReqLike,
    @Query('refresh') refresh?: string,
  ): Promise<SalesforceFieldsResponse> {
    const p = await this.auth.resolveHost(req);
    if (!this.salesforceFields) return { enabled: false, reason: 'unavailable' };
    return this.salesforceFields.listFields(p.accountId, {
      refresh: refresh === '1' || refresh === 'true',
    });
  }

  /** Calendly event-type picker for the scheduler step (per-account token, 5-min cache). */
  @Get('calendly/event-types')
  async calendlyEventTypes(@Req() req: ReqLike): Promise<CalendlyEventTypesResponse> {
    const p = await this.auth.resolveHost(req);
    return this.calendly.listEventTypes(p.accountId);
  }

  /**
   * dCal event-type picker for the scheduler step, read with the AUTHOR'S own
   * session: their bearer is forwarded to dCal, which scopes the answer to it.
   * No stored credential is involved, so there is nothing to connect first.
   *
   * `workspaceId` picks one of the author's other workspaces (the picker's
   * switcher); `refresh=1` drops the cached list, which is what the empty
   * state's refresh asks for after the author created an event in dCal.
   */
  @Get('dcal/event-types')
  // Outbound calls on every miss, and `refresh=1` is a deliberate cache bypass,
  // so the route can be looped. Guarded for the reason `pingWebhook` is: it
  // must not be turnable into a scanner by repetition.
  @UseGuards(RateLimitGuard)
  async dcalEventTypes(
    @Req() req: ReqLike,
    @Query('workspaceId') workspaceId?: string,
    @Query('refresh') refresh?: string,
  ): Promise<DcalEventTypesResponse> {
    const p = await this.auth.resolveHost(req);
    if (!this.dcal) return { enabled: false, reason: 'This deployment has no dCal configured.' };
    return this.dcal.listEventTypes(p.accountId, p.memberId, bearerOf(req), {
      ...(workspaceId?.trim() ? { workspaceId: workspaceId.trim() } : {}),
      refresh: refresh === '1' || refresh === 'true',
    });
  }

  /**
   * Validate a pasted token by calling the provider with it, returning a display
   * label on success. Never returns the token or the provider's error body. A
   * provider rejection OR an unreachable provider both fail closed (`ok:false`),
   * so an unvalidated token is never stored.
   */
  private async validateToken(
    provider: IntegrationProvider,
    token: string,
  ): Promise<{ ok: true; label: string } | { ok: false }> {
    try {
      // A switch, NOT an if/else with Calendly as the tail. This used to read
      // "if hubspot, else Calendly", so every provider added after those two
      // would have been validated against api.calendly.com and rejected with a
      // message naming the wrong vendor.
      switch (provider) {
        case 'hubspot': {
          const res = await this.fetchImpl(HUBSPOT_PROPERTIES_URL, {
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          });
          return res.ok ? { ok: true, label: 'HubSpot' } : { ok: false };
        }
        case 'calendly': {
          const res = await this.fetchImpl(CALENDLY_ME_URL, {
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          });
          if (!res.ok) return { ok: false };
          const cbody = (await res.json().catch(() => ({}))) as {
            resource?: { email?: string; name?: string };
          };
          const label = cbody.resource?.email?.trim() || cbody.resource?.name?.trim() || 'Calendly';
          return { ok: true, label };
        }
        default:
          // Reached only if a provider is added to `PASTE_TOKEN_PROVIDERS`
          // without a probe here. Fail closed: an unvalidated token is never
          // stored.
          return { ok: false };
      }
    } catch {
      // Couldn't reach the provider: fail closed (never store an unvalidated token).
      return { ok: false };
    }
  }
}

const destinationsBodySchema = z.object({ destinations: z.array(formDestinationSchema) });

/**
 * The mirror-form bookkeeping the API writes for itself, as opposed to the
 * settings an author edits. Kept apart because they are sourced from the stored
 * row on every save and a caller's copy is never trusted — see `syncMirror`.
 */
interface OwnedMirrorState {
  formGuid?: string | null;
  formSignature?: string;
}

/** The submission id a test delivery names. No real submission has it. */
const PING_SUBMISSION_ID = 'test-submission';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Read the owned mirror state off a form's STORED destinations.
 *
 * Deliberately duck-typed rather than parsed: a config that no longer satisfies
 * `formDestinationSchema` (an older shape, a hand-edited row) must still yield
 * its guid, because failing to find one is precisely what makes the next save
 * create a duplicate form in the portal. There is at most one HubSpot
 * destination per form, so the first match is the answer.
 */
function storedMirrorState(stored: unknown): OwnedMirrorState {
  if (!Array.isArray(stored)) return {};
  for (const entry of stored) {
    if (!isRecord(entry) || entry.type !== 'hubspot') continue;
    const settings = isRecord(entry.settings) ? entry.settings : {};
    const owned: OwnedMirrorState = {};
    // `null` is meaningful — `syncMirrorForm` writes it to say "the portal no
    // longer has this form, make a new one on the next save".
    if (typeof settings.formGuid === 'string' || settings.formGuid === null) {
      owned.formGuid = settings.formGuid;
    }
    if (typeof settings.formSignature === 'string') owned.formSignature = settings.formSignature;
    return owned;
  }
  return {};
}

/**
 * The settings to store: the caller's, with the owned keys stripped and then set
 * from the sync's result.
 *
 * Strip-then-set rather than a spread, so a caller that INVENTS a `formGuid` for
 * a form that has none cannot have it survive. Pointing one account's form at
 * another's mirror is the failure worth being explicit about; a stale guid is
 * merely the common one.
 */
function mirrorSettingsFor(
  raw: unknown,
  settings: MirrorSyncResult['settings'],
): Record<string, unknown> {
  const fromCaller = isRecord(raw) && isRecord(raw.settings) ? raw.settings : {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fromCaller)) {
    if (key !== 'formGuid' && key !== 'formSignature') out[key] = value;
  }
  if (settings.formGuid !== undefined) out.formGuid = settings.formGuid;
  if (settings.formSignature !== undefined) out.formSignature = settings.formSignature;
  return out;
}

/** Where a spreadsheet destination writes, and what dForms last put in its row 1. */
interface SheetHeaderSnapshot {
  spreadsheetId: string;
  sheetTitle: string;
  headers: string[];
}

/**
 * Each Sheets Admin call on the SAVE path gets this long, not the ten seconds
 * the Connect tab's own buttons get: the save waits on it, and the autosave
 * that sent the save gives up at fifteen.
 */
const SHEETS_SAVE_TIMEOUT_MS = 4_000;

/**
 * The headers a destination's columns put in row 1, in order: the written
 * columns only (`isWritableSheetColumn`: the ones with a heading), the same
 * ones every delivered row holds, so an unnamed column shifts nothing.
 */
function sheetHeadersOf(entry: Record<string, unknown> | undefined): string[] {
  const columns = Array.isArray(entry?.columns) ? entry.columns : [];
  return columns
    .filter(
      (c): c is { header: string; source: string; key?: string } =>
        isRecord(c) && typeof c.header === 'string' && isWritableSheetColumn({ header: c.header }),
    )
    .map((c) => c.header.trim());
}

/** Where a destination writes: its spreadsheet and tab (`''` is the first tab). */
function sheetTargetOf(
  entry: Record<string, unknown> | undefined,
): { spreadsheetId: string; sheetTitle: string } | null {
  const settings = isRecord(entry?.settings) ? entry.settings : {};
  const spreadsheetId = typeof settings.spreadsheetId === 'string' ? settings.spreadsheetId.trim() : '';
  if (!spreadsheetId) return null;
  const sheetTitle = typeof settings.sheetTitle === 'string' ? settings.sheetTitle.trim() : '';
  return { spreadsheetId, sheetTitle };
}

/**
 * A stored snapshot, duck-typed like `storedMirrorState` so an old row still
 * yields one. `headerSnapshot` is what dForms last wrote to row 1;
 * `headerForeign` is the headings it last found it may not write there.
 */
function snapshotOf(
  entry: Record<string, unknown> | undefined,
  key: 'headerSnapshot' | 'headerForeign' = 'headerSnapshot',
): SheetHeaderSnapshot | null {
  const raw = isRecord(entry?.settings) ? entry.settings[key] : undefined;
  if (!isRecord(raw) || typeof raw.spreadsheetId !== 'string' || !Array.isArray(raw.headers)) return null;
  return {
    spreadsheetId: raw.spreadsheetId,
    sheetTitle: typeof raw.sheetTitle === 'string' ? raw.sheetTitle : '',
    headers: raw.headers.filter((h): h is string => typeof h === 'string'),
  };
}

const sameList = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

const firstSheetsEntry = (list: unknown): Record<string, unknown> | undefined =>
  Array.isArray(list)
    ? (list.find((d) => isRecord(d) && d.type === 'google-sheets') as Record<string, unknown> | undefined)
    : undefined;

/**
 * Auth-gated PARTIAL config write for the integrations screen: replaces ONLY the
 * `destinations` key, merged against the row's fresh config server-side in one
 * request — the web tier no longer reads the whole config and writes it back
 * (which raced a concurrent editor save). See updateFormDestinations for the
 * optimistic-locking caveat.
 */
@Controller('v1')
export class FormDestinationsController {
  private readonly log = new Logger('FormDestinations');
  /** Injectable for tests; defaults to global fetch for the webhook ping. */
  fetchImpl: typeof fetch = fetch;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuthService) private readonly auth: AuthService,
    @Optional() @Inject(ENV) private readonly env?: ServerEnv,
    /** Reused for its per-account cache — the mirror needs the same list. */
    @Optional()
    @Inject(HubspotPropertiesService)
    private readonly hubspotProperties?: HubspotPropertiesService,
    /** The app-wide Google token cache, shared with the delivery path. */
    @Optional()
    @Inject(GoogleSheetsAccessTokens)
    private readonly googleTokens?: GoogleSheetsAccessTokens,
  ) {}

  @Put('forms/:id/destinations')
  async putDestinations(@Req() req: ReqLike, @Param('id') id: string, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    const { destinations } = parse(destinationsBodySchema, body, keyDestinationsBodyIssues(p, body));
    // At most one HubSpot destination — see `hasExtraHubspotDestination`. Not in
    // the schema above, so a form that already stores two still READS fine.
    // Compared against what is STORED, not against 1: the builder's per-question
    // picker writes the whole array back on every pick, so a count-only guard
    // would 400 an edit that adds nothing. Webhooks are unaffected.
    // Account-scoped, so a foreign or missing id is a 404 here — BEFORE the
    // guard, or a bad body would answer 400 for a form the caller cannot see.
    const before = await getFormById(this.db, p.accountId, id);
    if (!before) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    const stored = (before.config as { destinations?: unknown } | null)?.destinations;
    if (hasExtraHubspotDestination(destinations, stored)) {
      throw new BadRequestException({
        error: 'BAD_REQUEST',
        message: ONE_HUBSPOT_DESTINATION_MESSAGE,
      });
    }
    if (hasExtraSalesforceDestination(destinations, stored)) {
      throw new BadRequestException({
        error: 'BAD_REQUEST',
        message: ONE_SALESFORCE_DESTINATION_MESSAGE,
      });
    }
    // Bring the HubSpot mirror form in line BEFORE storing, so the guid it
    // returns is written in the same request that created it — no window where
    // a form exists in the portal that nothing points at. A HubSpot failure
    // never fails the save: an author must be able to edit their mappings while
    // a portal is unreachable or has not granted the scopes.
    const mirror = await this.syncMirror(p.accountId, before.name, destinations, stored);
    // Same rule for the spreadsheet's header row: brought in line BEFORE
    // storing, so the snapshot of what was written lands in this same write.
    const sheets = await this.syncSheetHeaders(p.accountId, mirror.destinations, stored);
    const out = await updateFormDestinations(this.db, p.accountId, id, sheets.destinations);
    if (!out.ok) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    // Never echo the stored webhook secret back to the client (mask on READ).
    return {
      ...out.value,
      config: maskConfigSecrets(out.value.config),
      ...(mirror.error ? { formActivityError: mirror.error } : {}),
      ...(sheets.result ? { sheetHeaders: sheets.result } : {}),
    };
  }

  /**
   * The Connect tab's "update the header row" button: bring row 1 in line with
   * the columns this form has STORED, now.
   *
   * Form-scoped and read from the stored config rather than from a body,
   * unlike the account-level `google-sheets/header-row` route it replaces in
   * the editor: the headers, the spreadsheet and the snapshot of what was last
   * written all come from the row, so nothing the browser sends decides what
   * gets overwritten. The same rule as the save path decides whether anything
   * is (see `syncHeaderRow`).
   */
  @Post('forms/:id/destinations/google-sheets/header-row')
  @HttpCode(200)
  async syncFormSheetHeaders(
    @Req() req: ReqLike,
    @Param('id') id: string,
    @Body() body?: unknown,
  ): Promise<FormSheetHeaderRowResponse> {
    const p = await this.auth.resolveHost(req);
    const form = await getFormById(this.db, p.accountId, id);
    if (!form) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    const stored = (form.config as { destinations?: unknown } | null)?.destinations;
    const entry = firstSheetsEntry(stored);
    if (!entry || !sheetTargetOf(entry) || sheetHeadersOf(entry).length === 0) {
      return { ok: false, reason: 'not_configured' };
    }
    // `replace: true` is the author's confirmed "replace row 1": the one path
    // that may overwrite a row 1 dForms cannot prove it wrote. A literal
    // `true` only; anything else is the ordinary, conservative sync.
    const replace = isRecord(body) && body.replace === true;
    // `check: true` is the card opening: one read, reported, nothing written
    // to the sheet and nothing stored. It runs on a copy of the config read
    // before Google answers, and an edit autosaved meanwhile must win.
    const check = !replace && isRecord(body) && body.check === true;
    const synced = await this.syncSheetHeaders(p.accountId, stored as unknown[], stored, {
      force: true,
      replace,
      check,
      timeoutMs: SHEETS_SAVE_TIMEOUT_MS * 2,
    });
    if (check) return { ok: true, ...(synced.result ?? { outcome: 'unchanged' }) };
    const before = snapshotOf(entry);
    const after = snapshotOf(firstSheetsEntry(synced.destinations));
    // Written back only when the snapshot moved, so a press that finds row 1
    // already right (or someone else's) is a read and nothing more. And ONLY
    // the snapshot, merged onto a FRESH read of the form: the Sheets calls
    // above can take seconds (this also runs when the card opens), and an
    // edit autosaved in that window must not be overwritten by the copy of
    // the destinations read before them.
    if (after && JSON.stringify(before) !== JSON.stringify(after)) {
      await this.recordSheetSnapshot(p.accountId, id, after);
    }
    // The headings written came from the config read BEFORE the Sheets calls.
    // An autosave that changed them in that window (a rename while "replace
    // row 1" was in flight) means row 1 now holds the old ones: say so rather
    // than "written", so the card offers to bring it up to date. The snapshot
    // recorded above is the truth about row 1, so that update is automatic.
    if (after && (synced.result?.outcome === 'written' || synced.result?.outcome === 'unchanged')) {
      const fresh = await getFormById(this.db, p.accountId, id);
      const now = sheetHeadersOf(firstSheetsEntry((fresh?.config as { destinations?: unknown } | null)?.destinations));
      if (!sameList(now, after.headers)) return { ok: true, outcome: 'stale' };
    }
    return { ok: true, ...(synced.result ?? { outcome: 'unchanged' }) };
  }

  /**
   * Set `headerSnapshot` on the stored Sheets destination that writes to the
   * same spreadsheet and tab, read-modify-write on the CURRENT config, every
   * other field of every destination left exactly as stored. If the author
   * has since pointed the card elsewhere, there is nothing to record: the
   * snapshot describes a row 1 the destination no longer writes to.
   */
  private async recordSheetSnapshot(
    accountId: string,
    formId: string,
    snapshot: SheetHeaderSnapshot,
  ): Promise<void> {
    // Compare-and-swap on the form's `updated_at`: the array written is the
    // one just read plus this one field, and it lands only if nothing was
    // written in between. A save that did land in between is kept, and the
    // field is merged onto IT on the one retry.
    for (let attempt = 0; attempt < 2; attempt++) {
      const fresh = await getFormById(this.db, accountId, formId);
      const list = (fresh?.config as { destinations?: unknown } | null)?.destinations;
      if (!fresh || !Array.isArray(list)) return;
      const index = list.findIndex((d) => isRecord(d) && d.type === 'google-sheets');
      if (index === -1) return;
      const current = list[index] as Record<string, unknown>;
      const target = sheetTargetOf(current);
      if (!target || target.spreadsheetId !== snapshot.spreadsheetId || target.sheetTitle !== snapshot.sheetTitle) {
        return;
      }
      const settings: Record<string, unknown> = {
        ...(isRecord(current.settings) ? current.settings : {}),
        headerSnapshot: snapshot,
      };
      // Written means known: whatever was recorded as someone else's row 1 is not.
      delete settings.headerForeign;
      const next = [...list];
      next[index] = { ...current, settings };
      const out = await updateFormDestinations(this.db, accountId, formId, next, fresh.updatedAt);
      if (out.ok || out.reason !== 'STALE') return;
    }
  }


  /**
   * Keep the spreadsheet's row 1 in line with the columns, returning the
   * destinations to store and what the attempt did.
   *
   * Runs unless it is KNOWN what row 1 holds for these headings (see the
   * comment at the skip below): a save that touched something else costs
   * Google nothing once row 1 is in sync or known to be someone else's, and
   * a failed sync is retried by the next save. `force` is the button.
   *
   * `headerSnapshot` is this method's own bookkeeping, sourced from what is
   * STORED and from the result, never from the caller, for the reason
   * `syncMirror` gives for the HubSpot guid: it decides what may be
   * overwritten in somebody's spreadsheet, so a client must not be able to
   * claim a row 1 dForms never wrote.
   *
   * The lists row 1 may match to count as dForms' own are the snapshot (for
   * this exact spreadsheet and tab) and the headers the STORED columns had
   * before this edit. The second covers a destination saved before snapshots
   * existed, whose row 1 was written by the create call, and a snapshot lost
   * to a racing save. Both are header lists dForms produced for this target,
   * so neither can make a foreign row look like ours.
   */
  private async syncSheetHeaders(
    accountId: string,
    destinations: unknown[],
    stored: unknown,
    opts: { force?: boolean; replace?: boolean; check?: boolean; timeoutMs?: number } = {},
  ): Promise<{ destinations: unknown[]; result?: SheetHeaderSync }> {
    const index = destinations.findIndex((d) => isRecord(d) && d.type === 'google-sheets');
    if (index === -1) return { destinations };
    const raw = destinations[index] as Record<string, unknown>;
    const storedEntry = firstSheetsEntry(stored);
    const storedSnapshot = snapshotOf(storedEntry);
    const storedForeign = snapshotOf(storedEntry, 'headerForeign');

    // Strip-then-set, as `mirrorSettingsFor` does: a caller's bookkeeping never
    // survives, and the stored one is carried unless this attempt replaces it.
    const settings: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(isRecord(raw.settings) ? raw.settings : {})) {
      if (k !== 'headerSnapshot' && k !== 'headerForeign') settings[k] = v;
    }
    const withState = (
      snapshot: SheetHeaderSnapshot | null,
      foreign: SheetHeaderSnapshot | null,
      result?: SheetHeaderSync,
    ) => {
      const next = [...destinations];
      next[index] = {
        ...raw,
        settings: {
          ...settings,
          ...(snapshot ? { headerSnapshot: snapshot } : {}),
          ...(foreign ? { headerForeign: foreign } : {}),
        },
      };
      return { destinations: next, ...(result ? { result } : {}) };
    };
    const keep = (result?: SheetHeaderSync) => withState(storedSnapshot, storedForeign, result);

    const target = sheetTargetOf({ settings });
    const headers = sheetHeadersOf(raw);
    if (!target || headers.length === 0) return keep();

    const storedTarget = sheetTargetOf(storedEntry);
    const sameTarget =
      storedTarget?.spreadsheetId === target.spreadsheetId &&
      storedTarget.sheetTitle === target.sheetTitle;
    const storedHeaders = sheetHeadersOf(storedEntry);
    const forThis = (snap: SheetHeaderSnapshot | null) =>
      !!snap && snap.spreadsheetId === target.spreadsheetId && snap.sheetTitle === target.sheetTitle;

    // Skip Google only when it is KNOWN what row 1 holds for these headings:
    // dForms wrote exactly them (the snapshot), or it already found row 1 is
    // someone else's for exactly them (`headerForeign`, so an unrelated save
    // does not re-read a sheet it has to leave alone anyway). Not on header
    // equality with the stored config alone: a sync that FAILED (Google down
    // while columns were reordered) left the config saying "A, B" and row 1
    // saying "B, A", and every later save used to skip it, while deliveries
    // wrote one column's answers under the other's heading.
    const inSync = forThis(storedSnapshot) && sameList(storedSnapshot!.headers, headers);
    const knownForeign = forThis(storedForeign) && sameList(storedForeign!.headers, headers);
    if (!opts.force && (inSync || knownForeign)) return keep();

    const owned: string[][] = [];
    if (forThis(storedSnapshot)) owned.push(storedSnapshot!.headers);
    if (sameTarget && storedHeaders.length > 0) owned.push(storedHeaders);

    let token = '';
    try {
      token = await this.googleAccessToken(accountId);
    } catch {
      return keep({ outcome: 'failed', reason: 'unavailable' });
    }
    if (!token) return keep({ outcome: 'failed', reason: 'not_connected' });

    const result = await syncHeaderRow(
      token,
      target.spreadsheetId,
      target.sheetTitle || undefined,
      headers,
      owned,
      this.fetchImpl,
      opts.timeoutMs ?? SHEETS_SAVE_TIMEOUT_MS,
      { replace: opts.replace, check: opts.check },
    );
    // A failure records nothing, so the next save tries again.
    if (!result.ok) return keep({ outcome: 'failed', reason: result.reason });
    if (result.outcome === 'foreign') {
      return withState(storedSnapshot, { ...target, headers }, {
        outcome: 'foreign',
        current: result.current,
        headers,
      });
    }
    if (result.outcome === 'stale') return keep({ outcome: 'stale' });
    return withState({ ...target, headers }, null, { outcome: result.outcome });
  }

  /** Seam for the specs: the account's Google access token, or `''` without one. */
  private googleAccessToken(accountId: string): Promise<string> {
    if (!this.googleTokens) return Promise.resolve('');
    return this.googleTokens.resolve(this.db, accountId, this.env, this.fetchImpl);
  }

  /**
   * Bring every HubSpot destination's mirror form in line with what this form
   * writes, returning the destinations to store.
   *
   * The array is rewritten rather than patched in place because the mirror's
   * guid belongs to the destination that owns it, and the caller stores the
   * whole array in one write. Only the HubSpot entries can change; everything
   * else passes through by reference.
   *
   * `formGuid` and `formSignature` are read from what is STORED and the caller's
   * values are discarded — they are this method's own bookkeeping, not settings
   * an author edits. Trusting the request body meant any client that did not
   * echo them back created a SECOND form in the portal on the very next save:
   * with no guid there is no form to PATCH and no signature to compare, so every
   * write POSTed a new one and abandoned the old — which still holds the
   * activities already attached to real contacts. The Connect tab autosaves per
   * keystroke and never learns the guid (the save action returns only
   * `{ok, formActivityError}`), so one editing session with the switch on was
   * one new form per debounce. Sourcing them here fixes it for every caller at
   * once, including the ones that have not been written yet.
   */
  private async syncMirror(
    accountId: string,
    formName: string,
    destinations: unknown[],
    stored: unknown,
  ): Promise<{ destinations: unknown[]; error?: string }> {
    if (!destinations.some((d) => (d as { type?: string })?.type === 'hubspot')) {
      return { destinations };
    }
    // Resolved once, and only for a form that actually has a HubSpot entry.
    let token: string | null = null;
    try {
      token = await resolveProviderToken(
        this.db,
        accountId,
        'hubspot',
        this.env?.FORMS_ENCRYPTION_KEY,
        this.env?.HUBSPOT_PRIVATE_APP_TOKEN,
      );
    } catch {
      token = null;
    }

    // Which contact properties the portal actually has. A form field naming one
    // it does not makes the CREATE fail with `400 internal error`, so a single
    // stale mapping among many would cost the whole activity. Cached per
    // account by the same service the property picker uses, so this is normally
    // free. A failure here leaves it unknown and nothing is filtered.
    let knownProperties: Set<string> | null = null;
    try {
      const listed = await this.hubspotProperties?.listProperties(accountId);
      if (listed?.enabled) knownProperties = new Set(listed.properties.map((p) => p.name));
    } catch {
      knownProperties = null;
    }

    // At most one HubSpot destination per form (`hasExtraHubspotDestination`,
    // enforced by the caller), so the stored mirror state is a single value
    // rather than something to match up entry by entry.
    const owned = storedMirrorState(stored);

    let error: string | undefined;
    const out = await Promise.all(
      destinations.map(async (raw) => {
        const parsed = formDestinationSchema.safeParse(raw);
        if (!parsed.success || parsed.data.type !== 'hubspot') return raw;
        // Discarded before the sync ever sees them: a spread would let an
        // INVENTED guid through whenever nothing is stored, and the sync would
        // dutifully PATCH whatever form it named.
        const settings = { ...parsed.data.settings };
        delete settings.formGuid;
        delete settings.formSignature;
        const result = await syncMirrorForm(
          { ...parsed.data, settings: { ...settings, ...owned } },
          formName,
          { fetchImpl: this.fetchImpl, token, knownProperties },
        );
        if (result.error && !error) error = result.error;
        // Merge onto the RAW entry, not the parsed one: parsing applies schema
        // defaults, and writing those back would rewrite fields this request
        // never touched. The two owned keys are set from the RESULT on every
        // path — including `noop` and `unchanged`, where returning the caller's
        // entry unchanged used to drop a stored guid on the floor, so switching
        // the activity off orphaned the form it was meant to keep.
        return { ...(raw as object), settings: mirrorSettingsFor(raw, result.settings) };
      }),
    );
    return { destinations: out, error };
  }

  /**
   * Send ONE sample delivery to this form's configured webhook, so an author can
   * see the shape their endpoint receives without waiting for a real respondent.
   *
   * Three things make this safe to expose, and all three are load-bearing:
   *  - **admin-only + account-scoped.** The form is fetched with the principal's
   *    `accountId`, so this can only ever ping a webhook the caller owns.
   *  - **the SSRF guard runs.** `WebhookDestination.deliver` resolves the host
   *    and rejects private/loopback/link-local/metadata targets before any
   *    request leaves. An endpoint that makes the SERVER fetch a URL the USER
   *    typed is the textbook internal-network probe; reusing the real adapter
   *    means the guard cannot be forgotten here.
   *  - **rate limited.** Same guard the public surface uses, so the route cannot
   *    be turned into a scanner by repetition.
   *
   * The payload is the real `WebhookPayload` shape with sample answers built
   * from the form's own input steps (a message or reveal step collects
   * nothing, so it gets none), in the phase the webhook listens to
   * (`complete` unless it only takes partial saves), and it carries `test:
   * true` at the top level so a receiver can tell it apart from a lead. The
   * older `data.test` marker stays for receivers that read it, unless a step
   * is keyed `test`: its sample answer wins there, never the marker.
   */
  @UseGuards(RateLimitGuard)
  @Post('forms/:id/destinations/webhook/ping')
  @HttpCode(200)
  async pingWebhook(
    @Req() req: ReqLike,
    @Param('id') id: string,
  ): Promise<WebhookPingResult> {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const form = await getFormById(this.db, p.accountId, id);
    if (!form) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });

    const config = form.config as { steps?: { key: string; type: string }[] };
    const destinations = (form.config as { destinations?: FormDestination[] }).destinations ?? [];
    const webhook = destinations.find((d) => d.type === 'webhook');
    if (!webhook || webhook.type !== 'webhook' || !webhook.settings.url) {
      throw new BadRequestException({
        error: 'NO_WEBHOOK',
        message: 'This form has no webhook URL configured.',
      });
    }

    // Loopback is permitted ONLY when the stored hostname is literally localhost
    // — exactly the case the URL validator carves out for a developer pointing a
    // form at a local catcher. Blanket-allowing it would also accept an https
    // host that RESOLVES to 127.0.0.1, which is the DNS-rebinding path into the
    // deployment's own loopback. Private and reserved ranges (10/8, 192.168/16,
    // the 169.254 metadata address) are refused either way by the guard.
    const literalLoopback = isLiteralLoopbackHost(webhook.settings.url);
    const dest = new WebhookDestination(
      {
        url: webhook.settings.url,
        secret: webhook.settings.secret || undefined,
        signatureHeader: webhook.settings.signatureHeader || undefined,
        allowLocalhost: literalLoopback,
      },
      this.fetchImpl,
    );

    const now = Date.now();
    const answers = sampleAnswers(config.steps ?? []);
    const data = 'test' in answers ? answers : { ...answers, test: true };
    // The phase the endpoint will really receive: a webhook that only takes
    // partial saves gets a partial, every other one the final submit.
    const events = webhook.events ?? [];
    const phase: 'partial' | 'complete' = events.length > 0 && !events.includes('complete') ? 'partial' : 'complete';
    // A file answer gets its `url` exactly as a real delivery would, minted by
    // the same code for this placeholder submission, so the receiver sees the
    // real shape. Opening it answers 404: there is no such submission. Absent
    // wherever a real payload would carry none.
    const fileLinks = fileLinksFor(this.env, PING_SUBMISSION_ID, data);
    const ctx = {
      idempotencyKey: `ping:${id}:${now}`,
      submissionId: PING_SUBMISSION_ID,
      formId: form.id,
      formName: form.name,
      accountId: p.accountId,
      sessionId: 'test-session',
      score: 0,
      outcomeLabel: null,
      phase,
      submittedAt: now,
      data,
      test: true,
      utm: {},
      ...(fileLinks ? { fileLinks } : {}),
      // The page a real delivery names (#199), so the author sees every key a
      // receiver will get. The cookie is a placeholder no HubSpot portal knows.
      visit: {
        pageUri: 'https://example.com/landing?utm_source=test',
        pageName: 'Example landing page',
        hutk: '0'.repeat(32),
        embedded: true,
      },
    };

    /**
     * Log the test delivery beside the real ones.
     *
     * A ping is synchronous — the author clicks and waits for the verdict — so
     * it never passes through the outbox. That is a fact about HOW it is
     * dispatched, and it was letting the delivery history stay empty during
     * exactly the session it exists to help: wiring up an endpoint, when the
     * test delivery is often the only one that has ever run. It IS a real signed
     * POST to the real URL, so it belongs in the log, labelled by its `ping`
     * action. Recorded terminal so the worker can never pick it up and send it a
     * second time.
     *
     * Best-effort throughout: the author's answer is the ping result, and
     * failing to write the log entry must not turn a successful test delivery
     * into an error on screen.
     */
    const record = async (status: 'done' | 'failed', error: string | null, transcript: object) => {
      try {
        await recordSettledDelivery(this.db, {
          kind: 'webhook',
          action: WEBHOOK_PING_ACTION,
          accountId: p.accountId,
          subjectUid: ctx.submissionId,
          // Same shape every destination row carries, so the per-form read finds
          // it by `ctx.formId` like any other.
          payload: JSON.stringify({ destination: { type: 'webhook' }, ctx }),
          status,
          error,
          transcript,
          now,
        });
      } catch (e) {
        this.log.warn(`could not record the webhook test delivery: ${String(e)}`);
      }
    };

    try {
      const result = await dest.deliver(ctx);
      await record('done', null, {
        requestBody: result.requestBody,
        responseStatus: result.responseStatus,
        responseBody: result.responseBody,
      });
      // The status the endpoint answered, as the delivery log records it.
      return { ok: true, ...(typeof result.responseStatus === 'number' ? { status: result.responseStatus } : {}) };
    } catch (err) {
      await record(
        'failed',
        err instanceof Error ? err.message : String(err),
        transcriptOfError(err),
      );
      // "HTTP 400" alone sends the author looking in the wrong place. Classify
      // it into something the UI can explain, and pass along the endpoint's own
      // response — which names the real reason far more often than the status
      // code does.
      return { ok: false, ...classifyWebhookFailure(err) };
    }
  }
}

/** What went wrong with a test delivery, in terms the UI can explain. */
export type WebhookPingReason =
  | 'method_not_allowed'
  | 'unsupported_media_type'
  | 'rejected_body'
  | 'unauthorized'
  | 'not_found'
  | 'rate_limited'
  | 'server_error'
  | 'redirect'
  | 'blocked'
  | 'unreachable'
  | 'unknown';

export interface WebhookPingResult {
  ok: boolean;
  reason?: WebhookPingReason;
  /** The status the endpoint answered with, when it answered at all. */
  status?: number;
  /** The endpoint's own response body, trimmed and truncated. */
  detail?: string;
  /** The raw adapter message — kept for the log and for reasons we cannot name. */
  message?: string;
}

/**
 * Map a failed delivery onto a reason the UI has copy for.
 *
 * Deliberately NOT a guess at intent. A 405 genuinely means "this endpoint does
 * not accept POST" and we say exactly that; a 400 means the endpoint read the
 * request and rejected the body, which is a different sentence, even though the
 * underlying mistake is often the same one. Saying "your webhook is not POST"
 * on a 400 would be right often enough to be trusted and wrong often enough to
 * send someone down the wrong path — so the copy for 4xx states what we send
 * (POST, application/json) and lets the endpoint's own message do the rest.
 */
export function classifyWebhookFailure(err: unknown): {
  reason: WebhookPingReason;
  status?: number;
  detail?: string;
  message: string;
} {
  const message = err instanceof Error ? err.message : String(err);

  if (err instanceof WebhookHttpError) {
    const { status, detail } = err;
    const base = { status, detail: detail ?? undefined, message };
    if (status >= 300 && status < 400) return { reason: 'redirect', ...base };
    if (status === 405 || status === 501) return { reason: 'method_not_allowed', ...base };
    if (status === 415) return { reason: 'unsupported_media_type', ...base };
    if (status === 401 || status === 403) return { reason: 'unauthorized', ...base };
    if (status === 404 || status === 410) return { reason: 'not_found', ...base };
    if (status === 429) return { reason: 'rate_limited', ...base };
    if (status >= 500) return { reason: 'server_error', ...base };
    if (status >= 400) return { reason: 'rejected_body', ...base };
    return { reason: 'unknown', ...base };
  }

  // The SSRF guard refused before anything left the process. Its own message is
  // the explanation; naming it separately keeps "we blocked this" from reading
  // like "your server is down".
  if (/blocked|private|loopback|link-local|metadata|not a public/i.test(message)) {
    return { reason: 'blocked', message };
  }
  // AbortError (our timeout) and fetch's TypeError both mean nobody answered.
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return { reason: 'unreachable', message };
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(message)) {
    return { reason: 'unreachable', message };
  }
  return { reason: 'unknown', message };
}

/**
 * Is this URL's hostname LITERALLY loopback (not merely resolving there)?
 * Mirrors the webhook URL validator's one http exception, and nothing wider.
 */
function isLiteralLoopbackHost(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

/** A plausible answer per question type, so the sample body has real shape. */
function sampleAnswers(steps: { key: string; type: string }[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of steps) {
    // A message or reveal step collects nothing: a real delivery has no answer for it.
    if (isInputlessStep(s as Pick<FormStep, 'type'>)) continue;
    switch (s.type) {
      case 'email':
        out[s.key] = 'sample@example.com';
        break;
      case 'phone':
        out[s.key] = '+15555550123';
        break;
      case 'url':
        out[s.key] = 'https://example.com';
        break;
      case 'slider':
        out[s.key] = 5;
        break;
      case 'file':
        // The object shape a real file answer has, so an endpoint author wires
        // against `name` and not against a string that never arrives. Its
        // `url` is added on the way out, by the same code a real delivery uses.
        out[s.key] = {
          key: 'uploads/acct/form/session/9f3c.pdf',
          name: 'sample.pdf',
          size: '40211',
          mime: 'application/pdf',
        };
        break;
      case 'multiple_choice':
      case 'dropdown':
        out[s.key] = 'sample-option';
        break;
      case 'checkbox':
        // Checked is the JSON boolean; an unchecked box sends no key at all.
        out[s.key] = true;
        break;
      case 'name':
        out.firstname = 'Sample';
        out.lastname = 'Respondent';
        break;
      default:
        out[s.key] = 'Sample answer';
    }
  }
  return out;
}

/**
 * The code a failed outbound call died with (`ENOTFOUND`, `ECONNRESET`,
 * `CERT_HAS_EXPIRED`, `TimeoutError`...), or `undefined`. Node's `fetch` puts
 * the socket error on `cause`. Anything that does not look like a code is
 * dropped, so no message, URL or body can ride back to the browser.
 */
export function networkCause(err: unknown): string | undefined {
  const e = err as { cause?: { code?: unknown; name?: unknown }; code?: unknown; name?: unknown } | null;
  const candidates = [e?.cause?.code, e?.code, e?.cause?.name, e?.name];
  for (const c of candidates) {
    if (typeof c === 'string' && /^(?:[A-Z][A-Z0-9_]{1,39}|TimeoutError|AbortError)$/.test(c)) return c;
  }
  return undefined;
}
