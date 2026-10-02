import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The two shapes a settings screen is built from, so Brand kit, Notifications,
 * Public page and Preferences read as one system instead of four stacks of
 * cards.
 *
 *  - `SettingsRow`: what the setting is and why on the left, the control on the
 *    right, a hairline between rows. Information lives directly on the page
 *    rather than inside a box per setting.
 *  - `SettingsPanel`: the one boxed surface, for a thing that sits BESIDE the
 *    settings (a preview, a bulk action) and has to read as separate from them.
 */
export function SettingsRow({
  title,
  hint,
  first = false,
  children,
  testId,
}: {
  title: string;
  hint?: string;
  /** The first row has no rule above it. */
  first?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className={cn(
        'grid gap-3 py-6 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-6',
        !first && 'border-t border-border',
      )}
    >
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function SettingsPanel({
  title,
  hint,
  tone = 'card',
  children,
}: {
  title?: string;
  hint?: string;
  /** `card`: a bordered surface. `well`: the grey work surface, for a preview. */
  tone?: 'card' | 'well';
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        'flex flex-col gap-4 rounded-2xl p-5',
        tone === 'well' ? 'bg-panel' : 'border border-border bg-card',
      )}
    >
      {title ? (
        <div className="min-w-0">
          <h3
            className={cn(
              tone === 'well'
                ? 'text-xs font-medium uppercase tracking-wider text-faint'
                : 'text-sm font-semibold text-foreground',
            )}
          >
            {title}
          </h3>
          {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
