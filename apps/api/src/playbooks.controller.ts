import {
  BadRequestException,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  PLAYBOOK_GALLERY_SLUG,
  announcementUserKey,
  listPlaybookStates,
  recordPlaybookSeen,
  type Db,
  type PlaybookStateRow,
} from '@quill/db';
import {
  PLAYBOOKS,
  PLAYBOOK_CATEGORIES,
  findPlaybook,
  isPlaybookCategory,
  isPlaybookNew,
  isPlaybookPromised,
  isPlaybookPublished,
  playbookBody,
  playbookOutline,
  playbookPublishedDate,
  playbookReadingMinutes,
  publishedPlaybooks,
  type Playbook,
  type PlaybookCategory,
} from '@quill/shared/playbooks';
import { AnalyticsEffects } from './analytics-effects';
import { keyNotAllowed } from './api-key-routes';
import { AuthService, type ReqLike } from './auth.service';
import { isAgentPrincipal, type HostPrincipal } from './auth.provider';
import { RateLimitGuard } from './rate-limit';
import { DB } from './tokens';

/** DI token for `PlaybooksOptions`. */
export const PLAYBOOKS_OPTIONS = Symbol('PLAYBOOKS_OPTIONS');

export interface PlaybooksOptions {
  /** The clock. Injectable so the publication dates are testable. */
  now?: () => number;
  /** The playbooks to serve. Defaults to `PLAYBOOKS`. */
  list?: readonly Playbook[];
}

/** What a gallery card shows: the catalog fields, never the body, and the person's state. */
export interface PlaybookCardView {
  slug: string;
  category: PlaybookCategory;
  title: string;
  summary: string;
  /** Epoch ms. */
  publishedAt: number;
  promisedBy: readonly string[];
  template: string;
  thumbnailVideo: string | null;
  thumbnailPoster: string | null;
  /** The person has opened it at least once. */
  seen: boolean;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
  /** Published after the person's last gallery visit, and never opened. */
  isNew: boolean;
}

export interface PlaybookListView {
  playbooks: PlaybookCardView[];
  /** The tabs that have at least one published playbook, in tab order. Never filtered by `?category=`. */
  categories: PlaybookCategory[];
  /** The person's last visit to the gallery, or null before the first. */
  galleryLastSeenAt: number | null;
  /** How many published playbooks are new to the person, across every category: the rail's "New". */
  newCount: number;
}

/**
 * What the landing's build gets for one playbook. The shape is the landing's
 * catalog fixture (`deploy/recursos/fixture.py` in dapta-forms-landing): an
 * optional field is left out rather than sent as null.
 */
export interface PublicPlaybookView {
  slug: string;
  category: PlaybookCategory;
  title: string;
  summary: string;
  /** The publication day in Bogota, `YYYY-MM-DD`. */
  publishedAt: string;
  promisedBy: readonly string[];
  /** Minutes to read the whole body, preview and rest, even when the rest is not sent. */
  readingMinutes: number;
  /** Markdown: the intro and the first section. */
  teaser: string;
  /** The `## ` headings of the rest, in order, so a locked page can list what is left. */
  outline: string[];
  /** Markdown below the teaser, only for a playbook a guide promises; absent for the rest. */
  rest?: string;
  thumbnailVideo?: string;
  thumbnailPoster?: string;
}

function notFound(): never {
  throw new NotFoundException({ error: 'NOT_FOUND', message: 'No such playbook.' });
}

function clockOf(options: PlaybooksOptions): number {
  return options.now?.() ?? Date.now();
}

function listOf(options: PlaybooksOptions): readonly Playbook[] {
  return options.list ?? PLAYBOOKS;
}

/**
 * The playbooks gallery for the signed-in PERSON (`/v1/me/playbooks`).
 *
 * Session only: an API key or an MCP connection is an agent, and the full
 * playbooks stay behind a dForms sign-in, so every route refuses it (and the
 * API key route allowlist leaves them out). Not admin-gated: owners, admins and
 * members all read the same gallery.
 *
 * State is per person, across workspaces, with the announcements' key
 * (`announcementUserKey`; ADR 0006): opening a playbook in one workspace marks
 * it opened in all of them. A playbook before its `publishedAt` does not exist
 * here: it is left out of the list and answers 404.
 */
@Controller('v1/me/playbooks')
export class PlaybooksController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AnalyticsEffects) private readonly analytics: AnalyticsEffects,
    @Inject(PLAYBOOKS_OPTIONS) private readonly options: PlaybooksOptions,
  ) {}

  private async person(req: ReqLike): Promise<{ p: HostPrincipal; userId: string }> {
    const p = await this.auth.resolveHost(req);
    if (isAgentPrincipal(p)) keyNotAllowed();
    return { p, userId: await announcementUserKey(this.db, p.accountId, p.memberId) };
  }

  private published(slug: string, now: number): Playbook {
    const playbook = findPlaybook(slug, listOf(this.options));
    if (!playbook || !isPlaybookPublished(playbook, now)) notFound();
    return playbook;
  }

  private async states(userId: string): Promise<{ bySlug: Map<string, PlaybookStateRow>; gallery: number | null }> {
    const rows = await listPlaybookStates(this.db, userId);
    const bySlug = new Map(rows.map((r) => [r.playbookSlug, r]));
    return { bySlug, gallery: bySlug.get(PLAYBOOK_GALLERY_SLUG)?.lastSeenAt ?? null };
  }

  private card(p: Playbook, state: PlaybookStateRow | undefined, gallery: number | null): PlaybookCardView {
    const lastSeenAt = state?.lastSeenAt ?? null;
    return {
      slug: p.slug,
      category: p.category,
      title: p.title,
      summary: p.summary,
      publishedAt: p.publishedAt,
      promisedBy: p.promisedBy,
      template: p.template,
      thumbnailVideo: p.thumbnailVideo,
      thumbnailPoster: p.thumbnailPoster,
      seen: lastSeenAt !== null,
      firstSeenAt: state?.firstSeenAt ?? null,
      lastSeenAt,
      isNew: isPlaybookNew(p, { lastSeenAt, galleryLastSeenAt: gallery }),
    };
  }

  /**
   * Every published playbook with the person's state, newest first.
   * `?category=` narrows the cards to one tab; `categories` and `newCount`
   * always describe the whole gallery. Reading it records nothing: the rail
   * can ask for `newCount` on every page without clearing it.
   */
  @Get()
  async list(@Req() req: ReqLike, @Query('category') category?: string): Promise<PlaybookListView> {
    const { userId } = await this.person(req);
    if (category !== undefined && category !== '' && !isPlaybookCategory(category)) {
      throw new BadRequestException({
        error: 'BAD_REQUEST',
        message: `category must be one of ${PLAYBOOK_CATEGORIES.join(', ')}.`,
      });
    }
    const all = publishedPlaybooks(clockOf(this.options), listOf(this.options));
    const { bySlug, gallery } = await this.states(userId);
    const cards = all.map((p) => this.card(p, bySlug.get(p.slug), gallery));
    const present = new Set(all.map((p) => p.category));
    return {
      playbooks: category ? cards.filter((c) => c.category === category) : cards,
      categories: PLAYBOOK_CATEGORIES.filter((c) => present.has(c)),
      galleryLastSeenAt: gallery,
      newCount: cards.filter((c) => c.isNew).length,
    };
  }

  /**
   * Record a visit to the gallery: from now on, only playbooks published
   * after it are "New". The gallery calls it when it opens, after reading the
   * list, so the visit that clears the marks still shows them once.
   */
  @Post('seen')
  @HttpCode(200)
  async galleryVisit(@Req() req: ReqLike): Promise<{ ok: true; galleryLastSeenAt: number }> {
    const { userId } = await this.person(req);
    const row = await recordPlaybookSeen(this.db, userId, PLAYBOOK_GALLERY_SLUG, clockOf(this.options));
    return { ok: true, galleryLastSeenAt: row.lastSeenAt };
  }

  /** One published playbook, whole: the card and the full markdown body. Records nothing. */
  @Get(':slug')
  async detail(
    @Req() req: ReqLike,
    @Param('slug') slug: string,
  ): Promise<{ playbook: PlaybookCardView & { body: string } }> {
    const { userId } = await this.person(req);
    const playbook = this.published(slug, clockOf(this.options));
    const { bySlug, gallery } = await this.states(userId);
    return { playbook: { ...this.card(playbook, bySlug.get(playbook.slug), gallery), body: playbookBody(playbook) } };
  }

  /**
   * Record that the person opened this playbook: `firstSeenAt` the first
   * time, `lastSeenAt` every time. Idempotent. Each call is one
   * `forms_playbook_viewed` product event (slug, category, and whether it was
   * the first open).
   */
  @Post(':slug/seen')
  @HttpCode(200)
  async seen(
    @Req() req: ReqLike,
    @Param('slug') slug: string,
  ): Promise<{ ok: true; firstSeenAt: number; lastSeenAt: number }> {
    const { p, userId } = await this.person(req);
    const now = clockOf(this.options);
    const playbook = this.published(slug, now);
    const row = await recordPlaybookSeen(this.db, userId, playbook.slug, now);
    await this.analytics.captureForMember(
      'playbook_viewed',
      p,
      { slug: playbook.slug, category: playbook.category, first: row.first },
      now,
    );
    return { ok: true, firstSeenAt: row.firstSeenAt, lastSeenAt: row.lastSeenAt };
  }
}

/**
 * The landing's view of one playbook: the teaser, the outline and the reading
 * time always, the rest only when a guide promises it.
 */
export function publicPlaybookView(p: Playbook): PublicPlaybookView {
  const view: PublicPlaybookView = {
    slug: p.slug,
    category: p.category,
    title: p.title,
    summary: p.summary,
    publishedAt: playbookPublishedDate(p),
    promisedBy: p.promisedBy,
    readingMinutes: playbookReadingMinutes(p),
    teaser: p.preview,
    outline: playbookOutline(p),
  };
  if (isPlaybookPromised(p)) view.rest = p.rest;
  if (p.thumbnailVideo) view.thumbnailVideo = p.thumbnailVideo;
  if (p.thumbnailPoster) view.thumbnailPoster = p.thumbnailPoster;
  return view;
}

/**
 * The playbooks for the landing's resource hub (`GET /v1/public/playbooks`),
 * which its build downloads to generate `/recursos`. No auth, rate limited
 * like the rest of the public surface.
 *
 * Only what the hub may show to anyone: the teaser of every published
 * playbook with its outline and reading time, and the rest of the body only
 * for the ones a guide promises (`promisedBy`), which open in full on the
 * landing for whoever comes from that guide. Never the rest of any other
 * playbook, and never the template step or the thumbnail brief.
 */
@UseGuards(RateLimitGuard)
@Controller('v1/public/playbooks')
export class PublicPlaybooksController {
  constructor(@Inject(PLAYBOOKS_OPTIONS) private readonly options: PlaybooksOptions) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=300')
  list(): { playbooks: PublicPlaybookView[] } {
    return { playbooks: publishedPlaybooks(clockOf(this.options), listOf(this.options)).map(publicPlaybookView) };
  }
}
