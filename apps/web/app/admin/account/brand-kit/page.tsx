import { getMessages } from '@quill/shared';
import { adminApi, isAdminRole, type AttributionStatus } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { signupHref } from '@/lib/growth';
import { daptaAiUrl } from '@/lib/dapta-ai-url';
import { BrandKitPanel } from './brand-kit-panel';
import { AttributionSetting } from './attribution-setting';
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

  // The attribution row exists only where the deployment draws the
  // attribution at all: with no signup URL (or NEXT_PUBLIC_HIDE_BADGE) nothing
  // ever shows, and a switch for it would be a dead control.
  const attributionOn = signupHref('form-button') !== null;
  const [me, branding, forms, attribution] = await Promise.all([
    adminApi.me(),
    adminApi.getBranding(),
    adminApi.listForms(),
    // An API older than the setting has no route: the row is left out rather
    // than failing the whole page.
    attributionOn ? adminApi.attributionStatus().catch((): AttributionStatus | null => null) : null,
  ]);

  return (
    <div data-testid="account-brand-kit">
      <BrandKitPanel
        initialKit={branding.config ?? {}}
        updatedAt={branding.updatedAt}
        forms={forms}
        canEdit={isAdminRole(me.role)}
        bk={bk}
        design={messages.editor.design}
        locale={locale}
        workspaceName={me.accountName}
        topRow={
          attribution ? (
            // Keyed: an element made here and placed by the client panel among
            // its own rows reads to React as a list child, and warned without it.
            <AttributionSetting
              key="attribution"
              first
              initial={attribution}
              canEdit={isAdminRole(me.role)}
              daptaAiUrl={daptaAiUrl()}
              m={messages.attributionSetting}
            />
          ) : null
        }
        heading={
          <>
            <h2 className="text-xl font-semibold tracking-tight">{bk.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{bk.subtitle}</p>
            <div className="mt-3">
              <ManagingChip label={messages.account.managing} name={me.accountName} />
            </div>
          </>
        }
      />
    </div>
  );
}
