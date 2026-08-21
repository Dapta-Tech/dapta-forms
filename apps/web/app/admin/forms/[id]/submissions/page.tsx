import { Suspense } from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { FormConfig, SubmissionsPage } from '@quill/types';
import { getMessages, t, type FormsMessages, type Locale } from '@quill/shared';
import { adminApi, ApiError } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { FormTabs } from '@/components/ui/form-tabs';
import { Skeleton } from '@/components/skeleton';
import { SubmissionsFilter } from './submissions-filter';
import { DeleteSubmissionButton } from './row-actions';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

type SP = { status?: string; offset?: string };

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
        <SubmissionsFilter
          labels={{
            all: m.submissions.statusAll,
            completed: m.submissions.statusCompleted,
            partial: m.submissions.statusPartial,
          }}
        />
      </div>

      <Suspense key={key} fallback={<Skeleton className="h-80 w-full" />}>
        <SubmissionsData id={id} status={status} offset={offset} locale={locale} m={m} />
      </Suspense>
    </div>
  );
}

/** Flatten one answer value for a table cell. */
function formatCell(v: unknown, na: string): string {
  if (v == null || v === '') return na;
  if (Array.isArray(v)) return v.length ? v.join(', ') : na;
  if (typeof v === 'boolean') return v ? '✓' : '';
  return String(v);
}

async function SubmissionsData({
  id,
  status,
  offset,
  locale,
  m,
}: {
  id: string;
  status: 'all' | 'completed' | 'partial';
  offset: number;
  locale: Locale;
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

  const steps = (form.config as FormConfig).steps ?? [];

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

  return (
    <div className="flex flex-col gap-4">
      {/* Horizontal scroll lives INSIDE this container (themed scrollbar, global);
          the page body never scrolls sideways even with many step columns. */}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-2xs uppercase tracking-wide text-faint">
              <th className="whitespace-nowrap px-4 py-3 font-medium">{m.submissions.colSubmitted}</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">{m.submissions.colStatus}</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-medium">{m.submissions.colScore}</th>
              {steps.map((s) => (
                <th key={s.key} className="whitespace-nowrap px-4 py-3 font-medium">
                  {s.question?.trim() || s.key}
                </th>
              ))}
              <th className="px-4 py-3" aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {page.items.map((row) => {
              const completed = row.completedAt != null;
              const when = row.completedAt ?? row.partialAt ?? row.startedAt;
              const data = (row.data ?? {}) as Record<string, unknown>;
              return (
                <tr key={row.id} className="border-b border-border last:border-b-0 align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {new Date(when).toLocaleString(locale)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span
                      className={
                        completed
                          ? 'inline-flex items-center gap-1.5 rounded-full bg-primary/20 px-2.5 py-0.5 text-xs font-medium text-foreground'
                          : 'inline-flex items-center gap-1.5 rounded-full bg-secondary/20 px-2.5 py-0.5 text-xs font-medium text-foreground'
                      }
                    >
                      <span
                        aria-hidden
                        className={`h-1.5 w-1.5 rounded-full ${completed ? 'bg-primary-edge' : 'bg-secondary'}`}
                      />
                      {completed ? m.submissions.badgeCompleted : m.submissions.badgePartial}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{row.score}</td>
                  {steps.map((s) => (
                    <td key={s.key} className="max-w-[240px] truncate px-4 py-3" title={formatCell(data[s.key], '')}>
                      {formatCell(data[s.key], m.submissions.na)}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-4 py-3 text-right">
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

      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground tabular-nums">
          {t(m.submissions.showing, { from, to, total: page.total })}
        </span>
        <div className="flex items-center gap-2">
          {hasPrev ? (
            <Link
              href={`?${statusParam}offset=${Math.max(0, offset - page.limit)}`}
              scroll={false}
              className="inline-flex h-9 items-center rounded-md border border-border px-3 font-medium text-foreground transition-colors hover:bg-accent"
            >
              {m.submissions.prev}
            </Link>
          ) : (
            <span className="inline-flex h-9 cursor-not-allowed items-center rounded-md border border-border px-3 font-medium text-muted-foreground opacity-50">
              {m.submissions.prev}
            </span>
          )}
          {hasNext ? (
            <Link
              href={`?${statusParam}offset=${offset + page.limit}`}
              scroll={false}
              className="inline-flex h-9 items-center rounded-md border border-border px-3 font-medium text-foreground transition-colors hover:bg-accent"
            >
              {m.submissions.next}
            </Link>
          ) : (
            <span className="inline-flex h-9 cursor-not-allowed items-center rounded-md border border-border px-3 font-medium text-muted-foreground opacity-50">
              {m.submissions.next}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
