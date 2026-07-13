'use client';

import type { SliderScoringRange } from '@quill/engine';
import { Button } from '@/components/ui/button';
import { NumberField } from './fields';
import type { EditorMessages } from './messages';

/** Slider scoring ranges: value in [min,max] awards `points`. Add/remove rows. */
export function SliderScoringEditor({
  ranges,
  onChange,
  m,
}: {
  ranges: SliderScoringRange[];
  onChange: (next: SliderScoringRange[]) => void;
  m: EditorMessages['sliderScoring'];
}) {
  function update(index: number, patch: Partial<SliderScoringRange>) {
    onChange(ranges.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }
  return (
    <div className="flex flex-col gap-2">
      {ranges.length === 0 ? (
        <p className="text-xs text-muted-foreground">{m.empty}</p>
      ) : (
        ranges.map((r, index) => (
          <div
            key={index}
            className="flex items-end gap-2 rounded-md border border-border bg-background p-2"
          >
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">{m.min}</span>
              <NumberField value={r.min} onChange={(e) => update(index, { min: Number(e.target.value) || 0 })} />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">{m.max}</span>
              <NumberField value={r.max} onChange={(e) => update(index, { max: Number(e.target.value) || 0 })} />
            </label>
            <label className="flex w-16 shrink-0 flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">{m.points}</span>
              <NumberField value={r.points} onChange={(e) => update(index, { points: Number(e.target.value) || 0 })} />
            </label>
            <Button
              variant="ghost"
              size="icon"
              aria-label={m.remove}
              onClick={() => onChange(ranges.filter((_, i) => i !== index))}
              className="mb-0.5 shrink-0 text-muted-foreground hover:text-destructive"
            >
              <i aria-hidden className="pi pi-trash" style={{ fontSize: 13 }} />
            </Button>
          </div>
        ))
      )}
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange([...ranges, { min: 0, max: 0, points: 0 }])}
        >
          <i aria-hidden className="pi pi-plus" style={{ fontSize: 11 }} /> {m.add}
        </Button>
      </div>
    </div>
  );
}
