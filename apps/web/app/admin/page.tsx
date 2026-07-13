import Link from 'next/link';
import { getMessages, t } from '@quill/shared';
import { adminApi } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { CopyLink } from '@/components/copy-link';
import { PageHeader } from '@/components/ui/page-header';
import { CreateFormButton } from './create-form-button';
import { FormRowActions } from './form-row-actions';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const locale = await getLocale();
  const messages = getMessages(locale).admin;
  const m = messages.forms;
  const nav = messages.nav;
  const [me, forms] = await Promise.all([adminApi.me(), adminApi.listForms()]);

  const createLabels = {
    create: m.create,
    createTitle: m.createTitle,
    nameLabel: m.nameLabel,
    namePlaceholder: m.namePlaceholder,
    cancel: m.cancel,
  };
  const rowLabels = { duplicate: m.duplicate, delete: m.delete, deleteConfirm: m.deleteConfirm };

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-10 sm:px-8">
      <PageHeader
        title={m.title}
        subtitle={m.subtitle}
        action={forms.length > 0 ? <CreateFormButton labels={createLabels} /> : undefined}
      />

      {forms.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <i aria-hidden className="pi pi-file-edit" style={{ fontSize: 20 }} />
          </div>
          <div>
            <p className="font-medium text-foreground">{m.emptyTitle}</p>
            <p className="mt-1 text-sm text-muted-foreground">{m.emptyBody}</p>
          </div>
          <CreateFormButton labels={createLabels} />
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {forms.map((f) => {
            const publicPath = `/${me.accountCode}/${me.handle ?? 'me'}/${f.slug}`;
            return (
              <li
                key={f.id}
                className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <Link
                    href={`/admin/forms/${f.id}/edit`}
                    className="w-fit font-medium transition-colors hover:text-primary hover:underline"
                  >
                    {f.name}
                  </Link>
                  <CopyLink path={publicPath} labels={{ copy: m.copy, copied: m.copied, open: m.open }} />
                  <span className="text-xs text-muted-foreground">
                    {t(m.updated, { when: new Date(f.updatedAt).toLocaleDateString(locale) })}
                  </span>
                </div>
                <FormRowActions
                  id={f.id}
                  labels={rowLabels}
                  nav={{ analytics: nav.analytics, submissions: nav.submissions }}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
