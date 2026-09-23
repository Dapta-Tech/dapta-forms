import Link from 'next/link';

export type SubmissionsView = 'summary' | 'responses';

/**
 * Summary | Responses: the two ways to read a form's submissions, as separate
 * routes the way Typeform splits them. Links, not client tabs, so each view
 * keeps its own URL (and its own data fetch) and the browser's Back works.
 */
export function SubmissionsViewTabs({
  formId,
  active,
  labels,
}: {
  formId: string;
  active: SubmissionsView;
  labels: { tabSummary: string; tabResponses: string; tabsLabel: string };
}) {
  const tabs: { key: SubmissionsView; href: string; label: string; icon: string }[] = [
    {
      key: 'summary',
      href: `/admin/forms/${formId}/submissions/summary`,
      label: labels.tabSummary,
      icon: 'pi-chart-bar',
    },
    {
      key: 'responses',
      href: `/admin/forms/${formId}/submissions`,
      label: labels.tabResponses,
      icon: 'pi-table',
    },
  ];
  return (
    <nav
      aria-label={labels.tabsLabel}
      data-testid="submissions-view-tabs"
      className="inline-flex w-fit items-center gap-1 rounded-lg border border-border bg-card p-1"
    >
      {tabs.map((tab) => {
        const on = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={on ? 'page' : undefined}
            data-view={tab.key}
            className={
              on
                ? 'inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground ring-1 ring-primary-edge'
                : 'inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
            }
          >
            <i aria-hidden className={`pi ${tab.icon}`} style={{ fontSize: 12 }} />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
