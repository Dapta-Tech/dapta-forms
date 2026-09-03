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
 * `settings` variant carries the explanatory help line, the `inline` one is
 * compact enough to sit beside a filter.
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
      if (res && 'ok' in res && res.ok) {
        toast.success(labels.saved);
        router.refresh();
      } else {
        setCurrent(previous);
        toast.error(labels.error);
      }
    });
  };

  const inline = variant === 'inline';
  return (
    <div
      data-testid={`workspace-timezone-${variant}`}
      className={inline ? 'flex min-w-0 flex-col gap-1' : 'flex min-w-0 max-w-md flex-col gap-1.5'}
    >
      <span className={inline ? 'text-xs font-medium text-muted-foreground' : 'text-2xs uppercase tracking-wide text-faint'}>
        {labels.label}
      </span>
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
          className={inline ? 'h-9 min-w-[220px] text-sm' : undefined}
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
