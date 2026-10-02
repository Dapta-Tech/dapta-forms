import Link from 'next/link';
import type { ReactNode } from 'react';
import { PublishChip, type PublishChipLabels } from './publish-chip';

/**
 * The header every screen of ONE form shares outside the editor (Submissions,
 * its Summary, Analytics): where you are ("Forms / the form's name", with its
 * publish state), the screen's own actions on the right, and the tabs that
 * move between the form's screens.
 *
 * The rule under the tabs runs the full width of the page; the content inside
 * is held to the same measure as every other admin screen.
 */
export type FormTab = 'edit' | 'analytics' | 'submissions';

export function FormTabs({
  formId,
  active,
  labels,
  name,
  hasDraft,
  statusLabels,
  actions,
}: {
  formId: string;
  active: FormTab;
  labels: {
    edit: string;
    analytics: string;
    submissions: string;
    integrations: string;
    backToForms: string;
    /** The list this form belongs to: the first crumb. */
    forms: string;
  };
  /** The form's name: the page's heading. */
  name: string;
  /** Whether the form holds unpublished changes. Left out, no chip is drawn. */
  hasDraft?: boolean;
  statusLabels?: PublishChipLabels;
  /** The screen's own controls (an export, a date range), on the right. */
  actions?: ReactNode;
}) {
  // Integrations live in the editor's Connect tab; the old per-form route only
  // redirects there, so the tab goes straight to it.
  const tabs: { key: FormTab | 'integrations'; href: string; label: string }[] = [
    { key: 'edit', href: `/admin/forms/${formId}/edit`, label: labels.edit },
    { key: 'submissions', href: `/admin/forms/${formId}/submissions`, label: labels.submissions },
    { key: 'analytics', href: `/admin/forms/${formId}/analytics`, label: labels.analytics },
    { key: 'integrations', href: `/admin/forms/${formId}/edit?tab=connect`, label: labels.integrations },
  ];
  return (
    <header className="border-b border-border" data-testid="form-header">
      <div className="mx-auto max-w-[1520px] px-6 pt-6 sm:px-8">
        {/* Top-aligned: when the actions grow a second row (a custom date
            range), the name stays on the first line instead of sinking to the
            middle of the block. */}
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="flex min-h-10 min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <Link
              href="/admin/forms"
              title={labels.backToForms}
              className="shrink-0 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {labels.forms}
            </Link>
            <span aria-hidden className="text-sm text-faint">
              /
            </span>
            <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight">{name}</h1>
            {typeof hasDraft === 'boolean' && statusLabels ? (
              <span className="shrink-0">
                <PublishChip hasDraft={hasDraft} labels={statusLabels} testId="form-status" />
              </span>
            ) : null}
          </div>
          {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
        <nav className="-mx-2.5 mt-3 flex items-center gap-1 overflow-x-auto" aria-label="Form sections">
          {tabs.map((t) => {
            const isActive = t.key === active;
            return (
              <Link
                key={t.key}
                href={t.href}
                aria-current={isActive ? 'page' : undefined}
                className={`relative inline-flex h-11 shrink-0 items-center whitespace-nowrap px-2.5 text-sm font-medium transition-colors after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                  isActive
                    ? 'text-foreground after:bg-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
