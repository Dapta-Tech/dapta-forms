'use server';

import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { linkPageToInput, type LinkPageInput } from '@quill/types';
import { adminApi, ApiError } from '@/lib/admin-api';

/**
 * The workspace link pages' writes. The workspace is always the caller's own,
 * resolved server-side from the session; the API validates every page with
 * `linkPageSchema` and answers 400 with the field when something is off.
 */

export interface LinkPageActionResult {
  ok: boolean;
  message?: string;
  /** The API's error code (`SLUG_TAKEN`, `DEFAULT_PAGE`, `PAGE_LIMIT`, `BAD_REQUEST`...). */
  code?: string;
  /** The page the action created or changed. */
  id?: string;
  slug?: string;
}

const LIST = '/admin/account/public-page';

/** The list, the page's editor and Home (which links to the default page while it is live). */
function refresh(id?: string) {
  revalidatePath(LIST);
  if (id) revalidatePath(`${LIST}/${id}`);
  revalidatePath('/admin');
}

async function attempt(work: () => Promise<{ id?: string | null; slug?: string | null } | void>, id?: string): Promise<LinkPageActionResult> {
  try {
    const out = (await work()) ?? {};
    refresh(out.id ?? id);
    return { ok: true, ...(out.id ? { id: out.id } : {}), ...(out.slug ? { slug: out.slug } : {}) };
  } catch (e) {
    unstable_rethrow(e);
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Could not save.',
      ...(e instanceof ApiError && e.code ? { code: e.code } : {}),
    };
  }
}

/** Save the DEFAULT page's content as a whole (or clear it), the one-page write. */
export async function saveLinkPageAction(page: LinkPageInput | null): Promise<LinkPageActionResult> {
  return attempt(async () => {
    await adminApi.saveLinkPage(page);
  });
}

/** Save one page: its content, and its internal name and slug when given. */
export async function savePageAction(
  id: string,
  body: { name?: string; slug?: string; page?: LinkPageInput },
): Promise<LinkPageActionResult> {
  return attempt(() => adminApi.updateLinkPage(id, body), id);
}

/** Make a page the one served at `/{accountCode}`. */
export async function makeDefaultPageAction(id: string): Promise<LinkPageActionResult> {
  return attempt(() => adminApi.updateLinkPage(id, { isDefault: true }), id);
}

/**
 * Publish or unpublish a page from the list. Reads the page as SAVED and
 * writes it back with only `enabled` changed, so a list toggle can never
 * publish anything an editor tab has not saved.
 */
export async function setPagePublishedAction(id: string, enabled: boolean): Promise<LinkPageActionResult> {
  return attempt(async () => {
    const view = await adminApi.linkPageById(id);
    // A stored page that no longer parses is never overwritten from here:
    // only its editor can replace it, with the person looking at it.
    if (!view.page) throw new ApiError(409, 'PAGE_UNREADABLE', 'PAGE_UNREADABLE');
    return adminApi.updateLinkPage(id, { page: { ...linkPageToInput(view.page), enabled } });
  }, id);
}

/** Add a page; the editor opens on it next. */
export async function createPageAction(body: { name?: string; slug?: string }): Promise<LinkPageActionResult> {
  return attempt(() => adminApi.createLinkPage(body));
}

/** Copy a page, unpublished, under a new slug. */
export async function duplicatePageAction(id: string, name?: string): Promise<LinkPageActionResult> {
  return attempt(() => adminApi.duplicateLinkPage(id, name !== undefined ? { name } : {}));
}

/** Delete a page that is not the default. */
export async function deletePageAction(id: string): Promise<LinkPageActionResult> {
  return attempt(async () => {
    await adminApi.deleteLinkPage(id);
  });
}
