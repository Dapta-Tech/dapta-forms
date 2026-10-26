import type { LinkPage } from '@quill/types';

/**
 * The workspace link page lives at `/{accountCode}` and only answers while it
 * is published (`page.enabled`; the API 404s otherwise, see
 * `LinkPageService.publicPage`). Two surfaces need the same answer to "where
 * is it, and is it live": the Public page editor and the Home dashboard's
 * shareable link. One helper so they cannot disagree.
 *
 * It replaced the per-member page at `/{accountCode}/{handle}`, which now
 * redirects here (`app/[accountCode]/[handle]/route.ts`).
 */
export function workspacePagePath(accountCode: string): string {
  return `/${encodeURIComponent(accountCode)}`;
}

/**
 * The path when it is safe to hand out, else null. Home shows its "Your public
 * page" box only in that case: an unpublished page has no link worth copying,
 * so the box hides rather than pointing at a 404.
 */
export function publishedWorkspacePagePath(
  accountCode: string,
  page: Pick<LinkPage, 'enabled'> | null | undefined,
): string | null {
  return page?.enabled ? workspacePagePath(accountCode) : null;
}

/**
 * Where one of the workspace's pages lives: the default page at
 * `/{accountCode}`, every other one at `/{accountCode}/p/{slug}`.
 */
export function linkPagePublicPath(accountCode: string, page: { slug: string; isDefault: boolean }): string {
  return page.isDefault
    ? workspacePagePath(accountCode)
    : `/${encodeURIComponent(accountCode)}/p/${encodeURIComponent(page.slug)}`;
}

/**
 * The share card of a workspace's page: the default page's at
 * `app/api/public/pages/[accountCode]/og`, any other page's one level down.
 */
export function linkPageOgPath(accountCode: string, pageSlug?: string | null): string {
  const base = `/api/public/pages/${encodeURIComponent(accountCode)}`;
  return pageSlug ? `${base}/${encodeURIComponent(pageSlug)}/og` : `${base}/og`;
}

/** Where a page's views and clicks are sent (`app/api/public/pages/...`). */
export function linkPageEventsPath(accountCode: string, pageSlug?: string | null): string {
  const base = `/api/public/pages/${encodeURIComponent(accountCode)}`;
  return pageSlug ? `${base}/${encodeURIComponent(pageSlug)}/events` : `${base}/events`;
}

/**
 * Could this be a page slug? The vanity shape, without regard to case (the
 * API lowercases). Anything else is a 404 without a call to the API.
 */
export function plausiblePageSlug(slug: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{1,28})[A-Za-z0-9]$/.test(slug);
}

/**
 * Could this be a workspace code (or a vanity slug)? Letters, digits and
 * inner hyphens, nothing else. A file name like `favicon.ico`, a dotfile probe
 * or an encoded slash is answered with a 404 without asking the API.
 */
export function plausibleAccountCode(code: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?$/.test(code);
}

/** Up to two letters for the stand-in when a page has no logo. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : (words[0] ?? '').slice(0, 2);
  return letters.toUpperCase();
}
