'use client';

import type { FormConfig, FormOutcome } from '@quill/engine';
import { createEmptyOutcome } from '@quill/engine';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Field, TextField, NumberField, InlineField, PanelSection } from './fields';
import type { EditorMessages } from './messages';

/**
 * Outcomes editor — the generalized score-routing model. Each bucket has a
 * label, a minimum score, and an optional redirect URL; at submit time the
 * highest bucket the score clears wins. A master toggle mirrors
 * `scoring.enabled`.
 */
export function OutcomesPanel({
  config,
  onScoringChange,
  onOutcomesChange,
  m,
}: {
  config: FormConfig;
  onScoringChange: (enabled: boolean) => void;
  onOutcomesChange: (next: FormOutcome[]) => void;
  m: EditorMessages;
}) {
  const outcomes = config.outcomes ?? [];
  const scoringOn = config.scoring?.enabled !== false;

  function update(index: number, patch: Partial<FormOutcome>) {
    onOutcomesChange(outcomes.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  }
  function add() {
    const taken = new Set(outcomes.map((o) => o.id));
    onOutcomesChange([...outcomes, createEmptyOutcome(taken)]);
  }

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-4">
      <PanelSection title={m.outcomes.title} subtitle={m.outcomes.subtitle}>
        <InlineField label={m.outcomes.scoringEnabled} hint={m.outcomes.scoringHint}>
          <Switch checked={scoringOn} onCheckedChange={onScoringChange} aria-label={m.outcomes.scoringEnabled} />
        </InlineField>
      </PanelSection>

      <PanelSection
        title={m.outcomes.title}
        action={
          <Button variant="outline" size="sm" onClick={add}>
            <i aria-hidden className="pi pi-plus" style={{ fontSize: 11 }} /> {m.outcomes.add}
          </Button>
        }
      >
        {outcomes.length === 0 ? (
          <p className="text-xs text-muted-foreground">{m.outcomes.empty}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {outcomes.map((o, index) => (
              <div key={o.id} className="flex flex-col gap-3 rounded-md border border-border bg-background p-3 sm:flex-row sm:items-end">
                <Field label={m.outcomes.label} className="flex-[2]">
                  <TextField
                    value={o.label}
                    placeholder={m.outcomes.labelPlaceholder}
                    onChange={(e) => update(index, { label: e.target.value })}
                  />
                </Field>
                <Field label={m.outcomes.minScore} className="sm:w-28">
                  <NumberField
                    value={o.minScore ?? 0}
                    onChange={(e) => update(index, { minScore: Number(e.target.value) || 0 })}
                  />
                </Field>
                <Field label={m.outcomes.redirectUrl} className="flex-[2]">
                  <TextField
                    type="url"
                    value={o.redirectUrl ?? ''}
                    placeholder={m.outcomes.redirectPlaceholder}
                    onChange={(e) => update(index, { redirectUrl: e.target.value || null })}
                  />
                </Field>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={m.outcomes.remove}
                  onClick={() => onOutcomesChange(outcomes.filter((_, i) => i !== index))}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <i aria-hidden className="pi pi-trash" style={{ fontSize: 13 }} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </PanelSection>
    </div>
  );
}
