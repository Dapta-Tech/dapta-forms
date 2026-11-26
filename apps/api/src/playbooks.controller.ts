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
  getMemberLocale,
  listPlaybookStates,
  recordPlaybookSeen,
  type Db,
  type PlaybookStateRow,
} from '@quill/db';
import {
  PLAYBOOK_BASE_LOCALE,
  PLAYBOOK_CATALOG,
  PLAYBOOK_CATEGORIES,
  PLAYBOOK_LOCALES,
  findPlaybook,
  isPlaybookCategory,
  isPlaybookLocale,
  isPlaybookNew,
  isPlaybookPromised,
  isPlaybookPublished,
  playbookBody,
  playbookOutline,
  playbookPublishedDate,
  playbookReadingMinutes,
  localizedPlaybook,
  publishedPlaybooks,
  type Playbook,
  type PlaybookCatalog,
  type PlaybookCategory,
  type PlaybookLocale,
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
  /** The playbooks to serve, by language. Defaults to `PLAYBOOK_CATALOG`. */
  catalog?: PlaybookCatalog;
}

/**
 * Which language a playbook was served in. `locale` is the language of the
 * text; `fallback` is true when the language asked for has no version of this
 * playbook yet, so the Spanish one came instead.
 */
export interface PlaybookLanguageView {
  locale: PlaybookLocale;
  fallback: boolean;
}

/** What a gallery card shows: the catalog fields, never the body, and the person's state. */
export interface PlaybookCardView extends PlaybookLanguageView {
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
  /** The language asked for (or the member's, or Spanish). Each card says what it was served in. */
  locale: PlaybookLocale;
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
export interface PublicPlaybookView extends PlaybookLanguageView {
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

function catalogOf(options: PlaybooksOptions): PlaybookCatalog {
  return options.catalog ?? PLAYBOOK_CATALOG;
}

/** The base list: every playbook there is, whatever the language asked for. */
function listOf(options: PlaybooksOptions): readonly Playbook[] {
  return catalogOf(options)[PLAYBOOK_BASE_LOCALE];
}

/**
 * `?locale=`: a playbook language, or undefined when absent or empty (the
 * caller's default). Anything else is a 400, so a typo never reads as Spanish.
 */
export function readPlaybookLocale(value: unknown): PlaybookLocale | undefined {
  if (value === undefined || value === '') return undefined;
  if (isPlaybookLocale(value)) return value;
  throw new BadRequestException({
    error: 'BAD_REQUEST',
    message: `locale must be one of ${PLAYBOOK_LOCALES.join(', ')}.`,
  });
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

  /**
   * The language to serve: `?locale=` when given, else the language the
   * member chose for the platform, else Spanish (the one every playbook has).
   */
  private async locale(p: HostPrincipal, query: unknown): Promise<PlaybookLocale> {
    const asked = readPlaybookLocale(query);
    if (asked) return asked;
    const own = await getMemberLocale(this.db, p.accountId, p.memberId);
    return isPlaybookLocale(own) ? own : PLAYBOOK_BASE_LOCALE;
  }

  private async states(userId: string): Promise<{ bySlug: Map<string, PlaybookStateRow>; gallery: number | null }> {
    const rows = await listPlaybookStates(this.db, userId);
    const bySlug = new Map(rows.map((r) => [r.playbookSlug, r]));
    return { bySlug, gallery: bySlug.get(PLAYBOOK_GALLERY_SLUG)?.lastSeenAt ?? null };
  }

  /**
   * One card in `locale`. The state comes from the base playbook's slug, which
   * every language shares: what a person read is read in every language.
   */
  private card(
    base: Playbook,
    locale: PlaybookLocale,
    state: PlaybookStateRow | undefined,
    gallery: number | null,
  ): PlaybookCardView {
    const { playbook: p, fallback } = localizedPlaybook(base, locale, catalogOf(this.options));
    const lastSeenAt = state?.lastSeenAt ?? null;
    return {
      slug: p.slug,
      locale: p.locale,
      fallback,
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
      isNew: isPlaybookNew(base, { lastSeenAt, galleryLastSeenAt: gallery }),
    };
  }

  /**
   * Every published playbook with the person's state, newest first.
   * `?category=` narrows the cards to one tab; `categories` and `newCount`
   * always describe the whole gallery. `?locale=es|en` picks the language
   * (default: the member's platform language, else Spanish); a playbook not
   * translated yet comes in Spanish with `fallback: true`, and its state and
   * "New" are the same in every language. Reading it records nothing: the
   * rail can ask for `newCount` on every page without clearing it.
   */
  @Get()
  async list(
    @Req() req: ReqLike,
    @Query('category') category?: string,
    @Query('locale') localeParam?: string,
  ): Promise<PlaybookListView> {
    const { p, userId } = await this.person(req);
    if (category !== undefined && category !== '' && !isPlaybookCategory(category)) {
      throw new BadRequestException({
        error: 'BAD_REQUEST',
        message: `category must be one of ${PLAYBOOK_CATEGORIES.join(', ')}.`,
      });
    }
    const locale = await this.locale(p, localeParam);
    const all = publishedPlaybooks(clockOf(this.options), listOf(this.options));
    const { bySlug, gallery } = await this.states(userId);
    const cards = all.map((b) => this.card(b, locale, bySlug.get(b.slug), gallery));
    const present = new Set(all.map((b) => b.category));
    return {
      locale,
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

  /**
   * One published playbook, whole: the card and the full markdown body, in
   * `?locale=` (as the list picks it), or in Spanish with `fallback: true`
   * while it has no version in that language. Records nothing.
   */
  @Get(':slug')
  async detail(
    @Req() req: ReqLike,
    @Param('slug') slug: string,
    @Query('locale') localeParam?: string,
  ): Promise<{ playbook: PlaybookCardView & { body: string } }> {
    const { p, userId } = await this.person(req);
    const locale = await this.locale(p, localeParam);
    const base = this.published(slug, clockOf(this.options));
    const { bySlug, gallery } = await this.states(userId);
    const { playbook } = localizedPlaybook(base, locale, catalogOf(this.options));
    return { playbook: { ...this.card(base, locale, bySlug.get(base.slug), gallery), body: playbookBody(playbook) } };
  }

  /**
   * Record that the person opened this playbook: `firstSeenAt` the first
   * time, `lastSeenAt` every time. Idempotent. The state is the slug's, in
   * every language: `?locale=` (the language the reader showed, defaulted as
   * the list does) only goes into the event. Each call is one
   * `forms_playbook_viewed` product event (slug, category, whether it was the
   * first open, the language shown and whether it was the Spanish fallback).
   */
  @Post(':slug/seen')
  @HttpCode(200)
  async seen(
    @Req() req: ReqLike,
    @Param('slug') slug: string,
    @Query('locale') localeParam?: string,
  ): Promise<{ ok: true; firstSeenAt: number; lastSeenAt: number }> {
    const { p, userId } = await this.person(req);
    const locale = await this.locale(p, localeParam);
    const now = clockOf(this.options);
    const playbook = this.published(slug, now);
    const shown = localizedPlaybook(playbook, locale, catalogOf(this.options));
    const row = await recordPlaybookSeen(this.db, userId, playbook.slug, now);
    await this.analytics.captureForMember(
      'playbook_viewed',
      p,
      {
        slug: playbook.slug,
        category: playbook.category,
        first: row.first,
        locale: shown.playbook.locale,
        requested_locale: locale,
        fallback: shown.fallback,
      },
      now,
    );
    return { ok: true, firstSeenAt: row.firstSeenAt, lastSeenAt: row.lastSeenAt };
  }
}

/**
 * The landing's view of one playbook: the teaser, the outline and the reading
 * time always, the rest only when a guide promises it. `fallback` says the
 * language asked for had no version, so this is the Spanish one.
 */
export function publicPlaybookView(p: Playbook, fallback = false): PublicPlaybookView {
  const view: PublicPlaybookView = {
    slug: p.slug,
    locale: p.locale,
    fallback,
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
 *
 * `?locale=es|en` picks the language, Spanish by default (there is no member
 * here); a playbook not translated yet comes in Spanish with `fallback: true`.
 * Publication and `promisedBy` are the same in every language.
 */
@UseGuards(RateLimitGuard)
@Controller('v1/public/playbooks')
export class PublicPlaybooksController {
  constructor(@Inject(PLAYBOOKS_OPTIONS) private readonly options: PlaybooksOptions) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=300')
  list(@Query('locale') localeParam?: string): { locale: PlaybookLocale; playbooks: PublicPlaybookView[] } {
    const locale = readPlaybookLocale(localeParam) ?? PLAYBOOK_BASE_LOCALE;
    const catalog = catalogOf(this.options);
    return {
      locale,
      playbooks: publishedPlaybooks(clockOf(this.options), listOf(this.options)).map((base) => {
        const { playbook, fallback } = localizedPlaybook(base, locale, catalog);
        return publicPlaybookView(playbook, fallback);
      }),
    };
  }
}
