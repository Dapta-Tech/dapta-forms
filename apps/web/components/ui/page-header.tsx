import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The admin screen header system. Two consistent shapes so every admin surface
 * behaves the same (Design Quality Bar — one system, predictable back-nav):
 *
 *  • PageHeader — LIST / index pages. Title (+ optional subtitle) on the left,
 *    a single primary action (the green Create) top-right. No nested headers.
 *  • FormHeader — CREATE / EDIT pages. A back affordance to the parent list,
 *    the record title, and optional sticky actions (Save) top-right. Sticky so
 *    the primary action stays reachable while the form scrolls.
 *
 * A list page uses ONLY PageHeader; a detail page uses ONLY FormHeader — never
 * both stacked (that was the "double header" bug on /availability).
 */

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-muted-foreground">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/**
 * Sticky detail-page header. `-mx-8 px-8` bleeds the surface + border to the
 * container's padding edges so the backdrop covers the full width as content
 * scrolls under it. Place as the first child of a `px-8 py-10` page container.
 */
export function FormHeader({
  backHref,
  backLabel,
  title,
  actions,
}: {
  backHref: string;
  backLabel: string;
  title: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-20 -mx-8 mb-6 border-b border-border bg-background/90 px-8 pb-4 pt-6 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <i aria-hidden className="pi pi-chevron-left" style={{ fontSize: 12 }} />
        {backLabel}
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 text-2xl font-semibold tracking-tight">{title}</div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
