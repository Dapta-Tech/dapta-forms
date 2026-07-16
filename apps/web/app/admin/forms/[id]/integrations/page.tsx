import Link from 'next/link';
import { notFound } from 'next/navigation';
import { adminApi, ApiError, type HubSpotPropertiesResponse } from '@/lib/admin-api';
import { getMessages } from '@quill/shared';
import { getLocale } from '@/lib/locale';
import type { FormDestination } from '@quill/types';
import { IntegrationsEditor, type QuestionMeta } from './integrations-editor';

export const dynamic = 'force-dynamic';

export default async function IntegrationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getLocale();
  const m = getMessages(locale).admin.integrations;

  let form: Awaited<ReturnType<typeof adminApi.getForm>>;
  try {
    form = await adminApi.getForm(id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  // The property picker degrades gracefully — a lookup failure must not 500 the
  // whole page; the editor shows a disabled state and still lets you save.
  let hubspot: HubSpotPropertiesResponse;
  try {
    hubspot = await adminApi.hubspotProperties();
  } catch {
    hubspot = { enabled: false, reason: m.loadError };
  }

  // Account-level connection gates the mapping UI (Typeform model). A lookup
  // failure degrades to "not connected" — the editor still shows the mapping
  // when the property picker resolved via the server env fallback.
  let hubspotConnected = false;
  try {
    const integrations = await adminApi.listIntegrations();
    hubspotConnected = integrations.providers.some((p) => p.provider === 'hubspot' && p.connected);
  } catch {
    hubspotConnected = false;
  }

  const destinations = (form.config.destinations ?? []) as FormDestination[];
  // "Map questions" rows come from the latest authored steps (draft preferred so
  // a builder can pre-map questions before publishing). `message` steps collect
  // no answer, so they are excluded.
  const cfg = form.draftConfig ?? form.config;
  const questions: QuestionMeta[] = (cfg.steps ?? [])
    .filter((s) => s.type !== 'message')
    .map((s) => ({ key: s.key, label: s.question?.trim() || s.key, type: s.type }));

  return (
    <div className="mx-auto max-w-[900px] px-8 py-10">
      <Link href="/admin/forms" className="text-sm text-muted-foreground hover:text-foreground">
        {m.back}
      </Link>
      <div className="mt-4 mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{m.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {form.name} — {m.subtitle}
        </p>
      </div>
      <IntegrationsEditor
        id={id}
        initialDestinations={destinations}
        hubspot={hubspot}
        hubspotConnected={hubspotConnected}
        questions={questions}
        messages={m}
        locale={locale}
      />
    </div>
  );
}
