import type { MemberProfile } from '@quill/types';

/**
 * The member's public page lives at `/{accountCode}/{handle}` and only answers
 * while the profile is published (`profile.enabled`; the API 404s otherwise, see
 * `SubmissionService.publicProfile`). Two surfaces need the same answer to
 * "where is it, and is it live": the Account settings card and the Home
 * dashboard's shareable link. One helper so they cannot disagree.
 */
export function publicPagePath(me: { accountCode: string; handle: string | null }): string | null {
  return me.handle ? `/${me.accountCode}/${me.handle}` : null;
}

/**
 * The path when it is safe to hand out, else null. Home shows its "Your public
 * page" box only in that case: an unpublished page (or a member with no handle)
 * has no link worth copying, so the box hides rather than pointing at a 404.
 */
export function publishedPublicPagePath(
  me: { accountCode: string; handle: string | null },
  profile: Pick<MemberProfile, 'enabled'> | null | undefined,
): string | null {
  if (!profile?.enabled) return null;
  return publicPagePath(me);
}
