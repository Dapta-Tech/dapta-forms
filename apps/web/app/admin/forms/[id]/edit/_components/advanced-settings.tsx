'use client';

import { useState, type ReactNode } from 'react';
import type { FormStep } from '@quill/engine';
import { nameFields } from '@quill/engine';
import type { BuilderMessages } from './builder-messages';

/**
 * The question panel's ADVANCED group.
 *
 * The panel was seventeen sections in one flat scroll, all weighted the same, so
 * the two controls an author touches constantly sat beside the one that renames
 * an answer key and cascades through every condition, goto and CRM mapping.
 * This collapses the dangerous and the rarely-needed ones.
 *
 * The badges are the load-bearing part, not decoration. A collapsed group that
 * hides a question being conditional, terminal, or hidden would be strictly
 * worse than the flat list it replaces: the author would see a clean question
 * and have no idea it behaves differently. So the header names what is
 * configured inside, in the same vocabulary the left spine already uses for its
 * "Logic" and "hidden" badges.
 *
 * Opens automatically when something IS configured, for the same reason — the
 * first render must not hide a behaviour from someone who did not set it up.
 */
export function AdvancedSettings({
  badges,
  children,
  m,
}: {
  /** What is configured inside — the whole reason a collapsed group is safe. */
  badges: string[];
  children: ReactNode;
  m: BuilderMessages['settings'];
}) {
  const [open, setOpen] = useState(badges.length > 0);

  return (
    <section
      data-testid="advanced-settings"
      data-open={open}
      className="mt-2 overflow-hidden rounded-md border border-border"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <i
          aria-hidden
          className={`pi ${open ? 'pi-chevron-down' : 'pi-chevron-right'} text-muted-foreground`}
          style={{ fontSize: 11 }}
        />
        <span className="text-sm font-medium text-foreground">{m.advancedTitle}</span>
        {badges.map((b) => (
          <span
            key={b}
            data-testid="advanced-badge"
            className="rounded-sm bg-secondary/15 px-1.5 py-0.5 text-[11px] font-medium text-secondary"
          >
            {b}
          </span>
        ))}
      </button>
      {open ? (
        <div className="flex flex-col gap-4 border-t border-border px-3 pb-4 pt-3">{children}</div>
      ) : null}
    </section>
  );
}

/**
 * The URL parameter that prefills this question, and an example link.
 *
 * The RUNTIME already does this: `capturePrefill` seeds any declared field key
 * from the query string, visible questions included. What never existed was any
 * way to find out — nothing told an author that the parameter is the field key,
 * so the feature was effectively invisible. This is that missing sentence, not a
 * new capability.
 *
 * A `name` step declares its SUBFIELDS instead of its own key, so it shows two
 * parameters; showing one would be wrong. And a key starting with `utm_` is
 * skipped by the capture on purpose (UTMs are captured separately), which means
 * prefill silently does nothing for it — the one case worth warning about.
 */
export function PrefillRow({
  step,
  publicUrl,
  m,
}: {
  step: FormStep;
  /** The form's real public URL, or null before it can be resolved. */
  publicUrl: string | null;
  m: BuilderMessages['settings'];
}) {
  const [copied, setCopied] = useState(false);
  const keys = nameFields(step);
  const reserved = keys.filter((k) => k.toLowerCase().startsWith('utm_'));
  // An example value that fits the QUESTION, not a hardcoded email: showing
  // `?role=ana%40acme.com` on a dropdown reads as nonsense and teaches the wrong
  // shape. A choice question borrows its own first option, which is also the
  // only value the engine would actually accept.
  const sample = (): string => {
    if (step.type === 'email') return 'ana%40acme.com';
    if (step.type === 'phone') return '%2B15555550123';
    if (step.type === 'slider') return '5';
    const option = step.options?.[0];
    if (option) return encodeURIComponent(option.value ?? option.label ?? 'value');
    return 'value';
  };
  const query =
    keys.length > 1
      ? keys.map((k, i) => `${k}=${i === 0 ? 'Ana' : 'Ruiz'}`).join('&')
      : `${keys[0]}=${sample()}`;
  const example = `${publicUrl ?? '…/your-form'}?${query}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(example);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked (no permission / insecure origin) — the text is visible anyway */
    }
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid="prefill-row">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {m.prefillTitle}
        </p>
        <span className="text-[11px] text-muted-foreground">{m.prefillReadOnly}</span>
      </div>
      <p className="text-xs text-muted-foreground">{m.prefillHint}</p>
      {reserved.length > 0 ? (
        <p
          data-testid="prefill-utm-warning"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
        >
          {m.prefillUtmWarning}
        </p>
      ) : (
        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5">
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[11px] text-foreground">
            {example}
          </code>
          <button
            type="button"
            onClick={copy}
            aria-label={m.prefillCopy}
            className="shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {copied ? m.prefillCopied : m.prefillCopy}
          </button>
        </div>
      )}
    </div>
  );
}
