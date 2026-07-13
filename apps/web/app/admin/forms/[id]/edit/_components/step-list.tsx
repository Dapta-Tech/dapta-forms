'use client';

import { useState } from 'react';
import type { FormStep, FormFieldType } from '@quill/engine';
import { Button } from '@/components/ui/button';
import { SelectField } from './fields';
import { SortableList, SortableRow } from './sortable';
import type { EditorMessages } from './messages';

const STEP_TYPES: FormFieldType[] = [
  'text',
  'name',
  'email',
  'phone',
  'dropdown',
  'multiple_choice',
  'slider',
  'textarea',
  'message',
];

const TYPE_TAG: Record<FormFieldType, string> = {
  text: 'TXT',
  name: 'NAME',
  email: 'MAIL',
  phone: 'TEL',
  dropdown: 'LIST',
  multiple_choice: 'PICK',
  slider: 'SLDR',
  textarea: 'LONG',
  message: 'MSG',
};

/**
 * The left rail: a drag-reorderable list of steps (dnd-kit) with a type-picker
 * add control at the bottom. Selection drives the center properties panel and
 * the live preview. The active row is unmistakable (accent border + fill).
 */
export function StepList({
  steps,
  selectedIndex,
  onSelect,
  onReorder,
  onAdd,
  m,
}: {
  steps: FormStep[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onReorder: (from: number, to: number) => void;
  onAdd: (type: FormFieldType) => void;
  m: EditorMessages;
}) {
  const [addType, setAddType] = useState<FormFieldType>('text');
  const ids = steps.map((s) => s.key);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">{m.steps.title}</h2>
        <span className="text-xs text-muted-foreground">{steps.length}</span>
      </div>

      {steps.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          {m.steps.empty}
        </p>
      ) : (
        <SortableList ids={ids} onReorder={onReorder} className="flex flex-col gap-1.5">
          {(id, index) => {
            const step = steps[index];
            if (!step) return null;
            const active = index === selectedIndex;
            return (
              <SortableRow key={id} id={id}>
                {({ handleProps }) => (
                  <div
                    className={
                      'flex items-center gap-2 rounded-md border px-2 py-2 transition-colors ' +
                      (active
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-card hover:border-muted-foreground')
                    }
                  >
                    <button
                      type="button"
                      aria-label={m.steps.dragHint}
                      className="shrink-0 cursor-grab touch-none rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                      {...handleProps}
                    >
                      <i aria-hidden className="pi pi-bars" style={{ fontSize: 12 }} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelect(index)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-muted-foreground">
                        {TYPE_TAG[step.type]}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {step.question?.trim() || m.steps.untitled}
                      </span>
                      {step.showWhen || step.hideWhen ? (
                        <i
                          aria-hidden
                          title={m.flow.conditional}
                          className="pi pi-sitemap shrink-0 text-muted-foreground"
                          style={{ fontSize: 11 }}
                        />
                      ) : null}
                    </button>
                  </div>
                )}
              </SortableRow>
            );
          }}
        </SortableList>
      )}

      <div className="flex items-end gap-2 border-t border-border pt-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">{m.steps.addType}</span>
          <SelectField value={addType} onChange={(e) => setAddType(e.target.value as FormFieldType)}>
            {STEP_TYPES.map((t) => (
              <option key={t} value={t}>
                {m.types[t]}
              </option>
            ))}
          </SelectField>
        </label>
        <Button variant="outline" size="sm" onClick={() => onAdd(addType)} className="shrink-0">
          <i aria-hidden className="pi pi-plus" style={{ fontSize: 11 }} /> {m.steps.add}
        </Button>
      </div>
    </div>
  );
}
