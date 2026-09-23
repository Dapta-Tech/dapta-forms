'use client';

/**
 * Multi-select on the submissions table: a checkbox per row, one in the header
 * for the whole page, and a bar that acts on the selection (export it, delete
 * it, clear it).
 *
 * The rows are server-rendered; the checkboxes are the only client pieces in
 * them, and they read one selection held by `ResponsesViewer`. A selection is
 * per page: the viewer is remounted on a page, size or filter change, and ids
 * that left the page (deleted) drop out of it on their own.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { t } from '@quill/shared';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { callAction, isTransportError } from '@/lib/call-action';
import { deleteSubmissionsAction } from './actions';

export interface SelectionLabels {
  /** "{n} selected" */
  selectedCount: string;
  selectedCountOne: string;
  exportSelected: string;
  delete: string;
  clearSelection: string;
  /** "Delete {n} responses?" */
  bulkDeleteTitle: string;
  bulkDeleteTitleOne: string;
  bulkDeleteBody: string;
  bulkDeleteFailed: string;
}

interface Selection {
  /** The selected ids, in page order. */
  ids: string[];
  has: (id: string) => boolean;
  toggle: (id: string, on: boolean) => void;
  /** Every row on the page, or none. */
  setPage: (on: boolean) => void;
  clear: () => void;
  pageSize: number;
}

const SelectionContext = createContext<Selection | null>(null);
export const SelectionProvider = SelectionContext.Provider;

/**
 * The selection over one page of rows. Held as a set, but read through the
 * page: an id that is no longer on it (deleted here or elsewhere) is simply
 * not selected any more.
 */
export function useSelection(pageIds: string[]): Selection {
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const ids = useMemo(() => pageIds.filter((id) => picked.has(id)), [pageIds, picked]);
  const toggle = useCallback((id: string, on: boolean) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const setPage = useCallback((on: boolean) => setPicked(new Set(on ? pageIds : [])), [pageIds]);
  const clear = useCallback(() => setPicked(new Set()), []);
  return useMemo(
    () => ({
      ids,
      has: (id) => ids.includes(id),
      toggle,
      setPage,
      clear,
      pageSize: pageIds.length,
    }),
    [ids, toggle, setPage, clear, pageIds.length],
  );
}

const CHECKBOX = 'size-4 cursor-pointer rounded-sm accent-primary-edge';

/**
 * One row's checkbox. The label covers the whole cell (the cell is sticky, so
 * it positions the label), so a click anywhere in it toggles the row instead
 * of opening the panel: the viewer ignores clicks on labels and inputs. A
 * plain block label stops at its own height, and a tall row's lower half
 * opened the panel.
 */
export function RowSelect({ id, label }: { id: string; label: string }) {
  const selection = useContext(SelectionContext);
  if (!selection) return null;
  return (
    <label className="absolute inset-0 flex cursor-pointer justify-center pt-3.5">
      <input
        type="checkbox"
        data-row-select
        aria-label={label}
        className={CHECKBOX}
        checked={selection.has(id)}
        onChange={(e) => selection.toggle(id, e.target.checked)}
      />
    </label>
  );
}

/** The header checkbox: the whole page on or off, mixed while only some rows are on. */
export function PageSelect({ label }: { label: string }) {
  const selection = useContext(SelectionContext);
  const ref = useRef<HTMLInputElement>(null);
  const count = selection?.ids.length ?? 0;
  const all = selection != null && selection.pageSize > 0 && count === selection.pageSize;
  const some = count > 0 && !all;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some;
  }, [some]);
  if (!selection) return null;
  return (
    <label className="flex cursor-pointer justify-center px-3.5 py-0.5">
      <input
        ref={ref}
        type="checkbox"
        data-page-select
        aria-label={label}
        className={CHECKBOX}
        checked={all}
        onChange={(e) => selection.setPage(e.target.checked)}
      />
    </label>
  );
}

const BAR_BUTTON =
  'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

/**
 * "3 selected · Export CSV · Delete · Clear". Nothing at all without a
 * selection. Export is a plain link to the CSV route with `?ids=`, so the file
 * is the same as the full export, only shorter.
 *
 * One line always: in the sheet the bar takes the top bar's place beside the
 * close button, so on a phone Export and Clear drop to their icons (named for
 * screen readers and on hover) rather than wrap out of it.
 */
export function SelectionBar({ formId, labels }: { formId: string; labels: SelectionLabels }) {
  const selection = useContext(SelectionContext);
  const { confirm, dialog } = useConfirmDialog();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const count = selection?.ids.length ?? 0;
  // A new selection is a new attempt: the old failure no longer describes it.
  useEffect(() => setFailed(false), [count]);
  if (!selection || count === 0) return dialog;

  const ids = selection.ids;
  const onDelete = () => {
    void confirm({
      title: count === 1 ? labels.bulkDeleteTitleOne : t(labels.bulkDeleteTitle, { n: count }),
      message: labels.bulkDeleteBody,
      confirmLabel: labels.delete,
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      start(async () => {
        const res = await callAction(() => deleteSubmissionsAction(formId, ids));
        if (isTransportError(res) || !res.ok) setFailed(true);
        else selection.clear();
      });
    });
  };

  // The confirm is a sibling of the bar, not inside it: the bar animates in,
  // and a transformed ancestor would trap the confirm's `position: fixed`.
  return (
    <>
      <div
        role="toolbar"
        aria-label={count === 1 ? labels.selectedCountOne : t(labels.selectedCount, { n: count })}
        data-testid="selection-bar"
        className="flex min-w-0 animate-response-in items-center gap-1"
      >
        <span
          className="mr-1 whitespace-nowrap text-sm font-semibold tabular-nums"
          data-testid="selection-count"
        >
          {count === 1 ? labels.selectedCountOne : t(labels.selectedCount, { n: count })}
        </span>
        <a
          href={`/admin/forms/${formId}/submissions/export?ids=${ids.map(encodeURIComponent).join(',')}`}
          data-testid="selection-export"
          aria-label={labels.exportSelected}
          title={labels.exportSelected}
          className={`${BAR_BUTTON} text-foreground hover:bg-accent`}
        >
          <i aria-hidden className="pi pi-download" style={{ fontSize: 12 }} />
          <span className="hidden sm:inline">{labels.exportSelected}</span>
        </a>
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          data-testid="selection-delete"
          className={`${BAR_BUTTON} text-destructive hover:bg-destructive/10`}
        >
          <i aria-hidden className="pi pi-trash" style={{ fontSize: 12 }} />
          {labels.delete}
        </button>
        <button
          type="button"
          onClick={selection.clear}
          data-testid="selection-clear"
          aria-label={labels.clearSelection}
          title={labels.clearSelection}
          className={`${BAR_BUTTON} text-muted-foreground hover:bg-accent hover:text-foreground`}
        >
          <i aria-hidden className="pi pi-times" style={{ fontSize: 11 }} />
          <span className="hidden sm:inline">{labels.clearSelection}</span>
        </button>
        {failed ? (
          <span role="alert" className="ml-1 min-w-0 truncate text-sm text-destructive">
            {labels.bulkDeleteFailed}
          </span>
        ) : null}
      </div>
      {dialog}
    </>
  );
}
