'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Modal } from '@/components/modal';
import { Button } from '@/components/ui/button';
import { createFormAction } from '@/app/admin/actions';

interface Labels {
  create: string;
  createTitle: string;
  nameLabel: string;
  namePlaceholder: string;
  cancel: string;
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

  const trigger =
    variant === 'card' ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex flex-col gap-1 rounded-md border border-border bg-card p-5 text-left transition-transform hover:border-primary active:scale-[0.99]"
      >
        <span className="mb-1 flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <i aria-hidden className="pi pi-plus" style={{ fontSize: 14 }} />
        </span>
        <span className="font-medium">{cardTitle ?? labels.create}</span>
        {cardDesc ? <span className="text-sm text-muted-foreground">{cardDesc}</span> : null}
      </button>
    ) : (
      <Button variant={variant === 'outline' ? 'outline' : 'default'} onClick={() => setOpen(true)}>
        <i aria-hidden className="pi pi-plus" style={{ fontSize: 12 }} /> {labels.create}
      </Button>
    );

  return (
    <>
      {trigger}
      <Modal open={open} onClose={() => setOpen(false)} title={labels.createTitle} labelId="create-form-title">
        <form action={createFormAction} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{labels.nameLabel}</span>
            <input
              name="name"
              required
              autoComplete="off"
              placeholder={labels.namePlaceholder}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {labels.cancel}
            </Button>
            <SubmitButton label={labels.create} />
          </div>
        </form>
      </Modal>
    </>
  );
}
