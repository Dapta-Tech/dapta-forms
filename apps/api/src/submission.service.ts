import { Inject, Injectable } from '@nestjs/common';
import type { Db } from '@quill/db';
import {
  getPublishedForm,
  upsertSubmission,
  recordFormEvent,
  listSubmissions,
  type SubmissionRow,
} from '@quill/db';
import { computeScore, resolveOutcome, type FormConfig } from '@quill/engine';
import { submissionSchema, formEventSchema, type PublicForm } from '@quill/types';
import { EmailEffects } from './email-effects';
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
  ) {}

  /** The published form for a public code + slug (the renderer's config). */
  async publicForm(accountCode: string, slug: string): Promise<PublicForm | null> {
    const f = await getPublishedForm(this.db, accountCode, slug);
    if (!f) return null;
    return { slug: f.slug, name: f.name, config: f.config as FormConfig };
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
    const outcome = resolveOutcome(config, score);
    const row = await upsertSubmission(this.db, {
      formId: form.id,
      sessionId: input.sessionId,
      data: input.data,
      score,
      partial: input.partial,
    });

    if (!input.partial) {
      const respondentEmail = pickEmail(input.data);
      void this.email.enqueueSubmissionReceived(form.accountId, {
        submissionId: row.id,
        formName: form.name,
        respondentEmail,
        score,
        outcomeLabel: outcome?.label ?? null,
      });
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
    });
    return { ok: true };
  }

  /** List a form's submissions (admin-scoped by the caller). */
  listSubmissions(formId: string): Promise<SubmissionRow[]> {
    return listSubmissions(this.db, formId);
  }
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
