import type { ReactNode } from 'react';
import { getMessages } from '@quill/shared';
import { getLocale } from '@/lib/locale';
import { PageHeader } from '@/components/ui/page-header';
import { AccountNav } from './account-nav';

/**
 * Account settings (/admin/account/*): the area behind the rail's profile
 * button. One header, then the sub-nav (Workspaces · Brand kit · Notifications
 * · Public page) and the page. Side by side only from `xl`: the rail already
 * takes 240px from `md`, and two columns in what is left of a 768-1279px
 * viewport squeezed the page to a strip. Below `xl` the sub-nav sits above
 * the page as a 2x2 grid, so all four entries are visible at 375px too.
 *
 * Which workspace a page acts on is the PAGE's to say (Brand kit and
 * Notifications name the current one; a workspace detail names its own), not
 * this layout's: a single chip up here was wrong on the detail page.
 */
export default async function AccountLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const a = getMessages(locale).admin.account;

  return (
    <div className="mx-auto max-w-[1520px] px-6 py-10 sm:px-8">
      <PageHeader title={a.title} subtitle={a.subtitle} />
      <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:gap-8">
        <AccountNav labels={a.nav} ariaLabel={a.title} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
