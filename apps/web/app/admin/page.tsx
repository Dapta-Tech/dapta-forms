import Link from 'next/link';
import { adminApi } from '@/lib/admin-api';
import { CopyLink } from '@/components/copy-link';
import { createFormAction } from './actions';
import { FormRowActions } from './form-row-actions';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const [me, forms] = await Promise.all([adminApi.me(), adminApi.listForms()]);

  return (
    <div className="mx-auto max-w-[1100px] px-8 py-10">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Forms</h1>
          <p className="text-muted-foreground">Build a form, share the public link, collect submissions.</p>
        </div>
        <form action={createFormAction} className="flex items-center gap-2">
          <input
            name="name"
            placeholder="New form name"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground active:scale-[0.98]"
          >
            Create form
          </button>
        </form>
      </div>

      {forms.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-12 text-center text-muted-foreground">
          No forms yet. Create your first form above.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {forms.map((f) => {
            const publicPath = `/${me.accountCode}/${me.handle ?? 'me'}/${f.slug}`;
            return (
              <li
                key={f.id}
                className="flex items-center justify-between gap-4 rounded-md border border-border bg-card p-4"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <Link href={`/admin/forms/${f.id}/edit`} className="font-medium hover:underline">
                    {f.name}
                  </Link>
                  <CopyLink path={publicPath} labels={{ copy: 'Copy link', copied: 'Copied', open: 'Open' }} />
                  <span className="text-xs text-muted-foreground">
                    Updated {new Date(f.updatedAt).toLocaleString()}
                  </span>
                </div>
                <FormRowActions id={f.id} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
