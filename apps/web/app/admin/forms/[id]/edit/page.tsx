import { notFound } from 'next/navigation';
import { getMessages } from '@quill/shared';
import { adminApi, ApiError } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { FormEditor } from './form-editor';

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
    <FormEditor
      id={form.id}
      initialName={form.name}
      // Edit the pending DRAFT when one exists; autosave keeps writing the
      // draft, and the explicit Publish action makes it live.
      initialConfig={form.draftConfig ?? form.config}
      publicPath={publicPath}
      locale={locale}
      m={m}
    />
  );
}
