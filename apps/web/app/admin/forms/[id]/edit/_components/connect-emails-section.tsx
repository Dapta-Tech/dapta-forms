'use client';

import type { EditorMessages } from './messages';

/**
 * Emails slot on the Connect tab. Placeholder for the per-form email templates
 * workstream — this file's contents will be REPLACED by that feature; keep the
 * export name and props stable so connect-panel.tsx needs no change.
 */
export function ConnectEmailsSection({ m }: { m: EditorMessages['connect'] }) {
  return (
    <section
      data-testid="connect-emails-stub"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
    >
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-foreground">{m.emailsTitle}</h3>
      </div>
      <div className="rounded-md border border-dashed border-border bg-muted/40 p-4">
        <p className="text-sm text-muted-foreground">
          <i aria-hidden className="pi pi-envelope" style={{ fontSize: 12 }} /> {m.emailsComingSoon}
        </p>
      </div>
    </section>
  );
}
