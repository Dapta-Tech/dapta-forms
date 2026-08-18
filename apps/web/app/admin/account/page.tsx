import { redirect } from 'next/navigation';

/** /admin/account has no page of its own: the first sub-nav entry is the landing. */
export default function AccountIndex(): never {
  redirect('/admin/account/workspaces');
}
