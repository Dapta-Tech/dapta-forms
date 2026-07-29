'use client';

import { useMemo, useState } from 'react';
import type { FormOption } from '@quill/engine';
import { Modal } from '@/components/modal';
import { Button } from '@/components/ui/button';
import { parseOptionsPaste, buildImportedOptions, type ImportRow } from './options-import';
import type { EditorMessages } from './messages';

/**
 * "Import options from a spreadsheet" — the modal behind the button in
 * {@link OptionsEditor}. A big paste box with a LIVE preview underneath:
 * every keystroke re-parses (the parser is pure and cheap), each row shows
 * its fate (ok / duplicate / invalid score), and the CTA always states
 * exactly how many options it will import. Errors never block the paste —
 * an author fixes two cells in the preview's terms, not by re-copying 200.
 */
export function OptionsImportModal({
  open,
  onClose,
  options,
  onApply,
  scoringEnabled,
  m,
}: {
  open: boolean;
  onClose: () => void;
  /** The question's current options (append de-dupes against them). */
  options: FormOption[];
  onApply: (next: FormOption[]) => void;
  /** The question is scored — used for the "no scores in paste" note. */
  scoringEnabled: boolean;
  m: EditorMessages['options']['importer'];
}) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'replace' | 'append'>('replace');

  const parsed = useMemo(
    () =>
      parseOptionsPaste(text, {
        existingLabels: mode === 'append' ? options.map((o) => o.label) : [],
      }),
    [text, mode, options],
  );

  const importable = parsed.importable;
  const anyScore = importable.some((r) => r.points != null);
  const replaceLosesIcons = mode === 'replace' && options.some((o) => o.icon);

  const summary: string[] = [];
  if (parsed.rows.length > 0) {
    summary.push(interpolate2(m.summaryValid, importable.length));
    if (anyScore)
      summary.push(interpolate2(m.summaryWithScore, importable.filter((r) => r.points != null).length));
    if (parsed.skippedHeader) summary.push(m.summaryHeaderSkipped);
    if (parsed.extraColumns) summary.push(m.summaryExtraColumns);
    if (parsed.truncated)
      summary.push(
        interpolate2(m.summaryTruncated, parsed.rows.filter((r) => r.status === 'ok').length - importable.length),
      );
  }

  function statusLabel(r: ImportRow): { text: string; tone: 'ok' | 'warn' | 'bad' } {
    if (r.status === 'duplicate') return { text: m.statusDuplicate, tone: 'warn' };
    if (r.status === 'invalidPoints') return { text: m.statusInvalid, tone: 'bad' };
    if (r.rounded) return { text: interpolate2(m.statusRounded, r.points ?? 0), tone: 'ok' };
    return { text: m.statusOk, tone: 'ok' };
  }

  function apply() {
    onApply(buildImportedOptions(importable, options, mode));
    setText('');
    onClose();
  }

  const toneClass = {
    ok: 'bg-primary/10 text-primary',
    warn: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    bad: 'bg-destructive/10 text-destructive',
  } as const;

  return (
    <Modal open={open} onClose={onClose} title={m.title} labelId="options-import-title">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">{m.intro}</p>
        <textarea
          data-testid="options-import-paste"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={m.placeholder}
          spellCheck={false}
          rows={6}
          className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            className="inline-flex overflow-hidden rounded-md border border-border"
            role="group"
            aria-label={m.title}
          >
            {(['replace', 'append'] as const).map((mo) => (
              <button
                key={mo}
                type="button"
                data-testid={`options-import-mode-${mo}`}
                onClick={() => setMode(mo)}
                className={
                  'px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
                  (mode === mo
                    ? 'bg-primary/15 font-semibold text-foreground'
                    : 'bg-card text-muted-foreground hover:text-foreground')
                }
              >
                {mo === 'replace' ? m.modeReplace : m.modeAppend}
              </button>
            ))}
          </div>
          {summary.length > 0 ? (
            <p data-testid="options-import-summary" className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
              {summary.join(' · ')}
            </p>
          ) : null}
        </div>

        {parsed.rows.length > 0 ? (
          <div className="max-h-56 overflow-y-auto rounded-md border border-border">
            <table className="w-full border-collapse text-xs" data-testid="options-import-preview">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{m.colOption}</th>
                  <th className="w-16 px-3 py-2 font-medium">{m.colScore}</th>
                  <th className="w-28 px-3 py-2 font-medium">{m.colStatus}</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.map((r) => {
                  const st = statusLabel(r);
                  return (
                    <tr key={`${r.line}-${r.label}`} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-1.5">{r.label}</td>
                      <td className="px-3 py-1.5 font-mono tabular-nums">{r.points ?? '—'}</td>
                      <td className="px-3 py-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${toneClass[st.tone]}`}>
                          {st.text}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {replaceLosesIcons ? (
          <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="options-import-icons-note">
            {m.replaceIconsNote}
          </p>
        ) : null}
        {scoringEnabled && parsed.rows.length > 0 && !anyScore ? (
          <p className="text-xs text-muted-foreground" data-testid="options-import-noscores-note">
            {m.noScoresNote}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {m.cancel}
          </Button>
          <Button
            size="sm"
            data-testid="options-import-apply"
            disabled={importable.length === 0}
            onClick={apply}
          >
            {interpolate2(m.submit, importable.length)}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** `{n}` interpolation for the importer strings (engine interpolate expects answers). */
function interpolate2(template: string, n: number): string {
  return template.replace('{n}', String(n));
}
