'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Modal } from '@/components/modal';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { createFormAction } from '@/app/admin/actions';

interface Labels {
  create: string;
  createTitle: string;
  nameLabel: string;
  namePlaceholder: string;
  cancel: string;
  /** Inline error when the name is left blank (V5-A8). */
  nameRequired: string;
  /** Layout picker: slides (one question per screen) vs one vertical page. */
  layoutLabel: string;
  layoutSlides: string;
  layoutSlidesDesc: string;
  layoutVertical: string;
  layoutVerticalDesc: string;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="min-w-[110px]">
      {label}
    </Button>
  );
}

/**
 * Create-form entry point following the list/create pattern (Design Quality
 * Bar): a primary trigger that opens a dedicated create surface (a dialog),
 * never an inline form under the list. Submits to the create server action,
 * which redirects into the new form's editor.
 *
 * Two triggers, one dialog:
 *  • `variant="button"` — the green Create button (list header, empty state).
 *  • `variant="card"`   — a quick-action card on the dashboard.
 */
export function CreateForm({
  labels,
  variant = 'button',
  cardTitle,
  cardDesc,
}: {
  labels: Labels;
  variant?: 'button' | 'outline' | 'card';
  cardTitle?: string;
  cardDesc?: string;
}) {
  const [open, setOpen] = useState(false);
  const [nameError, setNameError] = useState(false);
  const [layout, setLayout] = useState<'slides' | 'vertical'>('slides');

  // Every open starts clean and every dismissal clears the error, so a Cancel
  // (or ESC, or overlay click) can't leave a stale "name required" on the next,
  // untouched dialog (V4-11). Cancel previously called only setOpen(false).
  const openDialog = () => {
    setNameError(false);
    setLayout('slides');
    setOpen(true);
  };
  const closeDialog = () => {
    setOpen(false);
    setNameError(false);
  };

  const trigger =
    variant === 'card' ? (
      <button
        type="button"
        onClick={openDialog}
        className="group flex flex-col gap-1 rounded-md border border-border bg-card p-5 text-left transition-transform hover:border-primary active:scale-[0.99]"
      >
        <span className="mb-1 flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <i aria-hidden className="pi pi-plus" style={{ fontSize: 14 }} />
        </span>
        <span className="font-medium">{cardTitle ?? labels.create}</span>
        {cardDesc ? <span className="text-sm text-muted-foreground">{cardDesc}</span> : null}
      </button>
    ) : (
      <Button variant={variant === 'outline' ? 'outline' : 'default'} onClick={openDialog}>
        <i aria-hidden className="pi pi-plus" style={{ fontSize: 12 }} /> {labels.create}
      </Button>
    );

  return (
    <>
      {trigger}
      <Modal open={open} onClose={closeDialog} title={labels.createTitle} labelId="create-form-title">
        {/* `noValidate` + an inline error instead of the browser's own bubble
            (V5-A8): the native popup is an OS-styled white/orange box that
            ignores the app's theme and dark mode entirely, so the one validation
            message on this screen looked like it came from a different product. */}
        <form
          action={createFormAction}
          noValidate
          onSubmit={(e) => {
            const value = new FormData(e.currentTarget).get('name');
            if (typeof value === 'string' && value.trim()) return;
            e.preventDefault();
            setNameError(true);
          }}
          className="flex flex-col gap-4"
        >
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{labels.nameLabel}</span>
            <input
              name="name"
              required
              autoComplete="off"
              autoFocus
              aria-invalid={nameError || undefined}
              aria-describedby={nameError ? 'create-form-name-error' : undefined}
              onInput={() => setNameError(false)}
              placeholder={labels.namePlaceholder}
              className={cn(
                'w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                nameError ? 'border-destructive' : 'border-input',
              )}
            />
            {nameError ? (
              <span
                id="create-form-name-error"
                role="alert"
                data-testid="create-form-name-error"
                className="text-xs text-destructive"
              >
                {labels.nameRequired}
              </span>
            ) : null}
          </label>

          {/* Layout picker: two visual cards. Rides the form as a hidden input
              so the server action reads one flat FormData — no client fetch. */}
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">{labels.layoutLabel}</legend>
            <input type="hidden" name="layout" value={layout} />
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  {
                    id: 'slides' as const,
                    label: labels.layoutSlides,
                    desc: labels.layoutSlidesDesc,
                    sketch: (
                      // One tall card = one question per screen.
                      <span aria-hidden className="flex h-10 items-center justify-center gap-1">
                        <span className="h-8 w-6 rounded-sm border border-current opacity-90" />
                        <span className="h-8 w-1.5 rounded-sm border border-current opacity-40" />
                      </span>
                    ),
                  },
                  {
                    id: 'vertical' as const,
                    label: labels.layoutVertical,
                    desc: labels.layoutVerticalDesc,
                    sketch: (
                      // Stacked rows = every question on one page.
                      <span aria-hidden className="flex h-10 flex-col items-center justify-center gap-1">
                        <span className="h-1.5 w-9 rounded-sm border border-current opacity-90" />
                        <span className="h-1.5 w-9 rounded-sm border border-current opacity-70" />
                        <span className="h-1.5 w-9 rounded-sm border border-current opacity-50" />
                      </span>
                    ),
                  },
                ]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={layout === opt.id}
                  data-testid={`create-form-layout-${opt.id}`}
                  onClick={() => setLayout(opt.id)}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-md border p-3 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    layout === opt.id
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground',
                  )}
                >
                  {opt.sketch}
                  <span className="text-sm font-medium">{opt.label}</span>
                  <span className="text-xs text-muted-foreground">{opt.desc}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={closeDialog}>
              {labels.cancel}
            </Button>
            <SubmitButton label={labels.create} />
          </div>
        </form>
      </Modal>
    </>
  );
}
