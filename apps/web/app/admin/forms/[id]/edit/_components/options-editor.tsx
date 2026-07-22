'use client';

import type { FormOption } from '@quill/engine';
import { slugify } from '@quill/engine';
import { Button } from '@/components/ui/button';
import { HelpTip } from '@/components/ui/help-tip';
import { TextField, NumberField } from './fields';
import { SortableList, SortableRow } from './sortable';
import type { EditorMessages } from './messages';

/**
 * Editor for a choice/dropdown step's options: label, value, points and an
 * optional icon, drag-reorderable. Value auto-fills from the label until the
 * author edits it directly (then it's left alone). No native scrollbars; the
 * whole panel scrolls with the page.
 */
export function OptionsEditor({
  options,
  onChange,
  showPoints = true,
  m,
}: {
  options: FormOption[];
  onChange: (next: FormOption[]) => void;
  /**
   * Render the Points column (V5-B6). Hidden while this question is not scored,
   * so the row shows the two fields that always matter instead of a column that
   * does nothing — and each remaining field gets the width back.
   */
  showPoints?: boolean;
  m: EditorMessages['options'];
}) {
  const ids = options.map((_, i) => `opt-${i}`);

  function update(index: number, patch: Partial<FormOption>) {
    onChange(options.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  }
  function remove(index: number) {
    onChange(options.filter((_, i) => i !== index));
  }
  function add() {
    const n = options.length + 1;
    onChange([...options, { label: `Option ${n}`, value: slugify(`option ${n}`), points: 0 }]);
  }
  function reorder(from: number, to: number) {
    const next = [...options];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2">
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">{m.empty}</p>
      ) : (
        <SortableList ids={ids} onReorder={reorder} className="flex flex-col gap-2">
          {(id, index) => {
            const o = options[index];
            if (!o) return null;
            return (
              <SortableRow key={id} id={id}>
                {({ handleProps }) => (
                  <div className="flex items-end gap-2 rounded-md border border-border bg-background p-2">
                    <button
                      type="button"
                      aria-label={m.title}
                      className="mb-1.5 shrink-0 cursor-grab touch-none rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                      {...handleProps}
                    >
                      <i aria-hidden className="pi pi-bars" style={{ fontSize: 13 }} />
                    </button>
                    <label className="flex min-w-0 flex-[2] flex-col gap-1">
                      <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                        {m.label}
                        <HelpTip text={m.labelHelp} label={m.label} />
                      </span>
                      <TextField
                        value={o.label}
                        onChange={(e) => {
                          const label = e.target.value;
                          const autoValue = !o.value || o.value === slugify(o.label ?? '');
                          update(index, autoValue ? { label, value: slugify(label) } : { label });
                        }}
                      />
                    </label>
                    <label className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                        {m.value}
                        <HelpTip text={m.valueHelp} label={m.value} />
                      </span>
                      <TextField
                        value={o.value}
                        onChange={(e) => update(index, { value: e.target.value })}
                      />
                    </label>
                    {showPoints ? (
                      <label className="flex w-20 shrink-0 flex-col gap-1">
                        <span className="text-[11px] font-medium text-muted-foreground">{m.points}</span>
                        <NumberField
                          aria-label={m.points}
                          data-testid={`option-points-${index}`}
                          value={o.points ?? 0}
                          onChange={(e) => update(index, { points: Number(e.target.value) || 0 })}
                        />
                      </label>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={m.remove}
                      onClick={() => remove(index)}
                      className="mb-0.5 shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <i aria-hidden className="pi pi-trash" style={{ fontSize: 13 }} />
                    </Button>
                  </div>
                )}
              </SortableRow>
            );
          }}
        </SortableList>
      )}
      {showPoints ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground" data-testid="option-points-hint">
          {m.pointsHint}
        </p>
      ) : null}
      <div>
        <Button variant="outline" size="sm" onClick={add}>
          <i aria-hidden className="pi pi-plus" style={{ fontSize: 11 }} /> {m.add}
        </Button>
      </div>
    </div>
  );
}
