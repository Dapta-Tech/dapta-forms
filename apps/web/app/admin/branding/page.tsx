import { getMessages } from '@quill/shared';
import { adminApi, isAdminRole } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { PageHeader } from '@/components/ui/page-header';
import { BrandKitPanel } from './brand-kit-panel';

export const dynamic = 'force-dynamic';

/**
 * The workspace brand kit: one place to set the logo, colors, font and control
 * shape every NEW form is born with, plus a bulk "apply to existing forms"
 * (snapshot + per-form undo). Reads are open to every member; the editor and
 * the apply/revert actions are admin/owner only (enforced server-side too).
 */
export default async function BrandingPage() {
  const locale = await getLocale();
  const messages = getMessages(locale).admin;
  const bk = messages.brandKit;

  const [me, branding, forms] = await Promise.all([
    adminApi.me(),
    adminApi.getBranding(),
    adminApi.listForms(),
  ]);

  return (
    <div className="mx-auto max-w-[1520px] px-6 py-10 sm:px-8">
      <PageHeader title={bk.title} subtitle={bk.subtitle} />
      <BrandKitPanel
        initialKit={branding.config ?? {}}
        updatedAt={branding.updatedAt}
        forms={forms}
        canEdit={isAdminRole(me.role)}
        bk={bk}
        design={messages.editor.design}
        locale={locale}
      />
    </div>
  );
}
