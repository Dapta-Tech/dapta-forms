import Link from 'next/link';

/**
 * Cross-page tabs for a single form's admin surfaces (Edit / Analytics /
 * Submissions) plus a back-to-list affordance. A NEW shared component so the
 * analytics + submissions pages get consistent navigation WITHOUT touching the
 * editor page internals. Tokens-only styling; the active tab is unmistakable
 * (Design Quality Bar #5).
 */
export type FormTab = 'edit' | 'analytics' | 'submissions';

export function FormTabs({
  formId,
  active,
  labels,
}: {
  formId: string;
  active: FormTab;
  labels: { edit: string; analytics: string; submissions: string; backToForms: string };
}) {
  const tabs: { key: FormTab; href: string; label: string }[] = [
    { key: 'edit', href: `/admin/forms/${formId}/edit`, label: labels.edit },
    { key: 'analytics', href: `/admin/forms/${formId}/analytics`, label: labels.analytics },
    { key: 'submissions', href: `/admin/forms/${formId}/submissions`, label: labels.submissions },
  ];
  return (
    <div className="mb-6">
      <Link
        href="/admin/forms"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <i aria-hidden className="pi pi-chevron-left" style={{ fontSize: 12 }} />
        {labels.backToForms}
      </Link>
      <nav className="mt-3 flex items-center gap-1 border-b border-border" aria-label="Form sections">
        {tabs.map((t) => {
          const isActive = t.key === active;
          return (
            <Link
              key={t.key}
              href={t.href}
              aria-current={isActive ? 'page' : undefined}
              className={
                isActive
                  ? 'relative -mb-px border-b-2 border-primary px-3 py-2 text-sm font-semibold text-foreground'
                  : 'relative -mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground'
              }
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
