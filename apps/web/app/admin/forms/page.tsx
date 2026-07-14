import Link from 'next/link';
import { getMessages, t } from '@quill/shared';
import { adminApi } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { CopyLink } from '@/components/copy-link';
import { PageHeader } from '@/components/ui/page-header';
import { CreateForm } from './create-form';
import { FormRowActions } from './form-row-actions';

export const dynamic = 'force-dynamic';

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
    cancel: m.cancel,
  };
  const rowLabels = {
    menu: m.actions,
    edit: m.edit,
    analytics: messages.nav.analytics,
    submissions: messages.nav.submissions,
    integrations: messages.nav.integrations,
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
        <div className="flex flex-col items-center gap-4 rounded-md border border-dashed border-border bg-card/40 p-12 text-center">
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
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {forms.map((f) => {
            const publicPath = `/${me.accountCode}/${me.handle ?? 'me'}/${f.slug}`;
            return (
              <li
                key={f.id}
                className="flex flex-col gap-4 rounded-md border border-border bg-card p-5 transition-colors hover:border-primary/60"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/forms/${f.id}/edit`}
                      className="block w-fit truncate text-base font-semibold tracking-tight transition-colors hover:text-primary"
                    >
                      {f.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t(m.updated, { when: new Date(f.updatedAt).toLocaleDateString(locale) })}
                    </p>
                  </div>
                  <FormRowActions id={f.id} labels={rowLabels} />
                </div>
                <CopyLink path={publicPath} labels={{ copy: m.copy, copied: m.copied, open: m.open }} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
