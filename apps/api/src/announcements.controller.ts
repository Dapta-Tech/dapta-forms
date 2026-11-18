import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Req } from '@nestjs/common';
import type { ServerEnv } from '@quill/config/env';
import { announcementUserKey, listAnnouncementStates, recordAnnouncementEvent, type Db } from '@quill/db';
import {
  ANNOUNCEMENTS,
  ANNOUNCEMENT_EVENTS,
  findAnnouncement,
  isAnnouncementLive,
  isDaptaProductName,
  pickAnnouncement,
  type Announcement,
} from '@quill/shared';
import { z } from 'zod';
import { keyNotAllowed } from './api-key-routes';
import { AuthService, type ReqLike } from './auth.service';
import { isAgentPrincipal, type HostPrincipal } from './auth.provider';
import { parse } from './validation';
import { DB } from './tokens';

/** DI token for `AnnouncementsOptions`. */
export const ANNOUNCEMENTS_OPTIONS = Symbol('ANNOUNCEMENTS_OPTIONS');

export interface AnnouncementsOptions {
  /** Whether this deployment is Dapta's own: `daptaOnly` announcements show only then. */
  dapta: boolean;
  /** The clock. Injectable so the dates are testable. */
  now?: () => number;
  /** The announcements to choose from. Defaults to `ANNOUNCEMENTS`. */
  list?: readonly Announcement[];
}

/**
 * Whether this API serves Dapta's own deployment. `AUTH_PROVIDER=workos` is
 * true for every Dapta deployment and never for a bare fork (the same rule the
 * web app's platform GTM falls back on). The product name is the build's own
 * claim, read the way the web app reads it, so a local stack named dForms
 * behaves like Dapta's.
 */
export function isDaptaDeployment(
  env: Pick<ServerEnv, 'AUTH_PROVIDER'>,
  productName: string | undefined = process.env.NEXT_PUBLIC_PRODUCT_NAME,
): boolean {
  return env.AUTH_PROVIDER === 'workos' || isDaptaProductName(productName);
}

const eventSchema = z.object({ event: z.enum(ANNOUNCEMENT_EVENTS) });

/** What the dashboard renders for an announcement. Copy is a catalog key: the web app owns the language. */
export interface AnnouncementView {
  id: string;
  copy: string;
  cta: string;
  visual: Announcement['visual'];
  railBadge: Announcement['railBadge'];
  /** The Home banner's marks, or null when the announcement has no banner. */
  banner: Announcement['banner'];
  /** Open the pop-up. */
  modal: boolean;
  /** Show the rail badge. */
  badge: boolean;
  /** Show the Home banner. */
  showBanner: boolean;
  /** The person already reached the route: the browser has no visit left to report. */
  followed: boolean;
}

/**
 * In-app announcements for the signed-in PERSON (`/v1/me/announcement`).
 *
 * Session only: an API key or an MCP connection is an agent, and an agent has
 * no dashboard to show news in, so both routes refuse it (and the API key
 * route allowlist leaves them out). Not admin-gated: owners, admins and
 * members all get announcements.
 *
 * State is per person, across workspaces (`announcementUserKey`): someone who
 * closes the pop-up in one workspace does not get it again in the next.
 */
@Controller('v1/me')
export class AnnouncementsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ANNOUNCEMENTS_OPTIONS) private readonly options: AnnouncementsOptions,
  ) {}

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private list(): readonly Announcement[] {
    return this.options.list ?? ANNOUNCEMENTS;
  }

  private async person(req: ReqLike): Promise<{ p: HostPrincipal; userId: string }> {
    const p = await this.auth.resolveHost(req);
    if (isAgentPrincipal(p)) keyNotAllowed();
    return { p, userId: await announcementUserKey(this.db, p.accountId, p.memberId) };
  }

  /** The one announcement this person gets now, or `{ announcement: null }`. */
  @Get('announcement')
  async current(@Req() req: ReqLike): Promise<{ announcement: AnnouncementView | null }> {
    const { userId } = await this.person(req);
    const states = await listAnnouncementStates(this.db, userId);
    const pick = pickAnnouncement(this.list(), states, this.now(), { dapta: this.options.dapta });
    if (!pick) return { announcement: null };
    const a = pick.announcement;
    return {
      announcement: {
        id: a.id,
        copy: a.copy,
        cta: a.cta,
        visual: a.visual,
        railBadge: a.railBadge,
        banner: a.banner,
        modal: pick.modal,
        badge: pick.badge,
        showBanner: pick.banner,
        followed: pick.followed,
      },
    };
  }

  /**
   * Record that the pop-up was on screen (`seen`), was closed (`dismissed`),
   * or the person reached the announcement's route (`clicked`). An unknown id
   * is a 404; a known one outside its dates, or not allowed on this
   * deployment, is accepted and stores nothing, so a tab left open past the end
   * date gets no error for a click nobody needs anymore.
   */
  @Post('announcements/:id')
  @HttpCode(200)
  async record(@Req() req: ReqLike, @Param('id') id: string, @Body() body: unknown): Promise<{ ok: true }> {
    const { userId } = await this.person(req);
    const { event } = parse(eventSchema, body);
    const a = findAnnouncement(id, this.list());
    if (!a) throw new NotFoundException({ error: 'NOT_FOUND', message: 'No such announcement.' });
    const now = this.now();
    if (!isAnnouncementLive(a, now, { dapta: this.options.dapta })) return { ok: true };
    await recordAnnouncementEvent(this.db, userId, a.id, event, now);
    return { ok: true };
  }
}
