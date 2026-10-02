'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/toast';
import { browserTimezones } from '@/lib/timezones';
import { callAction } from '@/lib/call-action';
import { setWorkspaceTimezoneAction } from '@/app/admin/workspace-actions';

export interface WorkspaceTimezoneLabels {
  label: string;
  /** Explains that the zone is shared by the whole workspace. */
  help: string;
  saved: string;
  error: string;
  /** Trigger text while nobody has set a zone (UTC applies). */
  unset: string;
  utc: string;
  /** Shown to a member, who sees the value but cannot change it. */
  readOnly: string;
}

/**
 * The ONE workspace timezone, editable by admins/owners from two places (the
 * workspace's settings page and the submissions table) and read-only for
 * members. Both surfaces write the same column through the same action; the
 * `settings` variant carries the explanatory help line, the `inline` one is a
 * chip that sits beside the table's export.
 */
export function WorkspaceTimezoneField({
  accountId,
  value,
  canEdit,
  variant,
  locale,
  labels,
}: {
  accountId: string;
  value: string | null;
  canEdit: boolean;
  variant: 'settings' | 'inline';
  locale: string;
  labels: WorkspaceTimezoneLabels;
}) {
  const toast = useToast();
  const router = useRouter();
  const helpId = useId();
  const [pending, start] = useTransition();
  const [current, setCurrent] = useState<string>(value ?? '');
  const zones = browserTimezones() ?? [];
  const options = [
    { value: 'UTC', label: labels.utc },
    // A stored zone this browser cannot enumerate still shows as itself.
    ...(current && current !== 'UTC' && !zones.includes(current) ? [{ value: current, label: current }] : []),
    ...zones.filter((z) => z !== 'UTC').map((zone) => ({ value: zone, label: zone })),
  ];

  const onChange = (next: string) => {
    const previous = current;
    setCurrent(next);
    start(async () => {
      const res = await callAction(() => setWorkspaceTimezoneAction(accountId, next || null));
      if ('ok' in res && res.ok) {
        toast.success(labels.saved);
        router.refresh();
      } else {
        setCurrent(previous);
        toast.error(labels.error);
      }
    });
  };

  // Inline, it is a chip beside the table's export: a clock and the zone. The
  // label and the help line are still there for a screen reader and on hover;
  // spelled out above a control this small they outweighed the table.
  if (variant === 'inline') {
    const hint = canEdit ? labels.help : `${labels.help} ${labels.readOnly}`;
    return (
      <div data-testid="workspace-timezone-inline" className="relative min-w-0" title={`${labels.label}. ${hint}`}>
        <i
          aria-hidden
          className={`pi ${canEdit ? 'pi-clock' : 'pi-lock'} pointer-events-none absolute left-3.5 top-1/2 z-1 -translate-y-1/2 text-muted-foreground`}
          style={{ fontSize: 13 }}
        />
        {canEdit ? (
          <Select
            ariaLabel={labels.label}
            value={current}
            options={options}
            placeholder={labels.unset}
            searchable
            locale={locale}
            disabled={pending}
            onChange={onChange}
            className="h-10 min-w-[220px] rounded-full pl-9 text-sm"
          />
        ) : (
          <span
            className="inline-flex h-10 items-center rounded-full border border-input pl-9 pr-4 text-sm text-foreground"
            data-testid="workspace-timezone-readonly"
          >
            {current || labels.unset}
          </span>
        )}
        <p id={helpId} className="sr-only">
          {hint}
        </p>
      </div>
    );
  }

  return (
    <div data-testid="workspace-timezone-settings" className="flex min-w-0 max-w-md flex-col gap-1.5">
      <span className="text-2xs uppercase tracking-wide text-faint">{labels.label}</span>
      {canEdit ? (
        <Select
          ariaLabel={labels.label}
          value={current}
          options={options}
          placeholder={labels.unset}
          searchable
          locale={locale}
          disabled={pending}
          onChange={onChange}
        />
      ) : (
        <span
          className="inline-flex items-center gap-1.5 text-sm text-foreground"
          title={labels.readOnly}
          data-testid="workspace-timezone-readonly"
        >
          <i aria-hidden className="pi pi-lock text-muted-foreground" style={{ fontSize: 12 }} />
          {current || labels.unset}
        </span>
      )}
      <p id={helpId} className="text-xs text-muted-foreground">
        {canEdit ? labels.help : `${labels.help} ${labels.readOnly}`}
      </p>
    </div>
  );
}
