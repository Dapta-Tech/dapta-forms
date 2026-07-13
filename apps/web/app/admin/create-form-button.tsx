'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Modal } from '@/components/modal';
import { Button } from '@/components/ui/button';
import { createFormAction } from './actions';

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
 * Bar): a primary button that opens a dedicated create surface (a dialog),
 * never an inline form under the list. Submits to the create server action,
 * which redirects into the new form's editor.
 */
export function CreateFormButton({ labels, variant = 'default' }: { labels: Labels; variant?: 'default' | 'outline' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <i aria-hidden className="pi pi-plus" style={{ fontSize: 12 }} /> {labels.create}
      </Button>
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
