'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { BuilderMessages } from './builder-messages';
import { GALLERY, GALLERY_GROUPS, type GalleryGroup, type GalleryItem } from './question-types';

/**
 * The visual type gallery — one `+` opens this grouped, searchable picker
 * (centered dialog on desktop, bottom sheet on mobile). Picking a type inserts →
 * selects → focuses the canvas (the parent handles that). Kills the type
 * `<select>` cold start.
 */
export function TypeGallery({
  open,
  onClose,
  onPick,
  m,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (item: GalleryItem) => void;
  m: BuilderMessages;
}) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      // Focus the search after the dialog paints.
      const id = requestAnimationFrame(() => searchRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const groupLabel: Record<GalleryGroup, string> = {
    contact: m.gallery.groupContact,
    choice: m.gallery.groupChoice,
    text: m.gallery.groupText,
    content: m.gallery.groupContent,
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GALLERY_GROUPS.map((g) => {
      const items = GALLERY[g].filter((it) => {
        if (!q) return true;
        const label = m.gallery.items[it.id];
        return (
          label.title.toLowerCase().includes(q) ||
          label.desc.toLowerCase().includes(q) ||
          groupLabel[g].toLowerCase().includes(q)
        );
      });
      return { group: g, items };
    }).filter((s) => s.items.length > 0);
  }, [query, m]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={m.gallery.title}
    >
      <button
        type="button"
        aria-label={m.gallery.close}
        onClick={onClose}
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
      />
      <div className="relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:max-h-[85dvh] sm:w-[min(760px,92vw)] sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-5 sm:px-6">
          <h2 className="text-xl font-semibold tracking-tight">{m.gallery.title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={m.gallery.close}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <i aria-hidden className="pi pi-times" style={{ fontSize: 13 }} />
          </button>
        </div>

        <div className="px-5 pb-2 sm:px-6">
          <div className="relative">
            <i
              aria-hidden
              className="pi pi-search pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              style={{ fontSize: 13 }}
            />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={m.gallery.search}
              aria-label={m.gallery.search}
              className="w-full rounded-lg border border-input bg-background py-2.5 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 sm:px-6">
          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{m.gallery.noResults}</p>
          ) : (
            <div className="flex flex-col gap-5">
              {filtered.map(({ group, items }) => (
                <section key={group}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {groupLabel[group]}
                  </p>
                  <div className="grid gap-2.5 sm:grid-cols-3">
                    {items.map((it) => {
                      const label = m.gallery.items[it.id];
                      return (
                        <button
                          key={it.id}
                          type="button"
                          onClick={() => onPick(it)}
                          className="group flex items-center gap-3 rounded-xl border border-border bg-background p-3 text-left transition-colors hover:border-primary/60 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary/15 group-hover:text-foreground">
                            <i aria-hidden className={`pi ${it.icon}`} style={{ fontSize: 16 }} />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-foreground">
                              {label.title}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">{label.desc}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-5 py-3 text-xs text-muted-foreground sm:px-6">
          <i aria-hidden className="pi pi-info-circle" style={{ fontSize: 12 }} />
          {m.gallery.hint}
        </div>
      </div>
    </div>
  );
}
