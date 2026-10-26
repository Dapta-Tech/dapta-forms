import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { ServerEnv } from '@quill/config/env';
import { linkPageUrl } from '@quill/shared';
import {
  linkPageCreateSchema,
  linkPageDuplicateSchema,
  linkPageSchema,
  linkPageUpdateSchema,
} from '@quill/types';
import { AuthService, type ReqLike } from './auth.service';
import { unwrap } from './http';
import { LinkPageService, type LinkPageDetailView } from './link-page.service';
import { ENV } from './tokens';
import { parse } from './validation';

const notFound = () => new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });

/**
 * The workspace link pages: `/v1/link-pages` (up to 20 per workspace) and
 * `/v1/link-page`, which reads and writes the DEFAULT page exactly as it did
 * when a workspace had one page, so keys and agents already using it keep
 * working.
 *
 * Any member of the workspace may read and write them: the pages belong to
 * the workspace, not to one person, and the team decided not to gate them on
 * a role. Every route still resolves the principal and acts only on ITS
 * workspace; the workspace is never taken from the request, and a page id
 * from another workspace answers 404.
 *
 * Open to API keys (see `api-key-routes.ts`), documented in the API reference
 * and served to agents by the MCP's link page tools, which run these same
 * handlers in process.
 */
@Controller('v1')
export class LinkPageController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(LinkPageService) private readonly pages: LinkPageService,
    // Only for `publicUrl`; absent (a spec) reads as no public address.
    @Optional() @Inject(ENV) private readonly env?: ServerEnv,
  ) {}

  /** A page view with its public address (`publicUrl`, null without `PUBLIC_APP_URL`) and whether it is live. */
  private withAddress(view: LinkPageDetailView) {
    const page = view.slug ? { slug: view.slug, isDefault: view.isDefault } : null;
    return {
      ...view,
      publicUrl: linkPageUrl(this.env?.PUBLIC_APP_URL, view.accountCode, page),
      live: view.page?.enabled === true,
    };
  }

  private async detail(accountId: string, memberId: string, id: string) {
    const view = await this.pages.pageView(accountId, memberId, id);
    if (!view) throw notFound();
    return this.withAddress(view);
  }

  // --- The default page, as one page (backward compatible) -------------------

  /**
   * The default page (or null), the workspace's forms and its brand kit, for
   * the editor and its preview, plus the page's public address and whether it
   * is live there. Also says which page it is (`id`, `slug`, `name`).
   */
  @Get('link-page')
  async get(@Req() req: ReqLike) {
    const p = await this.auth.resolveHost(req);
    const view = await this.pages.editorView(p.accountId, p.memberId);
    if (!view) throw notFound();
    return this.withAddress(view);
  }

  /**
   * Replace the default page's content (created as `main` when the workspace
   * has no page). `{ page: null }` removes it when it is the workspace's only
   * page, which is the same as never having had one; with other pages it is a
   * 409, since the default page cannot be deleted.
   */
  @Put('link-page')
  async put(@Req() req: ReqLike, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    const raw = (body as { page?: unknown } | null)?.page ?? null;
    const page = raw == null ? null : parse(linkPageSchema, raw);
    const saved = unwrap(await this.pages.save(p.accountId, page));
    return { ok: true, page: saved };
  }

  // --- Every page --------------------------------------------------------------

  /** Every page of the workspace, the default first, each with its public address. */
  @Get('link-pages')
  async list(@Req() req: ReqLike) {
    const p = await this.auth.resolveHost(req);
    const view = await this.pages.list(p.accountId, p.memberId);
    if (!view) throw notFound();
    return {
      ...view,
      pages: view.pages.map((page) => ({ ...page, publicUrl: linkPageUrl(this.env?.PUBLIC_APP_URL, view.accountCode, page) })),
    };
  }

  /** Add a page: `{ name?, slug?, page? }`. The workspace's first page becomes its default. */
  @Post('link-pages')
  async create(@Req() req: ReqLike, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    const input = parse(linkPageCreateSchema, body ?? {});
    const row = unwrap(await this.pages.create(p.accountId, input));
    return this.detail(p.accountId, p.memberId, row.id);
  }

  /** One page and everything its editor needs. */
  @Get('link-pages/:id')
  async one(@Req() req: ReqLike, @Param('id') id: string) {
    const p = await this.auth.resolveHost(req);
    return this.detail(p.accountId, p.memberId, id);
  }

  /**
   * Change a page: `{ name?, slug?, isDefault?: true, page? }`. An absent
   * field stays as it is; `page` replaces the whole content. A new slug keeps
   * the old one redirecting to it.
   */
  @Put('link-pages/:id')
  async update(@Req() req: ReqLike, @Param('id') id: string, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    const input = parse(linkPageUpdateSchema, body ?? {});
    unwrap(await this.pages.update(p.accountId, id, input));
    return this.detail(p.accountId, p.memberId, id);
  }

  /** Delete a page. The default page answers 409: make another page the default first. */
  @Delete('link-pages/:id')
  @HttpCode(200)
  async remove(@Req() req: ReqLike, @Param('id') id: string) {
    const p = await this.auth.resolveHost(req);
    const row = unwrap(await this.pages.remove(p.accountId, id));
    return { ok: true, id: row.id, slug: row.slug };
  }

  /** Copy a page under a new slug, switched off: `{ name?, slug? }`. */
  @Post('link-pages/:id/duplicate')
  async duplicate(@Req() req: ReqLike, @Param('id') id: string, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    const input = parse(linkPageDuplicateSchema, body ?? {});
    const row = unwrap(await this.pages.duplicate(p.accountId, id, input));
    return this.detail(p.accountId, p.memberId, row.id);
  }
}
