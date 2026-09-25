/** Completed or partial, as a pill: the table row and the response panel both show it. */
export function StatusBadge({ completed, label }: { completed: boolean; label: string }) {
  return (
    <span
      className={
        completed
          ? 'inline-flex items-center gap-1.5 rounded-full bg-primary/20 px-2.5 py-0.5 text-xs font-medium text-foreground'
          : 'inline-flex items-center gap-1.5 rounded-full bg-secondary/20 px-2.5 py-0.5 text-xs font-medium text-foreground'
      }
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${completed ? 'bg-primary-edge' : 'bg-secondary'}`}
      />
      {label}
    </span>
  );
}
