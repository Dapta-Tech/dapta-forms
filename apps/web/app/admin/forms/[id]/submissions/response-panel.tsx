'use client';

/**
 * One response, read in full, in a panel beside the table.
 *
 * The table cannot show a long answer: every cell is one truncated line, and
 * the full text used to live only in a native tooltip that cannot be selected
 * and never appears on a touch screen. Owners were downloading the CSV just to
 * read what people wrote. The panel is where a response is read: every question
 * with its whole answer, and the arrows to walk the page one response at a time.
 *
 * Everything the panel prints is formatted on the server (`buildResponseDetail`);
 * this file only lays it out and handles opening, closing and walking.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { t } from '@quill/shared';
import { Drawer } from '@/components/drawer';
import { inNestedDialog } from '@/components/modal';
import type { AnswerView, ResponseDetail } from './response-detail';
import { StatusBadge } from './status-badge';
import { SubmissionFileButton, type FileButtonLabels } from './submission-file-button';
import { DeleteSubmissionButton } from './row-actions';
import { RESPONSE_PARAM, SHEET_VIEW, VIEW_PARAM } from './viewer-params';

export interface PanelLabels {
  responseTitle: string;
  prevResponse: string;
  nextResponse: string;
  closeResponse: string;
  /** "{n} of {total}" */
  responsePosition: string;
  answersTitle: string;
  detailsTitle: string;
  noAnswer: string;
  colStatus: string;
  colSubmitted: string;
  colStarted: string;
  colScore: string;
  responseId: string;
  utmTitle: string;
  /** "{n} of {total} answered" */
  answeredCount: string;
  badgeCompleted: string;
  badgePartial: string;
  delete: string;
  deleteConfirm: string;
  sheetOpen: string;
  sheetClose: string;
}

const LABEL_ID = 'response-panel-title';

/**
 * Put the viewer's state in the address bar without a navigation. Native
 * `replaceState`, never `router.replace`: the router would re-run the server
 * page (and its API calls) just to move a panel. Replace rather than push, so
 * walking twenty responses does not leave twenty Back steps behind.
 */
function writeParam(name: string, value: string | null): void {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(name, value);
  else url.searchParams.delete(name);
  window.history.replaceState(null, '', url);
}

/** Whether the table is open as the full-screen sheet; read by `PagerLink`. */
const SheetContext = createContext(false);

/**
 * A pager link that keeps the sheet open on the next page. The hrefs are built
 * on the server, which cannot know the sheet was opened after the page loaded
 * (the toggle only rewrites the address bar), so the view is added here.
 */
export function PagerLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: ReactNode;
}) {
  const sheet = useContext(SheetContext);
  let to = href;
  if (sheet) {
    const q = new URLSearchParams(href.replace(/^\?/, ''));
    q.set(VIEW_PARAM, SHEET_VIEW);
    to = `?${q.toString()}`;
  }
  return (
    <Link href={to} scroll={false} className={className}>
      {children}
    </Link>
  );
}

const TOOLBAR_BUTTON =
  'inline-flex h-9 items-center gap-2 rounded-md border border-border bg-transparent px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Wraps the submissions table: a click on a row (or on its "View response"
 * button) opens that response in the panel, and a click on one answer cell
 * opens it scrolled to that question.
 *
 * The rows stay server-rendered; one delegated handler here reads the row's
 * `data-response-id` and the cell's `data-answer-key`. A click that lands on
 * something that already does a job (a file button, the delete button, a link,
 * a dialog opened from the row) keeps doing that job and opens nothing, and so
 * does a drag that selected text: copying an answer out of the table must not
 * throw a panel over it.
 *
 * The same table can be opened as a full-screen sheet over the whole app. The
 * markup does not change: the wrapper carries `data-sheet`, and the table's
 * own `in-data-sheet:` classes take the room (sticky header, wider cells, three
 * lines per cell). The panel opens over the sheet exactly as over the page.
 */
export function ResponsesViewer({
  formId,
  title,
  items,
  initialId,
  initialSheet = false,
  labels,
  fileLabels,
  pager,
  children,
}: {
  formId: string;
  /** The form's name, on the sheet's top bar. */
  title: string;
  items: ResponseDetail[];
  /** `?response=` on load. Ignored when that response is not on this page. */
  initialId?: string;
  /** `?view=sheet` on load. */
  initialSheet?: boolean;
  labels: PanelLabels;
  fileLabels: FileButtonLabels;
  /** The range and the page links, under the table in both views. */
  pager?: ReactNode;
  children: ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(() =>
    initialId && items.some((i) => i.id === initialId) ? initialId : null,
  );
  /**
   * The question the panel should land on: the cell that was clicked. Walking
   * to the next response keeps it, so the same question can be compared down
   * the page; a click on the row itself, away from any answer, clears it.
   */
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [sheet, setSheet] = useState(initialSheet);
  const rootRef = useRef<HTMLDivElement>(null);
  const openSheetRef = useRef<HTMLButtonElement>(null);
  const closeSheetRef = useRef<HTMLButtonElement>(null);
  const index = openId ? items.findIndex((i) => i.id === openId) : -1;
  const current = index >= 0 ? items[index]! : null;
  /**
   * The last response opened. Closing clears `openId` at once (the dialog
   * contract ends there), but the drawer keeps drawing this one while it
   * slides out, instead of emptying mid-animation.
   */
  const [shownId, setShownId] = useState(openId);
  const shownIndex = shownId ? items.findIndex((i) => i.id === shownId) : -1;
  const shown = current ?? (shownIndex >= 0 ? items[shownIndex]! : null);
  const shownAt = current ? index : shownIndex;

  /** Open (or close, with null) a response. `key` names the question to land on; omitted, it is kept. */
  const show = useCallback((id: string | null, key?: string | null) => {
    setOpenId(id);
    if (id) setShownId(id);
    if (key !== undefined) setFocusKey(key);
    writeParam(RESPONSE_PARAM, id);
  }, []);

  const toggleSheet = useCallback((on: boolean) => {
    setSheet(on);
    writeParam(VIEW_PARAM, on ? SHEET_VIEW : null);
  }, []);

  const go = useCallback(
    (delta: number) => {
      const next = items[index + delta];
      if (next) show(next.id);
    },
    [items, index, show],
  );

  // Land on the clicked question, or at the top: never at the scroll depth of
  // the response before.
  useEffect(() => {
    if (!openId) return;
    const body = document.querySelector<HTMLElement>('[data-drawer-body]');
    const scroller = body?.parentElement;
    if (!body || !scroller) return;
    const target = focusKey
      ? body.querySelector<HTMLElement>(`[data-answer-key="${CSS.escape(focusKey)}"]`)
      : null;
    if (!target) {
      scroller.scrollTo({ top: 0 });
      return;
    }
    // Measured, not `scrollIntoView`: that would also scroll the panel's
    // clipped ancestors and shift the whole drawer.
    const top =
      target.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    scroller.scrollTo({ top: Math.max(0, top - 16) });
  }, [openId, focusKey]);

  // Mark the open response's row, and keep it in view while walking the sheet.
  useEffect(() => {
    const rows = [
      ...(rootRef.current?.querySelectorAll<HTMLElement>('tr[data-response-id]') ?? []),
    ];
    let active: HTMLElement | null = null;
    for (const row of rows) {
      const on = row.dataset.responseId === openId;
      row.toggleAttribute('data-active', on);
      if (on) active = row;
    }
    if (sheet && active) active.scrollIntoView({ block: 'nearest' });
  }, [openId, sheet]);

  // The open response left the page (deleted from the panel, or by someone
  // else before a refresh): close rather than show a record that is gone.
  useEffect(() => {
    if (openId && index < 0) show(null, null);
  }, [openId, index, show]);

  // Up / Down walk the page, like the arrows in the header. Not while a dialog
  // opened from the panel has the keys (a file preview, the delete confirm),
  // and not inside the scrolling body, where the arrows scroll the answers.
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const panel =
        document.getElementById(LABEL_ID)?.closest<HTMLElement>('[role="dialog"]') ?? null;
      if (inNestedDialog(e.target, panel)) return;
      if (
        e.target instanceof Element &&
        e.target.closest('[data-drawer-body], input, textarea, select')
      )
        return;
      e.preventDefault();
      go(e.key === 'ArrowUp' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, go]);

  // While the sheet is up: the page behind it does not scroll, focus starts on
  // the way out, and Esc leaves it. Esc belongs to any dialog first (the panel,
  // a file preview, a delete confirm): the sheet only takes one nobody else is
  // showing, so the first Esc closes the panel and the second the sheet.
  useEffect(() => {
    if (!sheet) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeSheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // `aria-modal`, not `role="dialog"`: every open dialog here (Modal,
      // Drawer, ConfirmDialog) is modal, while the admin shell's mobile nav
      // is a `role="dialog"` that lives in the DOM even when shut.
      if (document.querySelector('[aria-modal="true"]')) return;
      toggleSheet(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      openSheetRef.current?.focus();
    };
  }, [sheet, toggleSheet]);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as Element;
    const trigger = target.closest<HTMLElement>('[data-open-response]');
    if (trigger?.dataset.openResponse) {
      show(trigger.dataset.openResponse, null);
      return;
    }
    if (
      target.closest(
        'a, button, input, select, textarea, label, [role="dialog"], [role="alertdialog"]',
      )
    )
      return;
    if (window.getSelection()?.toString()) return;
    const row = target.closest<HTMLElement>('tr[data-response-id]');
    if (!row?.dataset.responseId) return;
    const cell = target.closest<HTMLElement>('td[data-answer-key]');
    show(row.dataset.responseId, cell?.dataset.answerKey ?? null);
  };

  return (
    <SheetContext.Provider value={sheet}>
      <div
        ref={rootRef}
        data-sheet={sheet ? '' : undefined}
        data-testid="responses-viewer"
        className={
          sheet
            ? 'fixed inset-0 z-40 flex animate-backdrop-in flex-col bg-background'
            : 'flex flex-col gap-3'
        }
      >
        {sheet ? (
          <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-popover px-4 sm:px-5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground ring-1 ring-primary-edge"
              >
                <i className="pi pi-table" style={{ fontSize: 12 }} />
              </span>
              <h2 className="truncate text-base font-semibold">{title}</h2>
            </div>
            <button
              ref={closeSheetRef}
              type="button"
              onClick={() => toggleSheet(false)}
              aria-label={labels.sheetClose}
              title={labels.sheetClose}
              data-testid="sheet-close"
              className={TOOLBAR_BUTTON}
            >
              <i aria-hidden className="pi pi-window-minimize" style={{ fontSize: 12 }} />
              <span className="hidden sm:inline">{labels.sheetClose}</span>
            </button>
          </div>
        ) : (
          <div className="flex justify-end">
            <button
              ref={openSheetRef}
              type="button"
              onClick={() => toggleSheet(true)}
              data-testid="sheet-open"
              className={TOOLBAR_BUTTON}
            >
              <i aria-hidden className="pi pi-expand" style={{ fontSize: 12 }} />
              {labels.sheetOpen}
            </button>
          </div>
        )}
        <div
          onClick={onClick}
          className={sheet ? 'flex min-h-0 flex-1 flex-col p-3 sm:p-4' : undefined}
        >
          {children}
        </div>
        {pager ? (
          <div
            className={
              sheet ? 'shrink-0 border-t border-border bg-popover px-4 py-2.5 sm:px-5' : undefined
            }
          >
            {pager}
          </div>
        ) : null}
      </div>
      <Drawer
        open={current != null}
        onClose={() => show(null, null)}
        labelId={LABEL_ID}
        header={
          shown ? (
            <PanelHeader
              detail={shown}
              position={t(labels.responsePosition, {
                n: shownAt + 1,
                total: items.length,
              })}
              hasPrev={shownAt > 0}
              hasNext={shownAt < items.length - 1}
              onPrev={() => go(-1)}
              onNext={() => go(1)}
              onClose={() => show(null, null)}
              labels={labels}
            />
          ) : null
        }
        footer={
          shown ? (
            <div className="flex justify-end">
              <DeleteSubmissionButton
                formId={formId}
                submissionId={shown.id}
                size="md"
                labels={{
                  delete: labels.delete,
                  confirm: labels.deleteConfirm,
                }}
              />
            </div>
          ) : null
        }
      >
        {shown ? (
          <ResponseDetailView
            detail={shown}
            formId={formId}
            labels={labels}
            fileLabels={fileLabels}
            focusKey={focusKey}
          />
        ) : null}
      </Drawer>
    </SheetContext.Provider>
  );
}

function IconButton({
  icon,
  label,
  onClick,
  disabled,
  testId,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      data-testid={testId}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
    >
      <i aria-hidden className={`pi ${icon}`} style={{ fontSize: 12 }} />
    </button>
  );
}

/**
 * The header's identity, by one rule for every form: the title is the first
 * contact the form collected (name, then email, then phone), the line under it
 * the next one. A form that asks for none of them keeps the same layout with an
 * anonymous title and a person icon in the avatar.
 */
function identity(respondent: ResponseDetail['respondent'], anonymous: string) {
  const [title, contact] = [respondent.name, respondent.email, respondent.phone].filter(
    (v): v is string => v != null,
  );
  return { title: title ?? anonymous, contact: contact ?? null };
}

/** Up to two initials for the avatar: from the name, else the email's first letter. */
function initials(respondent: ResponseDetail['respondent']): string | null {
  const words = respondent.name?.split(/\s+/).filter(Boolean) ?? [];
  if (words.length > 0)
    return words
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('');
  return respondent.email ? respondent.email[0]!.toUpperCase() : null;
}

function PanelHeader({
  detail,
  position,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  labels,
}: {
  detail: ResponseDetail;
  position: string;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  labels: PanelLabels;
}) {
  const { title, contact } = identity(detail.respondent, labels.responseTitle);
  const mark = initials(detail.respondent);
  const total = detail.answers.length;
  const answered = detail.answers.filter((a) => a.kind !== 'empty').length;
  const pct = total > 0 ? Math.round((answered / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span
          className="text-xs font-medium tabular-nums text-muted-foreground"
          data-testid="response-position"
        >
          {position}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            icon="pi-chevron-up"
            label={labels.prevResponse}
            onClick={onPrev}
            disabled={!hasPrev}
            testId="response-prev"
          />
          <IconButton
            icon="pi-chevron-down"
            label={labels.nextResponse}
            onClick={onNext}
            disabled={!hasNext}
            testId="response-next"
          />
          <IconButton
            icon="pi-times"
            label={labels.closeResponse}
            onClick={onClose}
            testId="response-close"
          />
        </div>
      </div>

      <div key={detail.id} className="flex animate-response-in items-center gap-3.5">
        <span
          aria-hidden
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-base font-semibold text-primary-foreground shadow-sm ring-1 ring-primary-edge"
          data-testid="response-avatar"
        >
          {mark ?? <i className="pi pi-user" style={{ fontSize: 18 }} />}
        </span>
        <div className="min-w-0">
          <h2 id={LABEL_ID} className="truncate text-lg font-semibold tracking-tight">
            {title}
          </h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {contact ? <span className="truncate">{contact}</span> : null}
            {contact ? (
              <span aria-hidden className="text-faint">
                ·
              </span>
            ) : null}
            <span>{detail.submittedAt}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge
          completed={detail.completed}
          label={detail.completed ? labels.badgeCompleted : labels.badgePartial}
        />
        {detail.score != null ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground ring-1 ring-primary-edge"
            data-testid="response-score"
          >
            <i aria-hidden className="pi pi-star-fill" style={{ fontSize: 10 }} />
            {labels.colScore} {detail.score}
          </span>
        ) : null}
        <div className="ml-auto flex min-w-36 flex-1 items-center justify-end gap-2.5">
          <div aria-hidden className="h-1.5 max-w-32 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span
            className="shrink-0 text-xs tabular-nums text-muted-foreground"
            data-testid="response-answered"
          >
            {t(labels.answeredCount, { n: answered, total })}
          </span>
        </div>
      </div>
    </div>
  );
}

function AnswerValueView({
  answer,
  responseId,
  formId,
  labels,
  fileLabels,
}: {
  answer: AnswerView;
  responseId: string;
  formId: string;
  labels: PanelLabels;
  fileLabels: FileButtonLabels;
}) {
  switch (answer.kind) {
    case 'empty':
      return <p className="text-sm italic text-faint">{labels.noAnswer}</p>;
    case 'text':
      return (
        <p
          className={
            answer.long
              ? 'whitespace-pre-wrap break-words text-base leading-relaxed text-foreground'
              : 'break-words text-base font-medium text-foreground'
          }
        >
          {answer.text}
        </p>
      );
    case 'choices':
      return (
        <ul className="flex flex-wrap gap-2">
          {answer.choices.map((c, i) => (
            <li
              key={`${c}-${i}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary-edge/40 bg-primary/15 px-3 py-1 text-sm font-medium text-foreground"
            >
              <i aria-hidden className="pi pi-check text-primary" style={{ fontSize: 10 }} />
              {c}
            </li>
          ))}
        </ul>
      );
    case 'link':
      return (
        <a
          href={answer.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 break-all text-base font-medium text-primary underline decoration-primary-edge/40 underline-offset-4 hover:decoration-primary-edge"
        >
          {answer.text}
          <i aria-hidden className="pi pi-external-link shrink-0" style={{ fontSize: 11 }} />
        </a>
      );
    case 'file':
      return (
        <SubmissionFileButton
          formId={formId}
          submissionId={responseId}
          stepKey={answer.key}
          name={answer.name}
          labels={fileLabels}
        />
      );
  }
}

/**
 * One answer's card. An unanswered step is dashed and bare; the question opened
 * from a table cell is outlined in the accent. One border colour per state, so
 * no two border utilities ever compete on the same element.
 */
function answerCardClass(empty: boolean, focused: boolean): string {
  const edge = focused
    ? 'border-primary-edge ring-2 ring-primary-edge/40'
    : empty
      ? 'border-border'
      : 'border-border hover:border-primary-edge/40';
  return empty
    ? `rounded-lg border border-dashed px-4 py-3 ${edge}`
    : `rounded-lg border bg-card px-4 py-3.5 transition-colors ${edge}`;
}

/** The panel body: the answers, then the facts about the response. Static, so it renders without a DOM. */
export function ResponseDetailView({
  detail,
  formId,
  labels,
  fileLabels,
  focusKey = null,
}: {
  detail: ResponseDetail;
  formId: string;
  labels: PanelLabels;
  fileLabels: FileButtonLabels;
  /** The question opened from a table cell: outlined in the accent so the eye lands on it. */
  focusKey?: string | null;
}) {
  const heading = 'mb-3 text-2xs font-medium uppercase tracking-wide text-faint';
  const card = 'rounded-lg border border-border bg-card';
  return (
    <div
      key={detail.id}
      data-drawer-body
      tabIndex={-1}
      className="flex animate-response-in flex-col gap-7 text-sm outline-none"
    >
      <section>
        <h3 className={heading}>{labels.answersTitle}</h3>
        <ol className="flex flex-col gap-2.5" data-testid="response-answers">
          {detail.answers.map((a, i) => (
            <li
              key={a.key}
              className={answerCardClass(a.kind === 'empty', a.key === focusKey)}
              data-answer-kind={a.kind}
              data-answer-key={a.key}
              data-focused={a.key === focusKey ? '' : undefined}
            >
              <div className="flex items-start gap-2.5">
                <span
                  aria-hidden
                  className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-2xs font-semibold tabular-nums ${
                    a.kind === 'empty' ? 'bg-muted text-faint' : 'bg-primary/15 text-primary'
                  }`}
                >
                  {i + 1}
                </span>
                <p className="text-xs font-medium leading-5 text-muted-foreground">{a.label}</p>
              </div>
              <div className="mt-2 pl-7.5">
                <AnswerValueView
                  answer={a}
                  responseId={detail.id}
                  formId={formId}
                  labels={labels}
                  fileLabels={fileLabels}
                />
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h3 className={heading}>{labels.detailsTitle}</h3>
        <dl
          className={`${card} grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-6 gap-y-2.5 px-4 py-3.5`}
          data-testid="response-details"
        >
          <dt className="text-muted-foreground">{labels.colStatus}</dt>
          <dd>
            <StatusBadge
              completed={detail.completed}
              label={detail.completed ? labels.badgeCompleted : labels.badgePartial}
            />
          </dd>
          <dt className="text-muted-foreground">{labels.colSubmitted}</dt>
          <dd>{detail.submittedAt}</dd>
          <dt className="text-muted-foreground">{labels.colStarted}</dt>
          <dd>{detail.startedAt}</dd>
          {detail.score != null ? (
            <>
              <dt className="text-muted-foreground">{labels.colScore}</dt>
              <dd className="font-semibold tabular-nums text-primary">{detail.score}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">{labels.responseId}</dt>
          <dd className="select-all break-all font-mono text-xs">{detail.id}</dd>
        </dl>
      </section>

      {detail.utm.length > 0 ? (
        <section>
          <h3 className={heading}>{labels.utmTitle}</h3>
          <ul className="flex flex-wrap gap-2" data-testid="response-utm">
            {detail.utm.map(([k, v]) => (
              <li
                key={k}
                className="inline-flex max-w-full items-center overflow-hidden rounded-md border border-border bg-card text-xs"
              >
                <span className="border-r border-border bg-muted px-2 py-1 font-mono text-muted-foreground">
                  {k}
                </span>
                <span className="break-all px-2 py-1 font-medium">{v}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
