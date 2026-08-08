'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormStep } from '@quill/engine';
import { isInputlessStep, nameFields } from '@quill/engine';
import { cn } from '@/lib/cn';
import { iconForStep } from './question-types';

/**
 * TokenTextarea — a textarea with a Typeform-style "Recall information" picker.
 * Typing `@` (or `[`) opens an anchored dropdown of the answer fields captured
 * BEFORE the current step; typing filters, ↑/↓ + Enter/Tab (or click) inserts
 * the engine token `[key]` in place of the typed trigger + query, and the caret
 * lands right after the token. `[` completes the bracket pair (`[fir⏎` →
 * `[firstname]`).
 *
 * The option list is limited to what the engine's `interpolate`
 * (packages/engine/src/form-logic.ts) actually resolves at runtime: tokens are
 * substituted from the answers map ONLY, which holds each capturing step's
 * answer under `step.key` — except `name` steps, which store one answer per
 * subfield (`nameFields(step)`, default firstname/lastname) and never under
 * their own key. `message` steps capture nothing. Score, outcome, and UTM
 * values never enter the answers map, so they are never offered.
 *
 * Authoring guidance (never blocking — the runtime sweeps empty tokens
 * gracefully): a referenced token that is captured at THIS step or LATER renders
 * empty when the question shows, and a token no step captures never resolves.
 * Both cases surface as an inline warning chip (`data-testid="token-warning"`).
 *
 * ARIA: managed-focus combobox — the textarea keeps focus and carries
 * `role="combobox"` + `aria-expanded`/`aria-controls`/`aria-activedescendant`;
 * the panel is a `role="listbox"` of `role="option"` rows (same shell as
 * `components/ui/select.tsx`).
 */

export interface TokenOption {
  /** The interpolation key, exactly as `[key]` resolves it. */
  key: string;
  /** The owning question's label (shown truncated next to the mono key). */
  label: string;
  /** PrimeIcons glyph for the owning step's type. */
  icon: string;
}

/** The strings the picker + warnings need (from either message catalog). */
export interface TokenTextareaMessages {
  pickerLabel: string;
  pickerEmpty: string;
  pickerNoMatch: string;
  /** `{token}` is replaced with the bracketed token, e.g. `[firstname]`. */
  warnLater: string;
  warnUnknown: string;
  /**
   * V5-A5 — a bare `@key` that names a real earlier field but was never turned
   * into a token, so it renders literally. `{token}` is the `@key` as typed,
   * `{fixed}` the `[key]` spelling that would work.
   */
  warnRaw: string;
}

/** The answer keys one step captures (message: none; name: its subfields). */
export function stepTokenKeys(step: FormStep): string[] {
  if (isInputlessStep(step)) return [];
  return nameFields(step);
}

/** Picker entries for fields captured BEFORE `steps[index]`, in step order. */
export function tokenOptionsBefore(steps: FormStep[], index: number): TokenOption[] {
  const out: TokenOption[] = [];
  const seen = new Set<string>();
  steps.slice(0, Math.max(0, index)).forEach((s, i) => {
    for (const key of stepTokenKeys(s)) {
      if (seen.has(key)) continue; // duplicate keys: the earliest capture wins
      seen.add(key);
      out.push({ key, label: s.question?.trim() || `${i + 1} · ${s.key}`, icon: iconForStep(s) });
    }
  });
  return out;
}

/** Every key ANY step captures — classifies unknown vs. later-step tokens. */
export function allTokenKeys(steps: FormStep[]): Set<string> {
  const set = new Set<string>();
  for (const s of steps) for (const k of stepTokenKeys(s)) set.add(k);
  return set;
}

/** A field reference found in the text, with where it starts and how it's written. */
interface TokenRef {
  key: string;
  /** Index of the `[` or `@` that opens it — used to skip the one being typed. */
  start: number;
  /** One past the last char (`]` or the end of the `@key` run) — for slicing. */
  end: number;
  /** `bracket` resolves at runtime; `at` is raw text the engine never substitutes. */
  form: 'bracket' | 'at';
}

/**
 * Field references in a text: the engine's own `[key]` grammar, PLUS bare `@key`
 * runs (V5-A5).
 *
 * Only `[key]` ever interpolates — `@` is the picker's trigger, and choosing an
 * option rewrites it to `[key]`. But an author who types `@phone_1` straight
 * through and moves on leaves plain text that silently renders as literal
 * "@phone_1", and the warnings never fired because they only looked at brackets.
 * Both spellings are scanned so the same mistake is reported either way; the
 * caller distinguishes them so an unresolvable `@` can say so specifically.
 */
function referencedTokens(text: string): TokenRef[] {
  const out: TokenRef[] = [];
  const re = /\[([a-zA-Z0-9_]+)\]|@([a-zA-Z0-9_]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) != null) {
    const bracket = m[1];
    if (bracket == null) {
      // An `@` with a word character before it is an EMAIL ADDRESS, not a
      // recall trigger: "email us at hello@acme.com" was raising a red
      // "@acme doesn't exist in this form". The picker only ever opens on an
      // `@` that starts a word, so this matches how a token is actually typed.
      const prev = m.index > 0 ? text.charAt(m.index - 1) : '';
      if (prev && /[a-zA-Z0-9_.]/.test(prev)) continue;
      // A trailing domain dot ("@acme.com") is the same story from the other side.
      const after = text.charAt(m.index + m[0].length);
      if (after === '.') continue;
    }
    out.push({
      key: (bracket ?? m[2]) as string,
      start: m.index,
      end: m.index + m[0].length,
      form: bracket != null ? 'bracket' : 'at',
    });
  }
  return out;
}

/** A run of the text for the highlight backdrop: plain, or a token to style. */
interface HighlightSegment {
  text: string;
  kind: 'plain' | 'valid' | 'invalid';
}

/**
 * Split the text into styled runs for the backdrop mirror (V4-06). A `[key]`
 * that resolves HERE (captured before this step) reads as `valid`; a `[key]`
 * captured later / never, or any bare `@key` (literal text the engine never
 * substitutes), reads as `invalid` — the same split the warning chips make, now
 * shown inline so a valid token is visibly a token and a typo visibly is not.
 * The reference the open picker is mid-typing stays plain so it doesn't flash
 * red as it is spelled out.
 */
function highlightSegments(
  value: string,
  resolvesHere: (key: string) => boolean,
  skipStart: number | null,
): HighlightSegment[] {
  const segs: HighlightSegment[] = [];
  let cursor = 0;
  for (const ref of referencedTokens(value)) {
    if (ref.start < cursor) continue; // defensive: refs are ordered + non-overlapping
    if (ref.start > cursor) segs.push({ text: value.slice(cursor, ref.start), kind: 'plain' });
    const raw = value.slice(ref.start, ref.end);
    if (skipStart != null && ref.start === skipStart) {
      segs.push({ text: raw, kind: 'plain' });
    } else {
      const valid = ref.form === 'bracket' && resolvesHere(ref.key);
      segs.push({ text: raw, kind: valid ? 'valid' : 'invalid' });
    }
    cursor = ref.end;
  }
  if (cursor < value.length) segs.push({ text: value.slice(cursor), kind: 'plain' });
  return segs;
}

/** An open picker: where the trigger char sits and what was typed after it. */
interface Menu {
  start: number;
  trigger: '@' | '[';
  query: string;
}

export function TokenTextarea({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className,
  rows = 1,
  autoGrow,
  tokens,
  allKeys,
  m,
  hint,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  ariaLabel: string;
  className?: string;
  rows?: number;
  /** Grow to fit content (canvas inline-title mode). */
  autoGrow?: boolean;
  /** Insertable tokens = fields captured before this step. */
  tokens: TokenOption[];
  /** Every capturing key in the form (for the warning kind). */
  allKeys: Set<string>;
  m: TokenTextareaMessages;
  /** Permanent muted discoverability hint (shown only when tokens exist). */
  hint?: string;
  testId?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const caretAfter = useRef<number | null>(null);
  const listId = useId();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [active, setActive] = useState(0);

  // Inline token highlighting (V4-06): a mirror layer behind a transparent
  // textarea renders the same text with `[valid]` tokens tinted and unresolved
  // ones flagged. Styling is background/colour only — never padding, weight, or
  // size — so every glyph keeps the textarea's exact metrics and the caret never
  // drifts. The reference under the open picker stays plain (not flashing).
  const tokenKeys = new Set(tokens.map((t) => t.key));
  const segments = highlightSegments(value, (k) => tokenKeys.has(k), menu?.start ?? null);
  /** Keep the mirror aligned when the textarea scrolls (fixed-height fields). */
  function syncScroll() {
    const ta = ref.current;
    const hl = highlightRef.current;
    if (ta && hl) hl.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
  }

  const query = menu?.query.toLowerCase() ?? '';
  const matches = menu
    ? tokens.filter((t) => t.key.toLowerCase().includes(query) || t.label.toLowerCase().includes(query))
    : [];
  const activeIdx = Math.min(active, Math.max(0, matches.length - 1));

  // Auto-grow + restore the caret right after a just-inserted token.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (autoGrow) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
    if (caretAfter.current != null) {
      el.focus();
      el.setSelectionRange(caretAfter.current, caretAfter.current);
      caretAfter.current = null;
    }
    syncScroll(); // keep the highlight mirror aligned after a value/height change
  }, [value, autoGrow]);

  useLayoutEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, menu]);

  /** Re-derive the picker from the text + caret after every input event. */
  function syncMenu(text: string, caret: number) {
    setMenu((prev) => {
      if (prev && caret > prev.start && text[prev.start] === prev.trigger) {
        const q = text.slice(prev.start + 1, caret);
        // Keys are [a-zA-Z0-9_]+ — any other character ends the query.
        if (/^[a-zA-Z0-9_]*$/.test(q)) return { ...prev, query: q };
      }
      const ch = caret > 0 ? text.charAt(caret - 1) : '';
      // An `@` typed straight after a word character is an EMAIL ADDRESS being
      // written, not a recall trigger. Opening the picker there meant Tab or
      // Enter rewrote "bob@company.com" into "bob[company]" — silently
      // destroying typed text with a keystroke people use to leave a field.
      if (ch === '@') {
        const before = caret >= 2 ? text.charAt(caret - 2) : '';
        if (before && /[a-zA-Z0-9_.]/.test(before)) return null;
        return { start: caret - 1, trigger: ch, query: '' };
      }
      if (ch === '[') return { start: caret - 1, trigger: ch, query: '' };
      return null;
    });
    setActive(0);
  }

  /** Replace the trigger + typed query with `[key]`, caret after the token. */
  function insertToken(key: string) {
    if (!menu) return;
    const replaceEnd = menu.start + 1 + menu.query.length;
    const token = `[${key}]`;
    caretAfter.current = menu.start + token.length;
    setMenu(null);
    onChange(value.slice(0, menu.start) + token + value.slice(replaceEnd));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!menu) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (matches.length) setActive((activeIdx + 1) % matches.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (matches.length) setActive((activeIdx - 1 + matches.length) % matches.length);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setMenu(null);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      const opt = matches[activeIdx];
      if (opt) {
        e.preventDefault();
        insertToken(opt.key);
      } else {
        setMenu(null);
      }
    }
  }

  // Authoring warnings: references in the text that will NOT resolve here —
  // captured at this step or later ('later'), never captured ('unknown'), or
  // written as bare `@key` which the engine never substitutes at all ('raw').
  const seen = new Set<string>();
  const warnings: { token: string; kind: 'later' | 'unknown' | 'raw'; form: 'bracket' | 'at' }[] = [];
  for (const ref of referencedTokens(value)) {
    // Skip the reference the open picker is mid-way through: warning about
    // "@ph" while someone types "@phone" is noise, not help.
    if (menu && ref.start === menu.start) continue;
    const id = `${ref.form}:${ref.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const resolvable = tokens.some((o) => o.key === ref.key);
    if (ref.form === 'at') {
      // A bare `@key` is literal text no matter what it names — even a valid,
      // earlier field. Say THAT, rather than the later/unknown diagnosis.
      warnings.push({ token: ref.key, kind: resolvable ? 'raw' : allKeys.has(ref.key) ? 'later' : 'unknown', form: 'at' });
      continue;
    }
    if (resolvable) continue;
    warnings.push({ token: ref.key, kind: allKeys.has(ref.key) ? 'later' : 'unknown', form: 'bracket' });
  }

  const open = menu != null;

  return (
    <div>
      {/* The `relative` box holds ONLY the textarea and its two overlays (the
          highlight mirror and the picker). The hint and the warnings used to
          live inside it too — and the mirror is `inset-0`, so it stretched over
          textarea + hint and drew the caller's border (and, with `resize-y` in
          the caller's class, a second resize grip) around the taller box: two
          nested frames where the author saw one field, reported as "there is
          one on top of the other". Scoping the relative box to the control is
          the fix; it also anchors the picker directly under the textarea
          instead of under the hint. */}
      <div className="relative">
      {/* Highlight mirror — the same text under the (transparent) textarea, with
          tokens tinted. `aria-hidden` + no pointer events: it is pure decoration,
          the textarea remains the sole interactive/announced control. It carries
          `className` too so its font, padding, and wrapping match the textarea
          exactly; the inner div is what scrolls in sync. */}
      <div
        aria-hidden
        data-testid={testId ? `${testId}-highlight` : undefined}
        className={cn(
          'pointer-events-none absolute inset-0 select-none overflow-hidden',
          className,
          // LAST so it beats a `resize-y` in the caller's class: the mirror is
          // decoration, and a grip on it reads as a second, broken control.
          'resize-none',
        )}
      >
        <div ref={highlightRef} className="whitespace-pre-wrap break-words">
          {segments.map((s, i) =>
            s.kind === 'plain' ? (
              <span key={i}>{s.text}</span>
            ) : (
              <span
                key={i}
                data-testid="token-mark"
                data-kind={s.kind}
                style={{ boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' }}
                className={cn(
                  // Below the radius ladder's 6px floor on purpose. This is an
                  // inline highlight sitting on a 20px line, not a box on the
                  // page: at `rounded-sm` the corners eat into the glyphs and the
                  // chip reads as a pill interrupting the sentence instead of a
                  // mark on top of it. The ladder governs surfaces, not text runs.
                  'rounded-[3px]',
                  s.kind === 'valid' ? 'bg-primary/20 text-primary' : 'bg-destructive/15 text-destructive',
                )}
              >
                {s.text}
              </span>
            ),
          )}
          {/* A trailing newline needs a spacer or the mirror is one line short of
              the textarea's rendered height. */}
          {value.endsWith('\n') ? ' ' : ''}
        </div>
      </div>
      <textarea
        ref={ref}
        rows={rows}
        value={value}
        data-testid={testId}
        onChange={(e) => {
          onChange(e.target.value);
          syncMenu(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onScroll={syncScroll}
        onKeyDown={handleKeyDown}
        onBlur={() => setMenu(null)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && matches[activeIdx] ? `${listId}-opt-${activeIdx}` : undefined}
        // Text + background transparent so the mirror behind shows through, but a
        // visible caret so typing still has a cursor. Inline styles beat any
        // background/colour the caller's className sets (e.g. the outcome field's
        // bg-background), which would otherwise hide the highlight layer.
        style={{ backgroundColor: 'transparent', color: 'transparent', caretColor: 'var(--foreground)' }}
        className={cn(
          // `block`: inline-block leaves a baseline gap below the textarea, so
          // the wrapper (and the inset-0 mirror with it) ran ~7px taller than
          // the control — a second border edge peeking out under the field.
          'relative block w-full bg-transparent outline-none placeholder:text-muted-foreground/50',
          autoGrow && 'resize-none overflow-hidden',
          className,
        )}
      />

      {open ? (
        <div
          data-testid="token-picker"
          onMouseDown={(e) => e.preventDefault()} // keep textarea focus through option clicks
          className="absolute left-0 right-0 top-full z-50 mt-1 flex flex-col overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
        >
          <p className="border-b border-border px-2.5 py-1.5 text-2xs font-medium uppercase tracking-wide text-faint">
            {m.pickerLabel}
          </p>
          <ul ref={listRef} role="listbox" id={listId} aria-label={m.pickerLabel} className="max-h-56 overflow-y-auto p-1">
            {matches.map((t, i) => (
              <li key={t.key} role="option" aria-selected={i === activeIdx} id={`${listId}-opt-${i}`}>
                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="token-option"
                  data-key={t.key}
                  data-active={i === activeIdx}
                  onClick={() => insertToken(t.key)}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left',
                    // The keyboard cursor, marked like every other one (see
                    // `ui/select.tsx`): the wash alone could not say which token
                    // Enter would insert.
                    i === activeIdx
                      ? 'bg-muted shadow-[inset_0_0_0_1px_var(--primary-edge)]'
                      : 'hover:bg-muted',
                  )}
                >
                  <i aria-hidden className={`pi ${t.icon} shrink-0 text-muted-foreground`} style={{ fontSize: 11 }} />
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground">{t.label}</span>
                  <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 font-mono text-2xs text-faint">
                    {t.key}
                  </span>
                </button>
              </li>
            ))}
            {matches.length === 0 ? (
              <li className="px-2 py-2 text-xs text-muted-foreground">
                {tokens.length === 0 ? m.pickerEmpty : m.pickerNoMatch}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
      </div>

      {hint && tokens.length > 0 ? (
        <p data-testid="token-hint" className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground/80">
          <i aria-hidden className="pi pi-at" style={{ fontSize: 10 }} />
          {hint}
        </p>
      ) : null}

      {warnings.map((w) => (
        <p
          key={`${w.form}:${w.token}`}
          role="alert"
          data-testid="token-warning"
          data-kind={w.kind}
          data-form={w.form}
          className="mt-1 flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-xs leading-relaxed text-destructive"
        >
          <i aria-hidden className="pi pi-exclamation-triangle mt-0.5 shrink-0" style={{ fontSize: 10 }} />
          <span>
            {(w.kind === 'raw' ? m.warnRaw : w.kind === 'later' ? m.warnLater : m.warnUnknown)
              .replace('{token}', w.form === 'at' ? `@${w.token}` : `[${w.token}]`)
              .replace('{fixed}', `[${w.token}]`)}
          </span>
        </p>
      ))}
    </div>
  );
}
