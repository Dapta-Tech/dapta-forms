import type { ReactNode } from 'react';
import Link from 'next/link';
import type { QuestionSummary, SummaryBucket } from '@quill/engine';
import { t, type Locale } from '@quill/shared';

/**
 * The static cards of the Summary (choices, scales, files and bookings), and
 * the frame every card shares. Server components: nothing here moves, so none
 * of it ships to the browser. The text card's body is the one client part
 * (`TextAnswers`), passed in as children.
 */

export interface SummaryCardLabels {
  /** "{n} of {total} answered" */
  answered: string;
  multiNote: string;
  average: string;
  /** "{from}–{to}" */
  range: string;
  filesUploaded: string;
  meetingsBooked: string;
  noAnswers: string;
  /** "See the responses that chose {option}", on a choice bar. */
  showResponses: string;
}

export function QuestionCard({
  question,
  index,
  typeLabel,
  labels,
  children,
}: {
  question: QuestionSummary;
  /** Its position among the cards, from 1. */
  index: number;
  /** The kind of question, named as the builder names it ("Single choice"). */
  typeLabel?: string;
  labels: SummaryCardLabels;
  children: ReactNode;
}) {
  return (
    <section
      className="rounded-2xl border border-border bg-card p-5 sm:p-6"
      data-testid="summary-card"
      data-question-key={question.key}
      data-question-kind={question.kind}
      aria-labelledby={`summary-q-${index}`}
    >
      <header className="mb-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="flex min-w-0 items-baseline gap-1.5 text-2xs font-medium uppercase tracking-wider text-faint">
            <span className="tabular-nums">{String(index).padStart(2, '0')}</span>
            {typeLabel ? (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{typeLabel}</span>
              </>
            ) : null}
          </p>
          <span
            className="shrink-0 text-xs tabular-nums text-muted-foreground"
            data-testid="summary-answered"
          >
            {t(labels.answered, { n: question.answered, total: question.total })}
          </span>
        </div>
        <h2
          id={`summary-q-${index}`}
          className="mt-1.5 min-w-0 break-words text-base font-semibold leading-snug"
        >
          {question.label}
        </h2>
      </header>
      {question.answered === 0 ? (
        <p
          className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
          data-testid="summary-no-answers"
        >
          {labels.noAnswers}
        </p>
      ) : (
        children
      )}
    </section>
  );
}

/**
 * How solid a bar is drawn, from its share of the most chosen option: the
 * leader at full strength, the rest fading with their count, never so faint
 * that a real answer reads as none.
 */
function barOpacity(count: number, top: number): number {
  if (top <= 0) return 1;
  return Math.round((0.3 + 0.7 * (count / top)) * 100) / 100;
}

/** One labelled bar: the share of the people who answered. */
function Bar({
  label,
  percent,
  count,
  top,
  href,
  title,
}: {
  label: string;
  percent: number;
  count: number;
  /** The most chosen option's count: what this bar's strength is measured against. */
  top: number;
  /** The table filtered by this option, when the bar leads there. */
  href?: string;
  title?: string;
}) {
  const body = (
    <>
      <div className="mb-1.5 flex items-baseline justify-between gap-4 text-sm">
        <span className="min-w-0 break-words text-foreground" data-testid="summary-option-label">
          {label}
        </span>
        <span
          className="shrink-0 tabular-nums text-muted-foreground"
          data-testid="summary-option-share"
        >
          <span className="font-semibold text-foreground">{percent}%</span>
          <span aria-hidden className="text-faint">
            {' · '}
          </span>
          {count}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        {/* Signal Green, the colour progress carries across the app. */}
        <div
          className="h-full rounded-full bg-signal-edge"
          style={{ width: `${percent}%`, opacity: barOpacity(count, top) }}
        />
      </div>
    </>
  );
  return (
    <li data-testid="summary-option">
      {href ? (
        <Link
          href={href}
          title={title}
          data-testid="summary-option-link"
          className="-mx-2 -my-1.5 block rounded-lg px-2 py-1.5 transition-colors hover:bg-sidebar focus-visible:bg-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

export function ChoiceBody({
  question,
  labels,
  hrefFor,
}: {
  question: Extract<QuestionSummary, { kind: 'choice' }>;
  labels: SummaryCardLabels;
  /** The table filtered by an option. An option nobody chose leads nowhere. */
  hrefFor?: (value: string) => string;
}) {
  const top = question.options[0]?.count ?? 0;
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3.5">
        {question.options.map((o) => (
          <Bar
            key={o.value}
            label={o.label}
            percent={o.percent}
            count={o.count}
            top={top}
            href={hrefFor && o.count > 0 ? hrefFor(o.value) : undefined}
            title={t(labels.showResponses, { option: o.label })}
          />
        ))}
      </ul>
      {question.multiple ? (
        <p
          className="flex items-start gap-2 text-xs text-muted-foreground"
          data-testid="summary-multi-note"
        >
          <i aria-hidden className="pi pi-info-circle mt-px" style={{ fontSize: 11 }} />
          {labels.multiNote}
        </p>
      ) : null}
    </div>
  );
}

function bucketLabel(b: SummaryBucket, labels: SummaryCardLabels, num: Intl.NumberFormat): string {
  return b.from === b.to
    ? num.format(b.from)
    : t(labels.range, { from: num.format(b.from), to: num.format(b.to) });
}

export function ScaleBody({
  question,
  labels,
  locale,
}: {
  question: Extract<QuestionSummary, { kind: 'scale' }>;
  labels: SummaryCardLabels;
  locale: Locale;
}) {
  // The decimal separator follows the reader: 43.8 in English, 43,8 in Spanish.
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const top = Math.max(0, ...question.buckets.map((b) => b.count));
  return (
    <div className="grid gap-6 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] sm:items-start">
      {/* The average stands on the card itself: the one big figure, with what
          it is under it. */}
      <div>
        <p
          className="text-4xl font-bold tabular-nums tracking-tight"
          data-testid="summary-average"
        >
          {question.average == null ? null : num.format(question.average)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {labels.average}
          {question.unit ? (
            <>
              <span aria-hidden className="text-faint">
                {' · '}
              </span>
              {question.unit}
            </>
          ) : null}
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {question.buckets.map((b) => (
          <Bar
            key={`${b.from}-${b.to}`}
            label={bucketLabel(b, labels, num)}
            percent={b.percent}
            count={b.count}
            top={top}
          />
        ))}
      </ul>
    </div>
  );
}

export function CountBody({
  question,
  labels,
}: {
  question: Extract<QuestionSummary, { kind: 'count' }>;
  labels: SummaryCardLabels;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span
        className="text-4xl font-bold tabular-nums tracking-tight"
        data-testid="summary-count"
      >
        {question.answered}
      </span>
      <span className="text-sm text-muted-foreground">
        {question.type === 'file' ? labels.filesUploaded : labels.meetingsBooked}
      </span>
    </div>
  );
}
