'use client';

import type { FormStep, SliderScoringRange } from '@quill/engine';
import { overlappingSliderRanges, sliderBounds, sliderRangeUnreachable } from '@quill/engine';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { NumberField } from './fields';
import type { EditorMessages } from './messages';

/**
 * Slider scoring ranges: value in [min,max] awards `points`. Add/remove rows.
 *
 * Each row is checked against the slider's OWN bounds (V5-A3): a 0–2000 slider
 * scoring 5000–6000 is silently dead, and nothing in the UI said so. Flagged, not
 * blocked — the bounds are often widened right after the ranges are typed. A new
 * row also seeds to the slider's bounds instead of 0–0, which was never a range
 * anyone wanted.
 */
export function SliderScoringEditor({
  step,
  ranges,
  onChange,
  m,
}: {
  step: FormStep;
  ranges: SliderScoringRange[];
  onChange: (next: SliderScoringRange[]) => void;
  m: EditorMessages['sliderScoring'];
}) {
  const { min, max } = sliderBounds(step);
  // Rows shadowed by an earlier one: sliderPoints returns on the FIRST match, so
  // these award nothing for the shared values (V5-QA).
  const overlapped = new Set(overlappingSliderRanges(step));
  function update(index: number, patch: Partial<SliderScoringRange>) {
    onChange(ranges.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] leading-relaxed text-muted-foreground">{m.hint}</p>
      {ranges.length === 0 ? (
        <p className="text-xs text-muted-foreground">{m.empty}</p>
      ) : (
        ranges.map((r, index) => {
          const unreachable = sliderRangeUnreachable(step, r);
          const shadowed = !unreachable && overlapped.has(index);
          return (
            <div key={index} className="flex flex-col gap-1.5">
              <div
                className={cn(
                  'flex items-end gap-2 rounded-md border bg-background p-2',
                  unreachable ? 'border-destructive/60' : shadowed ? 'border-secondary/50' : 'border-border',
                )}
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
              {shadowed ? (
                <p
                  data-testid="slider-range-overlapped"
                  className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground"
                >
                  <i aria-hidden className="pi pi-info-circle mt-0.5 shrink-0 text-secondary" style={{ fontSize: 10 }} />
                  {m.overlapped}
                </p>
              ) : null}
              {unreachable ? (
                <p
                  role="alert"
                  data-testid="slider-range-unreachable"
                  className="flex items-start gap-1.5 text-[11px] leading-relaxed text-destructive"
                >
                  <i aria-hidden className="pi pi-exclamation-triangle mt-0.5 shrink-0" style={{ fontSize: 10 }} />
                  {m.unreachable.replace('{min}', String(min)).replace('{max}', String(max))}
                </p>
              ) : null}
            </div>
          );
        })
      )}
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange([...ranges, { min, max, points: 0 }])}
        >
          <i aria-hidden className="pi pi-plus" style={{ fontSize: 11 }} /> {m.add}
        </Button>
      </div>
    </div>
  );
}
