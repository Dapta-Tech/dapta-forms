import { Controller, Get, Inject, Injectable, Req } from '@nestjs/common';
import type { ServerEnv } from '@quill/config/env';
import { AuthService, type ReqLike } from './auth.service';
import { ENV } from './tokens';

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
  private cache: { data: HubSpotPropertyDto[]; expires: number } | null = null;

  constructor(
    @Inject(ENV) private readonly env: ServerEnv,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private token(): string | null {
    const token = this.env.HUBSPOT_PRIVATE_APP_TOKEN;
    if (!token || PLACEHOLDER_TOKENS.has(token.trim())) return null;
    return token;
  }

  async listProperties(now = Date.now()): Promise<HubSpotPropertiesResponse> {
    const token = this.token();
    if (!token) {
      return {
        enabled: false,
        reason: 'HUBSPOT_PRIVATE_APP_TOKEN is not configured on the server.',
      };
    }
    if (this.cache && this.cache.expires > now) {
      return { enabled: true, cached: true, properties: this.cache.data };
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
      .map((p) => ({ name: p.name, label: p.label || p.name, type: p.type ?? 'string' }))
      .sort((a, b) => a.label.localeCompare(b.label));
    this.cache = { data: properties, expires: now + CACHE_TTL_MS };
    return { enabled: true, cached: false, properties };
  }
}

/** Auth-gated integration endpoints for the admin mapping UI. */
@Controller('v1/integrations')
export class IntegrationsController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(HubspotPropertiesService) private readonly hubspot: HubspotPropertiesService,
  ) {}

  /** HubSpot contact-property picker (server-side token, 5-min cache). */
  @Get('hubspot/properties')
  async hubspotProperties(@Req() req: ReqLike): Promise<HubSpotPropertiesResponse> {
    // Any authenticated host may read the property list (it drives their mapping UI).
    await this.auth.resolveHost(req);
    return this.hubspot.listProperties();
  }
}
