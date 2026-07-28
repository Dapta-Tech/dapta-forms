import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Db } from '@quill/db';
import {
  getMemberByHandle,
  listPublishedFormsForAccount,
  getPublishedForm,
  insertBookingEvent,
  upsertSubmission,
  recordFormEvent,
  listSubmissions,
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
import { DB } from './tokens';

export type ServiceError = { error: string; message: string; status: number };

/**
 * The public forms surface: fetch a published form, accept a submission (server-
 * recomputes the score from the config — never trust the client), and record a
 * funnel event. All account scoping is resolved from the public code + slug.
 */
@Injectable()
export class SubmissionService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EmailEffects) private readonly email: EmailEffects,
    // Optional so existing direct constructions (tests) keep working; the module
    // always provides it in the running app.
    @Optional() @Inject(DestinationEffects) private readonly destinations?: DestinationEffects,
    // Optional for the same reason: enqueues the durable booking → CRM sync.
    @Optional() @Inject(BookingEffects) private readonly bookings?: BookingEffects,
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
      forms: forms.map((f) => ({ slug: f.slug, name: f.name })),
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

    if (!input.partial) {
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
