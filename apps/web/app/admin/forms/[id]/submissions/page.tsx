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
import { SubmissionsFilter } from './submissions-filter';
import { DeleteSubmissionButton } from './row-actions';
import { SubmissionFileButton } from './submission-file-button';
import { buildResponseDetail } from './response-detail';
import { PagerLink, ResponsesViewer } from './response-panel';
import { SHEET_VIEW } from './viewer-params';
import { StatusBadge } from './status-badge';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

/**
 * Header and body cell chrome. The table is `border-separate` rather than
 * `border-collapse` because a collapsed border belongs to the table, not the
 * cell, and scrolls away from a sticky header or first column; so the row
 * rule is drawn on each cell instead. The header ground is opaque for the
 * same reason: in the sheet it stays put over the rows scrolling under it.
 */
const TH =
  'sticky top-0 z-10 whitespace-nowrap border-b border-border bg-card px-4 py-3 font-medium in-data-sheet:align-bottom in-data-sheet:shadow-[0_1px_0_var(--color-border)]';
const TD = 'border-b border-border px-4 py-3 group-last:border-b-0';

type SP = { status?: string; offset?: string; response?: string; view?: string };

function parseStatus(v: string | undefined): 'all' | 'completed' | 'partial' {
  return v === 'completed' || v === 'partial' ? v : 'all';
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
  const status = parseStatus(sp.status);
  const offset = Math.max(0, Number(sp.offset ?? 0) || 0);
  const key = `${status}:${offset}`;
  // The workspace zone every timestamp below is read in, and who may change it.
  const me = await adminApi.me();
  const timeZone = me.timezone ?? 'UTC';

  const exportQuery = status === 'all' ? '' : `?status=${status}`;

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-8">
      <FormTabs formId={id} active="submissions" labels={m.nav} />
      <div className="mb-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{m.submissions.title}</h1>
            <p className="mt-1 text-muted-foreground">{m.submissions.subtitle}</p>
          </div>
          <a
            href={`/admin/forms/${id}/submissions/export${exportQuery}`}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-transparent px-4 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
          >
            <i aria-hidden className="pi pi-download" style={{ fontSize: 13 }} />
            {m.submissions.export}
          </a>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SubmissionsFilter
            labels={{
              all: m.submissions.statusAll,
              completed: m.submissions.statusCompleted,
              partial: m.submissions.statusPartial,
            }}
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

      <Suspense key={key} fallback={<Skeleton className="h-80 w-full" />}>
        <SubmissionsData
          id={id}
          status={status}
          offset={offset}
          locale={locale}
          timeZone={timeZone}
          responseId={sp.response}
          sheet={sp.view === SHEET_VIEW}
          m={m}
        />
      </Suspense>
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

async function SubmissionsData({
  id,
  status,
  offset,
  locale,
  timeZone,
  responseId,
  sheet,
  m,
}: {
  id: string;
  status: 'all' | 'completed' | 'partial';
  offset: number;
  locale: Locale;
  timeZone: string;
  /** `?response=`: the response to open in the panel on load. */
  responseId?: string;
  /** `?view=sheet`: open the table as the full-screen sheet on load. */
  sheet: boolean;
  m: FormsMessages['admin'];
}) {
  let form: Awaited<ReturnType<typeof adminApi.getForm>>;
  let page: SubmissionsPage;
  try {
    [form, page] = await Promise.all([
      adminApi.getForm(id),
      adminApi.listSubmissions(id, { status, limit: PAGE_SIZE, offset }),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  const config = form.config as FormConfig;
  // Message and reveal steps collect nothing: no column, as in the CSV.
  const steps = (config.steps ?? []).filter((s) => !isInputlessStep(s));
  // Score only exists when the form scores, as in the CSV.
  const scoring = config.scoring?.enabled !== false;

  if (page.total === 0) {
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
  if (offset >= page.total) {
    const lastOffset = Math.floor((page.total - 1) / page.limit) * page.limit;
    const q = new URLSearchParams();
    if (status !== 'all') q.set('status', status);
    if (lastOffset > 0) q.set('offset', String(lastOffset));
    const query = q.toString();
    redirect(`/admin/forms/${id}/submissions${query ? `?${query}` : ''}`);
  }

  const from = offset + 1;
  const to = Math.min(offset + page.items.length, page.total);
  const hasPrev = offset > 0;
  const hasNext = offset + page.limit < page.total;
  const statusParam = status === 'all' ? '' : `status=${status}&`;
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
  // A form that collects a contact leads each row with who answered; one that
  // does not leads with when, as before.
  const hasContact = steps.some((s) => s.type === 'name' || s.type === 'email' || s.type === 'phone');
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
        title={form.name}
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
        }}
        pager={
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground tabular-nums">
              {t(m.submissions.showing, { from, to, total: page.total })}
            </span>
            <div className="flex items-center gap-2">
              {hasPrev ? (
                <PagerLink href={`?${statusParam}offset=${Math.max(0, offset - page.limit)}`} className={pagerButton}>
                  {m.submissions.prev}
                </PagerLink>
              ) : (
                <span className={pagerOff}>{m.submissions.prev}</span>
              )}
              {hasNext ? (
                <PagerLink href={`?${statusParam}offset=${offset + page.limit}`} className={pagerButton}>
                  {m.submissions.next}
                </PagerLink>
              ) : (
                <span className={pagerOff}>{m.submissions.next}</span>
              )}
            </div>
          </div>
        }
      >
        {/* In the sheet (`data-sheet` on the viewer) this container takes the
            screen and scrolls both ways, under a header that stays put and
            beside a first column that stays put. */}
        <div className="overflow-x-auto rounded-lg border border-border bg-card in-data-sheet:min-h-0 in-data-sheet:overflow-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-2xs uppercase tracking-wide text-faint">
              <th className={`${TH} sticky left-0 z-20 shadow-[1px_0_0_var(--color-border)]`}>
                {hasContact ? m.submissions.colResponse : m.submissions.colSubmitted}
              </th>
              <th className={TH}>{m.submissions.colStatus}</th>
              {scoring ? <th className={`${TH} text-right`}>{m.submissions.colScore}</th> : null}
              {steps.map((s) => (
                <th
                  key={s.key}
                  className={`${TH} in-data-sheet:min-w-56 in-data-sheet:max-w-80 in-data-sheet:whitespace-normal`}
                >
                  {stepLabel(s)}
                </th>
              ))}
              <th className={TH} aria-label="actions" />
            </tr>
          </thead>
          <tbody>
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
                  className="group cursor-pointer align-top transition-colors hover:bg-accent/70 data-active:bg-primary/10 data-active:hover:bg-primary/15"
                >
                  {/* Sticky, so it needs an opaque ground: the card colour, with the
                      row's hover or active tint laid over it as an image. The lime
                      bar on its left edge marks the response open in the panel. */}
                  <td
                    className={`${TD} sticky left-0 z-1 whitespace-nowrap bg-card shadow-[1px_0_0_var(--color-border)] before:absolute before:inset-y-0 before:left-0 before:w-0.75 group-hover:bg-linear-to-r group-hover:from-accent/70 group-hover:to-accent/70 group-data-active:bg-linear-to-r group-data-active:from-primary/10 group-data-active:to-primary/10 group-data-active:before:bg-primary`}
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
                  <td className={`${TD} whitespace-nowrap`}>
                    <StatusBadge
                      completed={completed}
                      label={completed ? m.submissions.badgeCompleted : m.submissions.badgePartial}
                    />
                  </td>
                  {scoring ? (
                    <td className={`${TD} whitespace-nowrap text-right tabular-nums`}>{row.score}</td>
                  ) : null}
                  {steps.map((s) => {
                    // A file cell is the one answer that is not text: it opens
                    // the thing rather than describing it.
                    const file = s.type === 'file' ? parseFileAnswer(data[s.key] as never) : null;
                    const text = cellText(s, data, timeZone);
                    return (
                      <td
                        key={s.key}
                        data-answer-key={s.key}
                        className={`${TD} max-w-[240px] truncate transition-colors hover:bg-primary/10 in-data-sheet:max-w-80 in-data-sheet:whitespace-normal`}
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
                  <td className={`${TD} whitespace-nowrap text-right`}>
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
