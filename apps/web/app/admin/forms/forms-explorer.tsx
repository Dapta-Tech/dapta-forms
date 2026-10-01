"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { getMessages, t } from "@quill/shared";
import { cn } from "@/lib/cn";
import { callAction } from "@/lib/call-action";
import { publicFormPath } from "@/lib/public-form-path";
import { clientLocale } from "@/lib/client-locale";
import {
  groupBySections,
  normalize,
  type FormSection,
} from "@/lib/forms-search";
import { useGlobalShortcut } from "@/lib/use-global-shortcut";
import type { Folder, FormSummary } from "@/lib/admin-api";
import { useToast } from "@/components/toast";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { SearchClearButton } from "@/components/ui/search-clear-button";
import { CreateForm } from "./create-form";
import { FolderDialog, type FolderDialogLabels } from "./folder-dialog";
import { FormRow, ROW_GRID, type FormRowLabels, type FormRowStats } from "./form-row";
import type { FormRowActionLabels } from "./form-row-actions";
import { deleteFolderAction, moveFormAction } from "./folder-actions";

/** Per-viewer collapse state (never shared: how you fold your list is yours). */
const COLLAPSED_KEY = "forms.folders.collapsed";

/** dnd-kit droppable ids: the folder id, or this marker for Unfiled. */
const UNFILED = "__unfiled__";

export interface FormsExplorerLabels {
  searchPlaceholder: string;
  searchLabel: string;
  searchClear: string;
  searchEmpty: string;
  searchResults: string;
  searchShortcut: string;
  unfiled: string;
  folderCount: string;
  folderCountOne: string;
  renameFolder: string;
  deleteFolder: string;
  deleteFolderConfirm: string;
  folderMenu: string;
  collapse: string;
  expand: string;
  createIn: string;
  moveFailed: string;
  dropHere: string;
  colForm: string;
  colStatus: string;
  colSubmissions: string;
  colCompletion: string;
  colUpdated: string;
}

export interface FormsExplorerProps {
  forms: FormSummary[];
  folders: Folder[];
  accountCode: string;
  locale: string;
  /** The already-formatted date of the last edit, per form id (formatted on the server, one clock). */
  updatedByForm: Record<string, string>;
  /** Responses and completion per form id; a form missing here shows no figures. */
  statsByForm?: Record<string, FormRowStats>;
  /** The page title block, set to the left of the search box. */
  heading?: React.ReactNode;
  /** The page's buttons (new folder, create form), set to the right of it. */
  actions?: React.ReactNode;
  labels: FormsExplorerLabels;
  rowLabels: FormRowLabels;
  actionLabels: FormRowActionLabels;
  dialogLabels: FolderDialogLabels;
  createLabels: React.ComponentProps<typeof CreateForm>["labels"];
}

/**
 * The forms list with folders and search. ONE table: every folder is a
 * collapsible band inside it (Unfiled first), rows drag onto a band, the
 * kebab's "Move to folder" is the keyboard-only route to the same move, and
 * the search box filters the loaded list by name or slug, expanding the
 * sections with a hit and hiding the rest. Without folders it is a plain
 * table with no bands.
 *
 * The frame is deliberately NOT `overflow-hidden`: a row's kebab menu hangs
 * below its row, and on the last row that is below the frame. The corners are
 * rounded piece by piece instead (the header, the last row, a collapsed last
 * band).
 */
export function FormsExplorer(props: FormsExplorerProps) {
  const { forms, folders, labels } = props;
  const router = useRouter();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [overrides, setOverrides] = useState<Map<string, string | null>>(
    () => new Map(),
  );
  const [dragging, setDragging] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [, start] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dndId = useId();

  // Collapse state is read AFTER mount: the server cannot know this viewer's
  // localStorage, and reading it during render would hydrate to a mismatch.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_KEY);
      if (raw) setCollapsed(new Set(JSON.parse(raw) as string[]));
    } catch {
      // No storage, or a stale value: everything starts expanded.
    }
  }, []);

  // Fresh server data supersedes an optimistic move once it SHOWS that move;
  // one still in flight keeps its override, so two moves in a row do not
  // snap the second back while the first refresh lands.
  useEffect(() => {
    setOverrides((prev) => {
      const next = new Map([...prev].filter(([id, folderId]) => forms.find((f) => f.id === id)?.folderId !== folderId));
      return next.size === prev.size ? prev : next;
    });
  }, [forms]);

  const effectiveForms = useMemo(
    () =>
      forms.map((f) =>
        overrides.has(f.id)
          ? { ...f, folderId: overrides.get(f.id) ?? null }
          : f,
      ),
    [forms, overrides],
  );
  const sections = useMemo(
    () => groupBySections(effectiveForms, folders, query),
    [effectiveForms, folders, query],
  );
  const searching = normalize(query).length > 0;
  const matches = sections.reduce((n, s) => n + s.forms.length, 0);

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        // Best effort only.
      }
      return next;
    });
  };

  const move = useCallback(
    (formId: string, folderId: string | null) => {
      const current =
        effectiveForms.find((f) => f.id === formId)?.folderId ?? null;
      if (current === folderId) return;
      setOverrides((prev) => new Map(prev).set(formId, folderId));
      start(async () => {
        const res = await callAction(() => moveFormAction(formId, folderId));
        if (res && "ok" in res && res.ok) {
          router.refresh();
        } else {
          setOverrides((prev) => {
            const next = new Map(prev);
            next.delete(formId);
            return next;
          });
          toast.error(labels.moveFailed);
        }
      });
    },
    [effectiveForms, router, toast, labels.moveFailed],
  );

  // Cmd/Ctrl+K and `/` focus the search box from anywhere on the page.
  useGlobalShortcut(
    useCallback((shortcut) => {
      if (shortcut === "search") searchRef.current?.focus();
    }, []),
  );

  // Roving focus over the VISIBLE row titles: arrows walk them, Enter opens
  // (a link). Keys inside a dialog, a menu or a listbox belong to that widget.
  function onListKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], input, textarea, select'))
      return;
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("ul:not([hidden]) [data-form-link]") ?? [],
    );
    if (items.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const at = active ? items.indexOf(active) : -1;
    e.preventDefault();
    if (e.key === "ArrowDown")
      items[at < 0 || at === items.length - 1 ? 0 : at + 1]?.focus();
    else if (at <= 0) searchRef.current?.focus();
    else items[at - 1]?.focus();
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  // Prefer the section the pointer is actually inside; a row dragged past every
  // section edge still snaps to the nearest one rather than nowhere.
  const collision: CollisionDetection = (args) => {
    const within = pointerWithin(args);
    return within.length > 0 ? within : rectIntersection(args);
  };
  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as { name?: string } | undefined;
    setDragging({ id: String(e.active.id), name: data?.name ?? "" });
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const over = e.over?.id;
    if (over == null) return;
    move(String(e.active.id), over === UNFILED ? null : String(over));
  };

  const searchId = useId();
  // The chord's glyph follows the platform; read after mount (the server has no platform).
  const [shortcutLabel, setShortcutLabel] = useState(labels.searchShortcut);
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform)) setShortcutLabel('\u2318 K');
  }, []);
  const flat = folders.length === 0;
  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        {props.heading ?? <span />}
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="relative w-full sm:w-72">
            <i
              aria-hidden
              className="pi pi-search pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              style={{ fontSize: 13 }}
            />
            <input
              ref={searchRef}
              id={searchId}
              type="search"
              value={query}
              data-testid="forms-search"
              aria-label={labels.searchLabel}
              placeholder={labels.searchPlaceholder}
              autoComplete="off"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  if (query) setQuery("");
                  else searchRef.current?.blur();
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  listRef.current
                    ?.querySelector<HTMLElement>("ul:not([hidden]) [data-form-link]")
                    ?.focus();
                }
              }}
              className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-20 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-2xs text-faint">
              {query ? null : (
                <kbd className="rounded border border-border bg-sidebar px-1.5 py-0.5 font-sans">
                  {shortcutLabel}
                </kbd>
              )}
            </span>
            <SearchClearButton
              query={query}
              label={labels.searchClear}
              testId="forms-search-clear"
              onClear={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
            />
          </div>
          {props.actions}
        </div>
      </div>
      <p
        role="status"
        aria-live="polite"
        className={cn(
          "-mt-3 mb-3 text-xs text-muted-foreground",
          !searching && "sr-only",
        )}
      >
        {searching ? t(labels.searchResults, { count: matches }) : ""}
      </p>

      <div
        ref={listRef}
        onKeyDown={onListKeyDown}
        data-testid="forms-table"
        className="divide-y divide-border rounded-2xl border border-border bg-card [&>:last-child_li:last-child]:rounded-b-[15px]"
      >
        {/* Column headings, on the rows' own grid. Decorative to a screen
            reader: each cell below already names itself. */}
        <div
          aria-hidden
          className={cn(
            "hidden items-center rounded-t-[15px] bg-sidebar px-5 py-2.5 text-xs font-medium uppercase tracking-wider text-faint",
            ROW_GRID,
          )}
        >
          <span>{labels.colForm}</span>
          <span>{labels.colStatus}</span>
          <span>{labels.colSubmissions}</span>
          <span>{labels.colCompletion}</span>
          <span className="hidden min-[85rem]:block">{labels.colUpdated}</span>
          <span />
        </div>
        {searching && matches === 0 ? (
          <p
            data-testid="forms-search-empty"
            className="px-5 py-12 text-center text-sm text-muted-foreground"
          >
            {labels.searchEmpty}
          </p>
        ) : null}
        {flat && !searching && sections[0] ? (
          /* No folders yet: a plain table, no bands, no grip. */
          <ul role="list" className="divide-y divide-border">
            {sections[0].forms.map((f) => (
              <FormRow
                key={f.id}
                form={f}
                publicPath={publicFormPath(props.accountCode, f.slug)}
                updatedLabel={props.updatedByForm[f.id] ?? ''}
                stats={props.statsByForm?.[f.id]}
                nameRanges={f.match.nameRanges}
                folders={folders}
                labels={props.rowLabels}
                actionLabels={props.actionLabels}
                onMove={move}
                draggable={false}
              />
            ))}
          </ul>
        ) : null}
        {(flat && !searching ? [] : sections).map((section, i, all) => (
          <FolderSection
            key={section.id ?? UNFILED}
            section={section}
            last={i === all.length - 1}
            expanded={searching || !collapsed.has(section.id ?? UNFILED)}
            onToggle={() => toggle(section.id ?? UNFILED)}
            onMove={move}
            dragging={dragging != null}
            {...props}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <div className="rounded-xl border border-primary-edge bg-card px-5 py-3 text-sm font-semibold shadow-lg">
            {dragging.name}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function FolderSection({
  section,
  expanded,
  onToggle,
  onMove,
  dragging,
  last,
  folders,
  accountCode,
  locale,
  updatedByForm,
  statsByForm,
  labels,
  rowLabels,
  actionLabels,
  dialogLabels,
  createLabels,
}: FormsExplorerProps & {
  section: FormSection<FormSummary>;
  expanded: boolean;
  onToggle: () => void;
  onMove: (formId: string, folderId: string | null) => void;
  dragging: boolean;
  /** The last band in the table, which has to carry the frame's bottom corners when nothing is under it. */
  last: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const { confirm: confirmDialog, dialog } = useConfirmDialog();
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [, start] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const listId = useId();
  const droppableId = section.id ?? UNFILED;
  const { setNodeRef, isOver } = useDroppable({
    id: droppableId,
    data: { type: "folder" },
  });
  const isFolder = section.id != null;
  const name = section.name ?? labels.unfiled;
  const count =
    section.total === 1
      ? labels.folderCountOne
      : t(labels.folderCount, { count: section.total });

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const remove = async () => {
    setMenuOpen(false);
    const ok = await confirmDialog({
      title: getMessages(clientLocale()).dialog.deleteFolderTitle,
      message: t(labels.deleteFolderConfirm, { name, forms: count }),
      confirmLabel: labels.deleteFolder,
      destructive: true,
    });
    if (!ok || !section.id) return;
    const id = section.id;
    start(async () => {
      const res = await callAction(() => deleteFolderAction(id));
      if (res && "ok" in res && res.ok) router.refresh();
      else toast.error(dialogLabels.actionFailed);
    });
  };

  const itemClass =
    "flex w-full items-center gap-2.5 rounded-sm px-2 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none";

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      data-testid={isFolder ? "folder-section" : "unfiled-section"}
      data-folder-id={section.id ?? ""}
      className={cn(
        "transition-colors",
        dragging && "outline outline-1 -outline-offset-1 outline-dashed outline-input",
        isOver && "bg-primary/10 outline-primary-edge",
        last && "rounded-b-[15px]",
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 bg-sidebar px-5 py-1.5",
          isOver && "bg-transparent",
          last && (!expanded || section.forms.length === 0) && "rounded-b-[15px]",
        )}
      >
        <button
          type="button"
          id={headingId}
          aria-expanded={expanded}
          aria-controls={listId}
          data-testid="folder-toggle"
          onClick={onToggle}
          title={expanded ? labels.collapse : labels.expand}
          className="flex min-w-0 items-center gap-2 rounded-md py-1 pr-2 text-left text-sm font-semibold text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <i
            aria-hidden
            className={cn(
              "pi text-muted-foreground",
              expanded ? "pi-chevron-down" : "pi-chevron-right",
            )}
            style={{ fontSize: 11 }}
          />
          <i
            aria-hidden
            className={cn(
              "pi text-muted-foreground",
              isFolder ? "pi-folder" : "pi-inbox",
            )}
            style={{ fontSize: 14 }}
          />
          <span className="truncate">{name}</span>
          <span
            data-testid="folder-count"
            className="rounded-full border border-border bg-card px-2 py-0.5 text-2xs font-medium text-muted-foreground"
          >
            {count}
          </span>
          {isOver ? (
            <span className="text-2xs text-primary">{labels.dropHere}</span>
          ) : null}
        </button>
        <div className="flex items-center gap-1">
          <CreateForm
            labels={createLabels}
            variant="outline"
            size="sm"
            triggerLabel={labels.createIn}
            folders={folders}
            defaultFolderId={section.id}
            locale={locale}
          />
          {isFolder ? (
            <div ref={menuRef} className="relative">
              <button
                type="button"
                data-testid="folder-menu"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={labels.folderMenu}
                title={labels.folderMenu}
                onClick={() => setMenuOpen((o) => !o)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <i
                  aria-hidden
                  className="pi pi-ellipsis-v"
                  style={{ fontSize: 14 }}
                />
              </button>
              {menuOpen ? (
                <div
                  role="menu"
                  aria-label={labels.folderMenu}
                  className="absolute right-0 z-50 mt-1 w-48 rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="folder-rename"
                    onClick={() => {
                      setMenuOpen(false);
                      setRenaming(true);
                    }}
                    className={itemClass}
                  >
                    <i
                      aria-hidden
                      className="pi pi-pencil text-muted-foreground"
                      style={{ fontSize: 13 }}
                    />
                    {labels.renameFolder}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="folder-delete"
                    onClick={() => void remove()}
                    className="flex w-full items-center gap-2.5 rounded-sm px-2 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10 focus-visible:bg-destructive/10 focus-visible:outline-none"
                  >
                    <i
                      aria-hidden
                      className="pi pi-trash"
                      style={{ fontSize: 13 }}
                    />
                    {labels.deleteFolder}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <ul
        id={listId}
        role="list"
        hidden={!expanded}
        className="divide-y divide-border border-t border-border empty:border-t-0"
      >
        {section.forms.map((f) => (
          <FormRow
            key={f.id}
            form={f}
            publicPath={publicFormPath(accountCode, f.slug)}
            updatedLabel={updatedByForm[f.id] ?? ""}
            stats={statsByForm?.[f.id]}
            nameRanges={f.match.nameRanges}
            folders={folders}
            labels={rowLabels}
            actionLabels={actionLabels}
            onMove={onMove}
          />
        ))}
      </ul>

      {isFolder && section.id ? (
        <FolderDialog
          key={`${section.id}:${renaming ? "open" : "closed"}`}
          open={renaming}
          onClose={() => setRenaming(false)}
          onDone={() => router.refresh()}
          mode="rename"
          folderId={section.id}
          initialName={section.name ?? ""}
          labels={dialogLabels}
        />
      ) : null}
      {dialog}
    </section>
  );
}
