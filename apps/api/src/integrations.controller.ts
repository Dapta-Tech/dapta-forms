import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z, ZodError } from 'zod';
import type {
  Db,
  IntegrationProvider,
  IntegrationStatus,
  ProviderCredentialRevision,
  ResolvedProviderToken,
} from '@quill/db';
import {
  deleteIntegration,
  hasEncryptionKey,
  integrationProviders,
  listAccountWebhooks,
  listIntegrationStatuses,
  resolveProviderToken,
  providerCredentialRevisionEquals,
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
  hasExtraHubspotDestination,
  maskConfigSecrets,
  ONE_HUBSPOT_DESTINATION_MESSAGE,
  type DestinationEvent,
  type FormDestination,
} from '@quill/types';
import { transcriptOfError, WebhookDestination, WebhookHttpError } from '@quill/destinations';
import { syncMirrorForm, type MirrorSyncResult } from './hubspot-mirror';
import type { ServerEnv } from '@quill/config/env';
import { AuthService, type ReqLike } from './auth.service';
import { assertAdmin } from './permissions';
import { RateLimitGuard } from './rate-limit';
import { DB, ENV } from './tokens';

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

/** The event-type-picker response: disabled (no token) or the cached list. */
export type CalendlyEventTypesResponse =
  | { enabled: false; reason: string }
  | { enabled: true; cached: boolean; eventTypes: CalendlyEventTypeDto[] };

const PLACEHOLDER_TOKENS = new Set(['', 'your_private_app_token_here', 'your_token_here']);
const CACHE_TTL_MS = 5 * 60 * 1000;
const HUBSPOT_PROPERTIES_URL = 'https://api.hubapi.com/crm/v3/properties/contacts';
/** Calendly identity probe: validates a pasted token + yields its display label. */
const CALENDLY_ME_URL = 'https://api.calendly.com/users/me';
const CALENDLY_EVENT_TYPES_URL = 'https://api.calendly.com/event_types';

/**
 * Account-scoped integration metadata only. Its write boundary has no
 * credential argument, so tokens and token-derived values cannot enter state.
 */
type IntegrationMetadata = HubSpotPropertyDto[] | CalendlyEventTypeDto[];

export class AccountMetadataCache<T extends IntegrationMetadata> {
  private readonly entries = new Map<string, { revision: ProviderCredentialRevision; data: T; expires: number }>();

  get(accountId: string, revision: ProviderCredentialRevision, now: number): T | undefined {
    const cached = this.entries.get(accountId);
    if (!cached || cached.expires <= now || !providerCredentialRevisionEquals(cached.revision, revision)) {
      this.entries.delete(accountId);
      return undefined;
    }
    return cached.data;
  }

  setIfCurrent(
    accountId: string,
    capturedRevision: ProviderCredentialRevision,
    currentRevision: ProviderCredentialRevision,
    data: T,
    now: number,
  ): boolean {
    if (!providerCredentialRevisionEquals(capturedRevision, currentRevision)) return false;
    this.entries.set(accountId, { revision: capturedRevision, data, expires: now + CACHE_TTL_MS });
    return true;
  }

  invalidate(accountId: string): void {
    this.entries.delete(accountId);
  }
}

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
  // account's connected token must never surface another account's list.
  //
  // The keying carries MORE weight now that entries include enumeration options:
  // a global cache would leak not just property names but their values — a
  // portal's internal sales taxonomy (deal stages, lead grades, account tiers).
  // Do not "optimize" this into a single shared map.
  private readonly cache = new AccountMetadataCache<HubSpotPropertyDto[]>();

  constructor(
    @Inject(ENV) private readonly env: ServerEnv,
    @Inject(DB) private readonly db: Db,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Remove metadata after this account's HubSpot credential source changes. */
  invalidate(accountId: string): void {
    this.cache.invalidate(accountId);
  }

  /**
   * The live HubSpot token for an account: its connected (decrypted) token if
   * present, else the single-tenant env fallback. Placeholder env values count
   * as absent so a bare clone reports disabled instead of 401-ing HubSpot.
   */
  private async resolveToken(accountId: string): Promise<ResolvedProviderToken | null> {
    const credential = await resolveProviderToken(
      this.db,
      accountId,
      'hubspot',
      this.env.FORMS_ENCRYPTION_KEY,
      this.env.HUBSPOT_PRIVATE_APP_TOKEN,
    );
    if (!credential || PLACEHOLDER_TOKENS.has(credential.token.trim())) return null;
    return credential;
  }

  async listProperties(accountId: string, now = Date.now()): Promise<HubSpotPropertiesResponse> {
    const credential = await this.resolveToken(accountId);
    if (!credential) {
      return {
        enabled: false,
        reason: 'No HubSpot token — connect HubSpot for this account or set the server token.',
      };
    }
    const cached = this.cache.get(accountId, credential.revision, now);
    if (cached) {
      return { enabled: true, cached: true, properties: cached };
    }
    const res = await this.fetchImpl(HUBSPOT_PROPERTIES_URL, {
      headers: { authorization: `Bearer ${credential.token}`, 'content-type': 'application/json' },
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
    // Provider I/O can overlap a credential mutation; cache only the source
    // revision that is still current after the response arrives.
    const current = await this.resolveToken(accountId);
    if (current) {
      this.cache.setIfCurrent(accountId, credential.revision, current.revision, properties, now);
    }
    return { enabled: true, cached: false, properties };
  }
}

interface CalendlyMeApiResponse {
  resource?: { uri?: string };
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
  private readonly cache = new AccountMetadataCache<CalendlyEventTypeDto[]>();

  constructor(
    @Inject(ENV) private readonly env: ServerEnv,
    @Inject(DB) private readonly db: Db,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Remove metadata after this account's Calendly credential source changes. */
  invalidate(accountId: string): void {
    this.cache.invalidate(accountId);
  }

  /** The live Calendly token for an account: connected (decrypted) else env fallback. */
  private async resolveToken(accountId: string): Promise<ResolvedProviderToken | null> {
    const credential = await resolveProviderToken(
      this.db,
      accountId,
      'calendly',
      this.env.FORMS_ENCRYPTION_KEY,
      this.env.CALENDLY_API_TOKEN,
    );
    if (!credential || PLACEHOLDER_TOKENS.has(credential.token.trim())) return null;
    return credential;
  }

  async listEventTypes(accountId: string, now = Date.now()): Promise<CalendlyEventTypesResponse> {
    const credential = await this.resolveToken(accountId);
    if (!credential) {
      return {
        enabled: false,
        reason: 'No Calendly token — connect Calendly for this account or set the server token.',
      };
    }
    const cached = this.cache.get(accountId, credential.revision, now);
    if (cached) {
      return { enabled: true, cached: true, eventTypes: cached };
    }
    const headers = { authorization: `Bearer ${credential.token}`, 'content-type': 'application/json' };
    // Calendly scopes event types by user, so resolve the token's own user first.
    const meRes = await this.fetchImpl(CALENDLY_ME_URL, { headers });
    if (!meRes.ok) return { enabled: false, reason: `Calendly rejected the request (HTTP ${meRes.status}).` };
    const me = (await meRes.json().catch(() => ({}))) as CalendlyMeApiResponse;
    const userUri = me.resource?.uri;
    if (!userUri) return { enabled: false, reason: 'Calendly did not return a user for this token.' };

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
    // Provider I/O can overlap a credential mutation; cache only the source
    // revision that is still current after the response arrives.
    const current = await this.resolveToken(accountId);
    if (current) {
      this.cache.setIfCurrent(accountId, credential.revision, current.revision, eventTypes, now);
    }
    return { enabled: true, cached: false, eventTypes };
  }
}

/** Connect-body contract: a non-empty pasted provider token. */
const connectBodySchema = z.object({ token: z.string().min(1) });

/** Narrow a path param to a known provider, or 400 (never echoes the raw input). */
function parseProvider(raw: string): IntegrationProvider {
  if ((integrationProviders as readonly string[]).includes(raw)) return raw as IntegrationProvider;
  throw new BadRequestException({
    error: 'BAD_REQUEST',
    message: 'unknown integration provider (expected hubspot or calendly)',
  });
}

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
  }> {
    const p = await this.auth.resolveHost(req);
    const providers = await listIntegrationStatuses(this.db, p.accountId);
    const usable = (token: string | undefined): boolean =>
      !!token?.trim() && !PLACEHOLDER_TOKENS.has(token.trim());
    const serverProvided: IntegrationProvider[] = [];
    if (usable(this.env.HUBSPOT_PRIVATE_APP_TOKEN)) serverProvided.push('hubspot');
    if (usable(this.env.CALENDLY_API_TOKEN)) serverProvided.push('calendly');
    return {
      encryptionAvailable: hasEncryptionKey(this.env.FORMS_ENCRYPTION_KEY),
      providers,
      serverProvided,
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
          hasSecret: w.hasSecret,
          // Per FORM, not per webhook — the queue records `ctx.formId`, never the
          // destination id, so two webhooks on one form share one figure.
          failures: hit ? { count: hit.count, lastError: hit.lastError, lastAt: hit.lastAt } : null,
        };
      }),
    };
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
    this.invalidateProviderCache(provider, p.accountId);
    return status;
  }

  /** Disconnect a provider for this account. Idempotent → 204. */
  @Delete(':provider')
  @HttpCode(204)
  async disconnect(@Req() req: ReqLike, @Param('provider') providerParam: string): Promise<void> {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const provider = parseProvider(providerParam);
    await deleteIntegration(this.db, p.accountId, provider);
    this.invalidateProviderCache(provider, p.accountId);
  }

  /** HubSpot contact-property picker (per-account token, 5-min cache). */
  @Get('hubspot/properties')
  async hubspotProperties(@Req() req: ReqLike): Promise<HubSpotPropertiesResponse> {
    // Any authenticated host may read the property list (it drives their mapping UI).
    const p = await this.auth.resolveHost(req);
    return this.hubspot.listProperties(p.accountId);
  }

  /** Calendly event-type picker for the scheduler step (per-account token, 5-min cache). */
  @Get('calendly/event-types')
  async calendlyEventTypes(@Req() req: ReqLike): Promise<CalendlyEventTypesResponse> {
    const p = await this.auth.resolveHost(req);
    return this.calendly.listEventTypes(p.accountId);
  }

  /** A connect or disconnect changes this account's provider metadata source. */
  private invalidateProviderCache(provider: IntegrationProvider, accountId: string): void {
    if (provider === 'hubspot') {
      this.hubspot.invalidate(accountId);
      return;
    }
    this.calendly.invalidate(accountId);
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
      if (provider === 'hubspot') {
        const res = await this.fetchImpl(HUBSPOT_PROPERTIES_URL, {
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        });
        return res.ok ? { ok: true, label: 'HubSpot' } : { ok: false };
      }
      const res = await this.fetchImpl(CALENDLY_ME_URL, {
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      });
      if (!res.ok) return { ok: false };
      const cbody = (await res.json().catch(() => ({}))) as {
        resource?: { email?: string; name?: string };
      };
      const label = cbody.resource?.email?.trim() || cbody.resource?.name?.trim() || 'Calendly';
      return { ok: true, label };
    } catch {
      // Couldn't reach the provider — fail closed (never store an unvalidated token).
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
  ) {}

  @Put('forms/:id/destinations')
  async putDestinations(@Req() req: ReqLike, @Param('id') id: string, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    let destinations: unknown[];
    try {
      destinations = destinationsBodySchema.parse(body).destinations;
    } catch (err) {
      if (err instanceof ZodError)
        throw new BadRequestException({ error: 'BAD_REQUEST', message: err.issues[0]?.message });
      throw err;
    }
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
    // Bring the HubSpot mirror form in line BEFORE storing, so the guid it
    // returns is written in the same request that created it — no window where
    // a form exists in the portal that nothing points at. A HubSpot failure
    // never fails the save: an author must be able to edit their mappings while
    // a portal is unreachable or has not granted the scopes.
    const mirror = await this.syncMirror(p.accountId, before.name, destinations, stored);
    const out = await updateFormDestinations(this.db, p.accountId, id, mirror.destinations);
    if (!out.ok) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    // Never echo the stored webhook secret back to the client (mask on READ).
    return {
      ...out.value,
      config: maskConfigSecrets(out.value.config),
      ...(mirror.error ? { formActivityError: mirror.error } : {}),
    };
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
      const credential = await resolveProviderToken(
        this.db,
        accountId,
        'hubspot',
        this.env?.FORMS_ENCRYPTION_KEY,
        this.env?.HUBSPOT_PRIVATE_APP_TOKEN,
      );
      token = credential?.token ?? null;
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
   * from the form's own steps, and it carries `phase: 'partial'` plus a
   * `test` marker so a receiver can tell it apart from a lead.
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
    const ctx = {
      idempotencyKey: `ping:${id}:${now}`,
      submissionId: 'test-submission',
      formId: form.id,
      formName: form.name,
      accountId: p.accountId,
      sessionId: 'test-session',
      score: 0,
      outcomeLabel: null,
      phase: 'partial' as const,
      submittedAt: now,
      data: { ...sampleAnswers(config.steps ?? []), test: true },
      utm: {},
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
      return { ok: true };
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
    if (s.type === 'message') continue;
    switch (s.type) {
      case 'email':
        out[s.key] = 'sample@example.com';
        break;
      case 'phone':
        out[s.key] = '+15555550123';
        break;
      case 'slider':
        out[s.key] = 5;
        break;
      case 'multiple_choice':
      case 'dropdown':
        out[s.key] = 'sample-option';
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
