'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import type { FormsMessages } from '@quill/shared';
import { recordPlaybooksGalleryVisitAction } from '@/app/admin/playbook-actions';
import type { PlaybookCard } from '@/lib/admin-api';
import { callAction } from '@/lib/call-action';
import {
  PLAYBOOK_LANG_PARAM,
  PLAYBOOK_TAB_PARAM,
  cardsForTab,
  categoryLabel,
  newSinceLabel,
  playbookStatus,
  readStoredPlaybookLocale,
  storePlaybookLocale,
  tabCounts,
  withPlaybookLang,
  type PlaybookContentLocale,
  type PlaybookStatus,
  type PlaybookTab,
} from '@/lib/playbooks';
import { captureEvent } from '@/lib/product-analytics';
import { useWorkspaceTimeZone } from '@/components/workspace-timezone';
import { PlaybookLocaleToggle } from './playbook-locale-toggle';
import { PlaybookThumb } from './playbook-thumb';

/** One shared empty value, so the default never changes the effect's deps. */
const NO_CAMPAIGN: Record<string, string> = {};

/** Set (or remove) one query parameter in the address without a navigation. Best effort. */
function replaceParam(name: string, value: string | null) {
  try {
    const url = new URL(window.location.href);
    if (value === null) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* what is on screen still changes */
  }
}

type Messages = FormsMessages['admin']['playbooks'];

/** A card's state line: the green "New" pill, a check and when, or a hollow dot. */
export function StatusLine({ status }: { status: PlaybookStatus }) {
  if (status.kind === 'new') {
    return (
      <span className="flex items-center gap-2" data-status="new">
        <span className="rounded-full bg-signal px-2 py-0.5 text-xs font-semibold text-signal-foreground">
          {status.label}
        </span>
        <span className="text-xs text-muted-foreground">{status.detail}</span>
      </span>
    );
  }
  if (status.kind === 'seen') {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground" data-status="seen">
        <i aria-hidden className="pi pi-check" style={{ fontSize: 14 }} />
        {status.label}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-foreground/80" data-status="unseen">
      <span aria-hidden className="flex h-3.5 w-3.5 items-center justify-center">
        <span className="h-2 w-2 rounded-full border-[1.5px] border-faint" />
      </span>
      {status.label}
    </span>
  );
}

/**
 * A card's state line worded in the workspace's time zone, for server pages
 * (the reader), which do not know it: the zone lives in a client context.
 */
export function CardStatus({
  card,
  now,
  locale,
  m,
}: {
  card: { isNew: boolean; lastSeenAt: number | null; publishedAt: number };
  now: number;
  locale: string;
  m: Messages['status'];
}) {
  const timeZone = useWorkspaceTimeZone();
  return <StatusLine status={playbookStatus(card, now, m, locale, timeZone)} />;
}

/**
 * The playbooks gallery: the language toggle, the category tabs and the cards
 * of the selected one. Rendered by the page with the list the API returned,
 * in every playbook language, before this visit was recorded, so the "New"
 * marks it clears still show this once, and switching the language is
 * instant and keeps them (the state is the slug's, the same in each language).
 * The visit is recorded from here, once the gallery is on screen.
 *
 * The language opens as the address says (`?lang=`), else as this person last
 * chose in this browser (`storageKey`), else as the page rendered it (the
 * platform's). A change is kept in the address and in the browser; it never
 * touches the platform's language.
 */
export function PlaybooksGallery({
  cardsByLocale,
  initialLocale,
  langInUrl,
  storageKey,
  tabs,
  initialTab,
  newCount,
  now,
  locale,
  m,
  campaign = NO_CAMPAIGN,
}: {
  /** The same cards in each playbook language (a card not translated yet is its Spanish one, `fallback`). */
  cardsByLocale: Record<PlaybookContentLocale, PlaybookCard[]>;
  /** The language the server rendered: the address's, else the platform's. */
  initialLocale: PlaybookContentLocale;
  /** The address named the language: a stored choice does not override a shared link. */
  langInUrl: boolean;
  /** Where this person's choice is kept (`playbookLangStorageKey`). */
  storageKey: string;
  /** The tabs to show, "All" first (`visibleTabs`). */
  tabs: PlaybookTab[];
  initialTab: PlaybookTab;
  newCount: number;
  /** The server's clock at render, so "read 2 days ago" is the same on both sides. */
  now: number;
  /** The platform's language: the copy around the cards and their dates. */
  locale: string;
  m: Messages;
  /** The account's first-touch `utm_*` tags (`campaignProperties`), on every event here. */
  campaign?: Record<string, string>;
}) {
  const [tab, setTab] = useState<PlaybookTab>(initialTab);
  const [contentLocale, setContentLocale] = useState<PlaybookContentLocale>(initialLocale);
  const timeZone = useWorkspaceTimeZone();
  const cards = cardsByLocale[contentLocale];
  const anyFallback = cards.some((c) => c.fallback);
  const counts = tabCounts(cards);
  const shown = cardsForTab(cards, tab);
  const newSince = newSinceLabel(newCount, m);
  const tabRefs = useRef<Map<PlaybookTab, HTMLButtonElement>>(new Map());

  // Once per mount (a strict-mode double effect must not record two visits).
  // The stored language is read here, after hydration: the server cannot see it.
  const recorded = useRef(false);
  useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;
    let shown = initialLocale;
    if (!langInUrl) {
      const stored = readStoredPlaybookLocale(storageKey);
      if (stored && stored !== initialLocale) {
        shown = stored;
        setContentLocale(stored);
        replaceParam(PLAYBOOK_LANG_PARAM, stored);
      }
    }
    void callAction(() => recordPlaybooksGalleryVisitAction());
    captureEvent('playbooks_gallery_viewed', {
      new_count: newCount,
      count: cardsByLocale[shown].length,
      category: initialTab,
      locale: shown,
      ...campaign,
    });
  }, [newCount, cardsByLocale, initialTab, initialLocale, langInUrl, storageKey, campaign]);

  const select = (next: PlaybookTab) => {
    if (next === tab) return;
    setTab(next);
    // Kept in the address so a reload or a shared link opens on the same tab,
    // without a navigation (the cards are already here).
    replaceParam(PLAYBOOK_TAB_PARAM, next === 'all' ? null : next);
    captureEvent('playbooks_category_selected', { category: next, locale: contentLocale, ...campaign });
  };

  // The language of the playbooks only: the cards of each are already here.
  const changeLocale = (next: PlaybookContentLocale) => {
    if (next === contentLocale) return;
    const from = contentLocale;
    setContentLocale(next);
    storePlaybookLocale(storageKey, next);
    replaceParam(PLAYBOOK_LANG_PARAM, next);
    captureEvent('playbooks_locale_changed', { from, to: next, surface: 'gallery', ...campaign });
  };

  // Arrow keys move along the tabs, as a tablist does.
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = tabs.indexOf(tab);
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : step ? (i + step + tabs.length) % tabs.length : -1;
    if (to < 0) return;
    e.preventDefault();
    const next = tabs[to]!;
    select(next);
    tabRefs.current.get(next)?.focus();
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
      <header className="mb-6 flex flex-col gap-3 sm:mb-7 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{m.title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{m.intro}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 self-start sm:self-auto">
          {newSince ? (
            <p
              data-testid="playbooks-new-since"
              className="flex items-center gap-2 rounded-full bg-signal/15 py-1.5 pl-2.5 pr-3 text-sm font-semibold text-signal-ink"
            >
              <span aria-hidden className="h-2 w-2 rounded-full bg-signal" />
              {newSince}
            </p>
          ) : null}
          <PlaybookLocaleToggle value={contentLocale} onChange={changeLocale} m={m.contentLanguage} />
        </div>
      </header>

      {anyFallback ? (
        <p
          data-testid="playbooks-fallback"
          role="status"
          className="-mt-2 mb-5 flex items-center gap-2 text-xs text-muted-foreground"
        >
          <i aria-hidden className="pi pi-info-circle" style={{ fontSize: 14 }} />
          {m.fallback.gallery}
        </p>
      ) : null}

      {tabs.length > 1 ? (
        <div className="-mx-4 mb-6 overflow-x-auto px-4 no-scrollbar sm:mx-0 sm:px-0">
          <div role="tablist" aria-label={m.tabsLabel} className="inline-flex gap-0.5 rounded-full bg-muted p-0.5">
            {tabs.map((id) => {
              const active = id === tab;
              return (
                <button
                  key={id}
                  ref={(el) => {
                    if (el) tabRefs.current.set(id, el);
                    else tabRefs.current.delete(id);
                  }}
                  type="button"
                  role="tab"
                  id={`playbooks-tab-${id}`}
                  aria-selected={active}
                  aria-controls="playbooks-grid"
                  tabIndex={active ? 0 : -1}
                  data-testid={`playbooks-tab-${id}`}
                  onClick={() => select(id)}
                  onKeyDown={onTabKey}
                  className={`flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-medium transition-colors ${
                    active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {categoryLabel(id, m)}
                  <span className={`text-xs tabular-nums ${active ? 'text-muted-foreground' : 'text-faint'}`}>
                    {counts[id]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* A tab panel only when there are tabs: with "All" alone the tablist is
          not drawn, and the panel would be labelled by a tab that is not there. */}
      <div
        id="playbooks-grid"
        {...(tabs.length > 1 ? { role: 'tabpanel', 'aria-labelledby': `playbooks-tab-${tab}` } : {})}
      >
        {shown.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
            {m.empty}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shown.map((card) => (
              <li key={card.slug} className="flex">
                <Link
                  href={withPlaybookLang(`/admin/playbooks/${card.slug}`, contentLocale)}
                  data-testid="playbook-card"
                  data-slug={card.slug}
                  data-locale={card.locale}
                  className="group flex w-full flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-foreground/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <PlaybookThumb
                    video={card.thumbnailVideo}
                    poster={card.thumbnailPoster}
                    category={card.category}
                    className="aspect-[29/18] w-full shrink-0 border-b border-border"
                  />
                  <span className="flex flex-1 items-stretch gap-3 px-4 pb-4 pt-3.5">
                    <span className="flex min-w-0 flex-1 flex-col gap-2.5">
                      {/* On a phone the card is a row of the list: the category
                          leads and the summary steps aside, as in the design. */}
                      <span className="text-xs text-muted-foreground sm:hidden">{categoryLabel(card.category, m)}</span>
                      <span lang={card.locale} className="text-base font-semibold leading-5 tracking-tight text-foreground">
                        {card.title}
                      </span>
                      <span lang={card.locale} className="hidden flex-1 text-sm leading-5 text-muted-foreground sm:block">
                        {card.summary}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1">
                        <StatusLine status={playbookStatus(card, now, m.status, locale, timeZone)} />
                        {card.fallback ? (
                          <span data-testid="playbook-card-fallback" className="text-xs text-faint">
                            {m.fallback.card}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    {/* The row's chevron, on a phone only. The wrapper hides it:
                        the icon sheet's own `display` outranks a utility on the <i>. */}
                    <span aria-hidden className="flex shrink-0 items-center text-faint sm:hidden">
                      <i className="pi pi-chevron-right" style={{ fontSize: 14 }} />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
