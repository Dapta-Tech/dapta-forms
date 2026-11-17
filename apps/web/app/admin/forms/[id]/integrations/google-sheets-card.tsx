'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { getMessages, type FormsMessages } from '@quill/shared';
import { sheetColumnSource, type SheetColumn, type SheetColumnSource } from '@quill/types';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { IntegrationMark } from '@/components/ui/provider-logo';
import { useToast } from '@/components/toast';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { callAction } from '@/lib/call-action';
import { cn } from '@/lib/cn';
import type { SheetHeaderSync, SheetTab } from '@/lib/admin-api';
import { GoogleConnectButton } from '@/app/admin/integrations/connect-forms';
import type { QuestionMeta } from './auto-map';
import { Card } from './integrations-card';
import { ConnectInPlace, DEFAULT_CONNECT_ACCESS, type ConnectAccess } from './connect-in-place';
import {
  googleSheetsCreateAction,
  googleSheetsPickerAction,
  googleSheetsTabsAction,
  syncSheetHeadersAction,
} from './actions';
import { pickSpreadsheet } from './google-picker';
import { columnMissing, defaultColumns, isCompleteColumn, moveColumn } from './sheet-columns';
import { sheetUrlFor } from './sheet-url';

type Msgs = FormsMessages['admin']['integrations'];

/** The card's whole editable state. Lifted to the editor, which autosaves it. */
export interface GoogleSheetsState {
  enabled: boolean;
  spreadsheetId: string;
  sheetTitle: string;
  columns: SheetColumn[];
}

/** The five `utm_*` keys, the only keys a `utm` column may name. */
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

/** The spreadsheet's own letter for the nth column (0 -> A, 26 -> AA). */
export function sheetColumnLetter(index: number): string {
  let out = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** The sentence and tone for what the last header-row sync did. */
function headerSyncLine(
  sync: SheetHeaderSync,
  g: Msgs['gsheets'],
): { text: string; tone: 'ok' | 'warn' | 'error' } | null {
  switch (sync.outcome) {
    case 'written':
      return { text: g.headersWritten, tone: 'ok' };
    case 'unchanged':
      return { text: g.headersUnchanged, tone: 'ok' };
    case 'foreign':
      // Drawn by `HeaderMismatch` instead, with the side-by-side and the way out.
      return null;
    default:
      // Not connected says nothing here: the card is already showing the
      // connect prompt in that case.
      if (sync.reason === 'not_connected') return null;
      return { text: sync.reason === 'forbidden' ? g.sheetForbidden : g.headersFailed, tone: 'error' };
  }
}

/** A quiet, fixed-size icon button for the column rows. */
function RowIconButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      // `disabled:bg-transparent` overrides the base button's grey disabled
      // fill: a disabled arrow at the top or bottom of the list should read as
      // absent, not as a grey blob in the middle of a quiet row.
      className="h-8 w-8 text-muted-foreground hover:text-foreground disabled:bg-transparent disabled:opacity-35"
    >
      <i aria-hidden className={cn('pi', icon)} style={{ fontSize: 13 }} />
    </Button>
  );
}

/**
 * The spreadsheet card on a form's Connect tab.
 *
 * A spreadsheet gets here one of two ways, and only these two: the author has
 * dForms create one, or chooses an existing one in Google's own Picker. There
 * is no field to paste a link into, and that is not an omission. The app asks
 * Google for the `drive.file` scope, which reaches the files it created and the
 * files it was handed and nothing else, so a pasted link to any other
 * spreadsheet would be refused by Google as if the file did not exist.
 *
 * Creating is the first button because it is the whole job in one click: the
 * spreadsheet, a named tab and the header row, with the columns taken from the
 * form's own questions if the author has not arranged any yet.
 *
 * The tab list is fetched rather than typed, because a tab name is matched
 * exactly at delivery time and a typo there fails silently on every submission.
 */
export function GoogleSheetsCard({
  state,
  setState,
  questions,
  connected,
  pickerAvailable = false,
  formName = '',
  formId,
  access = DEFAULT_CONNECT_ACCESS,
  headerSync = null,
  onHeaderSync,
  beforeHeaderSync,
  locale,
  m,
}: {
  state: GoogleSheetsState;
  setState: (next: GoogleSheetsState) => void;
  questions: QuestionMeta[];
  /** Account-level Google connection. Without it there is nothing to create or list with. */
  connected: boolean;
  /** Whether this deployment can open Google's Picker (it needs a browser key). */
  pickerAvailable?: boolean;
  /** Names the spreadsheet a click on "create" makes. */
  formName?: string;
  /**
   * The form this card belongs to: where "Continue with Google" returns to, and
   * which form's stored columns the header button syncs. Absent in isolated
   * specs, which then get neither.
   */
  formId?: string;
  /** Who may connect Google from here (see `ConnectInPlace`). */
  access?: ConnectAccess;
  /** What the last save (or press) did to row 1 of the sheet. */
  headerSync?: SheetHeaderSync | null;
  onHeaderSync?: (sync: SheetHeaderSync | null) => void;
  /**
   * Settle any pending autosave before the header button reads the STORED
   * columns, so it syncs what is on screen and not the save before it.
   */
  beforeHeaderSync?: () => Promise<unknown>;
  locale?: string;
  m: Msgs;
}) {
  const { success, error } = useToast();
  const [pending, start] = useTransition();
  const [tabs, setTabs] = useState<SheetTab[] | null>(null);
  const [tabsError, setTabsError] = useState<string | null>(null);
  const [loadingTabs, setLoadingTabs] = useState(false);
  /**
   * The spreadsheet's name, for the link back to it.
   *
   * Local, NOT part of the lifted state: the stored destination holds only the
   * id, so the name is something this card learns (from a create, a pick, or
   * the tab list) and shows. Lifting it would make the editor autosave a form
   * whose config had not changed, every time a name arrived.
   */
  const [sheetName, setSheetName] = useState('');

  const patch = (next: Partial<GoogleSheetsState>) => setState({ ...state, ...next });

  /**
   * Fetch the tabs whenever the spreadsheet changes. `latest` guards the race:
   * a slow answer for the previous spreadsheet must not land on top of the
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
      if (res.data.spreadsheetTitle) setSheetName(res.data.spreadsheetTitle);
    })();
  }, [connected, state.spreadsheetId, m]);

  /**
   * Look at row 1 once when the card opens on a spreadsheet, so a sheet that
   * drifted (headings written before dForms recorded them, or edited in the
   * sheet) shows its mismatch and the way out without anyone having to press
   * a button first. Once per open: the ref survives re-renders, and a sheet
   * picked later is checked by the save that stores it.
   *
   * It is the ordinary, conservative sync: one read, and a write only into a
   * row 1 that is provably dForms' own. Only a mismatch is reported here; a
   * row that already matches has nothing to say on open.
   */
  const checkedOnOpen = useRef(false);
  useEffect(() => {
    if (checkedOnOpen.current || !formId || !connected || !state.spreadsheetId) return;
    if (!state.columns.some(isCompleteColumn)) return;
    checkedOnOpen.current = true;
    void (async () => {
      const res = await callAction(() => syncSheetHeadersAction(formId));
      if (!res?.ok || !res.data?.ok) return;
      if (res.data.outcome === 'foreign') {
        const { ok: _ok, ...sync } = res.data;
        onHeaderSync?.(sync as SheetHeaderSync);
      }
    })();
    // Deliberately once per mount; the deps only gate when it may run.
  }, [formId, connected, state.spreadsheetId, state.columns, onHeaderSync]);

  const defaults = () =>
    defaultColumns(questions, {
      submittedAt: m.gsheets.colSubmittedAt,
      score: m.gsheets.colScore,
      outcome: m.gsheets.colOutcome,
      formName: m.gsheets.colFormName,
      submissionId: m.gsheets.colSubmissionId,
    });

  /**
   * Create the spreadsheet, tab and header row in one go.
   *
   * With no columns arranged yet, the form's own questions become the columns
   * first, so the sheet that opens already has its headings. An author who did
   * arrange columns keeps exactly those.
   */
  function createSheet() {
    const columns = state.columns.some(isCompleteColumn) ? state.columns : defaults();
    const headers = columns.filter(isCompleteColumn).map((c) => c.header.trim());
    const title = m.gsheets.newSheetTitle.replace('{form}', formName.trim() || m.gsheets.title);
    start(async () => {
      const res = await callAction(() =>
        googleSheetsCreateAction({ title, sheetTitle: m.gsheets.defaultTab, headers }),
      );
      if (!res.ok) {
        error(m.gsheets.createFailed);
        return;
      }
      if (!res.data.ok) {
        error(res.data.reason === 'unavailable' ? m.gsheets.createFailed : m.gsheets.sheetForbidden);
        return;
      }
      setSheetName(res.data.spreadsheetTitle);
      patch({ spreadsheetId: res.data.spreadsheetId, sheetTitle: res.data.sheetTitle, columns });
      success(m.gsheets.sheetCreated);
    });
  }

  /** Choose an existing spreadsheet in Google's Picker. */
  function chooseSheet() {
    start(async () => {
      const res = await callAction(() => googleSheetsPickerAction());
      if (!res.ok || !res.data.enabled) {
        error(m.gsheets.pickerFailed);
        return;
      }
      let picked: Awaited<ReturnType<typeof pickSpreadsheet>>;
      try {
        picked = await pickSpreadsheet({
          accessToken: res.data.accessToken,
          apiKey: res.data.apiKey,
          appId: res.data.appId,
          locale,
        });
      } catch {
        error(m.gsheets.pickerFailed);
        return;
      }
      // Closed without choosing: nothing changes, and nothing is announced.
      if (!picked) return;
      setSheetName(picked.name);
      // The tab is cleared, not kept: it named a tab of the PREVIOUS
      // spreadsheet, and a stale name would be matched against this one's tabs
      // at delivery time and miss.
      patch({ spreadsheetId: picked.id, sheetTitle: '' });
    });
  }

  const { confirm: confirmDialog, dialog } = useConfirmDialog();

  /**
   * Bring row 1 in line with the saved columns. `replace` is the author's
   * explicit way out of a row 1 that does not match (headings written before
   * dForms recorded them, or edited in the sheet): asked for behind a confirm,
   * because it overwrites cells dForms cannot prove are its own.
   */
  async function syncHeaders(replace = false) {
    if (!formId || !state.spreadsheetId) return;
    if (replace) {
      const ok = await confirmDialog({
        title: m.gsheets.replaceTitle,
        message: m.gsheets.replaceBody,
        confirmLabel: m.gsheets.replaceRow,
        cancelLabel: m.gsheets.replaceCancel,
        destructive: true,
      });
      if (!ok) return;
    }
    start(async () => {
      await beforeHeaderSync?.();
      const res = await callAction(() => syncSheetHeadersAction(formId, replace));
      if (!res.ok) {
        onHeaderSync?.({ outcome: 'failed', reason: 'unavailable' });
        return;
      }
      if (!res.data.ok) {
        // Nothing stored yet to sync (no complete column): the save that
        // stores one runs the sync itself.
        onHeaderSync?.(null);
        return;
      }
      const { ok: _ok, ...sync } = res.data;
      onHeaderSync?.(sync as SheetHeaderSync);
    });
  }

  const setColumns = (columns: SheetColumn[]) => patch({ columns });
  // A stored key the form no longer offers (a deleted question, or a `name`
  // question's own key, saved before it was offered as its two answers) stays
  // selected as itself instead of the select falling back to "pick one".
  const answerOptions = (current: string | undefined) => {
    const options = questions.map((q) => ({ value: q.key, label: q.label || q.key }));
    return current && !options.some((o) => o.value === current)
      ? [{ value: current, label: current }, ...options]
      : options;
  };
  const sourceOptions = sheetColumnSource.map((source) => ({
    value: source,
    label: m.gsheets.sources[source],
  }));
  const tabOptions = [
    { value: '', label: m.gsheets.tabFirst },
    // A stored tab the list does not (yet) hold stays selectable as itself.
    ...(state.sheetTitle && !(tabs ?? []).some((t) => t.title === state.sheetTitle)
      ? [{ value: state.sheetTitle, label: state.sheetTitle }]
      : []),
    ...(tabs ?? []).map((t) => ({ value: t.title, label: t.title })),
  ];
  // Columns the author is still filling in are not stored, so they are not in
  // row 1 either. While any exist, a green "row 1 matches" would be a claim
  // about the columns on screen that is not true: say which ones are pending.
  const pendingLetters = state.columns
    .map((c, i) => (isCompleteColumn(c) ? null : sheetColumnLetter(i)))
    .filter((l): l is string => l !== null);
  const syncResult = headerSync ? headerSyncLine(headerSync, m.gsheets) : null;
  const syncLine: { text: string; tone: 'ok' | 'warn' | 'error' | 'info' } | null =
    pendingLetters.length && state.spreadsheetId && (!syncResult || syncResult.tone === 'ok')
      ? {
          text: (pendingLetters.length === 1 ? m.gsheets.columnPendingOne : m.gsheets.columnPendingMany).replace(
            '{cols}',
            pendingLetters.join(', '),
          ),
          tone: 'info',
        }
      : syncResult;
  const cm = getMessages(locale ?? 'en').admin.connections;
  const returnTo = formId ? `/admin/forms/${formId}/edit` : undefined;

  return (
    <Card
      title={m.gsheets.title}
      desc={m.gsheets.desc}
      enabled={state.enabled}
      onToggle={(enabled) => patch({ enabled })}
      m={m}
      logo="google-sheets"
      id="gsheets-card"
    >
      {!connected ? (
        <ConnectInPlace
          provider={m.gsheets.title}
          title={m.gsheets.connectTitle}
          body={m.gsheets.notConnected}
          access={access}
          m={m}
          cm={cm}
          testId="gsheets-not-connected"
        >
          <GoogleConnectButton returnTo={returnTo} m={cm} />
        </ConnectInPlace>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{m.gsheets.sheetLabel}</h3>
            {state.spreadsheetId ? (
              <a
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-fit max-w-full')}
                data-testid="gsheets-current"
                href={sheetUrlFor(state.spreadsheetId)}
                target="_blank"
                rel="noopener noreferrer"
                title={m.gsheets.openSheet}
              >
                <IntegrationMark provider="google-sheets" size={14} />
                <span className="truncate">{sheetName || m.gsheets.openSheet}</span>
                <i aria-hidden className="pi pi-external-link text-muted-foreground" style={{ fontSize: 11 }} />
              </a>
            ) : (
              // Only promise Google Drive where the Picker button is really there.
              <p className="text-sm text-muted-foreground">
                {pickerAvailable ? m.gsheets.sheetHelp : m.gsheets.sheetHelpCreateOnly}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant={state.spreadsheetId ? 'soft' : 'default'}
                size="sm"
                className={SOFT_DISABLED}
                onClick={createSheet}
                disabled={pending}
              >
                <i aria-hidden className="pi pi-plus" style={{ fontSize: 11 }} />
                {m.gsheets.createSheet}
              </Button>
              {pickerAvailable ? (
                <Button variant="soft" size="sm" className={SOFT_DISABLED} onClick={chooseSheet} disabled={pending}>
                  <i aria-hidden className="pi pi-folder" style={{ fontSize: 11 }} />
                  {m.gsheets.chooseSheet}
                </Button>
              ) : null}
            </div>
          </section>

          {state.spreadsheetId ? (
            <section className="flex max-w-sm flex-col gap-1.5">
              <h3 className="text-sm font-semibold">{m.gsheets.tabLabel}</h3>
              <Select
                value={state.sheetTitle}
                onChange={(sheetTitle) => patch({ sheetTitle })}
                options={tabOptions}
                ariaLabel={m.gsheets.tabLabel}
                disabled={loadingTabs || !tabs}
                className="h-9"
                locale={locale}
              />
              {tabsError ? (
                <span role="alert" className="text-xs text-destructive">
                  {tabsError}
                </span>
              ) : null}
            </section>
          ) : null}

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{m.gsheets.columnsLabel}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{m.gsheets.columnsHelp}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="soft" size="sm" className={SOFT_DISABLED} onClick={() => setColumns(defaults())}>
                  {m.gsheets.fillFromForm}
                </Button>
                {formId ? (
                  <Button
                    variant="soft"
                    size="sm"
                    onClick={() => void syncHeaders()}
                    disabled={pending || !state.spreadsheetId || state.columns.length === 0}
                    className={SOFT_DISABLED}
                    data-testid="gsheets-sync-headers"
                  >
                    <i aria-hidden className="pi pi-refresh" style={{ fontSize: 11 }} />
                    {m.gsheets.writeHeaders}
                  </Button>
                ) : null}
              </div>
            </div>

            {/* ABOVE the column list: it is about the whole row 1, and on a
                phone a list of stacked columns would push it out of sight. */}
            {headerSync?.outcome === 'foreign' ? (
              <HeaderMismatch
                sync={headerSync}
                pending={pending}
                onReplace={() => void syncHeaders(true)}
                m={m.gsheets}
              />
            ) : null}

            {state.columns.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                {m.gsheets.noColumns}
              </p>
            ) : (
              // A container query, not a viewport breakpoint: the Connect tab
              // is a column beside the settings panel, so the window can be
              // wide while this card is narrow. Every row is the same grid, so
              // the four slots line up down the list as well as across it, and
              // below the width they need the pickers drop under the heading
              // instead of wrapping wherever they land.
              <div className="@container">
                <div className="overflow-visible rounded-lg border border-border">
                  <div
                    aria-hidden
                    className="hidden grid-cols-[1.75rem_minmax(0,1.15fr)_10rem_minmax(0,1fr)_6.5rem] gap-x-2 border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground @2xl:grid"
                  >
                    <span />
                    <span>{m.gsheets.headerFor}</span>
                    <span>{m.gsheets.sourceFor}</span>
                    <span>{m.gsheets.keyFor}</span>
                    <span />
                  </div>
                  <ul className="divide-y divide-border">
                    {state.columns.map((column, index) => {
                      const takesKey = column.source === 'answer' || column.source === 'utm';
                      const missing = columnMissing(column);
                      return (
                        <li
                          key={index}
                          data-testid="gsheets-column"
                          className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-x-2 gap-y-2 px-3 py-2.5 @2xl:grid-cols-[1.75rem_minmax(0,1.15fr)_10rem_minmax(0,1fr)_6.5rem]"
                        >
                          {/* The sheet's own column letter: what the author
                              will see above this heading in Google Sheets. */}
                          <span
                            aria-hidden
                            className="col-start-1 row-start-1 flex h-7 w-7 items-center justify-center rounded-md bg-muted text-xs font-semibold tabular-nums text-muted-foreground"
                          >
                            {sheetColumnLetter(index)}
                          </span>
                          <Input
                            value={column.header}
                            aria-label={m.gsheets.headerFor}
                            placeholder={m.gsheets.headerFor}
                            // Narrow: a line of its own under the letter and
                            // the actions. Wide: the second cell of the row.
                            className="col-span-2 row-start-2 h-9 @2xl:col-span-1 @2xl:col-start-2 @2xl:row-start-1"
                            onChange={(e) => {
                              const next = [...state.columns];
                              next[index] = { ...column, header: e.target.value };
                              setColumns(next);
                            }}
                          />
                          <div className="col-span-2 row-start-3 grid grid-cols-1 gap-2 @md:grid-cols-2 @2xl:contents">
                            <Select
                              value={column.source}
                              ariaLabel={m.gsheets.sourceFor}
                              options={sourceOptions}
                              className="min-h-9 py-1.5"
                              labelClassName="line-clamp-2 break-words"
                              locale={locale}
                              onChange={(value) => {
                                const source = value as SheetColumnSource;
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
                            />
                            {takesKey ? (
                              <Select
                                value={column.key ?? ''}
                                ariaLabel={m.gsheets.keyFor}
                                placeholder={m.gsheets.pickOne}
                                options={
                                  column.source === 'answer'
                                    ? answerOptions(column.key)
                                    : UTM_KEYS.map((k) => ({ value: k, label: k }))
                                }
                                searchable={column.source === 'answer'}
                                className="min-h-9 py-1.5"
                                labelClassName="line-clamp-2 break-words"
                                locale={locale}
                                onChange={(key) => {
                                  const next = [...state.columns];
                                  next[index] = { ...column, key };
                                  setColumns(next);
                                }}
                              />
                            ) : (
                              // The slot is HELD when this source takes no key,
                              // so the actions sit in the same place on every row.
                              // Stacked (one picker per line) it would only add a gap.
                              <span aria-hidden className="hidden @md:block" />
                            )}
                          </div>
                          <div className="col-start-2 row-start-1 flex justify-end gap-1 @2xl:col-start-5">
                            <RowIconButton
                              icon="pi-arrow-up"
                              label={m.gsheets.moveUp}
                              disabled={index === 0}
                              onClick={() => setColumns(moveColumn(state.columns, index, -1))}
                            />
                            <RowIconButton
                              icon="pi-arrow-down"
                              label={m.gsheets.moveDown}
                              disabled={index === state.columns.length - 1}
                              onClick={() => setColumns(moveColumn(state.columns, index, 1))}
                            />
                            <RowIconButton
                              icon="pi-times"
                              label={m.gsheets.removeColumn}
                              onClick={() => setColumns(state.columns.filter((_, i) => i !== index))}
                            />
                          </div>
                          {/* What THIS row still needs, exactly: the row is
                              saved, it is just not in the sheet yet. */}
                          {missing ? (
                            <p
                              data-testid="gsheets-column-missing"
                              data-missing={missing}
                              className="col-[1/-1] flex items-start gap-1.5 text-xs text-muted-foreground @2xl:col-[2/-1]"
                            >
                              <i aria-hidden className="pi pi-info-circle mt-px shrink-0" style={{ fontSize: 12 }} />
                              {missing === 'header'
                                ? m.gsheets.rowNeedsHeader
                                : missing === 'both'
                                  ? m.gsheets.rowNeedsBoth
                                  : column.source === 'utm'
                                    ? m.gsheets.rowNeedsUtm
                                    : m.gsheets.rowNeedsAnswer}
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            )}

            {syncLine ? (
              <p
                role="status"
                data-testid="gsheets-header-sync"
                data-tone={syncLine.tone}
                className={cn(
                  'flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
                  syncLine.tone === 'ok' && 'border-signal-edge/40 bg-signal/10 text-foreground',
                  syncLine.tone === 'warn' && 'border-warning/40 bg-warning/10 text-foreground',
                  syncLine.tone === 'error' && 'border-destructive/40 bg-destructive/10 text-destructive',
                  syncLine.tone === 'info' && 'border-border bg-muted/40 text-foreground',
                )}
              >
                <i
                  aria-hidden
                  className={cn(
                    'pi mt-px shrink-0',
                    syncLine.tone === 'ok' && 'pi-check-circle text-signal-ink',
                    syncLine.tone === 'warn' && 'pi-exclamation-circle text-warning-ink',
                    syncLine.tone === 'error' && 'pi-exclamation-triangle',
                    syncLine.tone === 'info' && 'pi-info-circle text-muted-foreground',
                  )}
                  style={{ fontSize: 13 }}
                />
                <span>{syncLine.text}</span>
              </p>
            ) : null}

            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setColumns([...state.columns, { header: '', source: 'answer' }])}
            >
              <i aria-hidden className="pi pi-plus" style={{ fontSize: 11 }} />
              {m.gsheets.addColumn}
            </Button>
          </section>
        </>
      )}
      {dialog}
    </Card>
  );
}

/**
 * The base button greys a disabled soft pill to the same grey it already is,
 * so a disabled one looked exactly like an enabled one. Faded instead.
 */
const SOFT_DISABLED = 'disabled:bg-muted disabled:opacity-45';

/**
 * Row 1 does not match the columns: say so plainly, show what is in the sheet
 * beside what would be written, and offer the one explicit way out.
 *
 * Plain, not "dForms did not write this": a sheet whose headings were written
 * before dForms kept a record (or renamed since) is the common case, and that
 * claim would be false about it. The automatic sync stays conservative; this
 * is where an author who knows the row is theirs to replace can say so.
 */
function HeaderMismatch({
  sync,
  pending,
  onReplace,
  m,
}: {
  sync: { current: string[]; headers: string[] };
  pending: boolean;
  onReplace: () => void;
  m: Msgs['gsheets'];
}) {
  const width = Math.max(sync.current.length, sync.headers.length);
  const cell = (text: string | undefined) =>
    text ? <span>{text}</span> : <span className="italic text-muted-foreground">{m.headersEmptyCell}</span>;
  return (
    <div
      role="status"
      data-testid="gsheets-header-mismatch"
      className="flex flex-col gap-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
    >
      <p className="flex items-start gap-2 text-foreground">
        <i aria-hidden className="pi pi-exclamation-circle mt-0.5 shrink-0 text-warning-ink" style={{ fontSize: 13 }} />
        <span>{m.headersNotEmpty}</span>
      </p>
      <div className="max-h-64 overflow-auto rounded-md border border-border bg-card">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-card text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="w-16 px-3 py-2 font-medium">
                {m.headersColumn}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {m.headersInSheet}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {m.headersToWrite}
              </th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: width }, (_, i) => {
              const same = (sync.current[i] ?? '') === (sync.headers[i] ?? '');
              return (
                <tr key={i} data-same={same} className="border-b border-border last:border-0">
                  <td className="px-3 py-1.5 font-semibold tabular-nums text-muted-foreground">
                    {sheetColumnLetter(i)}
                  </td>
                  <td className={cn('break-words px-3 py-1.5', !same && 'text-muted-foreground line-through decoration-muted-foreground/50')}>
                    {cell(sync.current[i])}
                  </td>
                  <td className={cn('break-words px-3 py-1.5', !same && 'font-medium')}>{cell(sync.headers[i])}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Button
        variant="destructive"
        size="sm"
        className="self-start"
        onClick={onReplace}
        disabled={pending}
        data-testid="gsheets-replace-row"
      >
        {m.replaceRow}
      </Button>
    </div>
  );
}
