'use client';

/**
 * The body of a text question's card: its latest answers, a search box that
 * looks through this question's answers only, and "Show more". A click on an
 * answer opens that whole response in the panel.
 *
 * The search runs on the server (paginated, account-scoped): ignoring case,
 * and NOT accents for now, so "gomez" does not find "Gómez".
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { t } from '@quill/shared';
import { SearchClearButton } from '@/components/ui/search-clear-button';
import { callAction, isTransportError } from '@/lib/call-action';
import { searchSummaryAnswersAction, type SummaryFilterQuery } from './actions';
import type { SummaryHit } from './summary-hit';
import { useOpenResponse } from './summary-response-panel';

export interface TextAnswersLabels {
  latest: string;
  searchLabel: string;
  searchPlaceholder: string;
  searchClear: string;
  matches: string;
  noMatches: string;
  showMore: string;
  anonymous: string;
  openAnswer: string;
  openFailed: string;
  searchFailed: string;
}

/** Wait this long after the last keystroke before searching. */
const DEBOUNCE_MS = 250;

/**
 * `text` with every case-insensitive occurrence of `query` marked. Skipped
 * when lowercasing changes the text's length (a handful of letters do), since
 * the offsets would no longer line up with the original.
 */
function highlight(text: string, query: string): ReactNode {
  const q = query.trim().toLowerCase();
  const lower = text.toLowerCase();
  if (!q || lower.length !== text.length) return text;
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(q); at >= 0; at = lower.indexOf(q, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="rounded-sm bg-primary/30 px-0.5 text-foreground">
        {text.slice(at, at + q.length)}
      </mark>,
    );
    from = at + q.length;
  }
  parts.push(text.slice(from));
  return parts;
}

export function TextAnswers({
  formId,
  stepKey,
  recent,
  answered,
  filter,
  compact = false,
  labels,
}: {
  formId: string;
  stepKey: string;
  /** The latest answers, from the summary itself. */
  recent: SummaryHit[];
  /** How many responses answered this question: what "Show more" can reach. */
  answered: number;
  /** The Summary's filter, so a search looks only through the filtered responses. */
  filter: SummaryFilterQuery;
  /**
   * A contact question (name, email, phone): the card is its count and the
   * search box, and lists answers only for a search. A list of people is the
   * least useful thing to read in a summary, and it took the most room.
   */
  compact?: boolean;
  labels: TextAnswersLabels;
}) {
  const openResponse = useOpenResponse();
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [query, setQuery] = useState('');
  /** The query the list below answers (the input runs ahead of it while typing). */
  const [applied, setApplied] = useState('');
  const [items, setItems] = useState<SummaryHit[]>(recent);
  const [total, setTotal] = useState(answered);
  /**
   * Where the next "Show more" starts, as the server counted it (its offset
   * plus its limit), never the length of the list: the list drops repeats, so
   * its length can lag behind the rows the server already handed over.
   */
  const [nextOffset, setNextOffset] = useState(recent.length);
  /** The last page came back short: there is nothing more to ask for. */
  const [exhausted, setExhausted] = useState(recent.length >= answered);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  /** Only the latest request may write the list: a slow early search must not land over a later one. */
  const seq = useRef(0);

  async function fetchPage(q: string, offset: number) {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    const res = await callAction(() => searchSummaryAnswersAction(formId, stepKey, q, offset, filter));
    if (mine !== seq.current) return;
    setLoading(false);
    if (isTransportError(res) || !res.ok) {
      setError(labels.searchFailed);
      return;
    }
    setApplied(q);
    setTotal(res.total);
    setNextOffset(res.offset + res.limit);
    // A short page is the end, even when `total` says otherwise: the count is
    // taken before the rows are read, and a response can arrive, or a row the
    // server counted can turn out to hold no answer, in between.
    setExhausted(res.items.length < res.limit || res.offset + res.limit >= res.total);
    setItems((prev) => {
      if (offset === 0) return res.items;
      // A response that arrived between pages shifts the next page by one, so
      // its first row is one already listed: keep the first copy only.
      const seen = new Set(prev.map((i) => i.id));
      return [...prev, ...res.items.filter((i) => !seen.has(i.id))];
    });
  }

  // Search as the person types, once they pause. Every keystroke retires the
  // request in flight, so typing back to what the list already shows cannot
  // be overwritten by the answer to a query that is no longer in the box.
  // Emptying the box goes back to the latest answers without a request.
  useEffect(() => {
    const q = query.trim();
    seq.current++;
    setLoading(false);
    if (!q) {
      setApplied('');
      setItems(recent);
      setTotal(answered);
      setNextOffset(recent.length);
      setExhausted(recent.length >= answered);
      setError(null);
      return;
    }
    if (q === applied) return;
    const timer = window.setTimeout(() => void fetchPage(q, 0), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  async function open(index: number) {
    const id = items[index]?.id;
    // One at a time. The button is never disabled for it: a disabled button
    // drops focus, and the panel hands focus back to whatever had it on open.
    if (!id || opening) return;
    setOpening(id);
    setError(null);
    const ok = await openResponse(
      items.map((i) => i.id),
      index,
      stepKey,
    );
    setOpening(null);
    if (!ok) setError(labels.openFailed);
  }

  const searching = applied.length > 0;
  const more = !exhausted;
  // Compact, the list (and its "latest" caption) only exists for a search.
  const listed = !compact || searching;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <i
          aria-hidden
          className="pi pi-search pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          style={{ fontSize: 12 }}
        />
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          value={query}
          aria-label={labels.searchLabel}
          placeholder={labels.searchPlaceholder}
          autoComplete="off"
          data-testid="summary-search"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.preventDefault();
              setQuery('');
            }
          }}
          className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-10 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <SearchClearButton
          query={query}
          label={labels.searchClear}
          testId="summary-search-clear"
          className="h-6 w-6"
          onClear={() => {
            setQuery('');
            inputRef.current?.focus();
          }}
        />
      </div>

      <div
        className={`flex items-center justify-between gap-3 text-xs text-muted-foreground ${
          listed || loading ? 'min-h-5' : 'hidden'
        }`}
      >
        <span aria-live="polite" data-testid="summary-search-status">
          {searching ? t(labels.matches, { n: total }) : listed ? labels.latest : null}
        </span>
        {loading ? (
          <i aria-hidden className="pi pi-spin pi-spinner text-faint" style={{ fontSize: 12 }} />
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive" data-testid="summary-error">
          {error}
        </p>
      ) : null}

      {!listed ? null : searching && items.length === 0 && !loading ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {t(labels.noMatches, { query: applied })}
        </p>
      ) : (
        <ul
          className={`flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border transition-opacity ${
            loading ? 'opacity-60' : ''
          }`}
          data-testid="summary-answers"
        >
          {items.map((item, i) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => void open(i)}
                aria-busy={opening === item.id || undefined}
                title={labels.openAnswer}
                data-testid="summary-answer"
                data-response-id={item.id}
                className="group flex w-full items-start gap-3 bg-background/40 px-4 py-3 text-left transition-colors hover:bg-accent/70 focus-visible:bg-accent/70 focus-visible:outline-none aria-busy:cursor-wait"
              >
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-3 whitespace-pre-line break-words text-sm text-foreground">
                    {searching ? highlight(item.text, applied) : item.text}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {/* On the name or email card the answer already says who. */}
                    {item.respondent !== item.text ? (
                      <>
                        <span className="max-w-full truncate font-medium">
                          {item.respondent ?? labels.anonymous}
                        </span>
                        <span aria-hidden className="text-faint">
                          ·
                        </span>
                      </>
                    ) : null}
                    <span>{item.when}</span>
                  </span>
                </span>
                <i
                  aria-hidden
                  className={`pi ${
                    opening === item.id ? 'pi-spin pi-spinner' : 'pi-window-maximize'
                  } mt-1 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 ${
                    opening === item.id ? 'opacity-100' : ''
                  }`}
                  style={{ fontSize: 11 }}
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      {more && listed ? (
        <button
          type="button"
          onClick={() => void fetchPage(applied, nextOffset)}
          disabled={loading}
          data-testid="summary-show-more"
          className="inline-flex h-9 w-fit items-center gap-2 self-center rounded-md border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          {labels.showMore}
        </button>
      ) : null}
    </div>
  );
}
