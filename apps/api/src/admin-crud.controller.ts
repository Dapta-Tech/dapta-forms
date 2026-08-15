import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  GoneException,
  HttpCode,
  Inject,
  Logger,
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
  claimAccountAttribution,
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
  listFormDeliveries,
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
  getMemberProfileState,
  overwriteMemberProfileLegacy,
} from '@quill/db';
import {
  defaultSubmissionTemplate,
  isSubmissionEmailKey,
  NOTIFICATION_TOKENS,
  SUBMISSION_EMAIL_KEYS,
  type SubmissionEmailKey,
} from '@quill/notifications';
import {
  attributionEventProps,
  attributionSchema,
  formInputSchema,
  hasExtraHubspotDestination,
  maskConfigSecrets,
  ONE_HUBSPOT_DESTINATION_MESSAGE,
  memberInviteSchema,
  memberPatchSchema,
  notificationSettingPatchSchema,
  memberProfileSchema,
  onboardingCompleteSchema,
  onboardingProgressSchema,
} from '@quill/types';
import { ZodError } from 'zod';
import { AdminService } from './admin.service';
import { SubmissionService } from './submission.service';
import { AnalyticsService } from './analytics.service';
import { AuthService, type ReqLike } from './auth.service';
import { EmailEffects } from './email-effects';
import { AnalyticsEffects } from './analytics-effects';
import { assertAdmin, assertCanManageTarget, assertNotSelf } from './permissions';
import { parseBound, parseIntParam, parseKinds, parseOutboxStatuses, parseStatus } from './query-params';
import { DB, ENV } from './tokens';
import type { ServerEnv } from '@quill/config/env';

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
  private readonly log = new Logger('AdminCrudController');

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
    /**
     * Optional like the effects above so direct constructions in tests keep
     * working; absent means the `/v1` profile write shim is CLOSED, which is the
     * safe default for anything that did not deliberately turn it on.
     */
    @Optional()
    @Inject(ENV)
    private readonly env?: Pick<ServerEnv, 'PROFILE_V1_WRITE_SHIM' | 'PROFILE_V2_WRITES_ENABLED'>,
  ) {}

  // --- Identity ----------------------------------------------------------
  @Get('me')
  async me(@Req() req: ReqLike) {
    const p = await this.auth.resolveHost(req);
    return this.admin.me(p);
  }

  /**
   * Record where this workspace came from. First touch, once, ever.
   *
   * POSTed by the web the moment a login completes, carrying the acquisition
   * tags it stashed BEFORE bouncing to the identity provider. That bounce leaves
   * our origin, so the query string never comes back — this request is the only
   * point at which those values exist server-side. Miss it and the campaign that
   * paid for the signup is unrecoverable.
   *
   * `accountId` comes from the resolved principal, NEVER the body. The body is
   * attacker-supplied by definition (anyone can craft a link), so letting it name
   * an account would let a stranger overwrite someone else's attribution.
   *
   * Admin-gated like every other workspace-level write in this controller: a
   * plain `member` must not be able to rewrite the workspace's acquisition
   * record. The intended caller is a brand-new account whose first member IS the
   * owner, so the happy path is unaffected — and a 403 here cannot break the
   * login, because the web discards this response entirely.
   *
   * Past the principal checks it never throws on a bad payload and never blocks:
   * attribution is an observer of the product, not a participant. A login must
   * not fail because a UTM could not be stored, which is why a junk body gets
   * `{ recorded: false }` rather than a 400.
   */
  @Post('account/attribution')
  async recordAttribution(@Req() req: ReqLike, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const parsed = attributionSchema.safeParse(body ?? {});
    if (!parsed.success) return { recorded: false };

    // Every field of the schema is nullable, so drop the empties BEFORE deciding
    // there is something to store. `{}` — and `{ utmSource: null }`, which a
    // hand-written body can produce — would otherwise SPEND the write-once claim
    // and the real campaign could never be recorded afterwards. The `typeof`
    // check is not decoration: `firstSeenAt` is a NUMBER, so a crafted
    // `{"firstSeenAt":0}` would survive a mere null-check and spend the claim
    // carrying nothing.
    const tags: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (typeof value === 'string' && value !== '') tags[key] = value;
    }
    if (Object.keys(tags).length === 0) return { recorded: false };

    const first = await claimAccountAttribution(this.db, p.accountId, tags).catch((err) => {
      // Same shape as the activation claim: a lock or a dead connection must not
      // turn a completed login into a 500 on the way to the dashboard.
      // Deliberately opaque: this line is about a claim that did not stick, not
      // about who tried it or what the driver said. The account id identifies a
      // customer and the raw error can carry a connection string, a row, or a
      // vendor message, and none of that belongs in an operational log.
      this.log.warn(
        `attribution_claim_failed (error_class=${err instanceof Error ? err.constructor.name : 'unknown'})`,
      );
      return false;
    });
    if (first && this.productAnalytics?.enabled) {
      await this.productAnalytics.captureForMember(
        'attribution_captured',
        p,
        attributionEventProps(tags),
      );
    }
    return { recorded: first };
  }

  // --- Onboarding (first-run wizard) ---------------------------------------

  /**
   * Record one screen's worth of onboarding progress.
   *
   * Called on EVERY advance, not just at the end, because a person who quits
   * halfway is the one the funnel is actually about — and they never reach the
   * end to be recorded. `accountId` comes from the principal, never the body.
   *
   * Admin-gated like every workspace-level write here: onboarding describes the
   * WORKSPACE, so an invited member must not be able to rewrite the owner's
   * answers. The intended caller is a brand-new account whose only member IS the
   * owner, so the happy path is untouched.
   *
   * Never throws on a bad payload. This runs behind a wizard the person cannot
   * skip; a 400 there is a dead end with no recovery, and losing one screen's
   * telemetry is strictly better than that. An unparseable body is reported as
   * `{ saved: false }` and the wizard carries on.
   */
  @Patch('account/onboarding')
  async saveOnboarding(@Req() req: ReqLike, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const parsed = onboardingProgressSchema.safeParse(body ?? {});
    if (!parsed.success) return { saved: false, onboarding: null };
    const onboarding = await this.admin.saveOnboarding(p, parsed.data);
    return { saved: onboarding != null, onboarding };
  }

  /**
   * Finish the wizard: claim completion and create the first form from the
   * chosen template.
   *
   * `completed` is true ONLY for the caller whose claim won. A double-click or a
   * retried request gets `completed: false` with the winner's `formId`, so both
   * land on the same form and the account never ends up with two "first" ones.
   * Anything counting onboarding conversions must read this flag, not infer it
   * from a 200.
   *
   * A bad template id is a 400 here rather than a silent fallback: the person
   * PICKED something, and quietly building them a different form than the one
   * they chose is worse than telling them to pick again.
   */
  @Post('account/onboarding/complete')
  async completeOnboarding(@Req() req: ReqLike, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const parsed = onboardingCompleteSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({ error: 'INVALID_TEMPLATE', message: 'Unknown template.' });
    }

    const result = await this.admin.completeOnboarding(p, parsed.data);
    if (result.completed && this.productAnalytics?.enabled) {
      // Emitted server-side, from the CLAIM's winner, so the completion count is
      // the count of accounts that finished — not of browsers that reached the
      // last screen, which double-counts a retry and misses a closed tab.
      await this.productAnalytics.captureForMember('onboarding_completed', p, {
        template: parsed.data.template,
        form_id: result.formId,
      });
      // The wizard is the THIRD way a form is born, alongside `createForm` and
      // `duplicateForm`, and it has to announce itself the same way they do.
      //
      // Without this the activation funnel breaks for every account the wizard
      // creates: `form_created` is its second stage, the funnel is `ordered`,
      // and a stage that never fires makes every LATER stage unreachable. The
      // account would read as "signed up, never made a form" forever — while
      // holding a form the wizard built for it — and publishing or receiving a
      // response would not move it. Suppressing the demo seed made the wizard
      // the ONLY source of a first form, so this is the whole cohort, not an
      // edge case.
      //
      // Guarded on `formId` because a failed create still leaves the completion
      // claimed (see `completeOnboarding`), and announcing a form that does not
      // exist would put a phantom into the funnel.
      if (result.formId) {
        await this.productAnalytics.captureForMember('form_created', p, {
          form_id: result.formId,
          from_onboarding: true,
          template: parsed.data.template,
        });
      }
    }
    return result;
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

  /** This member's public page config (the raw blob, or null) + its revision. */
  @Get('me/profile')
  async myProfile(@Req() req: ReqLike) {
    const p = await this.auth.resolveHost(req);
    const member = await getAccountMember(this.db, p.accountId, p.memberId);
    if (!member) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    const state = await getMemberProfileState(this.db, p.accountId, p.memberId);
    if (!state) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    // `revision` is ADDITIVE and is half of the capability signal: a web build
    // that does not get a number here knows it is talking to a pre-CAS API.
    // `writesEnabled` is the other half — an API that CAN guard writes but has
    // not been switched on yet must not be written to either.
    return {
      handle: member.handle,
      profile: state.profile,
      revision: state.revision,
      writesEnabled: this.env?.PROFILE_V2_WRITES_ENABLED === true,
    };
  }

  /**
   * DEPRECATED — the last-write-wins public page write, kept ONLY so a web build
   * from before the v2 contract keeps working during a rolling deploy. Remove
   * this route, `overwriteMemberProfileLegacy` and `PROFILE_V1_WRITE_SHIM`
   * together once no old web pod can reach this API.
   *
   * Gated by configuration and off by 410 when the gate is closed, so a
   * deployment that has finished rolling cannot keep an unguarded writer alive
   * by accident. It cannot compare-and-set (its callers know nothing about
   * revisions) but it DOES increment the revision in the same statement as the
   * write, which is what keeps the fence monotonic while an old tab saves.
   *
   * Scoped to the CALLER's own member row, never an id from the request.
   */
  @Put('me/profile')
  async saveMyProfile(@Req() req: ReqLike, @Body() body: unknown) {
    if (!this.env?.PROFILE_V1_WRITE_SHIM) {
      throw new GoneException({
        error: 'V1_WRITE_RETIRED',
        message: 'This endpoint is retired. Use PUT /v2/me/profile with expectedRevision.',
      });
    }
    const p = await this.auth.resolveHost(req);
    const raw = (body as { profile?: unknown } | null)?.profile ?? null;
    const profile = raw == null ? null : parse(memberProfileSchema, raw);
    const result = await overwriteMemberProfileLegacy(this.db, p.accountId, p.memberId, profile);
    if (result.status === 'not_found') {
      throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    }
    return { ok: true, profile: result.profile, revision: result.revision };
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
    // The other path that AUTHORS a `destinations` array (PUT /forms/:id stages
    // a draft, and drafts strip the key; duplicate copies stored state and is
    // exempt — see `hasExtraHubspotDestination`). Same one-HubSpot rule as
    // PUT /forms/:id/destinations — enforced here rather than in the schema so
    // stored configs that already carry two keep parsing.
    if (hasExtraHubspotDestination((input.config as { destinations?: unknown } | undefined)?.destinations)) {
      throw new BadRequestException({
        error: 'BAD_REQUEST',
        message: ONE_HUBSPOT_DESTINATION_MESSAGE,
      });
    }
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
    const result = await publishForm(this.db, p.accountId, id);
    const published = unwrapCrud(result);
    // `result.published` comes from the UPDATE's own RETURNING, so it is true
    // exactly on the call that copied the draft over. Reading the row BEFORE and
    // deciding here would be a read-then-act: two concurrent publishes both saw
    // a pending draft and both counted a first-publish conversion — the same
    // class of bug the activation claim exists to kill, one function over.
    // `result.ok` is redundant at runtime — `unwrapCrud` already threw on
    // failure — but it is what narrows the union so `published` is readable.
    if (result.ok && result.published) {
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
   * This form's deliveries, newest first.
   *
   * A side-effect that died — an expired CRM token, a disconnected scheduling
   * provider, a form with no resolvable respondent email — used to exist only in
   * server logs, so a form could stop syncing leads while every visible signal
   * said it was working.
   *
   * `?kind=` and `?status=` narrow it (comma-separated). Both are optional and
   * the defaults are the ORIGINAL behaviour — every kind, failures only — so a
   * caller written before the per-integration history keeps getting exactly what
   * it got. `?status=done,failed,…` is what turns this from a failure list into
   * a history.
   */
  @Get('forms/:id/deliveries')
  async formDeliveries(
    @Req() req: ReqLike,
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('kind') kind?: string,
    @Query('status') status?: string,
  ) {
    const p = await this.auth.resolveHost(req);
    // Account scoping twice on purpose: the form lookup proves this caller owns
    // the form, and the query itself is filtered by account_id in SQL.
    const f = await getFormById(this.db, p.accountId, id);
    if (!f) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    const items = await listFormDeliveries(this.db, p.accountId, id, {
      kinds: parseKinds(kind),
      statuses: parseOutboxStatuses(status),
      limit: parseIntParam(limit) ?? 50,
    });
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
