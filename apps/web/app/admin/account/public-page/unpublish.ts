import { linkPageToInput, type LinkPage, type LinkPageInput } from '@quill/types';

/** The last saved page as a body the API accepts again, or null when none was ever saved. */
export function savedBody(page: LinkPage | null): LinkPageInput | null {
  return page ? linkPageToInput(page) : null;
}

/**
 * What turning the page OFF writes: the last SAVED page with `enabled: false`.
 * Never the draft, so a half-typed link or social can never keep a page
 * published, and unsaved edits are neither lost nor published by the switch.
 */
export function unpublishBody(lastSaved: LinkPageInput | null): LinkPageInput {
  return { ...(lastSaved ?? { version: 1 }), enabled: false };
}
