import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getMessages } from '@quill/shared';
import { lockedOptionValues } from '@quill/engine';
import { adminApi, ApiError } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { FormEditor } from './form-editor';
import { BuilderTour } from './_components/builder-tour';

export const dynamic = 'force-dynamic';

export default async function EditFormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getLocale();
  const m = getMessages(locale).admin.editor;

  let form: Awaited<ReturnType<typeof adminApi.getForm>>;
  let me: Awaited<ReturnType<typeof adminApi.me>>;
  try {
    [form, me] = await Promise.all([adminApi.getForm(id), adminApi.me()]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  const publicPath = `/${me.accountCode}/${me.handle ?? 'me'}/${form.slug}`;

  return (
    <>
      <FormEditor
        id={form.id}
        initialName={form.name}
        // Edit the pending DRAFT when one exists; autosave keeps writing the
        // draft, and the explicit Publish action makes it live.
        initialConfig={form.draftConfig ?? form.config}
        initialHasDraft={form.draftConfig != null}
        // Which option values a label edit must not move, read from the LIVE
        // config rather than the draft being edited: a value is untouchable
        // because of what already left the building (answers already stored
        // against it, or a CRM mapping pointing at it), and the draft knows
        // neither. Computed here so the builder never pays a request for it.
        lockedValues={lockedOptionValues(form.config)}
        updatedAt={form.updatedAt}
        publicPath={publicPath}
        locale={locale}
        m={m}
      />
      {/* First-run coach marks, armed only by `?tour=1` on the wizard's own
          redirect. Suspense because `useSearchParams` suspends; the fallback is
          nothing, since a tour that has not measured its anchor yet should show
          nothing rather than a card pinned to the corner. */}
      <Suspense fallback={null}>
        <BuilderTour locale={locale} />
      </Suspense>
    </>
  );
}
