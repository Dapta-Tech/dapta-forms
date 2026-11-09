import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getMessages } from '@quill/shared';
import { lockedOptionValues } from '@quill/engine';
import { adminApi, ApiError, isAdminRole, type AttributionStatus } from '@/lib/admin-api';
import { daptaAiUrl } from '@/lib/dapta-ai-url';
import { signupHref } from '@/lib/growth';
import { getLocale } from '@/lib/locale';
import { publicFormPath } from '@/lib/public-form-path';
import { FormEditor } from './form-editor';
import { BuilderTour } from './_components/builder-tour';

export const dynamic = 'force-dynamic';

export default async function EditFormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getLocale();
  const m = getMessages(locale).admin.editor;

  // The workspace attribution switch is offered in the Design panel only where
  // the deployment draws the attribution at all (as Brand kit does). A failed
  // read leaves the panel with the size control alone, never a broken switch.
  const attributionOn = signupHref('form-button') !== null;
  let form: Awaited<ReturnType<typeof adminApi.getForm>>;
  let me: Awaited<ReturnType<typeof adminApi.me>>;
  let attribution: AttributionStatus | null;
  try {
    [form, me, attribution] = await Promise.all([
      adminApi.getForm(id),
      adminApi.me(),
      attributionOn ? adminApi.attributionStatus().catch((): AttributionStatus | null => null) : null,
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  const publicPath = publicFormPath(me.accountCode, form.slug);

  return (
    <>
      <FormEditor
        id={form.id}
        initialName={form.name}
        // Edit the pending DRAFT when one exists; autosave keeps writing the
        // draft, and the explicit Publish action makes it live.
        initialConfig={form.draftConfig ?? form.config}
        initialHasDraft={form.draftConfig != null}
        initialPreviousPublishedAt={form.previousPublishedAt ?? null}
        // Which option values a label edit must not move, read from the LIVE
        // config rather than the draft being edited: a value is untouchable
        // because of what already left the building (answers already stored
        // against it, or a CRM mapping pointing at it), and the draft knows
        // neither. Computed here so the builder never pays a request for it.
        lockedValues={lockedOptionValues(form.config)}
        // A DEPLOYMENT capability, reported by the API rather than read from
        // the dashboard's own env: two copies of this switch that disagreed
        // would offer a question whose answers the API refuses.
        uploads={me.uploads}
        // Same rule for spam protection: the API says whether this deployment
        // can run the human check, and the editor never guesses.
        captcha={me.captcha}
        // Same rule for the workspace's attribution setting: the API's answer
        // (absent on an older API = shown).
        showAttribution={me.attributionBadge?.showing !== false}
        // The full switch state for the Design panel's "Off" option: the same
        // workspace setting as Brand kit, editable by owners and admins.
        attribution={
          attribution ? { initial: attribution, canEdit: isAdminRole(me.role), daptaAiUrl: daptaAiUrl() } : null
        }
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
