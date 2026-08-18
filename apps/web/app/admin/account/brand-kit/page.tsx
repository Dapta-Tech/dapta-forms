import { getMessages } from '@quill/shared';
import { adminApi, isAdminRole } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { BrandKitPanel } from './brand-kit-panel';
import { ManagingChip } from '../_components/managing-chip';

export const dynamic = 'force-dynamic';

/**
 * Account settings → Brand kit. One place to set the logo, colors, font and
 * control shape every NEW form is born with, plus a bulk "apply to existing
 * forms" (snapshot + per-form undo). Reads are open to every member; the editor
 * and the apply/revert actions are admin/owner only (enforced server-side too).
 *
 * The account layout owns the page frame (title, sub-nav, width), so this
 * renders a section heading and the panel only.
 */
export default async function BrandKitPage() {
  const locale = await getLocale();
  const messages = getMessages(locale).admin;
  const bk = messages.brandKit;

  const [me, branding, forms] = await Promise.all([
    adminApi.me(),
    adminApi.getBranding(),
    adminApi.listForms(),
  ]);

  return (
    <div data-testid="account-brand-kit">
      <div className="mb-6">
        <h2 className="text-xl font-semibold tracking-tight">{bk.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{bk.subtitle}</p>
        <div className="mt-3">
          <ManagingChip label={messages.account.managing} name={me.accountName} />
        </div>
      </div>
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
