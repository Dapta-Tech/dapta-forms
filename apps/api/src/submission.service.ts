import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Db } from '@quill/db';
import {
  getMemberByHandle,
  listPublishedFormsForAccount,
  getPublishedForm,
  insertBookingEvent,
  upsertSubmission,
  recordFormEvent,
  firstSessionViewAt,
  listSubmissions,
  claimAccountActivation,
  claimAccountFirstView,
  getAccountOwner,
  type SubmissionRow,
} from '@quill/db';
import { computeScore, publicTitle, resolveOutcome, summarizeAnswers, type FormConfig } from '@quill/engine';
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
import { UploadService } from './upload.service';
import { captchaActive, captchaStrict, type CaptchaVerifier } from './captcha';
import { hutkRefused, storedVisit } from './submission-visit';
import { CAPTCHA, DB } from './tokens';

export type ServiceError = { error: string; message: string; status: number };

/** What the public controller knows about the request that the body cannot say. */
export interface SubmitContext {
  /** The visitor's address as the rate limiter resolved it (see `clientKey`). */
  remoteIp?: string | null;
}

/**
 * Strict mode's minimum fill time: a complete landing sooner than this after
 * the session's first `view` is a bot. Deliberately low, so a one-question
 * form with a prefilled answer (view, glance, submit, then the challenge
 * itself) never trips it for a person.
 */
export const STRICT_MIN_FILL_MS = 2_000;

/**
 * Every refusal the challenge produces reads the same to the client, whatever
 * tripped it: a bot learns nothing from the answer about which check it failed.
 * English on purpose, like every API message; the renderer localizes by `error`.
 */
const CAPTCHA_FAILED: ServiceError = {
  error: 'CAPTCHA_FAILED',
  message: 'We could not verify that you are human. Please try again.',
  status: 403,
};

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
    // Verifies + promotes `file` answers. Optional for the same reason as the
    // rest: a form with no file question never reaches it.
    @Optional() @Inject(UploadService) private readonly uploads?: UploadService,
    // Spam protection's verifier. LAST on purpose: every spec builds this
    // service positionally. Absent reads as a deployment without keys, so the
    // check never runs and every form behaves exactly as it did before.
    @Optional() @Inject(CAPTCHA) private readonly captcha?: CaptchaVerifier,
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
    // Matched against the form's retired slugs as well as its current one.
    // `formSlugs` records whatever the slug was when the author picked the
    // form, so comparing only against the live slug would drop a form off this
    // page the moment somebody renamed its link, silently and with nothing on
    // screen to explain it. Resolving here rather than rewriting every stored
    // profile on rename also means there is no read-modify-write on the profile
    // blob to lose a race with, and profiles saved before this shipped heal
    // themselves.
    const forms =
      allowed == null
        ? published
        : published.filter(
            (f) => allowed.includes(f.slug) || f.retiredSlugs.some((old) => allowed.includes(old)),
          );

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
    return {
      slug: f.slug,
      name: f.name,
      config: toPublicConfig(f.config),
      ...(this.uploads?.enabled ? { uploadMaxMb: this.uploads.maxFileMb } : {}),
      // The challenge travels here, in the payload the page is rendered from,
      // and never in a NEXT_PUBLIC_ variable: that would be frozen into the web
      // build and could not follow the deployment's keys. Absent unless the
      // deployment has keys AND the owner turned the check on, so every other
      // form loads nothing from the challenge provider.
      ...(captchaActive(f.config, this.captcha) && this.captcha?.provider && this.captcha.siteKey
        ? {
            captcha: {
              provider: this.captcha.provider,
              siteKey: this.captcha.siteKey,
              ...(captchaStrict(f.config, this.captcha) ? { strict: true } : {}),
            },
          }
        : {}),
    };
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
    ctx: SubmitContext = {},
  ): Promise<{ id: string; score: number; outcome: string | null } | ServiceError> {
    const input = submissionSchema.parse(raw);
    const form = await getPublishedForm(this.db, accountCode, slug);
    if (!form) return { error: 'NOT_FOUND', message: 'Form not found.', status: 404 };

    const config = form.config as FormConfig;

    // The page it was answered on (#199). The contract already dropped any field
    // that failed its rule, so this never refuses anything. The HubSpot cookie
    // is an online identifier: it is kept only when something on this form will
    // use it, and its value is never logged, refused or not.
    if (hutkRefused(raw, input.visit)) this.log.warn('hutk dropped: not a 32-character hex HubSpot cookie');
    const visit = storedVisit(input.visit, form.config);

    // The ceiling a long-text question sets is enforced HERE as well as in the
    // browser, because `submissionSchema` puts no bound on an answer string at
    // all, and an unbounded payload was an open door before this setting existed.
    // Checked for partial saves too: a giant string is the same problem either
    // way. The FLOOR is deliberately not checked here; per-answer validation on
    // the server is a different, larger job (see `validateAnswerCode`, which
    // this app never calls) and a short answer keeps being accepted.
    const tooLong = overLongAnswer(config, input.data);
    if (tooLong)
      return {
        error: 'ANSWER_TOO_LONG',
        message: `Answer for "${tooLong.key}" is longer than the ${tooLong.maxChars} characters this question allows.`,
        status: 400,
      };

    // SPAM PROTECTION. With it on, one rule: a partial is saved and never
    // delivered; a complete is verified, then saved and delivered. So only a
    // COMPLETE meets the challenge, and it meets it here: before the uploads
    // below (copying objects is already a side effect) and before anything is
    // written. A refusal writes nothing but a server-side event. An outage of
    // the check does not lose the answers: they go through as a partial, which
    // this same rule keeps from reaching any destination, and the client is
    // told to try again.
    const isProtected = captchaActive(form.config, this.captcha);
    let partial = input.partial === true;
    let checkUnavailable = false;
    if (isProtected && !partial) {
      const gate = await this.challengeGate(form, input, ctx);
      if (gate === 'unavailable') {
        partial = true;
        checkUnavailable = true;
      } else if (gate) {
        return gate;
      }
    }

    // File answers are checked against the bucket BEFORE anything is persisted
    // or scored: an unverified answer must never reach the row, the score, or
    // an outbound effect. What comes back has its keys rewritten out of the
    // staging prefix, which lifecycle deletes.
    let data = input.data;
    if (this.uploads) {
      const verified = await this.uploads.verifyAnswers(form, input.sessionId, data);
      if ('error' in verified) return verified;
      data = verified.answers;
    }

    const score = computeScore(config, data);
    // Pass the answers so answer-forced outcome overrides resolve identically
    // to the client renderer (a score-only resolution would disagree with the
    // redirect the visitor actually saw).
    const outcome = resolveOutcome(config, score, data);
    const row = await upsertSubmission(this.db, {
      formId: form.id,
      sessionId: input.sessionId,
      data,
      score,
      partial,
      visit,
    });

    // A transport retry whose first attempt actually landed re-runs this whole
    // method (`callActionWithRetry` cannot abort an in-flight request, so a
    // slow-but-successful complete IS retried). The submission row dedupes
    // itself; its effects do not — without this gate the owner and respondent
    // each get a second email, and a drained CRM delivery duplicates (the
    // HubSpot mirror activity has no idempotency key). The first landing
    // already owes every effect, so a re-landed complete enqueues nothing.
    const reCompleted = !partial && row.wasCompletedBefore;

    if (!partial && !reCompleted) {
      const respondentEmail = pickEmail(data);
      // The answers as the owner reads them (labels, option labels, step
      // order): resolved once here, printed by the `{{answers}}` token in
      // either email. The respondent copy carries them too so a custom receipt
      // can echo what was submitted.
      const answers = summarizeAnswers(config, data);
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
          answers,
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
            answers,
            // The language the respondent saw (the page resolved ?lang and the
            // browser), else the form's own language; null = English.
            locale: input.locale ?? config.language ?? null,
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
    // Skipped, too, for a partial of a protected form: a partial never meets the
    // challenge, so it must never reach a webhook or the CRM. The destinations'
    // own `events` are left exactly as saved, so turning protection off
    // restores what each one did before.
    if (!reCompleted && !(isProtected && partial))
      await this.destinations?.enqueueSubmissionDeliveries({
      formId: form.id,
      formName: form.name,
      accountId: form.accountId,
      submissionId: row.id,
      sessionId: input.sessionId,
      score,
      outcomeLabel: outcome?.label ?? null,
      phase: partial ? 'partial' : 'complete',
      submittedAt: Date.now(),
      data,
      config,
      // The MERGED row's visit, not this request's: a complete that came
      // without one still delivers what the partial before it caught.
      visit: row.visit,
      formTitle: publicTitle(config, form.name),
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
    if (!partial) {
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

    // The check could not be completed, so the answers above were kept as a
    // partial. Say so with a status the renderer turns into "your answers are
    // saved, try again": a retry that passes completes this same row.
    if (checkUnavailable) {
      await this.recordBlocked(form.id, input.sessionId, 'captcha_unavailable');
      return {
        error: 'CAPTCHA_UNAVAILABLE',
        message: 'We could not complete the security check. Your answers are saved. Please try again.',
        status: 503,
      };
    }

    return { id: row.id, score, outcome: outcome?.id ?? null };
  }

  /**
   * The challenge for a COMPLETE submit of a protected form: null lets it
   * through, `'unavailable'` means no verdict could be had (the caller keeps
   * the answers as a partial), anything else is the refusal to answer with.
   *
   * The token is checked FIRST, whatever else is wrong, so the cheap strict
   * checks can never be probed without spending a real token. Those two run
   * only after it passes, and answer exactly like a bad token.
   */
  private async challengeGate(
    form: { id: string; config: unknown },
    input: { sessionId: string; captchaToken?: string; hp?: string },
    ctx: SubmitContext,
  ): Promise<ServiceError | 'unavailable' | null> {
    if (!input.captchaToken) {
      // Also what a tab opened before the owner turned protection on sends: its
      // renderer predates the check and prints `message` as is, so the message
      // has to be something a person can act on.
      return {
        error: 'CAPTCHA_REQUIRED',
        message: 'This form now checks that you are human. Refresh the page and submit again.',
        status: 403,
      };
    }
    const verdict = await this.captcha!.verify({
      token: input.captchaToken,
      sessionId: input.sessionId,
      remoteIp: ctx.remoteIp ?? null,
    });
    if (verdict.outcome === 'unavailable') return 'unavailable';
    if (verdict.outcome === 'failed') {
      await this.recordBlocked(form.id, input.sessionId, 'captcha_failed');
      return CAPTCHA_FAILED;
    }

    if (captchaStrict(form.config, this.captcha)) {
      // The hidden field: no person can see it, so any value is a bot's.
      if (input.hp) {
        await this.recordBlocked(form.id, input.sessionId, 'spam_honeypot');
        return CAPTCHA_FAILED;
      }
      // The minimum fill time, from the session's first recorded view. A lost
      // view never blocks anyone: the beacon is fire-and-forget, and the token
      // above already covered this session.
      const viewedAt = await firstSessionViewAt(this.db, form.id, input.sessionId);
      if (viewedAt == null) {
        this.log.log(`strict check: no recorded view for a session of form ${form.id}; fill time not applied`);
      } else if (Date.now() - viewedAt < STRICT_MIN_FILL_MS) {
        await this.recordBlocked(form.id, input.sessionId, 'spam_too_fast');
        return CAPTCHA_FAILED;
      }
    }
    return null;
  }

  /**
   * A blocked attempt, as a `form_event` written by this service. These types
   * are deliberately NOT in `formEventType`, so no client can send them through
   * the events endpoint; no metric counts them either (every funnel query names
   * the types it reads). Best-effort: losing the record must never turn a
   * refusal into a 500.
   */
  private async recordBlocked(formId: string, sessionId: string, type: string): Promise<void> {
    await recordFormEvent(this.db, { formId, sessionId, type }).catch((err) => {
      this.log.warn(`could not record ${type} for form ${formId}: ${String(err)}`);
    });
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
 *
 * `spamProtection` goes too: it is the owner's switch, and whether it RUNS also
 * depends on the deployment. The renderer acts on `PublicForm.captcha` alone,
 * which is the API's answer to both, so it can never act on half of it.
 */
function toPublicConfig(config: unknown): FormConfig {
  const c = (config ?? { version: 1, steps: [] }) as Record<string, unknown>;
  const { destinations: _destinations, spamProtection: _spamProtection, ...rest } = c;
  return rest as unknown as FormConfig;
}

/**
 * The first answer that overruns its question's `maxChars`, or null.
 *
 * Only `textarea` steps carry the setting, and only when the owner configured
 * one. A question with no ceiling is not measured, which is how every form
 * published before this existed keeps submitting whatever it always did.
 */
function overLongAnswer(
  config: FormConfig,
  data: Record<string, unknown>,
): { key: string; maxChars: number } | null {
  for (const step of config.steps ?? []) {
    if (step.type !== 'textarea' || step.maxChars == null) continue;
    const answer = data[step.key];
    if (typeof answer !== 'string') continue;
    if (answer.length > step.maxChars) return { key: step.key, maxChars: step.maxChars };
  }
  return null;
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
