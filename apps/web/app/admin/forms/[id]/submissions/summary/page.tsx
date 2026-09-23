import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { FormConfig } from '@quill/types';
import { isInputlessStep, type SubmissionFacets } from '@quill/engine';
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
import {
  apiFilterQuery,
  filterParams,
  isFiltered,
  parseViewFilter,
  queryString,
  withFilter,
  type ViewFilter,
} from '../filters';
import { filterColumns, filterScope } from '../filter-columns';
import { ClearFiltersButton, FilterBar, FilterHost } from '../column-filter';

export const dynamic = 'force-dynamic';

/** Contact questions: their card is the count and a search, never a list of people. */
const CONTACT_TYPES = new Set(['name', 'email', 'phone']);

/**
 * Submissions, read question by question: one card per answering step, in
 * form order. Typeform calls it Summary; it is what owners were rebuilding in
 * a spreadsheet from the CSV. It describes the responses the table's header
 * filters leave (they ride along in the URL between the two views), and a bar
 * of a choice question opens the table filtered by that option.
 */
export default async function SubmissionsSummaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const locale = await getLocale();
  const m = getMessages(locale).admin;
  // The form is checked before the Suspense below: a form from another
  // workspace (or none at all) gets the not-found page, not the header, the
  // tabs and a skeleton first. The HTTP status is still 200, as on every admin
  // page: `admin/loading.tsx` wraps the whole admin in a Suspense, so the
  // response has started before any page runs.
  let form: Awaited<ReturnType<typeof adminApi.getForm>>;
  try {
    form = await adminApi.getForm(id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const config = form.config as FormConfig;
  const steps = (config.steps ?? []).filter((st) => !isInputlessStep(st));
  const scoring = config.scoring?.enabled !== false;
  const filter = parseViewFilter(sp, filterScope(steps, scoring));
  const hasContact = steps.some((st) => CONTACT_TYPES.has(st.type));
  // Labels only: the Summary has no headings to open a menu from, just the
  // chips that say what it is filtered by.
  const columns = filterColumns({
    steps,
    scoring,
    facets: null,
    labels: {
      date: hasContact ? m.submissions.colResponse : m.submissions.colSubmitted,
      status: m.submissions.colStatus,
      score: m.submissions.colScore,
    },
  });

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-8">
      <FormTabs formId={id} active="submissions" labels={m.nav} />
      <div className="mb-6 flex flex-col gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{m.submissions.title}</h1>
          <p className="mt-1 text-muted-foreground">{m.submissions.subtitle}</p>
        </div>
        <SubmissionsViewTabs
          formId={id}
          active="summary"
          labels={m.submissions.summary}
          query={queryString(filterParams(filter))}
        />
      </div>
      <FilterHost
        columns={columns}
        filter={filter}
        statusCounts={{ completed: 0, partial: 0 }}
        total={0}
        labels={{ ...m.submissions.filters, completed: m.submissions.badgeCompleted, partial: m.submissions.badgePartial }}
        locale={locale}
      >
        {/* Keyed by the filter: a text card's answers and search are its own
            state, and must start over on another set of responses. */}
        <Suspense key={filterParams(filter).toString()} fallback={<SummarySkeleton />}>
          <SummaryData id={id} filter={filter} locale={locale} m={m} />
        </Suspense>
      </FilterHost>
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
  filter,
  locale,
  m,
}: {
  id: string;
  filter: ViewFilter;
  locale: Locale;
  m: FormsMessages['admin'];
}) {
  const filtered = isFiltered(filter);
  const me = await adminApi.me();
  const timeZone = me.timezone ?? 'UTC';
  // The table's filter, minus its order: the Summary reads newest first.
  const { sort: _sort, ...apiQuery } = apiFilterQuery(filter, timeZone);
  let summary: Awaited<ReturnType<typeof adminApi.getSummary>>;
  let facets: SubmissionFacets | null = null;
  try {
    // Filtered, it also needs every response's count, for "12 of 30".
    [summary, facets] = await Promise.all([
      adminApi.getSummary(id, apiQuery),
      filtered ? adminApi.getSubmissionFacets(id) : Promise.resolve(null),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const s = m.submissions;
  const bar = <FilterBar shown={summary.total} total={facets?.total ?? summary.total} sorted={false} />;

  if (summary.total === 0) {
    return filtered ? (
      <div className="flex flex-col gap-4">
        {bar}
        <div
          className="rounded-xl border border-dashed border-border bg-card/40 p-12 text-center"
          data-testid="filter-empty"
        >
          <p className="text-lg font-medium">{s.filters.noMatchesTitle}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{s.filters.noMatchesBody}</p>
          <div className="mt-4">
            <ClearFiltersButton />
          </div>
        </div>
      </div>
    ) : (
      <div className="rounded-xl border border-dashed border-border bg-card/40 p-12 text-center">
        <p className="text-lg font-medium">{s.emptyTitle}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{s.emptyBody}</p>
      </div>
    );
  }

  /** The table, filtered as now plus this one option of this question. */
  const optionHref = (key: string) => (value: string) =>
    `/admin/forms/${id}/submissions${queryString(
      withFilter('', { ...filter, answers: { ...filter.answers, [key]: [value] } }),
    )}`;

  const cardLabels: SummaryCardLabels = {
    answered: s.answeredCount,
    multiNote: s.summary.multiNote,
    average: s.summary.average,
    range: s.summary.range,
    filesUploaded: s.summary.filesUploaded,
    meetingsBooked: s.summary.meetingsBooked,
    noAnswers: s.summary.noAnswers,
    showResponses: s.filters.showResponses,
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
        {bar}
        {summary.questions.map((q, i) => (
          <QuestionCard key={q.key} question={q} index={i + 1} labels={cardLabels}>
            {q.kind === 'choice' ? (
              <ChoiceBody question={q} labels={cardLabels} hrefFor={optionHref(q.key)} />
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
                filter={apiQuery}
                compact={CONTACT_TYPES.has(q.type)}
                labels={s.summary}
              />
            )}
          </QuestionCard>
        ))}
      </div>
    </SummaryResponsePanel>
  );
}
