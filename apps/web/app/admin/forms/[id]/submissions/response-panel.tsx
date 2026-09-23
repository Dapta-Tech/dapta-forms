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

  const show = useCallback((id: string | null) => {
    setOpenId(id);
    writeResponseParam(id);
  }, []);

  const go = useCallback(
    (delta: number) => {
      const next = items[index + delta];
      if (next) show(next.id);
    },
    [items, index, show],
  );

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
          current ? (
            <PanelHeader
              detail={current}
              position={t(labels.responsePosition, {
                n: index + 1,
                total: items.length,
              })}
              hasPrev={index > 0}
              hasNext={index < items.length - 1}
              onPrev={() => go(-1)}
              onNext={() => go(1)}
              onClose={() => show(null)}
              labels={labels}
            />
          ) : null
        }
        footer={
          current ? (
            <div className="flex justify-end">
              <DeleteSubmissionButton
                formId={formId}
                submissionId={current.id}
                labels={{
                  delete: labels.delete,
                  confirm: labels.deleteConfirm,
                }}
              />
            </div>
          ) : null
        }
      >
        {current ? (
          <ResponseDetailView
            detail={current}
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
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <h2 id={LABEL_ID} className="text-lg font-semibold tracking-tight">
            {labels.responseTitle}
          </h2>
          <span
            className="text-sm tabular-nums text-muted-foreground"
            data-testid="response-position"
          >
            {position}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <StatusBadge
            completed={detail.completed}
            label={detail.completed ? labels.badgeCompleted : labels.badgePartial}
          />
          <span>{detail.submittedAt}</span>
        </div>
      </div>
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
      return <p className="text-muted-foreground">{labels.noAnswer}</p>;
    case 'text':
      return (
        <p
          className={
            answer.long ? 'whitespace-pre-wrap break-words leading-relaxed' : 'break-words'
          }
        >
          {answer.text}
        </p>
      );
    case 'choices':
      return (
        <ul className="flex flex-wrap gap-1.5">
          {answer.choices.map((c, i) => (
            <li
              key={`${c}-${i}`}
              className="rounded-md border border-border bg-accent/40 px-2 py-0.5 text-xs font-medium"
            >
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
          className="break-all text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
        >
          {answer.text}
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
  const heading = 'mb-2 text-2xs font-medium uppercase tracking-wide text-faint';
  return (
    <div data-drawer-body tabIndex={-1} className="flex flex-col gap-6 text-sm outline-none">
      <section>
        <h3 className={heading}>{labels.answersTitle}</h3>
        <ol className="flex flex-col divide-y divide-border" data-testid="response-answers">
          {detail.answers.map((a) => (
            <li
              key={a.key}
              className="flex flex-col gap-1.5 py-3 first:pt-1"
              data-answer-kind={a.kind}
            >
              <p className="font-medium text-muted-foreground">{a.label}</p>
              <AnswerValueView
                answer={a}
                responseId={detail.id}
                formId={formId}
                labels={labels}
                fileLabels={fileLabels}
              />
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h3 className={heading}>{labels.detailsTitle}</h3>
        <dl
          className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-6 gap-y-2"
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
              <dd className="tabular-nums">{detail.score}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">{labels.responseId}</dt>
          <dd className="select-all break-all font-mono text-xs">{detail.id}</dd>
        </dl>
      </section>

      {detail.utm.length > 0 ? (
        <section>
          <h3 className={heading}>{labels.utmTitle}</h3>
          <dl
            className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-6 gap-y-2"
            data-testid="response-utm"
          >
            {detail.utm.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono text-xs text-muted-foreground">{k}</dt>
                <dd className="break-all">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}
