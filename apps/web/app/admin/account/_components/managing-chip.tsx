/**
 * "Managing: <workspace>" — names the workspace a page acts on. Rendered by
 * the pages whose data is per-workspace (Brand kit, Notifications) right
 * under their heading, never by the layout: the workspace detail page manages
 * a DIFFERENT workspace than the cookie's, and one chip up top was wrong there.
 */
export function ManagingChip({ label, name }: { label: string; name: string }) {
  return (
    <span
      data-testid="account-managing"
      className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs"
    >
      <span
        aria-hidden
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-primary/15 text-2xs font-semibold text-foreground"
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="shrink-0 text-faint">{label}:</span>
      <span className="truncate font-medium text-foreground">{name}</span>
    </span>
  );
}
