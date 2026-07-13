import Link from 'next/link';
import { notFound } from 'next/navigation';
import { adminApi, ApiError } from '@/lib/admin-api';
import { FormEditor } from './form-editor';

export const dynamic = 'force-dynamic';

export default async function EditFormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let form: Awaited<ReturnType<typeof adminApi.getForm>>;
  try {
    form = await adminApi.getForm(id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  return (
    <div className="mx-auto max-w-[900px] px-8 py-10">
      <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to forms
      </Link>
      <FormEditor
        id={form.id}
        initialName={form.name}
        initialConfig={JSON.stringify(form.config, null, 2)}
      />
    </div>
  );
}
