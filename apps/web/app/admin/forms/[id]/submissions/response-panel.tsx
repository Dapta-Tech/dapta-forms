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
import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { t } from '@quill/shared';
import { Drawer } from '@/components/drawer';
import { inNestedDialog } from '@/components/modal';
import type { AnswerView, ResponseDetail } from './response-detail';
import { StatusBadge } from './status-badge';
import { SubmissionFileButton, type FileButtonLabels } from './submission-file-button';
import { DeleteSubmissionButton } from './row-actions';

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
}

/** The query parameter that names the open response, so it survives a reload and can be shared. */
export const RESPONSE_PARAM = 'response';

const LABEL_ID = 'response-panel-title';

/**
 * Put the open response in the address bar without a navigation. Native
 * `replaceState`, never `router.replace`: the router would re-run the server
 * page (and its API calls) just to move a panel. Replace rather than push, so
 * walking twenty responses does not leave twenty Back steps behind.
 */
function writeResponseParam(id: string | null): void {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set(RESPONSE_PARAM, id);
  else url.searchParams.delete(RESPONSE_PARAM);
  window.history.replaceState(null, '', url);
}

/**
 * Wraps the submissions table: a click on a row (or on its "View response"
 * button) opens that response in the panel.
 *
 * The rows stay server-rendered; one delegated handler here reads the row's
 * `data-response-id`. A click that lands on something that already does a job
 * (a file button, the delete button, a link, a dialog opened from the row)
 * keeps doing that job and opens nothing, and so does a drag that selected text:
 * copying an answer out of the table must not throw a panel over it.
 */
export function ResponsesViewer({
  formId,
  items,
  initialId,
  labels,
  fileLabels,
  children,
}: {
  formId: string;
  items: ResponseDetail[];
  /** `?response=` on load. Ignored when that response is not on this page. */
  initialId?: string;
  labels: PanelLabels;
  fileLabels: FileButtonLabels;
  children: ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(() =>
    initialId && items.some((i) => i.id === initialId) ? initialId : null,
  );
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

  const show = useCallback((id: string | null) => {
    setOpenId(id);
    if (id) setShownId(id);
    writeResponseParam(id);
  }, []);

  const go = useCallback(
    (delta: number) => {
      const next = items[index + delta];
      if (next) show(next.id);
    },
    [items, index, show],
  );

  // A new response starts at its first question, not at the scroll depth of
  // the one before it.
  useEffect(() => {
    if (!openId) return;
    document.querySelector('[data-drawer-body]')?.parentElement?.scrollTo({ top: 0 });
  }, [openId]);

  // The open response left the page (deleted from the panel, or by someone
  // else before a refresh): close rather than show a record that is gone.
  useEffect(() => {
    if (openId && index < 0) show(null);
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

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as Element;
    const trigger = target.closest<HTMLElement>('[data-open-response]');
    if (trigger?.dataset.openResponse) {
      show(trigger.dataset.openResponse);
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
    if (row?.dataset.responseId) show(row.dataset.responseId);
  };

  return (
    <>
      <div onClick={onClick}>{children}</div>
      <Drawer
        open={current != null}
        onClose={() => show(null)}
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
              onClose={() => show(null)}
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
          />
        ) : null}
      </Drawer>
    </>
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

/** The panel body: the answers, then the facts about the response. Static, so it renders without a DOM. */
export function ResponseDetailView({
  detail,
  formId,
  labels,
  fileLabels,
}: {
  detail: ResponseDetail;
  formId: string;
  labels: PanelLabels;
  fileLabels: FileButtonLabels;
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
              className={
                a.kind === 'empty'
                  ? 'rounded-lg border border-dashed border-border px-4 py-3'
                  : `${card} px-4 py-3.5 transition-colors hover:border-primary-edge/40`
              }
              data-answer-kind={a.kind}
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
