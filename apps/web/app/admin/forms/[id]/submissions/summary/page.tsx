import { Suspense, type ReactNode } from 'react';
import { notFound } from 'next/navigation';
import type { FormConfig } from '@quill/types';
import { isInputlessStep, type SubmissionFacets, type SubmissionsSummary } from '@quill/engine';
import { getMessages, t, type FormsMessages, type Locale } from '@quill/shared';
import { adminApi, ApiError } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { FormTabs } from '@/components/ui/form-tabs';
import { Skeleton } from '@/components/skeleton';
import { HeldFallback, SwapHold } from '@/components/swap-hold';
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
import type { SummaryFilterQuery } from './actions';
import { getBuilderMessages } from '../../edit/_components/builder-messages';
import { galleryIdForStep } from '../../edit/_components/question-types';
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

/** Contact questions: a form that asks one leads its table with who answered. */
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
  let me: Awaited<ReturnType<typeof adminApi.me>>;
  try {
    [form, me] = await Promise.all([adminApi.getForm(id), adminApi.me()]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const timeZone = me.timezone ?? 'UTC';
  const config = form.config as FormConfig;
  const steps = (config.steps ?? []).filter((st) => !isInputlessStep(st));
  const scoring = config.scoring?.enabled !== false;
  const filter = parseViewFilter(sp, filterScope(steps, scoring));
  // The table's filter, minus its order: the Summary reads newest first.
  const { sort: _sort, ...apiQuery } = apiFilterQuery(filter, timeZone);
  // The cards' data is read HERE, in the shell, and the boundary below is
  // keyed by it. A refresh that changed the answers (a response deleted from
  // the panel) fetches the new cards, but a boundary that keeps its key never
  // puts them on screen: the table found the same, reads its rows in its shell
  // and keys its boundary by them. So does this: other answers, new boundary.
  const filtered = isFiltered(filter);
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
  const version = [
    summary.total,
    ...summary.questions.map((q) => `${q.answered}${q.kind === 'text' ? `:${q.recent[0]?.id ?? ''}` : ''}`),
  ].join(',');
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

  // Summary | Responses, handed down so it shares a line with the filter chips
  // (which only exist once the data does) and the count.
  const viewTabs = (
    <SubmissionsViewTabs
      formId={id}
      active="summary"
      labels={m.submissions.summary}
      query={queryString(filterParams(filter))}
    />
  );
  // The kind of each question, named as the builder names it.
  const kinds = getBuilderMessages(locale).gallery.items;
  const typeLabels = Object.fromEntries(steps.map((st) => [st.key, kinds[galleryIdForStep(st)]?.title ?? '']));

  return (
    <div>
      <FormTabs
        formId={id}
        active="submissions"
        labels={{ ...m.nav, forms: m.chrome.nav.forms }}
        name={form.name}
        hasDraft={form.draftConfig != null}
        statusLabels={m.forms}
      />
      <div className="mx-auto max-w-[1520px] px-6 py-6 sm:px-8">
        <FilterHost
          columns={columns}
          filter={filter}
          statusCounts={{ completed: 0, partial: 0 }}
          total={0}
          labels={{ ...m.submissions.filters, completed: m.submissions.badgeCompleted, partial: m.submissions.badgePartial }}
          locale={locale}
        >
          {/* Keyed by the filter: a text card's answers and search are its own
              state, and must start over on another set of responses. While the
              new cards load, the old ones stay up (see `SwapHold`) rather than
              a skeleton blinking in. */}
          <SwapHold>
            <Suspense
              key={`${filterParams(filter).toString()}|${version}`}
              fallback={
                <HeldFallback>
                  <SummarySkeleton viewTabs={viewTabs} />
                </HeldFallback>
              }
            >
              <SummaryData
                id={id}
                filter={filter}
                apiQuery={apiQuery}
                timeZone={timeZone}
                summary={summary}
                facets={facets}
                locale={locale}
                viewTabs={viewTabs}
                typeLabels={typeLabels}
                m={m}
              />
            </Suspense>
          </SwapHold>
        </FilterHost>
      </div>
    </div>
  );
}

function SummarySkeleton({ viewTabs }: { viewTabs: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      {viewTabs}
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-56 w-full rounded-2xl" />
        <Skeleton className="h-56 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
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
    pageRow: s.pageRow,
    hubspotCookie: s.hubspotCookie,
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

function SummaryData({
  id,
  filter,
  apiQuery,
  timeZone,
  summary,
  facets,
  locale,
  viewTabs,
  typeLabels,
  m,
}: {
  id: string;
  filter: ViewFilter;
  /** The cards' numbers, read by the shell. */
  summary: SubmissionsSummary;
  /** Every response's count, when the view is filtered (for "12 of 30"). */
  facets: SubmissionFacets | null;
  /** The filter as the API reads it, without the order (the Summary reads newest first). */
  apiQuery: SummaryFilterQuery;
  /** The workspace zone the dates are read in. */
  timeZone: string;
  locale: Locale;
  /** Summary | Responses, at the head of the line the chips and the count share. */
  viewTabs: ReactNode;
  /** Each question's kind, by step key, as the builder names it. */
  typeLabels: Record<string, string>;
  m: FormsMessages['admin'];
}) {
  const filtered = isFiltered(filter);
  const s = m.submissions;
  // One line over the cards: the view switch, what the view is filtered by,
  // and how many responses it describes. Filtered, the chips already say
  // "12 of 30", so the plain count steps aside.
  const bar = (
    <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2">
      {viewTabs}
      <FilterBar shown={summary.total} total={facets?.total ?? summary.total} sorted={false} />
      {!filtered && summary.total > 0 ? (
        <span className="ml-auto text-sm tabular-nums text-muted-foreground" data-testid="summary-total">
          {t(m.picker.submissionsCount, { n: summary.total })}
        </span>
      ) : null}
    </div>
  );

  if (summary.total === 0) {
    return filtered ? (
      <div className="flex flex-col gap-4">
        {bar}
        <div
          className="rounded-2xl border border-dashed border-border p-12 text-center"
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
      <div className="flex flex-col gap-4">
        {bar}
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <p className="text-lg font-medium">{s.emptyTitle}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{s.emptyBody}</p>
        </div>
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
        {/* Two columns once there is room, in reading order. The two cards of
            a row share its height, so the grid has no holes; a masonry would
            close them, and reshuffle the cards every time one grew. */}
        <div className="grid gap-4 xl:grid-cols-2">
        {summary.questions.map((q, i) => (
          <QuestionCard key={q.key} question={q} index={i + 1} typeLabel={typeLabels[q.key]} labels={cardLabels}>
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
                // Every text card opens with its latest answers, a contact
                // question (name, email, phone) like any other: a card that
                // showed only a search box read as a question nobody answered.
                recent={q.recent.map((a) => toSummaryHit(a, { locale, timeZone }))}
                filter={apiQuery}
                labels={s.summary}
              />
            )}
          </QuestionCard>
        ))}
        </div>
      </div>
    </SummaryResponsePanel>
  );
}
