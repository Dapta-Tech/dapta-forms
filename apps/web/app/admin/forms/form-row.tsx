"use client";

import Link from "next/link";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/cn";
import { CopyLinkIcon } from "@/components/copy-link";
import type { Folder, FormSummary } from "@/lib/admin-api";
import type { MatchRange } from "@/lib/forms-search";
import { FormRowActions, type FormRowActionLabels } from "./form-row-actions";

/** First-class row actions (user feedback: nothing hidden behind the kebab).
 *  Secondary buttons collapse to icon-only below `md`; the aria-label/title
 *  keep them nameable; the kebab holds Duplicate/Move/Delete. Tokens only. */
const primaryBtn =
  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const secondaryBtn =
  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-transparent px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const iconBtn =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export interface FormRowLabels {
  updated: string;
  edit: string;
  submissions: string;
  analytics: string;
  connect: string;
  copy: string;
  copied: string;
  openForm: string;
  dragHandle: string;
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
 * One form in the list. The markup (and every `data-testid`) is exactly what
 * the flat list rendered before folders existed, so the e2e that pins the row
 * still finds it; folders add a drag grip (listeners on the grip ONLY, so the
 * links and buttons keep working as links and buttons) and a "Move to folder"
 * entry in the kebab.
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
  draggable = true,
}: {
  form: FormSummary;
  publicPath: string;
  /** The already-formatted "Updated {when}" line. */
  updatedLabel: string;
  nameRanges: MatchRange[];
  folders: Folder[];
  labels: FormRowLabels;
  actionLabels: FormRowActionLabels;
  onMove: (formId: string, folderId: string | null) => void;
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
        "flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-border bg-card px-5 py-4 transition-colors hover:border-primary-edge/60",
        isDragging && "opacity-40",
      )}
    >
      {draggable ? (
        <button
          ref={setActivatorNodeRef}
          type="button"
          data-testid="form-row-grip"
          aria-label={labels.dragHandle}
          title={labels.dragHandle}
          className="flex h-9 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-faint transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          {...attributes}
          {...listeners}
        >
          <i aria-hidden className="pi pi-bars" style={{ fontSize: 14 }} />
        </button>
      ) : null}
      <div className="min-w-0 flex-1 basis-60">
        <Link
          href={editHref}
          data-form-link
          className="block w-fit max-w-full truncate text-base font-semibold tracking-tight transition-colors hover:text-primary"
        >
          <Highlight text={form.name} ranges={nameRanges} />
        </Link>
        {/* The row's two facts are not equally interesting. The public path is
            what someone came here to copy, so it keeps the body tier; the
            timestamp and the separator drop to `text-faint`. */}
        <p className="mt-0.5 flex min-w-0 items-center gap-2 text-xs">
          <span className="shrink-0 text-faint">{updatedLabel}</span>
          <span aria-hidden className="shrink-0 text-faint">
            ·
          </span>
          <span
            className="min-w-0 truncate font-mono text-muted-foreground"
            title={publicPath}
          >
            {publicPath}
          </span>
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <Link
          data-testid="form-row-edit"
          href={editHref}
          className={primaryBtn}
          title={labels.edit}
        >
          <i aria-hidden className="pi pi-pencil" style={{ fontSize: 13 }} />
          {labels.edit}
        </Link>
        <Link
          data-testid="form-row-submissions"
          href={`/admin/forms/${form.id}/submissions`}
          className={secondaryBtn}
          aria-label={labels.submissions}
          title={labels.submissions}
        >
          <i aria-hidden className="pi pi-inbox" style={{ fontSize: 13 }} />
          <span className="hidden md:inline">{labels.submissions}</span>
        </Link>
        <Link
          data-testid="form-row-analytics"
          href={`/admin/forms/${form.id}/analytics`}
          className={secondaryBtn}
          aria-label={labels.analytics}
          title={labels.analytics}
        >
          <i aria-hidden className="pi pi-chart-bar" style={{ fontSize: 13 }} />
          <span className="hidden md:inline">{labels.analytics}</span>
        </Link>
        <Link
          data-testid="form-row-connect"
          href={`${editHref}?tab=connect`}
          className={secondaryBtn}
          aria-label={labels.connect}
          title={labels.connect}
        >
          <i aria-hidden className="pi pi-link" style={{ fontSize: 13 }} />
          <span className="hidden md:inline">{labels.connect}</span>
        </Link>
        <CopyLinkIcon
          path={publicPath}
          labels={{ copy: labels.copy, copied: labels.copied }}
          testId="form-row-copy"
          className={iconBtn}
        />
        <a
          data-testid="form-row-open"
          href={publicPath}
          target="_blank"
          rel="noreferrer"
          className={iconBtn}
          aria-label={labels.openForm}
          title={labels.openForm}
        >
          <i
            aria-hidden
            className="pi pi-external-link"
            style={{ fontSize: 14 }}
          />
        </a>
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
