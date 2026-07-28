import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Db } from '@quill/db';
import {
  applyBrandKit,
  getAccountBranding,
  revertBrandKit,
  upsertAccountBranding,
} from '@quill/db';
import { brandKitSchema } from '@quill/types';
import { z, ZodError } from 'zod';
import { AuthService, type ReqLike } from './auth.service';
import { assertAdmin } from './permissions';
import { DB } from './tokens';

function parse<T>(schema: { parse: (v: unknown) => T }, body: unknown): T {
  try {
    return schema.parse(body);
  } catch (err) {
    if (err instanceof ZodError)
      throw new BadRequestException({ error: 'BAD_REQUEST', message: err.issues[0]?.message });
    throw err;
  }
}

const formIdsSchema = z.object({ formIds: z.array(z.string().min(1)).min(1).max(500) });

/**
 * The workspace brand kit (`/v1/branding`). Reads are open to every member so
 * the page can render; writes and the apply/revert bulk actions are admin/owner
 * only — the kit is workspace-wide state, and an apply rewrites live published
 * forms. Apply/revert operate ONLY on forms owned by the caller's account (the
 * repository re-scopes every UPDATE by accountId).
 */
@Controller('v1/branding')
export class BrandingController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Get()
  async get(@Req() req: ReqLike) {
    const p = await this.auth.resolveHost(req);
    const row = await getAccountBranding(this.db, p.accountId);
    return { config: row?.config ?? null, updatedAt: row?.updatedAt ?? null };
  }

  @Put()
  async put(@Req() req: ReqLike, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const config = parse(brandKitSchema, body);
    const row = await upsertAccountBranding(this.db, p.accountId, config);
    return { config: row.config, updatedAt: row.updatedAt };
  }

  @Post('apply')
  async apply(@Req() req: ReqLike, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const { formIds } = parse(formIdsSchema, body);
    return applyBrandKit(this.db, p.accountId, formIds);
  }

  @Post('revert')
  async revert(@Req() req: ReqLike, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const { formIds } = parse(formIdsSchema, body);
    return revertBrandKit(this.db, p.accountId, formIds);
  }
}
