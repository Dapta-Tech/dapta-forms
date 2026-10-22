/**
 * `/v1/api-keys`: the Developers page's list, create and revoke. Session only:
 * a key can never mint, list or revoke keys (403 `KEY_NOT_ALLOWED`, from the
 * route guard and again here).
 *
 *   GET    /v1/api-keys      { keys: [{ id, name, last4, createdAt, lastUsedAt,
 *                             createdBy: { memberId, name, email, staff } }] }
 *                            A member sees their own keys; owner and admin,
 *                            every active key of the workspace, including the
 *                            ones the deployment's staff created through a
 *                            staff access grant (`createdBy.staff`).
 *   POST   /v1/api-keys      { name } (1 to 60 characters) -> 201
 *                            { id, name, last4, createdAt, key }. The only
 *                            response that ever carries the key in clear. The
 *                            eleventh active key of one person in one
 *                            workspace is a 409 `KEY_LIMIT`.
 *   DELETE /v1/api-keys/:id  204. Someone else's key without being owner or
 *                            admin: 403. Unknown, already revoked or another
 *                            workspace's: 404.
 *
 * Staff in a workspace through a staff access grant (only while they are
 * staff, judged on each request) act as that grant's `admin` row: they list,
 * create and revoke keys there like any admin. A key they create keeps
 * working until someone revokes it, whatever their staff status later.
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  API_KEY_LIMIT_PER_MEMBER,
  getApiKeyById,
  insertApiKey,
  listApiKeys,
  revokeApiKey,
  type Db,
  type InsertApiKeyResult,
} from '@quill/db';
import { z } from 'zod';
import { AnalyticsEffects } from './analytics-effects';
import { generateApiKey, type MintedApiKey } from './api-keys';
import { keyNotAllowed } from './api-key-routes';
import { AuthService, isAgentPrincipal, type HostPrincipal, type ReqLike } from './auth.service';
import { assertOwnsOrAdmin, isAdmin } from './permissions';
import { DB } from './tokens';

/** Same bound the Developers page enforces before it calls. */
export const API_KEY_NAME_MAX = 60;

const createApiKeySchema = z.object({
  name: z
    .string({ required_error: 'name is required.', invalid_type_error: 'name must be a string.' })
    .trim()
    .min(1, 'name is required.')
    .max(API_KEY_NAME_MAX, `name must be at most ${API_KEY_NAME_MAX} characters.`),
});

/** The odds of two keys sharing a 12-character prefix are tiny; one retry each is plenty. */
const MINT_ATTEMPTS = 3;

function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let e: unknown = error;
  while (e && typeof e === 'object' && !seen.has(e)) {
    seen.add(e);
    const code = (e as { code?: unknown }).code;
    if (code === '23505' || code === 'SQLITE_CONSTRAINT_UNIQUE') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

@Controller('v1/api-keys')
export class ApiKeysController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuthService) private readonly auth: AuthService,
    @Optional() @Inject(AnalyticsEffects) private readonly productAnalytics?: AnalyticsEffects,
  ) {}

  /** The session principal; an agent (a key or an MCP connection) is refused even if the guard was bypassed. */
  private async session(req: ReqLike): Promise<HostPrincipal> {
    const p = await this.auth.resolveHost(req);
    if (isAgentPrincipal(p)) keyNotAllowed();
    return p;
  }

  @Get()
  async list(@Req() req: ReqLike) {
    const p = await this.session(req);
    const keys = await listApiKeys(this.db, p.accountId, isAdmin(p.role) ? undefined : p.memberId);
    return { keys };
  }

  @Post()
  @HttpCode(201)
  async create(@Req() req: ReqLike, @Body() body: unknown) {
    // Staff acting through a staff access grant may create keys here: the
    // session only resolves to a grant while the person is staff on this
    // request (`AuthService.resolveHost`). The key is the workspace's, held
    // by the grant row, and the workspace's owners and admins see it marked
    // as created by staff and can revoke it.
    const p = await this.session(req);
    const parsed = createApiKeySchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        error: 'BAD_REQUEST',
        message: parsed.error.issues[0]?.message ?? 'Invalid body.',
      });
    }
    const { name } = parsed.data;

    const { minted, result } = await this.mint(p, name);
    if (!result.ok) {
      throw new ConflictException({
        error: 'KEY_LIMIT',
        message: `You already have ${API_KEY_LIMIT_PER_MEMBER} active API keys in this workspace. Revoke one to create another.`,
      });
    }

    const created = result.value;
    // A key staff create through a grant is marked, so adoption metrics can
    // leave the deployment's own staff out of the customer's numbers.
    await this.productAnalytics?.captureForMember('api_key_created', p, {
      api_key_id: created.id,
      role: p.role,
      ...(p.accessGrant === 'staff' ? { staff_access: true } : {}),
    });
    return {
      id: created.id,
      name: created.name,
      last4: created.last4,
      createdAt: created.createdAt,
      key: minted.key,
    };
  }

  /** Mint and store a key, minting again on the rare prefix or hash collision. */
  private async mint(
    p: HostPrincipal,
    name: string,
  ): Promise<{ minted: MintedApiKey; result: InsertApiKeyResult }> {
    for (let attempt = 1; ; attempt++) {
      const minted = generateApiKey();
      try {
        const result = await insertApiKey(this.db, {
          accountId: p.accountId,
          memberId: p.memberId,
          name,
          keyHash: minted.keyHash,
          prefix: minted.prefix,
          last4: minted.last4,
        });
        return { minted, result };
      } catch (err) {
        if (attempt >= MINT_ATTEMPTS || !isUniqueViolation(err)) throw err;
      }
    }
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@Req() req: ReqLike, @Param('id') id: string): Promise<void> {
    const p = await this.session(req);
    const key = await getApiKeyById(this.db, p.accountId, id);
    if (!key) throw new NotFoundException({ error: 'NOT_FOUND', message: 'No such API key.' });
    assertOwnsOrAdmin(p, key.memberId);
    if (!(await revokeApiKey(this.db, p.accountId, id))) {
      throw new NotFoundException({ error: 'NOT_FOUND', message: 'No such API key.' });
    }
  }
}
