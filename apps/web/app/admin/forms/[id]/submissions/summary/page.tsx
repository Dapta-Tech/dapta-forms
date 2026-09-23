import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getMessages, type FormsMessages, type Locale } from '@quill/shared';
import { adminApi, ApiError } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { FormTabs } from '@/components/ui/form-tabs';
import { Skeleton } from '@/components/skeleton';
import type { PanelLabels } from '../response-panel';
import { SubmissionsViewTabs } from '../submissions-view-tabs';
import {
  ChoiceBody,
  CountBody,
  QuestionCard,
  ScaleBody,
  type SummaryCardLabels,
} from './summary-cards';
import { SummaryResponsePanel } from './summary-response-panel';
import { TextAnswers } from './text-answers';
import { toSummaryHit } from './summary-hit';

export const dynamic = 'force-dynamic';

/**
 * Submissions, read question by question: one card per answering step, in
 * form order. Typeform calls it Summary; it is what owners were rebuilding in
 * a spreadsheet from the CSV. No filter yet: it describes every response, and
 * the API already takes the table's filter for when the header filters land.
 */
export default async function SubmissionsSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const locale = await getLocale();
  const m = getMessages(locale).admin;
  // The form is checked before the Suspense below: a form from another
  // workspace (or none at all) gets the not-found page, not the header, the
  // tabs and a skeleton first. The HTTP status is still 200, as on every admin
  // page: `admin/loading.tsx` wraps the whole admin in a Suspense, so the
  // response has started before any page runs.
  try {
    await adminApi.getForm(id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-8">
      <FormTabs formId={id} active="submissions" labels={m.nav} />
      <div className="mb-6 flex flex-col gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{m.submissions.title}</h1>
          <p className="mt-1 text-muted-foreground">{m.submissions.subtitle}</p>
        </div>
        <SubmissionsViewTabs formId={id} active="summary" labels={m.submissions.summary} />
      </div>
      <Suspense fallback={<SummarySkeleton />}>
        <SummaryData id={id} locale={locale} m={m} />
      </Suspense>
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-56 w-full rounded-xl" />
      <Skeleton className="h-56 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}

/** The panel's labels: the same catalog entries the Responses view hands it. */
function panelLabels(s: FormsMessages['admin']['submissions']): PanelLabels {
  return {
    responseTitle: s.responseTitle,
    prevResponse: s.prevResponse,
    nextResponse: s.nextResponse,
    closeResponse: s.closeResponse,
    responsePosition: s.responsePosition,
    answersTitle: s.answersTitle,
    detailsTitle: s.detailsTitle,
    noAnswer: s.noAnswer,
    colStatus: s.colStatus,
    colSubmitted: s.colSubmitted,
    colStarted: s.colStarted,
    colScore: s.colScore,
    responseId: s.responseId,
    utmTitle: s.utmTitle,
    answeredCount: s.answeredCount,
    badgeCompleted: s.badgeCompleted,
    badgePartial: s.badgePartial,
    delete: s.delete,
    deleteConfirm: s.deleteConfirm,
    sheetOpen: s.sheetOpen,
    sheetClose: s.sheetClose,
    scoreValue: s.scoreValue,
  };
}

async function SummaryData({
  id,
  locale,
  m,
}: {
  id: string;
  locale: Locale;
  m: FormsMessages['admin'];
}) {
  let summary: Awaited<ReturnType<typeof adminApi.getSummary>>;
  let me: Awaited<ReturnType<typeof adminApi.me>>;
  try {
    [summary, me] = await Promise.all([adminApi.getSummary(id), adminApi.me()]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const s = m.submissions;
  const timeZone = me.timezone ?? 'UTC';

  if (summary.total === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/40 p-12 text-center">
        <p className="text-lg font-medium">{s.emptyTitle}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{s.emptyBody}</p>
      </div>
    );
  }

  const cardLabels: SummaryCardLabels = {
    answered: s.answeredCount,
    multiNote: s.summary.multiNote,
    average: s.summary.average,
    range: s.summary.range,
    filesUploaded: s.summary.filesUploaded,
    meetingsBooked: s.summary.meetingsBooked,
    noAnswers: s.summary.noAnswers,
  };
  const fileLabels = {
    download: s.download,
    downloadFailed: s.downloadFailed,
    loading: s.previewLoading,
    failed: s.previewFailed,
    reload: s.previewReload,
    unavailable: s.previewUnavailable,
    approx: s.previewApprox,
    close: s.previewClose,
  };

  return (
    <SummaryResponsePanel formId={id} labels={panelLabels(s)} fileLabels={fileLabels}>
      <div className="flex flex-col gap-4" data-testid="summary">
        {summary.questions.map((q, i) => (
          <QuestionCard key={q.key} question={q} index={i + 1} labels={cardLabels}>
            {q.kind === 'choice' ? (
              <ChoiceBody question={q} labels={cardLabels} />
            ) : q.kind === 'scale' ? (
              <ScaleBody question={q} labels={cardLabels} locale={locale} />
            ) : q.kind === 'count' ? (
              <CountBody question={q} labels={cardLabels} />
            ) : (
              <TextAnswers
                formId={id}
                stepKey={q.key}
                answered={q.answered}
                recent={q.recent.map((a) => toSummaryHit(a, { locale, timeZone }))}
                labels={s.summary}
              />
            )}
          </QuestionCard>
        ))}
      </div>
    </SummaryResponsePanel>
  );
}
