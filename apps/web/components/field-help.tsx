/** R18 inline field help: a small focusable “?” affordance. The explanation is
 *  the accessible name (announced on keyboard focus, not hover-title-only) and
 *  the native tooltip for mouse users. Type=button so it never submits or, when
 *  nested in a &lt;label&gt;, toggles the label's control. */
export function FieldHelp({ text }: { text: string }) {
  return (
    <button
      type="button"
      aria-label={text}
      title={text}
      onClick={(e) => e.preventDefault()}
      className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border border-border text-[10px] leading-none text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      ?
    </button>
  );
}
