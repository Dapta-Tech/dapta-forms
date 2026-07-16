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
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Db, NotificationSetting } from '@quill/db';
import {
  changeMemberRole,
  createForm,
  defaultNotificationSetting,
  deleteForm,
  duplicateForm,
  getAccountMember,
  getFormById,
  getNotificationSettings,
  inviteMember,
  listForms,
  listMembers,
  publishForm,
  removeMember,
  resetNotificationTemplate,
  saveDraftConfig,
  setMemberStatus,
  updateForm,
  upsertNotificationSetting,
  type CrudResult,
} from '@quill/db';
import {
  defaultSubmissionTemplate,
  isSubmissionEmailKey,
  NOTIFICATION_TOKENS,
  SUBMISSION_EMAIL_KEYS,
  type SubmissionEmailKey,
} from '@quill/notifications';
import {
  formInputSchema,
  maskConfigSecrets,
  memberInviteSchema,
  memberPatchSchema,
  notificationSettingPatchSchema,
} from '@quill/types';
import { ZodError } from 'zod';
import { AdminService } from './admin.service';
import { SubmissionService } from './submission.service';
import { AnalyticsService } from './analytics.service';
import { AuthService, type ReqLike } from './auth.service';
import { assertAdmin, assertCanManageTarget, assertNotSelf } from './permissions';
import { parseBound, parseIntParam, parseStatus } from './query-params';
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

function unwrapCrud<T>(r: CrudResult<T>): T {
  if (r.ok) return r.value;
  if (r.reason === 'NOT_FOUND') throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
  throw new ConflictException({ error: r.reason, message: r.message ?? 'Conflict.' });
}

/**
 * Mask webhook signing secrets in a form's config before it leaves the server to
 * the admin client. Every form-returning endpoint runs this so the plaintext
 * secret is never exposed in a READ; the integrations UI round-trips the sentinel
 * and the write layer restores the stored secret (see mergeWebhookSecrets). The
 * unpublished draft config gets the same treatment — a draft can carry webhook
 * destinations too.
 */
function maskForm<T extends { config: unknown; draftConfig?: unknown }>(form: T): T {
  return {
    ...form,
    config: maskConfigSecrets(form.config),
    ...(form.draftConfig != null ? { draftConfig: maskConfigSecrets(form.draftConfig) } : {}),
  };
}

/** Host-authed CRUD for forms + submissions + members, and identity/vanity. */
@Controller('v1')
export class AdminCrudController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(SubmissionService) private readonly submissions: SubmissionService,
    @Inject(AnalyticsService) private readonly analytics: AnalyticsService,
  ) {}

  // --- Identity ----------------------------------------------------------
  @Get('me')
  async me(@Req() req: ReqLike) {
    const p = await this.auth.resolveHost(req);
    return this.admin.me(p);
  }

  @Get('vanity')
  async vanity(@Req() req: ReqLike) {
    const p = await this.auth.resolveHost(req);
    return this.admin.vanityStatus(p);
  }

  @Put('vanity')
  async setVanity(@Req() req: ReqLike, @Body() body: { slug?: string | null }) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const out = await this.admin.setVanity(p, body?.slug ?? null);
    if (!out.ok) throw new ConflictException({ error: out.reason, message: 'Cannot set vanity slug.' });
    return out;
  }

  // --- Forms -------------------------------------------------------------
  @Get('forms')
  async listForms(@Req() req: ReqLike) {
    const p = await this.auth.resolveHost(req);
    return listForms(this.db, p.accountId);
  }

  @Get('forms/:id')
  async getForm(@Req() req: ReqLike, @Param('id') id: string) {
    const p = await this.auth.resolveHost(req);
    const f = await getFormById(this.db, p.accountId, id);
    if (!f) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    return maskForm(f);
  }

  @Post('forms')
  @HttpCode(201)
  async createForm(@Req() req: ReqLike, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    const input = parse(formInputSchema, body);
    return maskForm(unwrapCrud(await createForm(this.db, p.accountId, input)));
  }

  /**
   * Update a form. Draft→publish split: `name`/`slug` are METADATA and apply to
   * the live row immediately (they never lived in the config, so there is
   * nothing to stage); `config` is stored as an UNPUBLISHED draft via
   * `saveDraftConfig` — the live config the public renderer serves is untouched
   * until POST /v1/forms/:id/publish copies the draft over it.
   */
  @Put('forms/:id')
  async updateForm(@Req() req: ReqLike, @Param('id') id: string, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    const { config, ...meta } = parse(formInputSchema.partial(), body);
    let updated = unwrapCrud(await updateForm(this.db, p.accountId, id, meta));
    if (config !== undefined) {
      updated = unwrapCrud(await saveDraftConfig(this.db, p.accountId, id, config));
    }
    return maskForm(updated);
  }

  @Post('forms/:id/duplicate')
  @HttpCode(201)
  async duplicateForm(@Req() req: ReqLike, @Param('id') id: string) {
    const p = await this.auth.resolveHost(req);
    return maskForm(unwrapCrud(await duplicateForm(this.db, p.accountId, id)));
  }

  /**
   * Publish a form's pending draft (draft_config → config, stamp published_at,
   * clear the draft; a no-op when no draft is pending). Same role gate as
   * PUT /v1/forms/:id — any resolved host member, scoped to their account.
   */
  @Post('forms/:id/publish')
  async publishForm(@Req() req: ReqLike, @Param('id') id: string) {
    const p = await this.auth.resolveHost(req);
    return maskForm(unwrapCrud(await publishForm(this.db, p.accountId, id)));
  }

  @Delete('forms/:id')
  @HttpCode(204)
  async deleteForm(@Req() req: ReqLike, @Param('id') id: string) {
    const p = await this.auth.resolveHost(req);
    const existing = await getFormById(this.db, p.accountId, id);
    if (!existing) return; // idempotent — already gone (204)
    await deleteForm(this.db, p.accountId, id);
  }

  /**
   * A page of a form's submissions. Optional query: `status`
   * (all|completed|partial), `from`/`to` (epoch ms or YYYY-MM-DD, bound by
   * startedAt), `limit`/`offset`. Returns a paginated envelope `{ items, total,
   * limit, offset }` so the admin table can render page counts.
   */
  @Get('forms/:id/submissions')
  async formSubmissions(
    @Req() req: ReqLike,
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const p = await this.auth.resolveHost(req);
    const f = await getFormById(this.db, p.accountId, id);
    if (!f) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    return this.analytics.submissionsPage(id, {
      status: parseStatus(status),
      from: parseBound(from, false),
      to: parseBound(to, true),
      limit: parseIntParam(limit),
      offset: parseIntParam(offset),
    });
  }

  // --- Members (workspace roster; admin/owner-only) ----------------------
  @Get('members')
  async members(@Req() req: ReqLike) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    return listMembers(this.db, p.accountId);
  }

  @Post('members')
  @HttpCode(201)
  async inviteMember(@Req() req: ReqLike, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const input = parse(memberInviteSchema, body);
    return unwrapCrud(await inviteMember(this.db, p.accountId, input));
  }

  @Patch('members/:id')
  async updateMember(@Req() req: ReqLike, @Param('id') id: string, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    assertNotSelf(p, id);
    const input = parse(memberPatchSchema, body);
    const target = await getAccountMember(this.db, p.accountId, id);
    if (!target) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    assertCanManageTarget(p, target, { toRole: input.role });
    let updated = target;
    if (input.role !== undefined) updated = unwrapCrud(await changeMemberRole(this.db, p.accountId, id, input.role));
    if (input.status !== undefined) updated = unwrapCrud(await setMemberStatus(this.db, p.accountId, id, input.status));
    return updated;
  }

  @Delete('members/:id')
  @HttpCode(200)
  async removeMember(@Req() req: ReqLike, @Param('id') id: string) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    assertNotSelf(p, id);
    const target = await getAccountMember(this.db, p.accountId, id);
    if (!target) return { ok: true }; // idempotent — already gone
    assertCanManageTarget(p, target);
    unwrapCrud(await removeMember(this.db, p.accountId, id));
    return { ok: true };
  }

  // --- Notification emails (Settings → Notifications; admin/owner-only) ---
  //
  // The two submission emails the platform sends, each with a per-account toggle
  // plus an optional custom subject/body (plain text with {{token}} markers). A
  // stored subject/body of null means "shipped default" — the send path falls
  // back to the code template. Every route resolves the principal and scopes to
  // its account (never cross-account), and is admin/owner-gated like /v1/members.

  /** The two settings (stored overrides + the shipped default copy the UI shows). */
  @Get('notifications')
  async notifications(@Req() req: ReqLike) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const stored = await getNotificationSettings(this.db, p.accountId);
    return {
      settings: SUBMISSION_EMAIL_KEYS.map((key) =>
        this.notificationView(key, stored.get(key) ?? defaultNotificationSetting(key)),
      ),
    };
  }

  /** Toggle / override one email's copy. `null` subject|body resets that field. */
  @Put('notifications/:emailKey')
  async updateNotification(
    @Req() req: ReqLike,
    @Param('emailKey') emailKey: string,
    @Body() body: unknown,
  ) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const key = this.parseEmailKey(emailKey);
    const patch = parse(notificationSettingPatchSchema, body);
    const updated = await upsertNotificationSetting(this.db, p.accountId, key, patch);
    return this.notificationView(key, updated);
  }

  /** Reset one email's subject+body to the shipped default (keeps the toggle). */
  @Post('notifications/:emailKey/reset')
  async resetNotification(@Req() req: ReqLike, @Param('emailKey') emailKey: string) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const key = this.parseEmailKey(emailKey);
    const updated = await resetNotificationTemplate(this.db, p.accountId, key);
    return this.notificationView(key, updated);
  }

  /** 400 unless the path key is one of the two customizable emails. */
  private parseEmailKey(value: string): SubmissionEmailKey {
    if (isSubmissionEmailKey(value)) return value;
    throw new BadRequestException({ error: 'BAD_REQUEST', message: 'Unknown notification email key.' });
  }

  /**
   * Merge a stored setting with the shipped defaults + token catalog into the
   * shape the Settings UI renders. Both EN/ES defaults are returned (the API is
   * locale-agnostic; the web app picks the one matching its locale).
   */
  private notificationView(emailKey: SubmissionEmailKey, s: NotificationSetting) {
    return {
      emailKey,
      enabled: s.enabled,
      subject: s.subject,
      body: s.body,
      updatedAt: s.updatedAt,
      tokens: [...NOTIFICATION_TOKENS],
      defaults: {
        en: defaultSubmissionTemplate(emailKey, 'en'),
        es: defaultSubmissionTemplate(emailKey, 'es'),
      },
    };
  }
}
