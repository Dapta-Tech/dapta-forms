'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '@quill/shared';
import { cn } from '@/lib/cn';

/**
 * The code blocks of the API docs page: a header with a label and a copy
 * button over a block that scrolls inside itself (a long URL or JSON line never
 * widens the page). JSON and curl get a light highlight from the theme tokens,
 * so they read the same in light and dark.
 */

/** Render `text` with every backtick-quoted run as inline code. */
export function rich(text: string): ReactNode[] {
  return text.split('`').map((part, i) =>
    i % 2 === 1 ? (
      <code
        key={i}
        className="break-words rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
      >
        {part}
      </code>
    ) : (
      part
    ),
  );
}

export interface CopyLabels {
  copy: string;
  copied: string;
  copyFailed: string;
}

/** Copies `text`; says so for two seconds, or says it could not. */
export function CopyButton({
  text,
  label,
  m,
  testId,
}: {
  text: string;
  /** Accessible name while idle: what gets copied. */
  label: string;
  m: CopyLabels;
  testId?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  };

  const shown = state === 'copied' ? m.copied : state === 'failed' ? m.copyFailed : m.copy;
  return (
    <button
      type="button"
      onClick={copy}
      data-testid={testId}
      data-state={state}
      aria-label={state === 'idle' ? label : shown}
      title={label}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        state === 'copied' ? 'text-signal-ink' : state === 'failed' ? 'text-destructive' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <i aria-hidden className={`pi ${state === 'copied' ? 'pi-check' : 'pi-copy'}`} style={{ fontSize: 12 }} />
      <span aria-live="polite">{shown}</span>
    </button>
  );
}

const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/** Pretty JSON with keys, strings, numbers and literals told apart. */
export function highlightJson(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const match of code.matchAll(JSON_TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) out.push(code.slice(last, at));
    const [whole, str, colon, literal, num] = match;
    if (str !== undefined && colon !== undefined) {
      out.push(
        <span key={i++} className="text-foreground">
          {str}
        </span>,
        colon,
      );
    } else if (str !== undefined) {
      out.push(
        <span key={i++} className="text-signal-ink">
          {str}
        </span>,
      );
    } else if (literal !== undefined) {
      out.push(
        <span key={i++} className="text-warning-ink">
          {literal}
        </span>,
      );
    } else if (num !== undefined) {
      out.push(
        <span key={i++} className="text-score-ink">
          {num}
        </span>,
      );
    } else {
      out.push(whole);
    }
    last = at + whole.length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

const CURL_TOKEN = /(\$[A-Z][A-Z0-9_]*)|(^|\s)(--?[A-Za-z][A-Za-z-]*)|^(curl)\b/gm;

/** A curl command with its flags quieter and its shell variables marked. */
export function highlightCurl(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const match of code.matchAll(CURL_TOKEN)) {
    const at = match.index ?? 0;
    const [whole, variable, space, flag, command] = match;
    if (at > last) out.push(code.slice(last, at));
    if (variable !== undefined) {
      out.push(
        <span key={i++} className="text-score-ink">
          {variable}
        </span>,
      );
    } else if (flag !== undefined) {
      out.push(
        space ?? '',
        <span key={i++} className="text-faint">
          {flag}
        </span>,
      );
    } else if (command !== undefined) {
      out.push(
        <span key={i++} className="font-semibold text-signal-ink">
          {command}
        </span>,
      );
    }
    last = at + whole.length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

/** Lines past which a response starts folded. */
export const FOLD_AFTER_LINES = 16;

export function CodePanel({
  label,
  meta,
  code,
  language,
  copyLabel,
  m,
  fold,
  testId,
}: {
  label: string;
  /** Beside the label: the status pill of a response. */
  meta?: ReactNode;
  code: string;
  language: 'json' | 'curl' | 'text';
  copyLabel: string;
  m: CopyLabels;
  /** Fold a long block behind a "show the full response" button. */
  fold?: { more: string; less: string };
  testId?: string;
}) {
  const lines = code.split('\n').length;
  const foldable = fold !== undefined && lines > FOLD_AFTER_LINES;
  const [open, setOpen] = useState(false);
  const folded = foldable && !open;
  const body =
    language === 'json' ? highlightJson(code) : language === 'curl' ? highlightCurl(code) : code;

  return (
    <div data-testid={testId} className="min-w-0 overflow-hidden rounded-lg border border-border bg-panel">
      <div className="flex min-h-10 items-center justify-between gap-2 border-b border-border py-1.5 pl-3 pr-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-2xs font-semibold uppercase tracking-wide text-faint">{label}</span>
          {meta}
        </div>
        <CopyButton text={code} label={copyLabel} m={m} testId={testId ? `${testId}-copy` : undefined} />
      </div>
      <div className="relative">
        <pre
          data-folded={folded || undefined}
          className={cn(
            'max-w-full overflow-x-auto p-3 font-mono text-xs leading-relaxed text-muted-foreground',
            folded && 'max-h-72 overflow-y-hidden',
          )}
        >
          <code>{body}</code>
        </pre>
        {folded ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-panel to-transparent"
          />
        ) : null}
      </div>
      {foldable ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid={testId ? `${testId}-fold` : undefined}
          className="flex w-full items-center justify-center gap-1.5 border-t border-border py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <i aria-hidden className={`pi ${open ? 'pi-chevron-up' : 'pi-chevron-down'}`} style={{ fontSize: 11 }} />
          {open ? fold.less : t(fold.more, { lines })}
        </button>
      ) : null}
    </div>
  );
}
