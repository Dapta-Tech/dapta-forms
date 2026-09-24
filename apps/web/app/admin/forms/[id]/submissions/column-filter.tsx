'use client';

/**
 * Filtering and sorting from the table's column headings, like a spreadsheet.
 *
 * Every filterable column carries a funnel button right after its heading
 * text; the whole heading opens the same menu. The menu is not drawn inside
 * the table: the heading sits in a scrolling container in the sheet, which
 * would clip it, so it goes through the portal of `AnchoredMenu` (a bottom
 * sheet on a phone).
 *
 * The menu, and the filter it edits, live in `FilterHost`, which the page
 * renders OUTSIDE the table's keyed Suspense. That is deliberate: a filter
 * applies as it is checked, the rows change, and the table remounts (its key
 * is its rows, the #193 fix). A menu inside the table would close on every
 * check. The host keeps it open and re-anchors it to the heading's new button
 * once that mounts; each heading's button registers itself for that.
 *
 * Everything is in the address bar (see `filters.ts`), written through the
 * router so the server page fetches the filtered rows. While that navigation
 * is in flight the host shows the filter as the person just set it, so a
 * second check builds on the first rather than on the page still on screen.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { t, type FormsMessages } from '@quill/shared';
import { AnchoredMenu } from '@/components/ui/anchored-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { useDialogA11y } from '@/components/modal';
import { formatIsoDate } from '@/lib/calendar-math';
import {
  EMPTY_FILTER,
  hasDateFilter,
  hasScoreFilter,
  isCustomized,
  isFiltered,
  queryString,
  RANGE_PRESETS,
  STATUSES,
  withFilter,
  type RangePreset,
  type SortKey,
  type StatusKey,
  type ViewFilter,
} from './filters';
import type { FilterColumn, FilterOption } from './filter-columns';

export type FilterLabels = FormsMessages['admin']['submissions']['filters'] & {
  completed: string;
  partial: string;
};

interface Host {
  /** The filter on screen: the one just set while its navigation runs, else the page's. */
  filter: ViewFilter;
  pending: boolean;
  columns: ReadonlyMap<string, FilterColumn>;
  openId: string | null;
  toggle: (id: string) => void;
  /** A heading's button, mounted (`el`) or gone (null); the menu re-anchors to it. */
  attach: (id: string, el: HTMLButtonElement) => () => void;
  update: (next: ViewFilter) => void;
  labels: FilterLabels;
  locale: string;
}

const HostContext = createContext<Host | null>(null);

/** Below this width the menu opens as a sheet from the bottom of the screen. */
const PHONE_QUERY = '(max-width: 639px)';

/** A choice menu gets a search box past this many options. */
const SEARCH_FROM = 8;

export function FilterHost({
  columns,
  filter,
  statusCounts,
  total,
  labels,
  locale,
  children,
}: {
  columns: FilterColumn[];
  filter: ViewFilter;
  /** Completed and partial, over every response: the Status menu's counts. */
  statusCounts: { completed: number; partial: number };
  /** Every response of the form. */
  total: number;
  labels: FilterLabels;
  locale: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<ViewFilter | null>(null);
  const shown = pending && draft ? draft : filter;
  useEffect(() => {
    if (!pending) setDraft(null);
  }, [pending]);

  const [openId, setOpenId] = useState<string | null>(null);
  const [phone, setPhone] = useState(false);
  const anchors = useRef(new Map<string, HTMLButtonElement>());
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  // A new ref object per anchor element, so the menu re-places itself (and
  // re-arms its outside-click and focus handling) when the table remounts.
  const anchorRef = useMemo(() => ({ current: anchor }), [anchor]);
  const openRef = useRef(openId);
  openRef.current = openId;

  const byId = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);

  const attach = useCallback((id: string, el: HTMLButtonElement) => {
    anchors.current.set(id, el);
    if (openRef.current === id) setAnchor(el);
    return () => {
      if (anchors.current.get(id) === el) anchors.current.delete(id);
      // Keep the last position while the table is between two renders: a null
      // anchor is never measured, so the menu stays where it was.
      if (openRef.current === id) setAnchor((prev) => (prev === el ? null : prev));
    };
  }, []);

  const close = useCallback(() => setOpenId(null), []);

  const toggle = useCallback((id: string) => {
    if (openRef.current === id) {
      setOpenId(null);
      return;
    }
    setPhone(window.matchMedia(PHONE_QUERY).matches);
    setAnchor(anchors.current.get(id) ?? null);
    setOpenId(id);
  }, []);

  const update = useCallback(
    (next: ViewFilter) => {
      setDraft(next);
      const url = `${window.location.pathname}${queryString(withFilter(window.location.search, next))}`;
      start(() => router.push(url, { scroll: false }));
    },
    [router],
  );

  const host = useMemo<Host>(
    () => ({
      filter: shown,
      pending,
      columns: byId,
      openId,
      toggle,
      attach,
      update,
      labels,
      locale,
    }),
    [shown, pending, byId, openId, toggle, attach, update, labels, locale],
  );

  const column = openId ? byId.get(openId) : undefined;
  const body = column ? (
    <MenuBody column={column} statusCounts={statusCounts} total={total} onClose={close} />
  ) : null;

  return (
    <HostContext.Provider value={host}>
      {children}
      {column && !phone ? (
        <AnchoredMenu
          anchorRef={anchorRef}
          open
          onClose={close}
          label={column.label}
          role="dialog"
          width={column.kind === 'choice' ? 300 : 288}
          testId="filter-menu"
          className="overflow-x-hidden"
          onKeyDown={trapTab}
        >
          {body}
        </AnchoredMenu>
      ) : null}
      {column && phone ? (
        <BottomSheet label={column.label} onClose={close}>
          {body}
        </BottomSheet>
      ) : null}
    </HostContext.Provider>
  );
}

function useHost(): Host | null {
  return useContext(HostContext);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Tab stays inside the open menu. It is portalled to the end of the page, so
 * the next Tab after its last control would leave for the browser's chrome.
 */
function trapTab(e: KeyboardEvent<HTMLDivElement>): void {
  if (e.key !== 'Tab') return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null,
  );
  if (items.length === 0) return;
  const at = items.indexOf(document.activeElement as HTMLElement);
  e.preventDefault();
  const next = at < 0 ? 0 : (at + (e.shiftKey ? items.length - 1 : 1)) % items.length;
  items[next]!.focus();
}

/** The phone's version of the menu: a sheet up from the bottom, a real modal dialog. */
function BottomSheet({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useDialogA11y(mounted, panelRef, rootRef, onClose);
  if (!mounted) return null;
  return createPortal(
    <div ref={rootRef} className="fixed inset-0 z-[55]" data-filter-sheet="">
      <div
        aria-hidden
        className="absolute inset-0 animate-backdrop-in bg-black/50"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-testid="filter-menu"
        className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col overflow-y-auto rounded-t-2xl border-t border-border bg-popover pb-[env(safe-area-inset-bottom)] text-popover-foreground shadow-lg"
      >
        <span aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-border" />
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** How many filters a column has on: checked options, statuses, or 1 for a window or a score range. */
function activeCount(column: FilterColumn, f: ViewFilter): number {
  switch (column.kind) {
    case 'choice':
      return f.answers[column.key]?.length ?? 0;
    case 'status':
      return f.statuses.length;
    case 'date':
      return hasDateFilter(f) ? 1 : 0;
    case 'score':
      return hasScoreFilter(f) ? 1 : 0;
  }
}

/** The sort this column is ordering the table by, when it is not the default. */
function columnSort(column: FilterColumn, f: ViewFilter): 'asc' | 'desc' | null {
  if (column.kind === 'date' && f.sort === 'oldest') return 'asc';
  if (column.kind === 'score' && f.sort === 'score_desc') return 'desc';
  if (column.kind === 'score' && f.sort === 'score_asc') return 'asc';
  return null;
}

/** The column's filter (and its sort) removed from `f`. */
function withoutColumn(column: FilterColumn, f: ViewFilter): ViewFilter {
  switch (column.kind) {
    case 'choice': {
      const answers = { ...f.answers };
      delete answers[column.key];
      return { ...f, answers };
    }
    case 'status':
      return { ...f, statuses: [] };
    case 'date':
      return {
        ...f,
        preset: null,
        from: null,
        to: null,
        sort: f.sort === 'oldest' ? 'newest' : f.sort,
      };
    case 'score':
      return {
        ...f,
        scoreMin: null,
        scoreMax: null,
        sort: f.sort.startsWith('score') ? 'newest' : f.sort,
      };
  }
}

/**
 * The funnel after a heading's text. Idle: small and muted. Hover anywhere on
 * the heading: the accent. On: a filled lime pill with the count, and the
 * sort's arrow when this column orders the table.
 */
export function FilterTrigger({ columnId }: { columnId: string }) {
  const host = useHost();
  const column = host?.columns.get(columnId);
  // `attach` is stable, so the button registers once per element it mounts.
  const attach = host?.attach;
  const ref = useCallback(
    (el: HTMLButtonElement | null) => (el && attach ? attach(columnId, el) : undefined),
    [columnId, attach],
  );
  if (!host || !column) return null;
  const n = activeCount(column, host.filter);
  const sort = columnSort(column, host.filter);
  const open = host.openId === columnId;
  const name =
    n === 1
      ? t(host.labels.filterColumnActiveOne, { column: column.label })
      : n > 1
        ? t(host.labels.filterColumnActive, { column: column.label, n })
        : t(host.labels.filterColumn, { column: column.label });
  const on = n > 0 || sort != null;
  return (
    <button
      ref={ref}
      type="button"
      data-filter-trigger={columnId}
      data-active={on ? '' : undefined}
      data-testid="filter-trigger"
      aria-label={name}
      title={name}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={(e) => {
        e.stopPropagation();
        host.toggle(columnId);
      }}
      className={
        on
          ? 'inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-primary px-1.5 text-primary-foreground transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95'
          : `inline-flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors hover:text-primary focus-visible:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/filter:text-primary ${
              open ? 'text-primary' : 'text-faint'
            }`
      }
    >
      {sort ? (
        <i
          aria-hidden
          className={`pi ${sort === 'asc' ? 'pi-sort-amount-up-alt' : 'pi-sort-amount-down'}`}
          style={{ fontSize: 9 }}
        />
      ) : null}
      {n > 0 || !sort ? (
        <i
          aria-hidden
          className={`pi ${n > 0 ? 'pi-filter-fill' : 'pi-filter'}`}
          style={{ fontSize: n > 0 ? 9 : 10 }}
        />
      ) : null}
      {n > 0 ? <span className="text-2xs font-semibold leading-none tabular-nums">{n}</span> : null}
    </button>
  );
}

/**
 * A heading cell that filters: the text, the funnel right after it, and the
 * whole cell as the click target (a heading is a small thing to hit). A click
 * on the column's resize handle stays the handle's.
 */
export function FilterTh({
  columnId,
  className,
  style,
  align = 'start',
  children,
  extra,
}: {
  columnId: string;
  className: string;
  style?: CSSProperties;
  align?: 'start' | 'end';
  children: ReactNode;
  /** Drawn after the heading's content, outside its flex row (the resize handle). */
  extra?: ReactNode;
}) {
  const host = useHost();
  const filterable = host?.columns.has(columnId) ?? false;
  const onClick = (e: MouseEvent<HTMLTableCellElement>) => {
    if (!host || !filterable) return;
    if ((e.target as Element).closest('[data-testid="column-resize"], [data-filter-trigger]'))
      return;
    if (window.getSelection()?.toString()) return;
    host.toggle(columnId);
  };
  return (
    <th
      className={
        filterable
          ? `${className} group/filter cursor-pointer select-none transition-colors hover:bg-accent`
          : className
      }
      style={style}
      onClick={onClick}
      data-filter-column={filterable ? columnId : undefined}
    >
      <span className={`flex items-start gap-1.5 ${align === 'end' ? 'justify-end' : ''}`}>
        <span className="min-w-0">{children}</span>
        {filterable ? <FilterTrigger columnId={columnId} /> : null}
      </span>
      {extra}
    </th>
  );
}

// --- The menus -------------------------------------------------------------

const SECTION_TITLE = 'px-3 pb-1.5 pt-3 text-2xs font-medium uppercase tracking-wide text-faint';
const OPTION_ROW =
  'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none';

function MenuBody({
  column,
  statusCounts,
  total,
  onClose,
}: {
  column: FilterColumn;
  statusCounts: { completed: number; partial: number };
  total: number;
  onClose: () => void;
}) {
  const host = useHost()!;
  const { filter: f, labels } = host;
  const rootRef = useRef<HTMLDivElement>(null);
  const cleared = withoutColumn(column, f);
  const canClear = activeCount(column, f) > 0 || columnSort(column, f) != null;
  // Clear starts the menu's fields over: a score typed and not yet applied
  // is dropped with its pending wait, not applied on top of the cleared filter.
  const [clears, setClears] = useState(0);

  // The first control takes the focus once the panel is on screen (it is
  // hidden for the frame it is measured in, and a hidden element ignores focus).
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() =>
        rootRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus(),
      );
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [column.id]);

  return (
    <div ref={rootRef} className="flex flex-col" aria-busy={host.pending || undefined}>
      <div className="flex items-center justify-between gap-2 border-b border-border py-2 pl-3 pr-2">
        <p className="min-w-0 truncate text-sm font-semibold">{column.label}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label={labels.close}
          title={labels.close}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <i aria-hidden className="pi pi-times" style={{ fontSize: 11 }} />
        </button>
      </div>
      {column.kind === 'choice' ? (
        <ChoiceMenu
          options={column.options}
          label={column.label}
          selected={f.answers[column.key] ?? []}
          onChange={(values) =>
            host.update({ ...f, answers: withAnswer(f.answers, column.key, values) })
          }
        />
      ) : column.kind === 'status' ? (
        <StatusMenu counts={statusCounts} total={total} />
      ) : column.kind === 'date' ? (
        <DateMenu key={clears} />
      ) : (
        <ScoreMenu key={clears} />
      )}
      <div className="flex items-center justify-end border-t border-border px-2 py-2">
        <button
          type="button"
          disabled={!canClear}
          onClick={() => {
            setClears((n) => n + 1);
            host.update(cleared);
          }}
          data-testid="filter-clear"
          className="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
        >
          {labels.clear}
        </button>
      </div>
    </div>
  );
}

function withAnswer(
  answers: Record<string, string[]>,
  key: string,
  values: string[],
): Record<string, string[]> {
  const next = { ...answers };
  if (values.length > 0) next[key] = values;
  else delete next[key];
  return next;
}

/** One option's count and its thin share bar. */
function Share({ count, percent }: { count: number; percent: number }) {
  return (
    <span className="flex w-16 shrink-0 flex-col items-end gap-1">
      <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
      <span aria-hidden className="block h-1 w-full overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full bg-primary-edge"
          style={{ width: `${percent}%` }}
        />
      </span>
    </span>
  );
}

function ChoiceMenu({
  options,
  label,
  selected,
  onChange,
}: {
  options: FilterOption[];
  label: string;
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const { labels } = useHost()!;
  const [query, setQuery] = useState('');
  const searchId = useId();
  // A checked value no response carries any more still shows, at zero, so it
  // can be unchecked.
  const all = useMemo(() => {
    const known = new Set(options.map((o) => o.value));
    const extra = selected
      .filter((v) => !known.has(v))
      .map((v) => ({ value: v, label: v, count: 0, percent: 0 }));
    return [...options, ...extra];
  }, [options, selected]);
  const q = query.trim().toLowerCase();
  const shown = q ? all.filter((o) => o.label.toLowerCase().includes(q)) : all;
  const toggle = (value: string, on: boolean) =>
    onChange(
      on ? [...selected.filter((v) => v !== value), value] : selected.filter((v) => v !== value),
    );

  return (
    <div className="flex min-h-0 flex-col">
      {all.length > SEARCH_FROM ? (
        <div className="relative px-3 pt-3">
          <i
            aria-hidden
            className="pi pi-search pointer-events-none absolute left-5.5 top-1/2 mt-1.5 -translate-y-1/2 text-muted-foreground"
            style={{ fontSize: 11 }}
          />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={labels.searchOptions}
            placeholder={labels.searchOptions}
            autoComplete="off"
            data-testid="filter-search"
            className="h-8 w-full rounded-md border border-input bg-background pl-7 pr-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      ) : null}
      <div role="group" aria-label={label} className="max-h-80 overflow-y-auto p-1.5">
        {shown.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">{labels.noOptions}</p>
        ) : (
          shown.map((o) => (
            <label
              key={o.value}
              className={OPTION_ROW}
              data-testid="filter-option"
              data-value={o.value}
            >
              <Checkbox
                checked={selected.includes(o.value)}
                onChange={(e) => toggle(o.value, e.target.checked)}
              />
              <span className="min-w-0 flex-1 break-words">{o.label}</span>
              <Share count={o.count} percent={o.percent} />
            </label>
          ))
        )}
      </div>
    </div>
  );
}

function StatusMenu({
  counts,
  total,
}: {
  counts: { completed: number; partial: number };
  total: number;
}) {
  const host = useHost()!;
  const { filter: f, labels } = host;
  const toggle = (st: StatusKey, on: boolean) => {
    const next = on ? [...f.statuses, st] : f.statuses.filter((s) => s !== st);
    host.update({ ...f, statuses: STATUSES.filter((s) => next.includes(s)) });
  };
  return (
    <div role="group" aria-label={host.columns.get('status')?.label} className="p-1.5">
      {STATUSES.map((st) => {
        const count = counts[st];
        return (
          <label key={st} className={OPTION_ROW} data-testid="filter-option" data-value={st}>
            <Checkbox
              checked={f.statuses.includes(st)}
              onChange={(e) => toggle(st, e.target.checked)}
            />
            <span className="min-w-0 flex-1">
              {st === 'completed' ? labels.completed : labels.partial}
            </span>
            <Share count={count} percent={total > 0 ? Math.round((count / total) * 100) : 0} />
          </label>
        );
      })}
    </div>
  );
}

/** A choice among a few, drawn as a list of rows with a check on the one that is on. */
function PickRow({
  on,
  onClick,
  icon,
  children,
  testId,
}: {
  on: boolean;
  onClick: () => void;
  icon?: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      data-testid={testId}
      className={OPTION_ROW}
    >
      {icon ? (
        <i
          aria-hidden
          className={`pi ${icon} w-4 text-center text-muted-foreground`}
          style={{ fontSize: 12 }}
        />
      ) : null}
      <span className={`min-w-0 flex-1 ${on ? 'font-semibold text-foreground' : ''}`}>
        {children}
      </span>
      <i
        aria-hidden
        className={`pi pi-check text-primary transition-opacity ${on ? 'opacity-100' : 'opacity-0'}`}
        style={{ fontSize: 11 }}
      />
    </button>
  );
}

function SortSection({ options }: { options: { sort: SortKey; label: string; icon: string }[] }) {
  const host = useHost()!;
  const { filter: f, labels } = host;
  return (
    <div role="group" aria-label={labels.sortTitle}>
      <p className={SECTION_TITLE}>{labels.sortTitle}</p>
      <div className="px-1.5">
        {options.map((o) => (
          <PickRow
            key={o.sort}
            on={f.sort === o.sort}
            icon={o.icon}
            testId={`filter-sort-${o.sort}`}
            // Picking the order already on hands the table back to newest first.
            onClick={() => host.update({ ...f, sort: f.sort === o.sort ? 'newest' : o.sort })}
          >
            {o.label}
          </PickRow>
        ))}
      </div>
    </div>
  );
}

const PRESET_LABEL: Record<RangePreset, keyof FilterLabels> = {
  today: 'rangeToday',
  '7d': 'range7d',
  '30d': 'range30d',
};

function DateMenu() {
  const host = useHost()!;
  const { filter: f, labels, locale } = host;
  const [custom, setCustom] = useState(f.from != null || f.to != null);
  return (
    <div className="pb-1.5">
      <SortSection
        options={[
          { sort: 'newest', label: labels.sortNewest, icon: 'pi-sort-amount-down' },
          { sort: 'oldest', label: labels.sortOldest, icon: 'pi-sort-amount-up-alt' },
        ]}
      />
      <div role="group" aria-label={labels.rangeCustom} className="mt-1 border-t border-border">
        <p className={SECTION_TITLE}>{labels.rangeTitle}</p>
        <div className="px-1.5">
          {RANGE_PRESETS.map((p) => (
            <PickRow
              key={p}
              on={f.preset === p}
              testId={`filter-range-${p}`}
              onClick={() =>
                host.update({ ...f, preset: f.preset === p ? null : p, from: null, to: null })
              }
            >
              {labels[PRESET_LABEL[p]]}
            </PickRow>
          ))}
          <PickRow
            on={custom && f.preset == null}
            testId="filter-range-custom"
            onClick={() => {
              setCustom(true);
              if (f.preset) host.update({ ...f, preset: null });
            }}
          >
            {labels.rangeCustom}
          </PickRow>
        </div>
        {custom && f.preset == null ? (
          <div className="grid gap-2 px-3 pb-1 pt-2">
            <DatePicker
              value={f.from ?? ''}
              max={f.to ?? undefined}
              onChange={(v) => host.update({ ...f, preset: null, from: v || null })}
              locale={locale}
              placeholder={labels.rangeFrom}
              ariaLabel={labels.rangeFrom}
              testId="filter-from"
            />
            <DatePicker
              value={f.to ?? ''}
              min={f.from ?? undefined}
              onChange={(v) => host.update({ ...f, preset: null, to: v || null })}
              locale={locale}
              placeholder={labels.rangeTo}
              ariaLabel={labels.rangeTo}
              testId="filter-to"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Wait this long after the last keystroke in a score field before filtering. */
const SCORE_DEBOUNCE_MS = 500;

function ScoreMenu() {
  const host = useHost()!;
  const { filter: f, labels } = host;
  const text = (n: number | null) => (n == null ? '' : String(n));
  const [min, setMin] = useState(text(f.scoreMin));
  const [max, setMax] = useState(text(f.scoreMax));
  // The bounds this menu last applied, to tell its own change coming back
  // from one made elsewhere (the menu's Clear, a chip's x, Clear all).
  const [sent, setSent] = useState<[number | null, number | null]>([f.scoreMin, f.scoreMax]);
  const [seen, setSeen] = useState<[number | null, number | null]>([f.scoreMin, f.scoreMax]);
  if (seen[0] !== f.scoreMin || seen[1] !== f.scoreMax) {
    setSeen([f.scoreMin, f.scoreMax]);
    if (sent[0] !== f.scoreMin || sent[1] !== f.scoreMax) {
      // Changed elsewhere: the fields follow, and what they said is dropped.
      setMin(text(f.scoreMin));
      setMax(text(f.scoreMax));
      setSent([f.scoreMin, f.scoreMax]);
    }
  }
  const latest = useRef(f);
  latest.current = f;
  const fields = useRef({ min, max });
  fields.current = { min, max };
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Applied once the typing pauses, or at once on Enter. Only typing starts
  // the wait, and it applies what the fields say when it ends: a filter
  // changed meanwhile (the Clear above the fields) is never undone by it.
  const commit = () => {
    window.clearTimeout(timer.current);
    const num = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v));
    const cur = latest.current;
    const scoreMin = num(fields.current.min);
    const scoreMax = num(fields.current.max);
    if (scoreMin === cur.scoreMin && scoreMax === cur.scoreMax) return;
    setSent([scoreMin, scoreMax]);
    host.update({ ...cur, scoreMin, scoreMax });
  };
  const type = (set: (v: string) => void) => (e: ChangeEvent<HTMLInputElement>) => {
    set(e.target.value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(commit, SCORE_DEBOUNCE_MS);
  };

  const field =
    'h-9 w-full rounded-md border border-input bg-background px-3 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
  };
  return (
    <div className="pb-2">
      <SortSection
        options={[
          { sort: 'score_desc', label: labels.sortScoreDesc, icon: 'pi-sort-amount-down' },
          { sort: 'score_asc', label: labels.sortScoreAsc, icon: 'pi-sort-amount-up-alt' },
        ]}
      />
      <div role="group" aria-label={labels.scoreRange} className="mt-1 border-t border-border">
        <p className={SECTION_TITLE}>{labels.scoreRange}</p>
        <div className="grid grid-cols-2 items-center gap-2 px-3">
          <input
            type="number"
            inputMode="decimal"
            value={min}
            onChange={type(setMin)}
            onKeyDown={onEnter}
            aria-label={labels.scoreMin}
            placeholder={labels.scoreMin}
            data-testid="filter-score-min"
            className={field}
          />
          <input
            type="number"
            inputMode="decimal"
            value={max}
            onChange={type(setMax)}
            onKeyDown={onEnter}
            aria-label={labels.scoreMax}
            placeholder={labels.scoreMax}
            data-testid="filter-score-max"
            className={field}
          />
        </div>
      </div>
    </div>
  );
}

// --- Above the table ---------------------------------------------------------

interface Chip {
  id: string;
  column: string;
  value: string;
  without: ViewFilter;
}

function scoreText(f: ViewFilter, labels: FilterLabels): string {
  if (f.scoreMin != null && f.scoreMax != null)
    return t(labels.chipBetween, { from: f.scoreMin, to: f.scoreMax });
  if (f.scoreMin != null) return t(labels.chipAtLeast, { min: f.scoreMin });
  return t(labels.chipAtMost, { max: f.scoreMax ?? '' });
}

function dateText(f: ViewFilter, labels: FilterLabels, locale: string): string {
  if (f.preset) return labels[PRESET_LABEL[f.preset]];
  const from = f.from ? formatIsoDate(f.from, locale) : null;
  const to = f.to ? formatIsoDate(f.to, locale) : null;
  if (from && to) return t(labels.chipBetween, { from, to });
  if (from) return t(labels.chipFrom, { from });
  return t(labels.chipUntil, { to: to ?? '' });
}

function chipsOf(host: Host): Chip[] {
  const { filter: f, labels, locale, columns } = host;
  const out: Chip[] = [];
  const col = (id: string) => columns.get(id);
  const date = col('date');
  const score = col('score');
  const status = col('status');
  if (date && hasDateFilter(f)) {
    out.push({
      id: 'date',
      column: date.label,
      value: dateText(f, labels, locale),
      without: { ...f, preset: null, from: null, to: null },
    });
  }
  if (status && f.statuses.length > 0) {
    out.push({
      id: 'status',
      column: status.label,
      value: f.statuses
        .map((s) => (s === 'completed' ? labels.completed : labels.partial))
        .join(', '),
      without: { ...f, statuses: [] },
    });
  }
  if (score && hasScoreFilter(f)) {
    out.push({
      id: 'score',
      column: score.label,
      value: scoreText(f, labels),
      without: { ...f, scoreMin: null, scoreMax: null },
    });
  }
  for (const c of columns.values()) {
    if (c.kind !== 'choice') continue;
    const values = f.answers[c.key];
    if (!values?.length) continue;
    const label = (v: string) => c.options.find((o) => o.value === v)?.label ?? v;
    out.push({
      id: c.id,
      column: c.label,
      value: values.map(label).join(', '),
      without: { ...f, answers: withAnswer(f.answers, c.key, []) },
    });
  }
  if (f.sort !== 'newest') {
    const sortLabel: Record<SortKey, string> = {
      newest: labels.sortNewest,
      oldest: labels.sortOldest,
      score_desc: `${score?.label ?? ''} · ${labels.sortScoreDesc}`,
      score_asc: `${score?.label ?? ''} · ${labels.sortScoreAsc}`,
    };
    out.push({
      id: 'sort',
      column: labels.sortTitle,
      value: sortLabel[f.sort],
      without: { ...f, sort: 'newest' },
    });
  }
  return out;
}

/**
 * What the view is filtered by, one removable chip per column (and the sort
 * when it is not newest first), how many responses are left of how many, and
 * "Clear all". Nothing at all on the plain view. "Clear all" also resets the
 * sort, which only the table uses.
 */
export function FilterBar({
  shown,
  total,
  sorted = true,
}: {
  shown: number;
  total: number;
  /** False where the rows are not listed in order (the Summary): no sort chip there. */
  sorted?: boolean;
}) {
  const host = useHost();
  if (!host) return null;
  if (!(sorted ? isCustomized(host.filter) : isFiltered(host.filter))) return null;
  const { labels } = host;
  const chips = chipsOf(host).filter((c) => sorted || c.id !== 'sort');
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-2"
      data-testid="filter-bar"
      aria-busy={host.pending || undefined}
    >
      <ul aria-label={labels.chipsLabel} className="contents">
        {chips.map((c) => {
          const text = `${c.column}: ${c.value}`;
          return (
            <li
              key={c.id}
              data-testid="filter-chip"
              data-chip={c.id}
              className="inline-flex h-7 max-w-full items-center gap-1 rounded-full border border-primary-edge/40 bg-primary/10 pl-3 pr-1 text-xs"
            >
              <span className="min-w-0 truncate">
                <span className="text-muted-foreground">{c.column}: </span>
                <span className="font-semibold text-foreground">{c.value}</span>
              </span>
              <button
                type="button"
                onClick={() => host.update(c.without)}
                aria-label={t(labels.removeChip, { filter: text })}
                title={t(labels.removeChip, { filter: text })}
                data-testid="filter-chip-remove"
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <i aria-hidden className="pi pi-times" style={{ fontSize: 9 }} />
              </button>
            </li>
          );
        })}
      </ul>
      {isFiltered(host.filter) ? (
        <span className="text-xs tabular-nums text-muted-foreground" data-testid="filter-count">
          {t(labels.showing, { n: shown, total })}
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => host.update(EMPTY_FILTER)}
        data-testid="filter-clear-all"
        className="inline-flex h-7 items-center rounded-md px-2 text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {labels.clearAll}
      </button>
      {host.pending ? (
        <i aria-hidden className="pi pi-spin pi-spinner text-faint" style={{ fontSize: 12 }} />
      ) : null}
    </div>
  );
}

/** "Clear all" on its own, for the filtered empty state. */
export function ClearFiltersButton() {
  const host = useHost();
  if (!host) return null;
  return (
    <button
      type="button"
      onClick={() => host.update(EMPTY_FILTER)}
      data-testid="filter-empty-clear"
      className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {host.labels.clearAll}
    </button>
  );
}
