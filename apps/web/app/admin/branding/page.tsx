import { redirect } from 'next/navigation';

/**
 * The brand kit lives under Account settings now (/admin/account/brand-kit).
 * Kept as a redirect so bookmarks and older links keep working.
 */
export default function BrandingRedirect(): never {
  redirect('/admin/account/brand-kit');
}
