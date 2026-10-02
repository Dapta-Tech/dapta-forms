"use client";

import Link from "next/link";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/cn";
import { CopyLinkIcon } from "@/components/copy-link";
import { PublishChip } from "@/components/ui/publish-chip";
import type { Folder, FormSummary } from "@/lib/admin-api";
import type { MatchRange } from "@/lib/forms-search";
import { FormRowActions, type FormRowActionLabels } from "./form-row-actions";

/**
 * The list is a table drawn with a grid, not a `<table>`: every row is still a
 * draggable `<li>`, and a `<tr>` can be neither. From `xl` up the
 * cells sit in these lanes; the header row in the explorer uses the SAME
 * template, which is what keeps the headings over their columns. Narrower than
 * that, a row is a wrapping flex line and the header is gone.
 *
 * The breakpoints are the viewport's, set with the rail in mind: it takes
 * 240px when open, so the table is that much narrower than the window. `xl`
 * leaves the name lane about 300px with the rail open. Container queries would
 * say this more directly, but a query container contains layout in the
 * browsers that have not caught up with the spec, and that re-anchors the
 * fixed-position dialogs rendered inside the list.
 *
 * The lanes are fixed widths on purpose. `auto` would size each row's lane to
 * its own content, and the header (whose last cell is empty) would drift. The
 * date lane is the first to go: below 85rem (1360px, written in rem so it sorts after `xl`) it rides on the path line instead.
 */
export const ROW_GRID =
  "xl:grid xl:grid-cols-[minmax(0,1fr)_10.5rem_5.5rem_9.5rem_10.5rem] xl:gap-x-4 min-[85rem]:grid-cols-[minmax(0,1fr)_10.5rem_5.5rem_9.5rem_6.5rem_10.5rem]";

/** First-class row actions (user feedback: nothing hidden behind the kebab).
 *  Every destination the row had is still on the row: Edit and Connect as
 *  buttons, Submissions and Analytics as the two figures (icon-only while the
 *  table is too narrow for columns, where no heading would explain them), the public link
 *  as the path itself, and the kebab for Duplicate/Move/Delete. Tokens only. */
const editBtn =
  "inline-flex h-8 shrink-0 items-center rounded-full border border-input px-3.5 text-sm font-medium text-foreground transition-colors hover:border-foreground hover:bg-foreground hover:text-background active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const iconBtn =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
/** A figure that is also the way in: a bordered icon button in the narrow
 *  layout, a plain cell that underlines on hover in the table. */
const cellLink =
  "group/cell inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:w-auto xl:justify-start xl:gap-2 xl:rounded-sm xl:border-0 xl:hover:bg-transparent";

export interface FormRowLabels {
  edit: string;
  submissions: string;
  analytics: string;
  connect: string;
  copy: string;
  copied: string;
  openForm: string;
  dragHandle: string;
  statusLive: string;
  statusLiveHint: string;
  statusUnpublished: string;
  statusUnpublishedHint: string;
  /** "{n}%", the completion figure. */
  completionValue: string;
  /** The completion cell when there is no rate to show. */
  noCompletion: string;
}

/** What a row knows about its form's traffic; absent when it could not be read. */
export interface FormRowStats {
  submissions: number;
  /** Percentage, or null when nobody has started the form (no denominator). */
  completionRate: number | null;
}

/** The name with the matched ranges wrapped in `<mark>`. */
export function Highlight({
  text,
  ranges,
}: {
  text: string;
  ranges: MatchRange[];
}) {
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([start, end], i) => {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark key={i} className="rounded-sm bg-primary/25 px-0.5 text-inherit">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/**
 * One form in the list. Every `data-testid` the card row had is still here, on
 * an element that does the same thing, so the e2e that pins the row still finds
 * it; folders add a drag grip (listeners on the grip ONLY, so the links and
 * buttons keep working as links and buttons) and a "Move to folder" entry in
 * the kebab.
 */
export function FormRow({
  form,
  publicPath,
  updatedLabel,
  nameRanges,
  folders,
  labels,
  actionLabels,
  onMove,
  stats,
  draggable = true,
}: {
  form: FormSummary;
  publicPath: string;
  /** The already-formatted date of the last edit. */
  updatedLabel: string;
  nameRanges: MatchRange[];
  folders: Folder[];
  labels: FormRowLabels;
  actionLabels: FormRowActionLabels;
  onMove: (formId: string, folderId: string | null) => void;
  /** Responses and completion; absent = not known, and the cells say so in words. */
  stats?: FormRowStats;
  draggable?: boolean;
}) {
  const editHref = `/admin/forms/${form.id}/edit`;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: form.id,
    data: { type: "form", name: form.name },
    disabled: !draggable,
  });
  const rate = stats?.completionRate ?? null;
  // Without figures the two cells fall back to the NAME of where they lead, so
  // they are never an empty link.
  const submissionsText = stats ? String(stats.submissions) : labels.submissions;
  const completionText = !stats
    ? labels.analytics
    : rate == null
      ? labels.noCompletion
      : labels.completionValue.replace("{n}", String(Math.round(rate)));
  const submissionsName = stats ? `${labels.submissions}: ${stats.submissions}` : labels.submissions;
  const analyticsName = stats && rate != null ? `${labels.analytics}: ${completionText}` : labels.analytics;
  return (
    <li
      ref={setNodeRef}
      data-testid="form-row"
      data-form-id={form.id}
      style={{
        transform: transform
          ? CSS.Translate.toString({ ...transform, x: 0, y: 0 })
          : undefined,
      }}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3 transition-colors hover:bg-sidebar",
        ROW_GRID,
        isDragging && "opacity-40",
      )}
    >
      <div className="flex min-w-0 basis-full items-center gap-2">
        {draggable ? (
          <button
            ref={setActivatorNodeRef}
            type="button"
            data-testid="form-row-grip"
            aria-label={labels.dragHandle}
            title={labels.dragHandle}
            className="-ml-2 flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-faint transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            {...attributes}
            {...listeners}
          >
            <i aria-hidden className="pi pi-bars" style={{ fontSize: 13 }} />
          </button>
        ) : null}
        <div className="min-w-0">
          <Link
            href={editHref}
            data-form-link
            className="block w-fit max-w-full truncate font-medium text-foreground hover:underline"
          >
            <Highlight text={form.name} ranges={nameRanges} />
          </Link>
          {/* The public path is the link to the form itself, with its copy
              button beside it: the two things someone does with an address.
              The date rides on this line while its column is gone. */}
          <p className="flex min-w-0 items-center gap-1 text-xs text-faint">
            {updatedLabel ? (
              <span className="shrink-0 min-[85rem]:hidden">
                {updatedLabel}
                <span aria-hidden> ·</span>
              </span>
            ) : null}
            <a
              data-testid="form-row-open"
              href={publicPath}
              target="_blank"
              rel="noreferrer"
              title={publicPath}
              aria-label={`${labels.openForm}: ${publicPath}`}
              className="min-w-0 truncate rounded-sm hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {publicPath}
            </a>
            <CopyLinkIcon
              path={publicPath}
              labels={{ copy: labels.copy, copied: labels.copied }}
              testId="form-row-copy"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </p>
        </div>
      </div>

      {/* Present even when empty: in the table it is a grid lane, and a missing
          cell would pull every later one a column to the left. */}
      <div className={cn("flex min-w-0 items-center", typeof form.hasDraft !== "boolean" && "hidden xl:flex")}>
        {typeof form.hasDraft === "boolean" ? (
          <PublishChip hasDraft={form.hasDraft} labels={labels} testId="form-row-status" />
        ) : null}
      </div>

      <Link
        data-testid="form-row-submissions"
        href={`/admin/forms/${form.id}/submissions`}
        className={cellLink}
        aria-label={submissionsName}
        title={submissionsName}
      >
        <i aria-hidden className="pi pi-inbox xl:!hidden" style={{ fontSize: 13 }} />
        <span
          className={cn(
            "hidden text-sm tabular-nums group-hover/cell:underline xl:inline",
            stats && stats.submissions === 0 && "text-faint",
          )}
        >
          {submissionsText}
        </span>
      </Link>

      <Link
        data-testid="form-row-analytics"
        href={`/admin/forms/${form.id}/analytics`}
        className={cellLink}
        aria-label={analyticsName}
        title={analyticsName}
      >
        <i aria-hidden className="pi pi-chart-bar xl:!hidden" style={{ fontSize: 13 }} />
        <span
          className={cn(
            "hidden text-sm tabular-nums group-hover/cell:underline xl:inline",
            rate == null ? "text-faint" : "w-10 shrink-0",
          )}
        >
          {completionText}
        </span>
        {/* Progress, in the signal: the one saturated mark the figures get. A
            track under it so a low rate still reads as a bar. */}
        {rate == null ? null : (
          <b aria-hidden className="hidden h-1 w-16 overflow-hidden rounded-full bg-muted xl:block">
            <b className="block h-full rounded-full bg-signal-edge" style={{ width: `${Math.min(100, rate)}%` }} />
          </b>
        )}
      </Link>

      <span className="hidden truncate text-xs text-faint min-[85rem]:block">{updatedLabel}</span>

      <div className="flex shrink-0 items-center justify-end gap-1">
        <Link data-testid="form-row-edit" href={editHref} className={editBtn} title={labels.edit}>
          {labels.edit}
        </Link>
        <Link
          data-testid="form-row-connect"
          href={`${editHref}?tab=connect`}
          className={iconBtn}
          aria-label={labels.connect}
          title={labels.connect}
        >
          <i aria-hidden className="pi pi-link" style={{ fontSize: 14 }} />
        </Link>
        <FormRowActions
          id={form.id}
          labels={actionLabels}
          folders={folders}
          currentFolderId={form.folderId}
          onMove={(folderId) => onMove(form.id, folderId)}
        />
      </div>
    </li>
  );
}
