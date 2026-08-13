import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Db } from '@quill/db';
import {
  getMemberByHandle,
  listPublishedFormsForAccount,
  getPublishedForm,
  insertBookingEvent,
  upsertSubmission,
  recordFormEvent,
  listSubmissions,
  claimAccountActivation,
  claimAccountFirstView,
  getAccountOwner,
  type SubmissionRow,
} from '@quill/db';
import { computeScore, resolveOutcome, type FormConfig } from '@quill/engine';
import {
  memberProfileSchema,
  submissionSchema,
  formEventSchema,
  bookingCallbackSchema,
  type PublicForm,
  type PublicProfile,
} from '@quill/types';
import { EmailEffects } from './email-effects';
import { DestinationEffects } from './destination-effects';
import { BookingEffects } from './booking-effects';
import { AnalyticsEffects } from './analytics-effects';
import { DB } from './tokens';

export type ServiceError = { error: string; message: string; status: number };

/**
 * The public forms surface: fetch a published form, accept a submission (server-
 * recomputes the score from the config — never trust the client), and record a
 * funnel event. All account scoping is resolved from the public code + slug.
 */
@Injectable()
export class SubmissionService {
  private readonly log = new Logger('SubmissionService');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EmailEffects) private readonly email: EmailEffects,
    // Optional so existing direct constructions (tests) keep working; the module
    // always provides it in the running app.
    @Optional() @Inject(DestinationEffects) private readonly destinations?: DestinationEffects,
    // Optional for the same reason: enqueues the durable booking → CRM sync.
    @Optional() @Inject(BookingEffects) private readonly bookings?: BookingEffects,
    // Product analytics about the form OWNER (activation), not the respondent.
    @Optional() @Inject(AnalyticsEffects) private readonly productAnalytics?: AnalyticsEffects,
  ) {}

  /**
   * A member's PUBLIC PAGE, or null when there is none.
   *
   * Returns null — a 404 — for every case that is not an explicitly enabled
   * page: no such member, no profile blob, or `enabled: false`. The route
   * 404-ed before this feature existed and it must keep 404-ing until someone
   * deliberately turns their page on.
   *
   * Only PUBLISHED forms are listed, by name and slug only. Nothing else from a
   * form's config crosses this boundary: no steps, no destinations, no drafts.
   */
  async publicProfile(accountCode: string, handle: string): Promise<PublicProfile | null> {
    const member = await getMemberByHandle(this.db, accountCode, handle);
    if (!member) return null;
    const parsed = memberProfileSchema.safeParse(member.profile);
    if (!parsed.success || !parsed.data.enabled) return null;
    const profile = parsed.data;

    const published = await listPublishedFormsForAccount(this.db, accountCode);
    // Absent `formSlugs` = list them all; an EMPTY array = list none. The two
    // must stay distinct, or unlisting everything would silently restore
    // everything.
    const allowed = profile.formSlugs;
    const forms =
      allowed == null ? published : published.filter((f) => allowed.includes(f.slug));

    return {
      handle: member.handle ?? handle,
      displayName: member.displayName,
      avatarUrl: member.avatarUrl,
      headline: profile.headline ?? null,
      bio: profile.bio ?? null,
      links: profile.links ?? [],
      forms: forms.map((f) => ({ slug: f.slug, name: f.title ?? f.name })),
      branding: profile.branding ?? null,
    };
  }

  /** The published form for a public code + slug (the renderer's config). */
  async publicForm(accountCode: string, slug: string): Promise<PublicForm | null> {
    const f = await getPublishedForm(this.db, accountCode, slug);
    if (!f) return null;
    // NEVER leak destination config (webhook URLs/secrets, CRM mappings) to the
    // public renderer — it is server-only integration config.
    return { slug: f.slug, name: f.name, config: toPublicConfig(f.config) };
  }

  /**
   * Persist a submission for a form (one per session; partial→complete). The
   * score is recomputed server-side from the stored config. On a completed
   * submission the email effect is enqueued (durably, via the outbox).
   */
  async submit(
    accountCode: string,
    slug: string,
    raw: unknown,
  ): Promise<{ id: string; score: number; outcome: string | null } | ServiceError> {
    const input = submissionSchema.parse(raw);
    const form = await getPublishedForm(this.db, accountCode, slug);
    if (!form) return { error: 'NOT_FOUND', message: 'Form not found.', status: 404 };

    const config = form.config as FormConfig;
    const score = computeScore(config, input.data);
    // Pass the answers so answer-forced outcome overrides resolve identically
    // to the client renderer (a score-only resolution would disagree with the
    // redirect the visitor actually saw).
    const outcome = resolveOutcome(config, score, input.data);
    const row = await upsertSubmission(this.db, {
      formId: form.id,
      sessionId: input.sessionId,
      data: input.data,
      score,
      partial: input.partial,
    });

    // A transport retry whose first attempt actually landed re-runs this whole
    // method (`callActionWithRetry` cannot abort an in-flight request, so a
    // slow-but-successful complete IS retried). The submission row dedupes
    // itself; its effects do not — without this gate the owner and respondent
    // each get a second email, and a drained CRM delivery duplicates (the
    // HubSpot mirror activity has no idempotency key). The first landing
    // already owes every effect, so a re-landed complete enqueues nothing.
    const reCompleted = !input.partial && row.wasCompletedBefore;

    if (!input.partial && !reCompleted) {
      const respondentEmail = pickEmail(input.data);
      // form.id lets the effect apply any per-form template override
      // (precedence form → account → stock, resolved inside the effect).
      void this.email.enqueueSubmissionReceived(
        form.accountId,
        {
          submissionId: row.id,
          formName: form.name,
          respondentEmail,
          score,
          outcomeLabel: outcome?.label ?? null,
        },
        form.id,
      );
      // Respondent confirmation receipt — only when the answers carried an
      // email. Same durable outbox; gated inside the effect (notification_setting
      // `submission_confirmed`, form row → account row → default-on).
      if (respondentEmail) {
        void this.email.enqueueSubmissionConfirmed(
          form.accountId,
          {
            submissionId: row.id,
            formName: form.name,
            respondentEmail,
          },
          form.id,
        );
      }
    }

    // Fan out to every enabled destination (CRM/webhook) via the durable outbox.
    // Persist-first: this only ENQUEUES local outbox rows (cheap, never network,
    // internally guarded so it cannot throw) — the actual delivery happens later
    // in the worker, so the submission is never blocked or failed by a slow/failing
    // destination. Enqueued for BOTH phases; adapters decide phase behavior.
    // Skipped on a re-landed complete (same reasoning as the emails above):
    // enqueue cancels only PENDING rows, so once the worker drained the first
    // delivery a second enqueue is a duplicate webhook/CRM activity, not a retry.
    if (!reCompleted)
      await this.destinations?.enqueueSubmissionDeliveries({
      formId: form.id,
      formName: form.name,
      accountId: form.accountId,
      submissionId: row.id,
      sessionId: input.sessionId,
      score,
      outcomeLabel: outcome?.label ?? null,
      phase: input.partial ? 'partial' : 'complete',
      submittedAt: Date.now(),
      data: input.data,
      config,
    });

    // ACTIVATION — the north star: this account's form got a real answer.
    //
    // Server-side, and it has to be: the submission happens in the RESPONDENT's
    // browser, and the account owner (who the event is about) is not there. The
    // owner is resolved from the form's account, never from the respondent.
    //
    // Exactly once per account, enforced by an atomic CLAIM on the account row
    // (`UPDATE … WHERE activated_at IS NULL`) rather than by asking whether an
    // earlier answer exists. That question is a read-then-act: two answers
    // landing together each see the other and both decline, and the account can
    // then never activate; a re-submitted session double-fires. Both were
    // reproduced against this service. The claim has neither failure mode and is
    // idempotent against a replayed row.
    //
    // The CLAIM is deliberately NOT gated on analytics, only the capture is.
    // `activated_at` is a fact about the workspace — the day its first form was
    // really answered — and it has to be recorded whether or not anyone is
    // listening. Gating it would leave every account that activates while
    // telemetry is off with a NULL, and the moment the key is set each one would
    // claim and announce an activation dated today: exactly the false-conversion
    // wave the 0010 backfill exists to prevent, just triggered by env timing
    // instead of migration timing. The cost of always claiming is one
    // primary-key UPDATE that matches nothing after the first answer, next to a
    // submission write that already happened.
    //
    // `.catch(() => false)` is load-bearing, not defensive habit. By this point
    // the submission is COMMITTED and its emails and deliveries are enqueued; a
    // throw here would hand the respondent a 500 for an answer that was in fact
    // saved. A lost claim costs nothing — the claim is idempotent, so the next
    // completed answer takes it — while a failed request cannot be undone. Same
    // rule the rest of this feature already states: analytics observes the
    // product, it never participates in it.
    //
    // Logged, though, because two of its failure modes are permanent and do NOT
    // self-heal: a claim that commits and THEN loses its response (the column is
    // set, so nothing can ever claim it again), and an API running ahead of
    // migration 0010 (every milestone silently missing until the deploy
    // completes). Both are invisible without this line, and the first thing
    // anyone does with this feature is ask why activation reads zero.
    if (!input.partial) {
      const first = await claimAccountActivation(this.db, form.accountId).catch((err) => {
        this.log.warn(`activation claim failed for account ${form.accountId}: ${String(err)}`);
        return false;
      });
      if (first && this.productAnalytics?.enabled) {
        // The claim is already SPENT, so the event has to go out no matter what
        // the identity lookup returns. `getAccountOwner` filters on
        // `status = 'active'`, so a workspace whose owner is deactivated would
        // otherwise burn its activation and never emit one — the milestone can
        // only be claimed once, ever. The account fallback keeps the funnel
        // whole: `forms_account` is the group these milestones are counted by,
        // and that grouping is what the number actually measures.
        const owner = await getAccountOwner(this.db, form.accountId).catch(() => null);
        await this.productAnalytics.capture('activation', {
          distinctId: owner?.email ?? `account:${form.accountId}`,
          accountId: form.accountId,
          properties: { form_id: form.id, has_owner_email: Boolean(owner?.email) },
        });
      }
    }

    return { id: row.id, score, outcome: outcome?.id ?? null };
  }

  /** Record a funnel event (view/start/step_view/…) for a form + session. */
  async event(accountCode: string, slug: string, raw: unknown): Promise<{ ok: true } | ServiceError> {
    const input = formEventSchema.parse(raw);
    const form = await getPublishedForm(this.db, accountCode, slug);
    if (!form) return { error: 'NOT_FOUND', message: 'Form not found.', status: 404 };

    await recordFormEvent(this.db, {
      formId: form.id,
      sessionId: input.sessionId,
      type: input.type,
      stepIndex: input.stepIndex ?? null,
      stepKey: input.stepKey ?? null,
    });

    // Claimed AFTER the insert, not before. The old read-then-act HAD to run
    // first or it would have found the very row being written; a claim has no
    // such constraint, and claiming first meant a failed insert burned
    // `first_viewed_at` on a view that was never recorded.
    //
    // Same atomic claim as activation and, like it, NOT gated on analytics —
    // only the capture is. `first_viewed_at` is a fact about the workspace, and
    // recording it lazily would mean every account that got its first visitor
    // while telemetry was off announces that visit the day the key is set.
    // Restricted to `type === 'view'` so the ordinary hot path
    // (step_view/step_complete, which is most of this table) never touches it.
    // `.catch(() => false)` for the same reason as activation: the funnel event
    // is already recorded, and a lock on `account` must not turn a public form
    // view into an error. A lost claim is retried by the next visitor.
    const firstEverView =
      input.type === 'view' &&
      (await claimAccountFirstView(this.db, form.accountId).catch((err) => {
        this.log.warn(`first-view claim failed for account ${form.accountId}: ${String(err)}`);
        return false;
      }));

    // The moment a workspace's work first met a real visitor. It splits the two
    // halves of the funnel: published-but-never-viewed is a DISTRIBUTION problem
    // (the owner never shared it), viewed-but-never-answered is a FORM problem.
    // Without this event both look identical from the outside.
    if (firstEverView && this.productAnalytics?.enabled) {
      // Same as activation: the claim is spent, so the event must not depend on
      // an identity lookup that can come back empty.
      const owner = await getAccountOwner(this.db, form.accountId).catch(() => null);
      await this.productAnalytics?.capture('form_first_view', {
        distinctId: owner?.email ?? `account:${form.accountId}`,
        accountId: form.accountId,
        properties: { form_id: form.id, has_owner_email: Boolean(owner?.email) },
      });
    }
    return { ok: true };
  }

  /**
   * Record a scheduling callback (HubSpot Meetings / Calendly) reported by the
   * public renderer after a meeting is booked, tied to the submission session.
   * Persist-first: the booking_event row is the durable fact; the CRM sync is
   * then ENQUEUED (outbox kind `booking_sync`) — the worker fetches Calendly
   * details and updates the HubSpot contact with retry+backoff. Never inline
   * HTTP here, and a failed enqueue never fails the callback.
   */
  async booking(accountCode: string, slug: string, raw: unknown): Promise<{ ok: true } | ServiceError> {
    const input = bookingCallbackSchema.parse(raw);
    const form = await getPublishedForm(this.db, accountCode, slug);
    if (!form) return { error: 'NOT_FOUND', message: 'Form not found.', status: 404 };
    const row = await insertBookingEvent(this.db, {
      formId: form.id,
      sessionId: input.sessionId,
      provider: input.provider,
      eventUri: input.eventUri ?? null,
      inviteeUri: input.inviteeUri ?? null,
      startTime: input.startTime ? Date.parse(input.startTime) : null,
      // The validated callback body — never the raw request (bounded, typed).
      payload: input,
    });
    // Durable CRM sync (internally guarded — cannot reject into the callback).
    await this.bookings?.enqueueBookingSync({
      bookingEventId: row.id,
      formId: form.id,
      accountId: form.accountId,
      sessionId: input.sessionId,
      provider: input.provider,
      eventUri: input.eventUri ?? null,
      inviteeUri: input.inviteeUri ?? null,
      startTime: row.startTime,
      // The persisted row's own stamp, not a second `Date.now()` — the booking
      // day the CRM records must be the day this callback landed, and the row
      // is the durable record of when that was.
      bookedAt: row.createdAt,
    });
    return { ok: true };
  }

  /** List a form's submissions (admin-scoped by the caller). */
  listSubmissions(formId: string): Promise<SubmissionRow[]> {
    return listSubmissions(this.db, formId);
  }
}

/**
 * Strip server-only sections (submission `destinations`: webhook URLs/secrets,
 * CRM property mappings) from a stored config before it is served to the public
 * renderer. The renderer only needs cover/steps/scoring/outcomes.
 */
function toPublicConfig(config: unknown): FormConfig {
  const c = (config ?? { version: 1, steps: [] }) as Record<string, unknown>;
  const { destinations: _destinations, ...rest } = c;
  return rest as unknown as FormConfig;
}

/** Best-effort pick the respondent's email out of the answers for the receipt. */
function pickEmail(data: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'string') continue;
    if (/@/.test(value) && (key.toLowerCase().includes('email') || /@[^@]+\.[^@]+$/.test(value))) {
      return value;
    }
  }
  return null;
}
