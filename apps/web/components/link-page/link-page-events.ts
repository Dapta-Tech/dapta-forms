import {
  LINK_PAGE_LINK_TYPES,
  LINK_PAGE_SOCIALS,
  type LinkPageEvent,
  type LinkPageLinkType,
  type LinkPageSocial,
} from '@quill/types';

/** The few attributes the tracker reads, so it can be tested without a DOM. */
export interface LinkPageClickSource {
  getAttribute(name: string): string | null;
}

/**
 * The click event a `data-lp-*` element describes, or null when it describes
 * none (an attribute nobody wrote, or a value the API would refuse anyway).
 */
export function linkPageEventFromElement(el: LinkPageClickSource): LinkPageEvent | null {
  const type = el.getAttribute('data-lp-type');
  if (!type || !(LINK_PAGE_LINK_TYPES as readonly string[]).includes(type)) return null;
  const rawPos = el.getAttribute('data-lp-pos');
  const pos = rawPos == null || rawPos === '' ? NaN : Number(rawPos);
  const network = el.getAttribute('data-lp-network');
  const slug = el.getAttribute('data-lp-slug');
  return {
    type: 'click',
    linkType: type as LinkPageLinkType,
    ...(Number.isInteger(pos) && pos >= 0 ? { position: pos } : {}),
    ...(network && (LINK_PAGE_SOCIALS as readonly string[]).includes(network)
      ? { network: network as LinkPageSocial }
      : {}),
    ...(slug ? { slug } : {}),
  };
}
