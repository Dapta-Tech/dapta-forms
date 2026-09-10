'use client';

/**
 * The `file` question's own settings: what it accepts, and how big.
 *
 * Presets rather than a raw extension box, because "pdf, doc, docx, odt, rtf"
 * is not a decision a form author wants to make, and a plain text field is the
 * kind of control that produces a question nobody can answer. The extension
 * field is still there underneath for the author who genuinely needs .dwg, and
 * the two stay in sync: ticking a preset writes its extensions into the same
 * list the field edits.
 *
 * Every limit here is the author's PREFERENCE. The server enforces its own
 * ceiling and its own denylist whatever this panel says, so nothing typed here
 * can widen what the deployment accepts.
 */
import { useMemo } from 'react';
import type { FormStep } from '@quill/engine';
import { Field, NumberField, TextField } from './fields';
import type { EditorMessages } from './messages';

/** The groups an author picks from. Order is the order they render in. */
const PRESETS = [
  { id: 'documents', ext: ['pdf', 'doc', 'docx', 'txt'] },
  { id: 'images', ext: ['jpg', 'png', 'gif', 'webp'] },
  { id: 'sheets', ext: ['xls', 'xlsx', 'csv'] },
  { id: 'archives', ext: ['zip'] },
] as const;

type PresetId = (typeof PRESETS)[number]['id'];

function labelFor(id: PresetId, em: EditorMessages): string {
  switch (id) {
    case 'documents':
      return em.props.filePresetDocuments;
    case 'images':
      return em.props.filePresetImages;
    case 'sheets':
      return em.props.filePresetSheets;
    case 'archives':
      return em.props.filePresetArchives;
  }
}

/** Normalize what an author typed: lowercase, no dots, no blanks, no repeats. */
export function parseExtensions(raw: string): string[] {
  const seen = new Set<string>();
  for (const piece of raw.split(/[,\s]+/)) {
    const ext = piece.trim().toLowerCase().replace(/^\./, '');
    if (ext) seen.add(ext);
  }
  return [...seen];
}

export function FileSettings({
  step,
  onUpdate,
  em,
  maxFileMb,
}: {
  step: FormStep;
  onUpdate: (patch: Partial<FormStep>) => void;
  em: EditorMessages;
  maxFileMb: number;
}) {
  const allowed = useMemo(() => step.allowedTypes ?? [], [step.allowedTypes]);
  const empty = allowed.length === 0;

  // A preset is "on" when every extension it stands for is accepted. Partial
  // overlap reads as off, so ticking it completes the set rather than doing
  // nothing visible.
  const isOn = (p: (typeof PRESETS)[number]): boolean => p.ext.every((e) => allowed.includes(e));

  const toggle = (p: (typeof PRESETS)[number]): void => {
    const next = isOn(p)
      ? allowed.filter((e) => !(p.ext as readonly string[]).includes(e))
      : [...allowed, ...p.ext.filter((e) => !allowed.includes(e))];
    onUpdate({ allowedTypes: next });
  };

  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4">
      <p className="text-2xs font-semibold uppercase tracking-wide text-faint">{em.types.file}</p>

      <Field label={em.props.fileAllowedTypes} hint={em.props.fileAllowedTypesHint}>
        <div className="flex flex-wrap gap-1.5 pb-2">
          {PRESETS.map((p) => {
            const on = isOn(p);
            return (
              <button
                key={p.id}
                type="button"
                role="switch"
                aria-checked={on}
                onClick={() => toggle(p)}
                className={
                  on
                    ? 'rounded-full border border-primary-edge/60 bg-primary/10 px-3 py-1 text-xs font-medium text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                    : 'rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary-edge/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                }
              >
                {labelFor(p.id, em)}
              </button>
            );
          })}
        </div>
        <TextField
          aria-label={em.props.fileAllowedTypes}
          value={allowed.join(', ')}
          onChange={(e) => onUpdate({ allowedTypes: parseExtensions(e.target.value) })}
        />
      </Field>

      {/* An empty list is not "accept anything": the server still refuses what
          the deployment denies, but the question becomes one the author almost
          certainly did not mean, so it is called out rather than silently kept. */}
      {empty ? (
        <p role="alert" data-testid="file-no-types" className="flex gap-1.5 text-xs text-amber-600">
          <i aria-hidden className="pi pi-exclamation-triangle mt-0.5 shrink-0" style={{ fontSize: 10 }} />
          {em.props.fileNoTypes}
        </p>
      ) : null}

      <Field
        label={em.props.fileMaxSize}
        hint={em.props.fileMaxSizeHint.replaceAll('{max}', String(maxFileMb))}
      >
        <NumberField
          aria-label={em.props.fileMaxSize}
          min={1}
          max={maxFileMb}
          value={step.maxSizeMb ?? ''}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (raw === '') return onUpdate({ maxSizeMb: undefined });
            // Clamped on commit, not per keystroke: clamping while typing eats
            // digits, the way the slider bounds note explains.
            const n = Math.floor(Number(raw));
            onUpdate({ maxSizeMb: Number.isFinite(n) && n > 0 ? Math.min(n, maxFileMb) : undefined });
          }}
        />
      </Field>
    </section>
  );
}
