import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import type { FormConfig, SubmissionsPage } from '@quill/types';
import {
  formatAnswerCell,
  isInputlessStep,
  nameAnswer,
  parseFileAnswer,
  stepLabel,
  type FormStep,
} from '@quill/engine';
import { formatDateTime, getMessages, t, type FormsMessages, type Locale } from '@quill/shared';
import { adminApi, ApiError, isAdminRole } from '@/lib/admin-api';
import { WorkspaceTimezoneField } from '@/app/admin/_components/workspace-timezone-field';
import { getLocale } from '@/lib/locale';
import { FormTabs } from '@/components/ui/form-tabs';
import { Skeleton } from '@/components/skeleton';
import { DeleteSubmissionButton } from './row-actions';
import { SubmissionFileButton } from './submission-file-button';
import { buildResponseDetail } from './response-detail';
import { PagerLink, ResponsesViewer } from './response-panel';
import {
  columnWidthVar,
  DEFAULT_PAGE_SIZE,
  parsePageSize,
  SHEET_VIEW,
  SIZE_PARAM,
  type PageSize,
} from './viewer-params';
import { StatusBadge } from './status-badge';
import { ColumnHeading } from './column-heading';
import { SubmissionsViewTabs } from './submissions-view-tabs';
import { ColumnResizeHandle } from './column-resize';
import { PageSelect, RowSelect } from './table-selection';
import { PageSizeSelect } from './page-size-select';
import {
  apiFilterQuery,
  apiQueryString,
  filterParams,
  isFiltered,
  parseViewFilter,
  queryString,
  withFilter,
  type ViewFilter,
} from './filters';
import { choiceColumnId, filterColumns, filterScope } from './filter-columns';
import { ClearFiltersButton, FilterBar, FilterHost, FilterTh } from './column-filter';

export const dynamic = 'force-dynamic';

/**
 * Header and body cell chrome. The table is `border-separate` rather than
 * `border-collapse` because a collapsed border belongs to the table, not the
 * cell, and scrolls away from a sticky header or first column; so the row
 * rule is drawn on each cell instead. The header ground is opaque for the
 * same reason: in the sheet it stays put over the rows scrolling under it.
 */
const TH =
  'sticky top-0 z-10 border-b border-border bg-card px-4 py-3 align-bottom font-medium in-data-sheet:shadow-[0_1px_0_var(--color-border)]';
/** `data-cursor`: the sheet's keyboard cursor, drawn inside the cell so no neighbour clips it. */
const TD =
  'border-b border-border px-4 py-3 group-last:border-b-0 data-cursor:outline-2 data-cursor:-outline-offset-2 data-cursor:outline-primary-edge';

/**
 * A question column's width: the one the reader dragged it to (a CSS variable
 * the resize handle sets on the table, per column), else the default range for
 * the view, which the table sets as `--q-min`/`--q-max`. Heading and cells read
 * the same variable, so the column moves as one.
 */
function questionWidth(index: number, cell: boolean): { minWidth?: string; maxWidth: string } {
  const own = `var(${columnWidthVar(index)}`;
  return cell
    ? { maxWidth: `${own}, var(--q-max))` }
    : { minWidth: `${own}, var(--q-min))`, maxWidth: `${own}, var(--q-max))` };
}

/**
 * The two pinned columns: the checkbox at the left edge, and the response
 * right after it, offset by the checkbox column's width. Both need an opaque
 * ground since the rows scroll under them.
 */
const SELECT_COL = 'w-11 min-w-11 max-w-11';
const PINNED_RESPONSE = 'sticky left-11';
const PINNED_TINT =
  'bg-card group-has-checked:bg-linear-to-r group-has-checked:from-primary/5 group-has-checked:to-primary/5 group-hover:bg-linear-to-r group-hover:from-accent/70 group-hover:to-accent/70 group-data-active:bg-linear-to-r group-data-active:from-primary/10 group-data-active:to-primary/10';

/** The query as Next hands it over: a param given twice (a filter's options) is a list. */
type SP = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** The form's own 404 is the page's 404; anything else is an error. */
function orNotFound(e: unknown): never {
  if (e instanceof ApiError && e.status === 404) notFound();
  throw e;
}

export default async function SubmissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SP>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const locale = await getLocale();
  const m = getMessages(locale).admin;
  const offset = Math.max(0, Number(one(sp.offset) ?? 0) || 0);
  const size = parsePageSize(one(sp.size));
  // The workspace zone every timestamp below is read in, and who may change
  // it; the form, whose questions decide what can be filtered; and the
  // unfiltered counts the column menus show.
  const [me, form, facets] = await Promise.all([
    adminApi.me(),
    adminApi.getForm(id).catch(orNotFound),
    adminApi.getSubmissionFacets(id).catch(orNotFound),
  ]);
  const timeZone = me.timezone ?? 'UTC';
  const config = form.config as FormConfig;
  // Message and reveal steps collect nothing: no column, as in the CSV.
  const steps = (config.steps ?? []).filter((s) => !isInputlessStep(s));
  // Score only exists when the form scores, as in the CSV.
  const scoring = config.scoring?.enabled !== false;
  // A form that collects a contact leads each row with who answered; one that
  // does not leads with when, as before.
  const hasContact = steps.some((s) => s.type === 'name' || s.type === 'email' || s.type === 'phone');
  // The header filters, from the URL (an old `?status=` link reads as the
  // Status filter). The API takes the same filter, so the table, the CSV and
  // the Summary always describe the same rows.
  const filter = parseViewFilter(sp, filterScope(steps, scoring));
  const apiQuery = apiFilterQuery(filter, timeZone);
  // The page of rows, fetched here because the table's key needs it.
  const page = await adminApi.listSubmissions(id, { ...apiQuery, limit: size, offset }).catch(orNotFound);
  // A new page, size or filter is a new table: the viewer (and its selection)
  // starts over. So is a new set of rows. A refresh that changed them (a
  // delete's `revalidatePath`) fetched the new rows but never put them on
  // screen while the boundary kept its key, in Chrome and Safari, in a
  // production build; keying the viewer inside it was not enough. Keyed by
  // the rows, only a change of rows remounts: walking, the panel and the
  // cursor keep their state otherwise.
  const key = `${filterParams(filter).toString()}:${offset}:${size}:${page.items.map((row) => row.id).join(',')}`;
  const columns = filterColumns({
    steps,
    scoring,
    facets,
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{m.submissions.title}</h1>
            <p className="mt-1 text-muted-foreground">{m.submissions.subtitle}</p>
          </div>
          {/* The export downloads exactly what the filters show, in the same order. */}
          <a
            href={`/admin/forms/${id}/submissions/export${apiQueryString(apiQuery)}`}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-transparent px-4 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
          >
            <i aria-hidden className="pi pi-download" style={{ fontSize: 13 }} />
            {m.submissions.export}
          </a>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SubmissionsViewTabs
            formId={id}
            active="responses"
            labels={m.submissions.summary}
            query={queryString(filterParams(filter))}
          />
          {/* The SHARED workspace zone, right where the timestamps are: an
              admin can fix it here, a member sees which zone applies. */}
          <WorkspaceTimezoneField
            accountId={me.accountId}
            value={me.timezone}
            canEdit={isAdminRole(me.role)}
            variant="inline"
            locale={locale}
            labels={{
              label: m.submissions.timezoneLabel,
              help: m.submissions.timezoneHint,
              saved: m.settings.workspaceTimezoneSaved,
              error: m.settings.workspaceTimezoneError,
              unset: m.settings.workspaceTimezoneUnset,
              utc: m.settings.workspaceTimezoneUtc,
              readOnly: m.submissions.timezoneReadOnly,
            }}
          />
        </div>
      </div>

      {/* Outside the keyed Suspense on purpose: a column's filter menu stays
          open while the rows it filters change under it. */}
      <FilterHost
        columns={columns}
        filter={filter}
        statusCounts={{ completed: facets.completed, partial: facets.partial }}
        total={facets.total}
        labels={{ ...m.submissions.filters, completed: m.submissions.badgeCompleted, partial: m.submissions.badgePartial }}
        locale={locale}
      >
        <Suspense key={key} fallback={<Skeleton className="h-80 w-full" />}>
          <SubmissionsData
            id={id}
            title={form.name}
            steps={steps}
            scoring={scoring}
            hasContact={hasContact}
            page={page}
            filter={filter}
            total={facets.total}
            offset={offset}
            size={size}
            locale={locale}
            timeZone={timeZone}
            responseId={one(sp.response)}
            sheet={one(sp.view) === SHEET_VIEW}
            m={m}
          />
        </Suspense>
      </FilterHost>
    </div>
  );
}

/**
 * One answer as the cell text, through the same helper the CSV export uses so
 * the screen and the download agree: option labels, a file as its name,
 * multi-selects joined with `; `, a booking in the workspace zone, a boolean
 * as a check, values trimmed. A name step stores its sub-fields flat
 * (firstname, lastname), never under its own key.
 */
function cellText(step: FormStep, data: Record<string, unknown>, timeZone: string): string {
  return step.type === 'name' ? nameAnswer(step, data) : formatAnswerCell(step, data[step.key], { timeZone });
}

function SubmissionsData({
  id,
  title,
  steps,
  scoring,
  hasContact,
  page,
  filter,
  total,
  offset,
  size,
  locale,
  timeZone,
  responseId,
  sheet,
  m,
}: {
  id: string;
  /** The form's name, on the sheet's top bar. */
  title: string;
  /** The answering steps, one column each. */
  steps: FormStep[];
  scoring: boolean;
  hasContact: boolean;
  /** This page of rows, fetched by the shell. */
  page: SubmissionsPage;
  filter: ViewFilter;
  /** Every response of the form, whatever the filter. */
  total: number;
  offset: number;
  /** `?size=`: rows per page. */
  size: PageSize;
  locale: Locale;
  timeZone: string;
  /** `?response=`: the response to open in the panel on load. */
  responseId?: string;
  /** `?view=sheet`: open the table as the full-screen sheet on load. */
  sheet: boolean;
  m: FormsMessages['admin'];
}) {
  const filtered = isFiltered(filter);
  // No responses at all. With a filter on, an empty page is a filter that
  // matches nothing: the table stays, headings and all, so it can be undone.
  if (page.total === 0 && !filtered) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/40 p-12 text-center">
        <p className="text-lg font-medium">{m.submissions.emptyTitle}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{m.submissions.emptyBody}</p>
      </div>
    );
  }

  // `?offset=` outlives the rows it pointed at: delete the only submission on
  // the last page and the browser still asks for that page. The API answers
  // with no items and a `total` that is not zero, so the empty state above does
  // not apply and the table rendered a header with no rows under an impossible
  // range ("26–25 of 25"), with Next disabled. `total` is authoritative — it
  // counts every row matching the filter, before pagination — so it is what
  // decides where the last page starts. Send the reader there, filter intact.
  if (page.total > 0 && offset >= page.total) {
    const lastOffset = Math.floor((page.total - 1) / page.limit) * page.limit;
    const q = withFilter('', filter);
    if (size !== DEFAULT_PAGE_SIZE) q.set(SIZE_PARAM, String(size));
    if (lastOffset > 0) q.set('offset', String(lastOffset));
    if (sheet) q.set('view', SHEET_VIEW);
    const query = q.toString();
    redirect(`/admin/forms/${id}/submissions${query ? `?${query}` : ''}`);
  }

  const from = offset + 1;
  const to = Math.min(offset + page.items.length, page.total);
  const hasPrev = offset > 0;
  const hasNext = offset + page.limit < page.total;
  /** A page link: the filter and the page size ride along; the sheet is added client-side. */
  const pageHref = (to: number) => {
    const q = withFilter('', filter);
    if (size !== DEFAULT_PAGE_SIZE) q.set(SIZE_PARAM, String(size));
    q.set('offset', String(to));
    return `?${q.toString()}`;
  };
  const fileLabels = {
    download: m.submissions.download,
    downloadFailed: m.submissions.downloadFailed,
    loading: m.submissions.previewLoading,
    failed: m.submissions.previewFailed,
    reload: m.submissions.previewReload,
    unavailable: m.submissions.previewUnavailable,
    approx: m.submissions.previewApprox,
    close: m.submissions.previewClose,
  };
  // Every response on this page, formatted for the side panel: the rows open
  // it, and its arrows walk this same list.
  const details = page.items.map((row) => buildResponseDetail(row, steps, { locale, timeZone, scoring }));
  // Every column, for the one cell that says a filter matched nothing.
  const columnCount = 4 + (scoring ? 1 : 0) + steps.length;
  const pagerButton =
    'inline-flex h-9 items-center rounded-md border border-border px-3 font-medium text-foreground transition-colors hover:bg-accent';
  const pagerOff =
    'inline-flex h-9 cursor-not-allowed items-center rounded-md border border-border px-3 font-medium text-muted-foreground opacity-50';

  return (
    <div className="flex flex-col gap-4">
      {/* Horizontal scroll lives INSIDE this container (themed scrollbar, global);
          the page body never scrolls sideways even with many step columns. */}
      <ResponsesViewer
        formId={id}
        title={title}
        items={details}
        initialId={responseId}
        initialSheet={sheet}
        fileLabels={fileLabels}
        labels={{
          responseTitle: m.submissions.responseTitle,
          prevResponse: m.submissions.prevResponse,
          nextResponse: m.submissions.nextResponse,
          closeResponse: m.submissions.closeResponse,
          responsePosition: m.submissions.responsePosition,
          answersTitle: m.submissions.answersTitle,
          detailsTitle: m.submissions.detailsTitle,
          noAnswer: m.submissions.noAnswer,
          colStatus: m.submissions.colStatus,
          colSubmitted: m.submissions.colSubmitted,
          colStarted: m.submissions.colStarted,
          colScore: m.submissions.colScore,
          responseId: m.submissions.responseId,
          utmTitle: m.submissions.utmTitle,
          answeredCount: m.submissions.answeredCount,
          badgeCompleted: m.submissions.badgeCompleted,
          badgePartial: m.submissions.badgePartial,
          delete: m.submissions.delete,
          deleteConfirm: m.submissions.deleteConfirm,
          sheetOpen: m.submissions.sheetOpen,
          sheetClose: m.submissions.sheetClose,
          scoreValue: m.submissions.scoreValue,
        }}
        selectionLabels={{
          selectedCount: m.submissions.selectedCount,
          selectedCountOne: m.submissions.selectedCountOne,
          exportSelected: m.submissions.exportSelected,
          delete: m.submissions.delete,
          clearSelection: m.submissions.clearSelection,
          bulkDeleteTitle: m.submissions.bulkDeleteTitle,
          bulkDeleteTitleOne: m.submissions.bulkDeleteTitleOne,
          bulkDeleteBody: m.submissions.bulkDeleteBody,
          bulkDeleteFailed: m.submissions.bulkDeleteFailed,
        }}
        pager={
          page.total === 0 ? undefined : (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-3">
              <PageSizeSelect value={size} label={m.submissions.pageSize} />
              <span className="text-muted-foreground tabular-nums" data-testid="page-range">
                {t(m.submissions.showing, { from, to, total: page.total })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {hasPrev ? (
                <PagerLink href={pageHref(Math.max(0, offset - page.limit))} className={pagerButton}>
                  {m.submissions.prev}
                </PagerLink>
              ) : (
                <span className={pagerOff}>{m.submissions.prev}</span>
              )}
              {hasNext ? (
                <PagerLink href={pageHref(offset + page.limit)} className={pagerButton}>
                  {m.submissions.next}
                </PagerLink>
              ) : (
                <span className={pagerOff}>{m.submissions.next}</span>
              )}
            </div>
          </div>
          )
        }
      >
        {/* What the view is filtered by, above the table in both views. */}
        <div className="mb-3 empty:hidden">
          <FilterBar shown={page.total} total={total} />
        </div>
        {/* In the sheet (`data-sheet` on the viewer) this container takes the
            screen and scrolls both ways, under a header that stays put and
            beside a first column that stays put. */}
        <div
          data-table-scroll
          className="overflow-x-auto rounded-lg border border-border bg-card in-data-sheet:min-h-0 in-data-sheet:overflow-auto"
        >
        {/* `--q-min`/`--q-max`: a question column's default width range in
            each view, for the columns the reader has not resized. */}
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm [--q-max:15rem] [--q-min:10rem] in-data-sheet:[--q-max:20rem] in-data-sheet:[--q-min:14rem]">
          <thead>
            {/* Sentence case at the label step, not the uppercase telemetry
                eyebrow: these are questions people read, often two lines long. */}
            <tr className="text-left text-xs leading-4 text-muted-foreground">
              <th className={`${TH} sticky left-0 z-20 px-0 ${SELECT_COL}`}>
                <PageSelect label={m.submissions.selectPage} />
              </th>
              {/* A funnel on every column that filters (the date, the status,
                  the score, each choice question); the heading opens it. */}
              <FilterTh columnId="date" className={`${TH} ${PINNED_RESPONSE} z-20 whitespace-nowrap shadow-[1px_0_0_var(--color-border)]`}>
                {hasContact ? m.submissions.colResponse : m.submissions.colSubmitted}
              </FilterTh>
              <FilterTh columnId="status" className={`${TH} whitespace-nowrap`}>
                {m.submissions.colStatus}
              </FilterTh>
              {scoring ? (
                <FilterTh columnId="score" align="end" className={`${TH} whitespace-nowrap text-right`}>
                  {m.submissions.colScore}
                </FilterTh>
              ) : null}
              {steps.map((s, i) => (
                <FilterTh
                  key={s.key}
                  columnId={choiceColumnId(s.key)}
                  className={`${TH} group/th`}
                  style={questionWidth(i, false)}
                  extra={
                    <ColumnResizeHandle
                      formId={id}
                      stepKey={s.key}
                      index={i}
                      label={m.submissions.resizeColumn}
                    />
                  }
                >
                  <ColumnHeading text={stepLabel(s)} />
                </FilterTh>
              ))}
              <th className={TH} aria-label={m.submissions.colActions} />
            </tr>
          </thead>
          <tbody>
            {page.items.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="p-0">
                  {/* Pinned to the visible left edge: the table can be far wider than the screen. */}
                  <div className="sticky left-0 w-[min(28rem,calc(100vw-3.5rem))] px-6 py-12" data-testid="filter-empty">
                    <p className="text-base font-medium">{m.submissions.filters.noMatchesTitle}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{m.submissions.filters.noMatchesBody}</p>
                    <div className="mt-4">
                      <ClearFiltersButton />
                    </div>
                  </div>
                </td>
              </tr>
            ) : null}
            {page.items.map((row, rowIndex) => {
              const completed = row.completedAt != null;
              const when = row.completedAt ?? row.partialAt ?? row.startedAt;
              const data = (row.data ?? {}) as Record<string, unknown>;
              const who = details[rowIndex]!.respondent;
              const identity = who.name ?? who.email ?? who.phone;
              return (
                <tr
                  key={row.id}
                  data-response-id={row.id}
                  className="group cursor-pointer align-top transition-colors hover:bg-accent/70 has-checked:bg-primary/5 data-active:bg-primary/10 data-active:hover:bg-primary/15"
                >
                  {/* Sticky, so both pinned cells need an opaque ground: the card
                      colour, with the row's selected, hover or active tint laid over
                      it as an image. The lime bar on the checkbox cell's left edge
                      marks the response open in the panel. */}
                  <td
                    className={`${TD} ${SELECT_COL} ${PINNED_TINT} sticky left-0 z-1 p-0 before:absolute before:inset-y-0 before:left-0 before:w-0.75 group-data-active:before:bg-primary`}
                  >
                    <RowSelect id={row.id} label={m.submissions.selectResponse} />
                  </td>
                  <td
                    data-cell
                    className={`${TD} ${PINNED_RESPONSE} ${PINNED_TINT} z-1 whitespace-nowrap shadow-[1px_0_0_var(--color-border)]`}
                  >
                    <span className="inline-flex items-start gap-2">
                      <span className="flex flex-col">
                        {identity ? (
                          <span className="max-w-56 truncate font-medium text-foreground">{identity}</span>
                        ) : null}
                        <span className={identity ? 'text-xs text-muted-foreground' : 'text-muted-foreground'}>
                          {formatDateTime(when, { locale, timeZone })}
                        </span>
                      </span>
                      {/* The keyboard way in: the row itself is clickable, but a
                          row is not focusable, so each one carries a real button. */}
                      <button
                        type="button"
                        data-open-response={row.id}
                        data-testid="open-response"
                        aria-label={m.submissions.viewResponse}
                        title={m.submissions.viewResponse}
                        className="inline-flex h-6 w-6 items-center justify-center rounded text-foreground opacity-0 transition-opacity hover:bg-accent focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                      >
                        <i aria-hidden className="pi pi-window-maximize" style={{ fontSize: 11 }} />
                      </button>
                    </span>
                  </td>
                  <td data-cell className={`${TD} whitespace-nowrap`}>
                    <StatusBadge
                      completed={completed}
                      label={completed ? m.submissions.badgeCompleted : m.submissions.badgePartial}
                    />
                  </td>
                  {scoring ? (
                    <td data-cell className={`${TD} whitespace-nowrap text-right tabular-nums`}>
                      {row.score}
                    </td>
                  ) : null}
                  {steps.map((s, i) => {
                    // A file cell is the one answer that is not text: it opens
                    // the thing rather than describing it.
                    const file = s.type === 'file' ? parseFileAnswer(data[s.key] as never) : null;
                    const text = cellText(s, data, timeZone);
                    return (
                      <td
                        key={s.key}
                        data-cell
                        data-answer-key={s.key}
                        className={`${TD} truncate transition-colors hover:bg-primary/10 in-data-sheet:whitespace-normal`}
                        style={questionWidth(i, true)}
                        title={text}
                      >
                        {file ? (
                          <SubmissionFileButton
                            formId={id}
                            submissionId={row.id}
                            stepKey={s.key}
                            name={file.name}
                            labels={fileLabels}
                          />
                        ) : (
                          <span className="in-data-sheet:line-clamp-3">{text || m.submissions.na}</span>
                        )}
                      </td>
                    );
                  })}
                  {/* Its own padding, not TD's: a notch less on top so the taller pill
                      lines up with the first line of the row, and room on the right
                      so it does not sit against the table edge. */}
                  <td className="whitespace-nowrap border-b border-border py-2.5 pl-4 pr-5 text-right group-last:border-b-0">
                    <DeleteSubmissionButton
                      formId={id}
                      submissionId={row.id}
                      labels={{ delete: m.submissions.delete, confirm: m.submissions.deleteConfirm }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </ResponsesViewer>
    </div>
  );
}
