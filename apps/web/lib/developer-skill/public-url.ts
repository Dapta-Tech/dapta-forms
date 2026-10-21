import { trimTrailing } from '@quill/shared';

/**
 * An absolute http(s) URL with no trailing slash, or null. A path prefix is
 * kept (an API mounted under /forms-api), the query and hash are dropped.
 * The one normalizer behind every customer-facing address the developer pages
 * print (`publicApiUrl`, `publicMcpUrl`), so the skill and the MCP snippets
 * can never disagree about the shape of an address.
 */
export function cleanPublicUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return `${url.origin}${trimTrailing(url.pathname, '/')}`;
}
