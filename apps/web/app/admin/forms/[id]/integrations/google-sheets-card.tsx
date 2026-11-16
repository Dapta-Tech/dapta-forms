'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import type { FormsMessages } from '@quill/shared';
import { sheetColumnSource, type SheetColumn, type SheetColumnSource } from '@quill/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/toast';
import { callAction } from '@/lib/call-action';
import type { SheetTab } from '@/lib/admin-api';
import type { QuestionMeta } from './auto-map';
import { Card } from './integrations-card';
import { googleSheetsHeaderRowAction, googleSheetsTabsAction } from './actions';
import { defaultColumns, isCompleteColumn, moveColumn } from './sheet-columns';
import { parseSheetUrl, sheetUrlFor } from './sheet-url';

type Msgs = FormsMessages['admin']['integrations'];

/** The card's whole editable state. Lifted to the editor, which autosaves it. */
export interface GoogleSheetsState {
  enabled: boolean;
  /** What the author typed. Kept verbatim so a bad paste stays on screen to fix. */
  urlInput: string;
  spreadsheetId: string;
  sheetTitle: string;
  columns: SheetColumn[];
}

/** The five `utm_*` keys, the only keys a `utm` column may name. */
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

/**
 * The spreadsheet card on a form's Connect tab.
 *
 * Three steps in the order an author takes them: point at a spreadsheet, choose
 * the tab, say what the row holds. The tab list is fetched rather than typed,
 * because a tab name is matched exactly at delivery time and a typo there fails
 * silently on every submission.
 *
 * The column plan is the part with an opinion. It starts from the form's own
 * questions in the form's own order, because that is the sheet almost everyone
 * wants and building it by hand for a twenty-question form is a chore nobody
 * should have to do to try the feature.
 */
export function GoogleSheetsCard({
  state,
  setState,
  questions,
  connected,
  m,
}: {
  state: GoogleSheetsState;
  setState: (next: GoogleSheetsState) => void;
  questions: QuestionMeta[];
  /** Account-level Google connection. Without it there is nothing to list tabs with. */
  connected: boolean;
  m: Msgs;
}) {
  const { success, error } = useToast();
  const [pending, start] = useTransition();
  const [tabs, setTabs] = useState<SheetTab[] | null>(null);
  const [tabsError, setTabsError] = useState<string | null>(null);
  const [loadingTabs, setLoadingTabs] = useState(false);

  const patch = (next: Partial<GoogleSheetsState>) => setState({ ...state, ...next });

  /**
   * Fetch the tabs whenever the spreadsheet changes.
   *
   * Keyed on the id rather than on what was typed, so the list is not refetched
   * once per keystroke while somebody pastes a URL. `latest` guards the race: a
   * slow answer for the previous spreadsheet must not land on top of the
   * current one's.
   */
  const latest = useRef(0);
  useEffect(() => {
    if (!connected || !state.spreadsheetId) {
      setTabs(null);
      setTabsError(null);
      return;
    }
    const ticket = ++latest.current;
    setLoadingTabs(true);
    setTabsError(null);
    void (async () => {
      const res = await callAction(() => googleSheetsTabsAction(state.spreadsheetId));
      if (ticket !== latest.current) return;
      setLoadingTabs(false);
      if (!res.ok) {
        setTabs(null);
        setTabsError(m.gsheets.tabsUnavailable);
        return;
      }
      if (!res.data.enabled) {
        setTabs(null);
        setTabsError(
          res.data.reason === 'not_found'
            ? m.gsheets.sheetNotFound
            : res.data.reason === 'forbidden'
              ? m.gsheets.sheetForbidden
              : m.gsheets.tabsUnavailable,
        );
        return;
      }
      setTabs(res.data.tabs);
    })();
  }, [connected, state.spreadsheetId, m]);

  /** Take what was pasted and keep the id out of it, plus the tab it pointed at. */
  function onUrl(value: string) {
    const parsed = parseSheetUrl(value);
    if (!parsed) {
      patch({ urlInput: value, spreadsheetId: '' });
      return;
    }
    // A pasted link naming a tab preselects it once the list arrives: the
    // author copied the URL while looking at the tab they meant.
    const pendingGid = parsed.gid;
    patch({ urlInput: value, spreadsheetId: parsed.spreadsheetId });
    if (pendingGid != null) preselect.current = pendingGid;
  }

  /**
   * Preselect the tab a pasted link pointed at, once its list arrives.
   *
   * The effect must run on the TAB LIST only. It reads the current state
   * through a ref rather than depending on it, because depending on the state
   * it also writes would re-run it on every keystroke in the card, and the
   * alternative (silencing the dependency rule) is not available here: this
   * repo's eslint does not register that rule, so the disable comment is itself
   * an error.
   */
  const preselect = useRef<number | null>(null);
  const live = useRef({ state, setState });
  live.current = { state, setState };
  useEffect(() => {
    const gid = preselect.current;
    if (gid == null || !tabs) return;
    preselect.current = null;
    const match = tabs.find((t) => t.gid === gid);
    if (match) live.current.setState({ ...live.current.state, sheetTitle: match.title });
  }, [tabs]);

  function writeHeaders() {
    const headers = state.columns.filter(isCompleteColumn).map((c) => c.header.trim());
    if (!state.spreadsheetId || headers.length === 0) return;
    start(async () => {
      const res = await callAction(() =>
        googleSheetsHeaderRowAction({
          spreadsheetId: state.spreadsheetId,
          sheetTitle: state.sheetTitle || undefined,
          headers,
        }),
      );
      if (!res.ok) {
        error(m.gsheets.headersFailed);
        return;
      }
      if (!res.data.ok) {
        error(res.data.reason === 'forbidden' ? m.gsheets.sheetForbidden : m.gsheets.headersFailed);
        return;
      }
      if (res.data.written) success(m.gsheets.headersWritten);
      // Row 1 already held something. Not an error: it is almost always a sheet
      // that already has the headings, and overwriting would have been worse.
      else success(m.gsheets.headersNotEmpty);
    });
  }

  const setColumns = (columns: SheetColumn[]) => patch({ columns });

  return (
    <Card
      title={m.gsheets.title}
      desc={m.gsheets.desc}
      enabled={state.enabled}
      onToggle={(enabled) => patch({ enabled })}
      m={m}
      logo="google-sheets"
    >
      {!connected ? (
        <p className="text-sm text-muted-foreground" data-testid="gsheets-not-connected">
          {m.gsheets.notConnected}
        </p>
      ) : (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{m.gsheets.urlLabel}</span>
            <Input
              value={state.urlInput}
              onChange={(e) => onUrl(e.target.value)}
              placeholder={m.gsheets.urlPlaceholder}
              aria-invalid={!!state.urlInput.trim() && !state.spreadsheetId}
            />
            {state.urlInput.trim() && !state.spreadsheetId ? (
              <span className="text-xs text-destructive">{m.gsheets.urlInvalid}</span>
            ) : (
              <span className="text-xs text-muted-foreground">{m.gsheets.urlHelp}</span>
            )}
          </label>

          {state.spreadsheetId ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{m.gsheets.tabLabel}</span>
              <select
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                value={state.sheetTitle}
                onChange={(e) => patch({ sheetTitle: e.target.value })}
                disabled={loadingTabs || !tabs}
              >
                <option value="">{m.gsheets.tabFirst}</option>
                {(tabs ?? []).map((t) => (
                  <option key={t.gid} value={t.title}>
                    {t.title}
                  </option>
                ))}
              </select>
              {tabsError ? (
                <span className="text-xs text-destructive">{tabsError}</span>
              ) : (
                <a
                  className="text-xs text-muted-foreground underline"
                  href={sheetUrlFor(state.spreadsheetId)}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {m.gsheets.openSheet}
                </a>
              )}
            </label>
          ) : null}

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{m.gsheets.columnsLabel}</span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() =>
                    setColumns(
                      defaultColumns(questions, {
                        submittedAt: m.gsheets.colSubmittedAt,
                        score: m.gsheets.colScore,
                        outcome: m.gsheets.colOutcome,
                        formName: m.gsheets.colFormName,
                        submissionId: m.gsheets.colSubmissionId,
                      }),
                    )
                  }
                >
                  {m.gsheets.fillFromForm}
                </Button>
                <Button
                  variant="secondary"
                  onClick={writeHeaders}
                  disabled={pending || !state.spreadsheetId || state.columns.length === 0}
                >
                  {m.gsheets.writeHeaders}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{m.gsheets.columnsHelp}</p>

            {state.columns.length === 0 ? (
              <p className="text-sm text-muted-foreground">{m.gsheets.noColumns}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {state.columns.map((column, index) => (
                  // An explicit GRID, not nested flex-wrap.
                  //
                  // The Connect tab is a narrow column with the settings panel
                  // beside it, and flex-wrap there put the source select on a
                  // line of its own above the heading, with the buttons on a
                  // third: three ragged lines whose parts did not line up with
                  // the row above or below. A grid gives every row the same
                  // four slots, so the columns read down the list as well as
                  // across, and the row collapses to one slot per line when
                  // there is no room rather than wrapping wherever it lands.
                  <li
                    key={index}
                    className="grid grid-cols-1 items-center gap-2 rounded-md border border-border/60 p-2 lg:grid-cols-[minmax(8rem,1fr)_10rem_11rem_auto]"
                  >
                    <Input
                      value={column.header}
                      aria-label={m.gsheets.headerFor}
                      placeholder={m.gsheets.headerFor}
                      onChange={(e) => {
                        const next = [...state.columns];
                        next[index] = { ...column, header: e.target.value };
                        setColumns(next);
                      }}
                    />
                    <select
                      className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                      aria-label={m.gsheets.sourceFor}
                      value={column.source}
                      onChange={(e) => {
                        const source = e.target.value as SheetColumnSource;
                        const next = [...state.columns];
                        // Dropping the key when the source no longer takes one
                        // keeps a stale question key from riding along into the
                        // stored config, where nothing would ever read it.
                        next[index] =
                          source === 'answer' || source === 'utm'
                            ? { ...column, source }
                            : { header: column.header, source };
                        setColumns(next);
                      }}
                    >
                      {sheetColumnSource.map((source) => (
                        <option key={source} value={source}>
                          {m.gsheets.sources[source]}
                        </option>
                      ))}
                    </select>
                    {column.source === 'answer' || column.source === 'utm' ? (
                      <select
                        className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                        aria-label={m.gsheets.keyFor}
                        value={column.key ?? ''}
                        onChange={(e) => {
                          const next = [...state.columns];
                          next[index] = { ...column, key: e.target.value };
                          setColumns(next);
                        }}
                      >
                        <option value="">{m.gsheets.pickOne}</option>
                        {(column.source === 'answer'
                          ? questions.map((q) => ({ value: q.key, label: q.label || q.key }))
                          : UTM_KEYS.map((k) => ({ value: k, label: k }))
                        ).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      // The slot is HELD even when this source takes no key, so
                      // the buttons sit in the same place on every row. Without
                      // it they slide left on the rows that need no key, and a
                      // list of ten columns reads as ragged.
                      <span aria-hidden className="hidden lg:block" />
                    )}
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        aria-label={m.gsheets.moveUp}
                        disabled={index === 0}
                        onClick={() => setColumns(moveColumn(state.columns, index, -1))}
                      >
                        <i aria-hidden className="pi pi-arrow-up" style={{ fontSize: 11 }} />
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label={m.gsheets.moveDown}
                        disabled={index === state.columns.length - 1}
                        onClick={() => setColumns(moveColumn(state.columns, index, 1))}
                      >
                        <i aria-hidden className="pi pi-arrow-down" style={{ fontSize: 11 }} />
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label={m.gsheets.removeColumn}
                        onClick={() => setColumns(state.columns.filter((_, i) => i !== index))}
                      >
                        <i aria-hidden className="pi pi-times" style={{ fontSize: 11 }} />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <Button
              variant="secondary"
              className="self-start"
              onClick={() => setColumns([...state.columns, { header: '', source: 'answer' }])}
            >
              {m.gsheets.addColumn}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
