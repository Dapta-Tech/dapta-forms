/**
 * The "you don't have access" panel shown when a plain member lands on an
 * admin-only surface (Members, Developer). The API also enforces this (403);
 * this is the graceful FE gate so a member sees a clear message, not an error.
 */
export function NoAccess({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border p-10 text-center">
      <span
        aria-hidden
        className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-muted-foreground"
      >
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
