import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ServerEnv } from '@quill/config/env';
import { ENV } from './tokens';

/**
 * Where an author creates dCal event types, or null when this deployment has
 * no dCal. The SAME condition `DcalService.configured()` uses, so the
 * Connections card and the scheduler picker cannot disagree about whether
 * dCal exists here.
 */
export function dcalCreateEventUrl(env: ServerEnv | undefined): string | null {
  const api = env?.DCAL_API_BASE_URL?.trim();
  const app = env?.DCAL_APP_URL?.trim().replace(/\/+$/, '');
  return api && app ? `${app}/admin/event-types` : null;
}

/**
 * dCal as a scheduling provider, read with the AUTHOR'S OWN SESSION.
 *
 * Every other integration in this app is a pasted credential: the account
 * connects HubSpot or Calendly once, the token is encrypted in
 * `account_integration`, and a read decrypts it. dCal needs none of that, and
 * that is the point. It projects the same identity service this app does (both
 * resolve their account from the `account_id` claim and their member from
 * `sub`, and both verify the same HS256 platform token), so the bearer the
 * author is already holding is a valid credential there.
 *
 * Which means:
 *
 *   - nothing is stored and nothing is encrypted, so there is no connect
 *     screen, no token to rotate and no credential to leak;
 *   - dCal scopes its answer to the token, so an author sees exactly the
 *     workspaces and event types they can already reach in dCal itself. This
 *     service adds no authority of its own, it only forwards.
 *
 * The forwarding is why the cache is keyed by MEMBER and not just by account:
 * `GET /v1/event-types` returns the caller's own personal events, so two
 * members of one dForms account must never share a cache entry.
 *
 * A deployment with no `DCAL_API_BASE_URL`, or a session with no bearer (the
 * `local` auth provider of a bare fork), reports dCal unavailable with a clear
 * reason instead of erroring. The builder then offers Calendly, exactly as it
 * did before dCal existed.
 */

/** One extra question an event type's booking form asks, beyond name/email/notes. */
export interface DcalBookingFieldDto {
  /**
   * The field's own name, which is also the prefill parameter
   * (`answer_<name>`). A NAME, not a position: Calendly's `a1`/`a2` aim at the
   * wrong question the moment a host reorders their form.
   */
  name: string;
  label: string;
  type: string;
  required: boolean;
}

/** An event type the author can embed in a form. */
export interface DcalEventTypeDto {
  /** dCal's own event-type id (what a scheduler step stores as `eventTypeUri`). */
  id: string;
  name: string;
  /** The public booking page, already assembled: this is what the form embeds. */
  schedulingUrl: string;
  /** False for an event type hidden from the host's public profile. */
  active: boolean;
  durationMinutes: number;
  /** Null for the author's own events, the team's name for a team event. */
  teamName: string | null;
  bookingFields: DcalBookingFieldDto[];
}

/** A workspace the author can act in, for the picker's switcher. */
export interface DcalWorkspaceDto {
  id: string;
  name: string;
  /** True for the one this request resolved in. */
  current: boolean;
}

export type DcalEventTypesResponse =
  | { enabled: false; reason: string }
  | {
      enabled: true;
      cached: boolean;
      /** Whose list this is (their email, else their name), as dCal reports it. */
      connectedAs: string | null;
      /** Every workspace the author can act in. One entry means no switcher. */
      workspaces: DcalWorkspaceDto[];
      eventTypes: DcalEventTypeDto[];
      /**
       * Where to send an author who has no event type yet: dCal's own editor.
       *
       * It travels in the RESPONSE rather than reaching the browser as a
       * `NEXT_PUBLIC_*`, because those are baked at build time and this host
       * differs per environment. The API already knows it; the panel opens it
       * in a new tab and offers a refresh for when they come back.
       */
      createEventUrl: string | null;
    };

/** How long a list is reused. Same five minutes as the HubSpot and Calendly pickers. */
const CACHE_TTL_MS = 5 * 60 * 1000;
/** A hung dCal must not hold the builder's request open. */
const TIMEOUT_MS = 10_000;
/** At most this many teams are asked for their event types in one read. */
const MAX_TEAMS = 20;
/** At most this many cached lists are kept, since part of the key is caller-supplied. */
const MAX_CACHE_ENTRIES = 200;

interface DcalMe {
  accountShortCode?: string;
  vanitySlug?: string | null;
  handle?: string;
  email?: string;
  displayName?: string | null;
  accountId?: string;
}
interface DcalWorkspace {
  accountId?: string;
  id?: string;
  name?: string;
  status?: string;
  current?: boolean;
}
interface DcalEventType {
  id?: string;
  slug?: string;
  title?: string;
  lengthMinutes?: number;
  hidden?: boolean;
  teamId?: string | null;
  bookingFields?: unknown[];
}
interface DcalTeam {
  id?: string;
  name?: string;
  slug?: string | null;
}

@Injectable()
export class DcalService {
  private readonly logger = new Logger(DcalService.name);
  private readonly cache = new Map<
    string,
    { expires: number; body: Extract<DcalEventTypesResponse, { enabled: true }> }
  >();

  constructor(
    @Inject(ENV) private readonly env: ServerEnv,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * Whether this deployment can talk to a dCal at all.
   *
   * BOTH hosts or neither: with only the API host, every `schedulingUrl` this
   * service builds is relative, the picker still reports itself enabled, and
   * the author's save then 400s on `formSchedulerSchema.url`, which requires an
   * absolute http(s) address. Half-configured must read as not configured.
   */
  configured(): boolean {
    return !!this.env.DCAL_API_BASE_URL?.trim() && !!this.env.DCAL_APP_URL?.trim();
  }

  /**
   * Drop one member's cached lists, in every workspace.
   *
   * What this exists for is the refresh button: an author with no event type
   * opens dCal, creates one, comes back and asks again. Without dropping the
   * entry they would keep seeing the empty list they left, for up to five
   * minutes, and conclude the integration is broken.
   */
  invalidate(accountId: string, memberId: string): void {
    const prefix = `${accountId}:${memberId}:`;
    for (const key of [...this.cache.keys()]) if (key.startsWith(prefix)) this.cache.delete(key);
  }

  private async call<T>(bearer: string, path: string, workspaceId?: string): Promise<T | null> {
    const base = this.env.DCAL_API_BASE_URL?.trim().replace(/\/+$/, '');
    if (!base) return null;
    try {
      const res = await this.fetchImpl(`${base}${path}`, {
        headers: {
          authorization: `Bearer ${bearer}`,
          'content-type': 'application/json',
          // dCal re-derives the membership from its own database on every
          // request, so naming a workspace here is a REQUEST, never a grant: a
          // workspace the author is not a member of is a 403 there, not a
          // quiet fall back to their home account.
          ...(workspaceId ? { 'x-dcal-workspace': workspaceId } : {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        // The status, never the body: dCal's own error text is not this app's
        // copy and must not reach the builder verbatim.
        this.logger.warn(`dcal ${path} answered HTTP ${res.status}`);
        return null;
      }
      return (await res.json()) as T;
    } catch (err) {
      this.logger.warn(`dcal ${path} did not answer: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * The event types the author can embed, in one workspace.
   *
   * dCal lists personal and team events separately (`/v1/event-types` returns
   * the caller's own; a team's need its id), so this fans out over the
   * author's teams and merges. A team whose booking page has no slug is left
   * out: there is no public URL to embed, and an option that cannot be
   * embedded is worse than one that is missing.
   */
  async listEventTypes(
    accountId: string,
    memberId: string,
    bearer: string | null,
    options: { workspaceId?: string; refresh?: boolean; now?: number } = {},
  ): Promise<DcalEventTypesResponse> {
    const now = options.now ?? Date.now();
    if (!this.configured()) {
      return {
        enabled: false,
        reason: 'This deployment has no dCal configured (DCAL_API_BASE_URL and DCAL_APP_URL).',
      };
    }
    if (!bearer) {
      // The `local` auth provider of a bare fork mints no bearer, so there is
      // no session to forward and nothing to ask dCal with.
      return { enabled: false, reason: 'dCal needs a signed-in Dapta session; this deployment has none.' };
    }

    const key = `${accountId}:${memberId}:${options.workspaceId ?? 'home'}`;
    if (options.refresh) this.invalidate(accountId, memberId);
    const hit = this.cache.get(key);
    if (hit && hit.expires > now) return { ...hit.body, cached: true };

    const me = await this.call<DcalMe>(bearer, '/v1/me', options.workspaceId);
    if (!me) {
      return { enabled: false, reason: 'dCal did not accept this session. Check that both apps share an identity service.' };
    }
    const code = me.vanitySlug?.trim() || me.accountShortCode?.trim() || '';
    const handle = me.handle?.trim() ?? '';
    if (!code || !handle) {
      return { enabled: false, reason: 'dCal has no booking page for this user yet.' };
    }

    const [mine, teams, workspaces] = await Promise.all([
      this.call<DcalEventType[]>(bearer, '/v1/event-types', options.workspaceId),
      this.call<DcalTeam[]>(bearer, '/v1/teams', options.workspaceId),
      this.call<DcalWorkspace[]>(bearer, '/v1/me/workspaces', options.workspaceId),
    ]);

    const appUrl = this.env.DCAL_APP_URL?.trim().replace(/\/+$/, '') ?? '';
    const enc = encodeURIComponent;
    const personalUrl = (slug: string) => `${appUrl}/${enc(code)}/${enc(handle)}/${enc(slug)}`;
    const out: DcalEventTypeDto[] = [];
    for (const e of mine ?? []) {
      // Only the author's OWN events here; a team's come from the loop below,
      // under the team's URL, and this endpoint returns both on some versions.
      if (!e.slug || !e.id || e.teamId) continue;
      // Hidden in dCal means hidden here: the Calendly picker asks its provider
      // for active event types only, and an author should not be able to embed
      // an event they have taken off their own booking page.
      if (e.hidden === true) continue;
      out.push(this.toDto(e, personalUrl(e.slug), null));
    }
    // Bounded AND concurrent. Bounded alone was not enough: one call per team
    // in sequence, each with its own timeout, made the worst case twenty
    // timeouts end to end, far past the browser's 15s abort. In parallel the
    // worst case is one timeout, whatever the number of teams.
    const listed = (teams ?? []).slice(0, MAX_TEAMS).filter((team) => team.id && team.slug);
    const perTeam = await Promise.all(
      listed.map((team) =>
        this.call<DcalEventType[]>(
          bearer,
          `/v1/teams/${encodeURIComponent(team.id!)}/event-types`,
          options.workspaceId,
        ),
      ),
    );
    for (const [i, team] of listed.entries()) {
      const events = perTeam[i];
      for (const e of events ?? []) {
        if (!e.slug || !e.id || e.hidden === true) continue;
        out.push(
          this.toDto(e, `${appUrl}/${enc(code)}/team/${enc(team.slug!)}/${enc(e.slug)}`, team.name?.trim() || null),
        );
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));

    const body: Extract<DcalEventTypesResponse, { enabled: true }> = {
      enabled: true,
      cached: false,
      connectedAs: me.email?.trim() || me.displayName?.trim() || null,
      workspaces: (workspaces ?? [])
        .filter((w) => w.status !== 'invited')
        .map((w) => ({
          id: String(w.accountId ?? w.id ?? ''),
          name: w.name?.trim() || 'Workspace',
          current: w.current === true || String(w.accountId ?? w.id ?? '') === (options.workspaceId ?? ''),
        }))
        .filter((w) => w.id),
      eventTypes: out,
      createEventUrl: appUrl ? `${appUrl}/admin/event-types` : null,
    };
    // Only a usable answer is cached. Caching an empty list behind a failed
    // fan-out would make the refresh button useless for five minutes, which is
    // the one case the author is most likely to press it in.
    if (appUrl) {
      // The third segment of the key is caller-supplied (`workspaceId`), so
      // this map needs a ceiling: without one, a member can mint an entry per
      // distinct value they send. Oldest out first; a dropped entry only costs
      // a re-read.
      if (this.cache.size >= MAX_CACHE_ENTRIES) {
        const oldest = this.cache.keys().next();
        if (!oldest.done) this.cache.delete(oldest.value);
      }
      this.cache.set(key, { expires: now + CACHE_TTL_MS, body });
    }
    return body;
  }

  private toDto(e: DcalEventType, schedulingUrl: string, teamName: string | null): DcalEventTypeDto {
    return {
      id: String(e.id),
      name: e.title?.trim() || 'Untitled event',
      schedulingUrl,
      active: e.hidden !== true,
      durationMinutes: typeof e.lengthMinutes === 'number' ? e.lengthMinutes : 0,
      teamName,
      bookingFields: (e.bookingFields ?? [])
        .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
        .map((f) => ({
          name: String(f.name ?? ''),
          label: String(f.label ?? f.name ?? ''),
          type: String(f.type ?? 'text'),
          required: f.required === true,
        }))
        // `name`, `email` and `notes` are the fields dCal's form asks by
        // itself, so a legacy question reusing one is not a question to map.
        .filter((f) => f.name && !['name', 'email', 'notes'].includes(f.name.toLowerCase())),
    };
  }
}
