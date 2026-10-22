import { Body, Controller, Get, Inject, NotFoundException, Optional, Put, Req } from '@nestjs/common';
import type { ServerEnv } from '@quill/config/env';
import { linkPageUrl } from '@quill/shared';
import { linkPageSchema } from '@quill/types';
import { AuthService, type ReqLike } from './auth.service';
import { LinkPageService } from './link-page.service';
import { ENV } from './tokens';
import { parse } from './validation';

/**
 * The workspace link page editor (`/v1/link-page`).
 *
 * Any member of the workspace may read and write it: the page belongs to the
 * workspace, not to one person, and the team decided not to gate it on a role.
 * Both routes still resolve the principal and act only on ITS workspace; the
 * workspace is never taken from the request body.
 *
 * Open to API keys (see `api-key-routes.ts`), documented in the API reference
 * and served to agents by the MCP's `get_link_page` and `update_link_page`,
 * which run these same handlers in process.
 */
@Controller('v1/link-page')
export class LinkPageController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(LinkPageService) private readonly pages: LinkPageService,
    // Only for `publicUrl`; absent (a spec) reads as no public address.
    @Optional() @Inject(ENV) private readonly env?: ServerEnv,
  ) {}

  /**
   * The stored page (or null), the workspace's forms and its brand kit, for
   * the editor and its preview, plus the page's public address (`publicUrl`,
   * null without `PUBLIC_APP_URL`) and whether it is live there (`live`).
   */
  @Get()
  async get(@Req() req: ReqLike) {
    const p = await this.auth.resolveHost(req);
    const view = await this.pages.editorView(p.accountId, p.memberId);
    if (!view) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    return {
      ...view,
      publicUrl: linkPageUrl(this.env?.PUBLIC_APP_URL, view.accountCode),
      live: view.page?.enabled === true,
    };
  }

  /**
   * Replace the workspace's page. `{ page: null }` removes it, which is the
   * same as never having had one: the public URL goes back to 404.
   */
  @Put()
  async put(@Req() req: ReqLike, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    const raw = (body as { page?: unknown } | null)?.page ?? null;
    const page = raw == null ? null : parse(linkPageSchema, raw);
    const saved = await this.pages.save(p.accountId, page);
    return { ok: true, page: saved };
  }
}
