import { cn } from '@/lib/cn';

export interface PublishChipLabels {
  statusLive: string;
  statusLiveHint: string;
  statusUnpublished: string;
  statusUnpublishedHint: string;
}

/**
 * A form's publish state as a pill: green while what is live is what the editor
 * holds, amber while there are changes nobody published. The forms list and the
 * header of a form's own screens both say it, so they say it the same way.
 */
export function PublishChip({
  hasDraft,
  labels,
  testId,
}: {
  hasDraft: boolean;
  labels: PublishChipLabels;
  testId: string;
}) {
  return (
    <span
      data-testid={testId}
      data-status={hasDraft ? 'unpublished' : 'live'}
      title={hasDraft ? labels.statusUnpublishedHint : labels.statusLiveHint}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium text-foreground',
        hasDraft ? 'bg-warning/20' : 'bg-signal/20',
      )}
    >
      <span
        aria-hidden
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', hasDraft ? 'bg-warning' : 'bg-signal-edge')}
      />
      <span className="truncate">{hasDraft ? labels.statusUnpublished : labels.statusLive}</span>
    </span>
  );
}
