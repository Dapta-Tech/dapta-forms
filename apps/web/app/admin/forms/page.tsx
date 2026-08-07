import Link from 'next/link';
import { getMessages, t } from '@quill/shared';
import { adminApi } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { CopyLinkIcon } from '@/components/copy-link';
import { PageHeader } from '@/components/ui/page-header';
import { CreateForm } from './create-form';
import { FormRowActions } from './form-row-actions';

export const dynamic = 'force-dynamic';

/** First-class row actions (user feedback: nothing hidden behind the kebab).
 *  Secondary buttons collapse to icon-only below `md` — the aria-label/title
 *  keep them nameable; the kebab holds only Duplicate/Delete. Tokens only. */
const primaryBtn =
  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const secondaryBtn =
  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-transparent px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const iconBtn =
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default async function FormsList() {
  const locale = await getLocale();
  const messages = getMessages(locale).admin;
  const m = messages.forms;
  const [me, forms] = await Promise.all([adminApi.me(), adminApi.listForms()]);

  const createLabels = {
    create: m.create,
    createTitle: m.createTitle,
    nameLabel: m.nameLabel,
    namePlaceholder: m.namePlaceholder,
    nameRequired: m.nameRequired,
    cancel: m.cancel,
    layoutLabel: m.layoutLabel,
    layoutSlides: m.layoutSlides,
    layoutSlidesDesc: m.layoutSlidesDesc,
    layoutVertical: m.layoutVertical,
    layoutVerticalDesc: m.layoutVerticalDesc,
  };
  const rowLabels = {
    menu: m.actions,
    duplicate: m.duplicate,
    delete: m.delete,
    deleteConfirm: m.deleteConfirm,
  };

  return (
    <div className="mx-auto max-w-[1520px] px-6 py-10 sm:px-8">
      <PageHeader
        title={m.title}
        subtitle={m.subtitle}
        action={forms.length > 0 ? <CreateForm labels={createLabels} /> : undefined}
      />

      {forms.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border bg-card/40 p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <i aria-hidden className="pi pi-file-edit" style={{ fontSize: 20 }} />
          </div>
          <div>
            <p className="font-medium text-foreground">{m.emptyTitle}</p>
            <p className="mt-1 text-sm text-muted-foreground">{m.emptyBody}</p>
          </div>
          <CreateForm labels={createLabels} />
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {forms.map((f) => {
            const publicPath = `/${me.accountCode}/${me.handle ?? 'me'}/${f.slug}`;
            const editHref = `/admin/forms/${f.id}/edit`;
            return (
              <li
                key={f.id}
                data-testid="form-row"
                className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-border bg-card px-5 py-4 transition-colors hover:border-primary/60"
              >
                <div className="min-w-0 flex-1 basis-60">
                  <Link
                    href={editHref}
                    className="block w-fit max-w-full truncate text-base font-semibold tracking-tight transition-colors hover:text-primary"
                  >
                    {f.name}
                  </Link>
                  {/* The row's two facts are not equally interesting. The public
                      path is what someone came here to copy, so it keeps the body
                      tier; the timestamp and the separator drop to `text-faint` —
                      the quiet step exists exactly so metadata can sit beside a
                      value without competing with it. */}
                  <p className="mt-0.5 flex min-w-0 items-center gap-2 text-xs">
                    <span className="shrink-0 text-faint">
                      {t(m.updated, { when: new Date(f.updatedAt).toLocaleDateString(locale) })}
                    </span>
                    <span aria-hidden className="shrink-0 text-faint">
                      ·
                    </span>
                    <span className="min-w-0 truncate font-mono text-muted-foreground" title={publicPath}>
                      {publicPath}
                    </span>
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <Link data-testid="form-row-edit" href={editHref} className={primaryBtn} title={m.edit}>
                    <i aria-hidden className="pi pi-pencil" style={{ fontSize: 13 }} />
                    {m.edit}
                  </Link>
                  <Link
                    data-testid="form-row-submissions"
                    href={`/admin/forms/${f.id}/submissions`}
                    className={secondaryBtn}
                    aria-label={messages.nav.submissions}
                    title={messages.nav.submissions}
                  >
                    <i aria-hidden className="pi pi-inbox" style={{ fontSize: 13 }} />
                    <span className="hidden md:inline">{messages.nav.submissions}</span>
                  </Link>
                  <Link
                    data-testid="form-row-analytics"
                    href={`/admin/forms/${f.id}/analytics`}
                    className={secondaryBtn}
                    aria-label={messages.nav.analytics}
                    title={messages.nav.analytics}
                  >
                    <i aria-hidden className="pi pi-chart-bar" style={{ fontSize: 13 }} />
                    <span className="hidden md:inline">{messages.nav.analytics}</span>
                  </Link>
                  <Link
                    data-testid="form-row-connect"
                    href={`${editHref}?tab=connect`}
                    className={secondaryBtn}
                    aria-label={m.connect}
                    title={m.connect}
                  >
                    <i aria-hidden className="pi pi-link" style={{ fontSize: 13 }} />
                    <span className="hidden md:inline">{m.connect}</span>
                  </Link>
                  <CopyLinkIcon
                    path={publicPath}
                    labels={{ copy: m.copy, copied: m.copied }}
                    testId="form-row-copy"
                    className={iconBtn}
                  />
                  <a
                    data-testid="form-row-open"
                    href={publicPath}
                    target="_blank"
                    rel="noreferrer"
                    className={iconBtn}
                    aria-label={m.openForm}
                    title={m.openForm}
                  >
                    <i aria-hidden className="pi pi-external-link" style={{ fontSize: 14 }} />
                  </a>
                  <FormRowActions id={f.id} labels={rowLabels} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
