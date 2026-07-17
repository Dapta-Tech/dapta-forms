import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { z, ZodError } from 'zod';
import type { Db, IntegrationProvider, IntegrationStatus } from '@quill/db';
import {
  deleteIntegration,
  hasEncryptionKey,
  integrationProviders,
  listIntegrationStatuses,
  resolveProviderToken,
  updateFormDestinations,
  upsertIntegration,
} from '@quill/db';
import { formDestinationSchema, maskConfigSecrets } from '@quill/types';
import type { ServerEnv } from '@quill/config/env';
import { AuthService, type ReqLike } from './auth.service';
import { assertAdmin } from './permissions';
import { DB, ENV } from './tokens';

/** A HubSpot contact property surfaced to the mapping UI. */
export interface HubSpotPropertyDto {
  name: string;
  label: string;
  type: string;
}

/** The property-picker response: disabled (no token) or the cached property list. */
export type HubSpotPropertiesResponse =
  | { enabled: false; reason: string }
  | { enabled: true; cached: boolean; properties: HubSpotPropertyDto[] };

const PLACEHOLDER_TOKENS = new Set(['', 'your_private_app_token_here', 'your_token_here']);
const CACHE_TTL_MS = 5 * 60 * 1000;
const HUBSPOT_PROPERTIES_URL = 'https://api.hubapi.com/crm/v3/properties/contacts';
/** Calendly identity probe: validates a pasted token + yields its display label. */
const CALENDLY_ME_URL = 'https://api.calendly.com/users/me';

interface HubSpotPropertiesApiResponse {
  results?: Array<{ name: string; label?: string; type?: string }>;
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
  private readonly cache = new Map<string, { data: HubSpotPropertyDto[]; expires: number }>();

  constructor(
    @Inject(ENV) private readonly env: ServerEnv,
    @Inject(DB) private readonly db: Db,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

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
        reason: 'No HubSpot token — connect HubSpot for this account or set the server token.',
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
      .map((prop) => ({ name: prop.name, label: prop.label || prop.name, type: prop.type ?? 'string' }))
      .sort((a, b) => a.label.localeCompare(b.label));
    this.cache.set(accountId, { data: properties, expires: now + CACHE_TTL_MS });
    return { enabled: true, cached: false, properties };
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
@Controller('v1/integrations')
export class IntegrationsController {
  /** Injectable for tests; defaults to global fetch for provider validation. */
  fetchImpl: typeof fetch = fetch;

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(HubspotPropertiesService) private readonly hubspot: HubspotPropertiesService,
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  /** This account's connections (token-free) + whether server encryption is available. */
  @Get()
  async list(
    @Req() req: ReqLike,
  ): Promise<{ encryptionAvailable: boolean; providers: IntegrationStatus[] }> {
    const p = await this.auth.resolveHost(req);
    const providers = await listIntegrationStatuses(this.db, p.accountId);
    return { encryptionAvailable: hasEncryptionKey(this.env.FORMS_ENCRYPTION_KEY), providers };
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

    return upsertIntegration(this.db, p.accountId, provider, token, key!, validation.label);
  }

  /** Disconnect a provider for this account. Idempotent → 204. */
  @Delete(':provider')
  @HttpCode(204)
  async disconnect(@Req() req: ReqLike, @Param('provider') providerParam: string): Promise<void> {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const provider = parseProvider(providerParam);
    await deleteIntegration(this.db, p.accountId, provider);
  }

  /** HubSpot contact-property picker (per-account token, 5-min cache). */
  @Get('hubspot/properties')
  async hubspotProperties(@Req() req: ReqLike): Promise<HubSpotPropertiesResponse> {
    // Any authenticated host may read the property list (it drives their mapping UI).
    const p = await this.auth.resolveHost(req);
    return this.hubspot.listProperties(p.accountId);
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
 * Auth-gated PARTIAL config write for the integrations screen: replaces ONLY the
 * `destinations` key, merged against the row's fresh config server-side in one
 * request — the web tier no longer reads the whole config and writes it back
 * (which raced a concurrent editor save). See updateFormDestinations for the
 * optimistic-locking caveat.
 */
@Controller('v1')
export class FormDestinationsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuthService) private readonly auth: AuthService,
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
    const out = await updateFormDestinations(this.db, p.accountId, id, destinations);
    if (!out.ok) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    // Never echo the stored webhook secret back to the client (mask on READ).
    return { ...out.value, config: maskConfigSecrets(out.value.config) };
  }
}
