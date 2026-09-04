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
import { CreateForm } from "./create-form";
import { FolderDialog, type FolderDialogLabels } from "./folder-dialog";
import { FormRow, type FormRowLabels } from "./form-row";
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
  updated: string;
}

export interface FormsExplorerProps {
  forms: FormSummary[];
  folders: Folder[];
  accountCode: string;
  handle: string;
  locale: string;
  /** Already-formatted "Updated {when}" per form id (formatted on the server, one clock). */
  updatedByForm: Record<string, string>;
  labels: FormsExplorerLabels;
  rowLabels: FormRowLabels;
  actionLabels: FormRowActionLabels;
  dialogLabels: FolderDialogLabels;
  createLabels: React.ComponentProps<typeof CreateForm>["labels"];
}

/**
 * The forms list with folders and search. ONE list: every folder is a
 * collapsible section (Unfiled first), rows drag onto section headers, the
 * kebab's "Move to folder" is the keyboard-only route to the same move, and
 * the search box filters the loaded list by name or slug, expanding the
 * sections with a hit and hiding the rest. Without folders it looks exactly
 * like the flat list it replaces.
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

  // Fresh server data supersedes any optimistic move still recorded here.
  useEffect(() => setOverrides(new Map()), [forms]);

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

  // Roving focus over the row titles: arrows walk them, Enter opens (a link).
  function onListKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-form-link]") ?? [],
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
  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className="mb-4">
        <div className="relative max-w-md">
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
                  ?.querySelector<HTMLElement>("[data-form-link]")
                  ?.focus();
              }
            }}
            className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-24 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-2xs text-faint">
            {query ? null : (
              <kbd className="rounded border border-border px-1.5 py-0.5 font-mono">
                {labels.searchShortcut}
              </kbd>
            )}
          </span>
          {query ? (
            <button
              type="button"
              aria-label={labels.searchClear}
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <i aria-hidden className="pi pi-times" style={{ fontSize: 12 }} />
            </button>
          ) : null}
        </div>
        <p
          role="status"
          aria-live="polite"
          className={cn(
            "mt-1 text-xs text-muted-foreground",
            !searching && "sr-only",
          )}
        >
          {searching ? t(labels.searchResults, { count: matches }) : ""}
        </p>
      </div>

      <div
        ref={listRef}
        onKeyDown={onListKeyDown}
        className="flex flex-col gap-6"
      >
        {searching && matches === 0 ? (
          <p
            data-testid="forms-search-empty"
            className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground"
          >
            {labels.searchEmpty}
          </p>
        ) : null}
        {sections.map((section) => (
          <FolderSection
            key={section.id ?? UNFILED}
            section={section}
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
  folders,
  accountCode,
  handle,
  locale,
  updatedByForm,
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
      message: t(labels.deleteFolderConfirm, { name, count: section.total }),
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
        "rounded-xl transition-colors",
        dragging && "outline outline-1 outline-dashed outline-border",
        isOver && "bg-primary/10 outline-primary-edge",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 py-1">
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
            className="rounded-full bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground"
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
        className="flex flex-col gap-3"
      >
        {section.forms.map((f) => (
          <FormRow
            key={f.id}
            form={f}
            publicPath={`/${accountCode}/${handle}/${f.slug}`}
            updatedLabel={updatedByForm[f.id] ?? ""}
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
