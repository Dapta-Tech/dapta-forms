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
  getAccountBranding,
  mergeKitIntoBranding,
  defaultNotificationSetting,
  deleteForm,
  deleteNotificationSetting,
  duplicateForm,
  getAccountMember,
  getFormById,
  getNotificationSettings,
  inviteMember,
  listFailedDeliveries,
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
  getMemberProfileRaw,
  setMemberProfile,
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
  memberProfileSchema,
} from '@quill/types';
import { ZodError } from 'zod';
import { AdminService } from './admin.service';
import { SubmissionService } from './submission.service';
import { AnalyticsService } from './analytics.service';
import { AuthService, type ReqLike } from './auth.service';
import { EmailEffects } from './email-effects';
import { AnalyticsEffects } from './analytics-effects';
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
    // Optional so existing direct constructions (tests) keep working; the module
    // always provides it in the running app.
    @Optional() @Inject(EmailEffects) private readonly emails?: EmailEffects,
    // `productAnalytics`, not `analytics` — `analytics` above is the FORM funnel
    // service (per-question drop-off shown to a form owner). This one is our own
    // telemetry about the people using the builder. Different audience entirely.
    @Optional() @Inject(AnalyticsEffects) private readonly productAnalytics?: AnalyticsEffects,
  ) {}

  // --- Identity ----------------------------------------------------------
  @Get('me')
  async me(@Req() req: ReqLike) {
    const p = await this.auth.resolveHost(req);
    return this.admin.me(p);
  }

  /**
   * Every workspace this person can enter, for the switcher.
   *
   * Answered from the caller's HOME identity rather than the workspace they are
   * currently in — otherwise switching into a workspace would replace the list
   * with that workspace's own view and there would be no way back out.
   */
  @Get('workspaces')
  async workspaces(@Req() req: ReqLike) {
    return this.auth.listWorkspaces(req);
  }

  /** This member's public page config (the raw blob, or null). */
  @Get('me/profile')
  async myProfile(@Req() req: ReqLike) {
    const p = await this.auth.resolveHost(req);
    const member = await getAccountMember(this.db, p.accountId, p.memberId);
    if (!member) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    const raw = await getMemberProfileRaw(this.db, p.accountId, p.memberId);
    return { handle: member.handle, profile: raw };
  }

  /**
   * Replace this member's public page. A null body removes it entirely, which is
   * the same thing as never having had one — the page goes back to 404-ing.
   *
   * Scoped to the CALLER's own member row, never an id from the request: your
   * public page is yours, and an admin editing a teammate's bio is a different
   * feature with different consent.
   */
  @Put('me/profile')
  async saveMyProfile(@Req() req: ReqLike, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    const raw = (body as { profile?: unknown } | null)?.profile ?? null;
    const profile = raw == null ? null : parse(memberProfileSchema, raw);
    await setMemberProfile(this.db, p.accountId, p.memberId, profile);
    return { ok: true, profile };
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
    // New forms are born on-brand: snapshot the workspace brand kit into the
    // initial config's `branding`. Server-side so API-created forms inherit the
    // kit exactly like dashboard-created ones. Caller-supplied branding wins
    // over the kit (explicit input beats a default).
    const kit = await getAccountBranding(this.db, p.accountId);
    let config: unknown = input.config;
    if (kit) {
      const base =
        config && typeof config === 'object' && !Array.isArray(config)
          ? (config as Record<string, unknown>)
          : { version: 1, steps: [] };
      const own =
        base.branding && typeof base.branding === 'object' && !Array.isArray(base.branding)
          ? (base.branding as Record<string, unknown>)
          : {};
      config = { ...base, branding: { ...mergeKitIntoBranding(null, kit.config), ...own } };
    }
    // `p.memberId` — from the resolved principal, never the body.
    const created = unwrapCrud(await createForm(this.db, p.accountId, { ...input, config }, p.memberId));
    await this.productAnalytics?.captureForMember('form_created', p, { form_id: created.id });
    return maskForm(created);
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
    // Duplicating is the OTHER way a form is born in the builder. Without this
    // it would be the one creation path with no author and no funnel event.
    const copy = unwrapCrud(await duplicateForm(this.db, p.accountId, id, p.memberId));
    await this.productAnalytics?.captureForMember('form_created', p, {
      form_id: copy.id,
      from_duplicate: true,
    });
    return maskForm(copy);
  }

  /**
   * Publish a form's pending draft (draft_config → config, stamp published_at,
   * clear the draft; a no-op when no draft is pending). Same role gate as
   * PUT /v1/forms/:id — any resolved host member, scoped to their account.
   */
  @Post('forms/:id/publish')
  async publishForm(@Req() req: ReqLike, @Param('id') id: string) {
    const p = await this.auth.resolveHost(req);
    // Read the PRIOR state before publishing: `published_at` is about to be
    // stamped, so after the call every publish looks like the first one.
    // Republishing an existing form is not a new conversion, and counting it as
    // one would make the funnel improve the more a happy customer edits.
    // Gated: a deployment without analytics must not pay for this read.
    const before = this.productAnalytics?.enabled
      ? await getFormById(this.db, p.accountId, id)
      : null;
    const published = unwrapCrud(await publishForm(this.db, p.accountId, id));
    // Only when the publish ACTUALLY happened. `publishForm` is a no-op when no
    // draft is pending (it returns the row untouched, never stamping
    // `published_at`), so capturing unconditionally would emit a first-publish
    // conversion on every repeat call for a form that was never published.
    //
    // The test is "was a draft pending", NOT "did published_at change":
    // `published_at` is `Date.now()`, so two publishes inside the same
    // millisecond are indistinguishable and the second would be swallowed. A
    // pending draft is the exact precondition `publishForm` itself branches on.
    if (before?.draftConfig != null) {
      await this.productAnalytics?.captureForMember('form_published', p, {
        form_id: id,
        is_first_publish: before?.publishedAt == null,
      });
    }
    return maskForm(published);
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

  /**
   * Deliveries for this form that ended without landing.
   *
   * A side-effect that died — an expired CRM token, a disconnected scheduling
   * provider, a form with no resolvable respondent email — used to exist only in
   * server logs, so a form could stop syncing leads while every visible signal
   * said it was working.
   */
  @Get('forms/:id/deliveries')
  async formDeliveries(@Req() req: ReqLike, @Param('id') id: string, @Query('limit') limit?: string) {
    const p = await this.auth.resolveHost(req);
    // Account scoping twice on purpose: the form lookup proves this caller owns
    // the form, and the query itself is filtered by account_id in SQL.
    const f = await getFormById(this.db, p.accountId, id);
    if (!f) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    const items = await listFailedDeliveries(this.db, p.accountId, id, parseIntParam(limit) ?? 50);
    return { items };
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
    const member = unwrapCrud(await inviteMember(this.db, p.accountId, input));
    // Tell them. Until now the row was created and nobody was ever notified.
    // Enqueued (never sent inline) and fire-and-forget: a mail provider being
    // down must not fail an invite that already succeeded.
    const inviter = await getAccountMember(this.db, p.accountId, p.memberId);
    void this.emails?.enqueueMemberInvited({
      accountId: p.accountId,
      memberId: member.id,
      to: member.email ?? input.email,
      invitedBy: inviter?.displayName ?? inviter?.email ?? null,
      locale: null,
    });
    return member;
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

  // --- Per-form notification overrides (editor → Connect → Emails) --------
  //
  // A form may pin its own copy of either submission email, overriding the
  // account-level template (Typeform's per-form Follow-ups model). Send-time
  // precedence is form → account → stock, per field; a form row's `enabled`
  // wins outright when the row exists. Same admin/owner gate as the account
  // routes, PLUS the form must belong to the principal's account (the standard
  // forms-route scoping: getFormById(accountId, id) or 404).

  /** Both emails: the account-level baseline + this form's override (if any). */
  @Get('forms/:id/notifications')
  async formNotifications(@Req() req: ReqLike, @Param('id') id: string) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    await this.assertOwnForm(p.accountId, id);
    return { settings: await this.formNotificationViews(p.accountId, id) };
  }

  /** Create/update this form's override for one email (subject/body/enabled). */
  @Put('forms/:id/notifications/:emailKey')
  async updateFormNotification(
    @Req() req: ReqLike,
    @Param('id') id: string,
    @Param('emailKey') emailKey: string,
    @Body() body: unknown,
  ) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    await this.assertOwnForm(p.accountId, id);
    const key = this.parseEmailKey(emailKey);
    const patch = parse(notificationSettingPatchSchema, body);
    await upsertNotificationSetting(this.db, p.accountId, key, patch, Date.now(), id);
    return (await this.formNotificationViews(p.accountId, id)).find((v) => v.emailKey === key)!;
  }

  /** Remove this form's override — the form fully inherits the account setting. */
  @Post('forms/:id/notifications/:emailKey/reset')
  async resetFormNotification(
    @Req() req: ReqLike,
    @Param('id') id: string,
    @Param('emailKey') emailKey: string,
  ) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    await this.assertOwnForm(p.accountId, id);
    const key = this.parseEmailKey(emailKey);
    await deleteNotificationSetting(this.db, p.accountId, key, id);
    return (await this.formNotificationViews(p.accountId, id)).find((v) => v.emailKey === key)!;
  }

  /** 404 unless the form exists in the principal's account (standard scoping). */
  private async assertOwnForm(accountId: string, formId: string): Promise<void> {
    const f = await getFormById(this.db, accountId, formId);
    if (!f) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
  }

  /**
   * The per-form view for both emails: the effective ACCOUNT-level template
   * (stored override or nulls = stock), whether a form override exists, and the
   * override values — plus the same defaults + token catalog the account view
   * carries, so the Connect-tab editor renders with one payload.
   */
  private async formNotificationViews(accountId: string, formId: string) {
    const account = await getNotificationSettings(this.db, accountId);
    const overrides = await getNotificationSettings(this.db, accountId, formId);
    return SUBMISSION_EMAIL_KEYS.map((emailKey) => {
      const a = account.get(emailKey) ?? defaultNotificationSetting(emailKey);
      const o = overrides.get(emailKey);
      return {
        emailKey,
        /** The account layer this form inherits when it has no override. */
        account: { enabled: a.enabled, subject: a.subject, body: a.body },
        /** The form's pinned copy; null = using the account template. */
        override: o
          ? { enabled: o.enabled, subject: o.subject, body: o.body, updatedAt: o.updatedAt }
          : null,
        tokens: [...NOTIFICATION_TOKENS],
        defaults: {
          en: defaultSubmissionTemplate(emailKey, 'en'),
          es: defaultSubmissionTemplate(emailKey, 'es'),
        },
      };
    });
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
