import { isSafeHttpUrl } from '@quill/engine';

/**
 * Leaving an EMBEDDED form at the top level.
 *
 * The public renderer's ending/outcome redirect used to be a plain
 * `window.location.href = url`. Inside an iframe embed that navigates the
 * FRAME, not the tab the visitor is looking at, so the destination now has to
 * survive being framed by a third-party site. Checkout pages deliberately do
 * not: a Stripe Payment Link loads and then hangs on its own skeleton forever,
 * because its session bootstrap refuses to run cross-site. To the visitor the
 * form submitted into nothing.
 *
 * Two routes can take them out at the top level, and EXACTLY ONE of them must
 * run — firing both starts two navigations of the same top-level document, and
 * WebKit resolves that race by cancelling both, stranding the visitor on the
 * form. So the host is asked first and answers for itself:
 *
 *  1. `postMessage` to the host page, where our `public/embed.js` navigates and
 *     acknowledges. This is the only route that works when the host SANDBOXES
 *     the iframe: a `sandbox` attribute without `allow-top-navigation` makes
 *     route 2 a silent no-op (the browser refuses it with a console warning),
 *     while `embed.js` runs in the host page, outside that sandbox.
 *
 *  2. A direct write to `window.top.location`, taken only when no
 *     acknowledgement arrives — the host is serving an OLD cached `embed.js`,
 *     or the iframe was pasted bare with no script at all. A plain cross-origin
 *     frame may navigate its top, with or without user activation.
 *
 * A host that is BOTH sandboxed and running no `embed.js` cannot be redirected
 * by anything the frame does; nothing inside the sandbox can reach past it.
 *
 * Framing is detected from the window itself, never from `?embed=1` — an
 * iframe pasted without the flag is just as framed, and broke the same way.
 *
 * NOT embedded — the ordinary case — is left exactly as it was: one
 * `window.location.href`, and nothing is posted to anyone.
 *
 * Security posture of route 1: `redirectUrl` is a static string from the
 * PUBLISHED form config (`resolveEnding` returns it verbatim — it is never
 * interpolated with answers), so the message is exactly as public as the form
 * document any visitor can already fetch. It carries no answers, no keys and
 * no identifiers, which is why `targetOrigin: '*'` is acceptable here, the same
 * reasoning the height reporter runs on: the embedding site is by definition
 * unknown to us, and `window.parent` delivers to that host page and nowhere
 * else. The protocol is re-checked below because the value leaves our origin.
 * The acknowledgement is accepted only from `window.parent`, so a frame beside
 * ours cannot forge one to suppress route 2 and strand the visitor.
 */

/** The message `public/embed.js` listens for to navigate the host page. */
export const EMBED_REDIRECT_MESSAGE = 'dapta-forms:redirect';

/** The reply `public/embed.js` sends back: "I have this, do not navigate." */
export const EMBED_REDIRECT_ACK = 'dapta-forms:redirect-ack';

/**
 * How long to wait for that reply. A `postMessage` round trip inside one tab is
 * a pair of tasks, so this is far more than enough; it is only ever spent in
 * full on a host with no current `embed.js`, which then redirects itself.
 */
export const EMBED_ACK_TIMEOUT_MS = 150;

/** True when this document is rendered inside a frame of any kind. */
export function isEmbedded(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.top !== window.self;
  } catch {
    // A cross-origin `window.top` comparison can throw in older engines. If we
    // are not even allowed to look, we are certainly framed.
    return true;
  }
}

/**
 * Navigate the visitor to `url` at the top level, embedded or not.
 *
 * Callers already gate on `isSafeHttpUrl` so they can fall through to the
 * thank-you screen on a bad URL; the re-check here is belt-and-braces for the
 * value that crosses the origin boundary, and never changes their control flow.
 */
export function navigateTop(url: string): void {
  if (typeof window === 'undefined') return;
  if (!isSafeHttpUrl(url)) {
    console.warn('[forms] ignored non-http(s) redirectUrl');
    return;
  }

  if (!isEmbedded()) {
    window.location.href = url;
    return;
  }

  let settled = false;
  const onAck = (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    if (!event.data || (event.data as { type?: unknown }).type !== EMBED_REDIRECT_ACK) return;
    settled = true; // the host page is navigating itself — stay out of its way
    window.removeEventListener('message', onAck);
  };
  window.addEventListener('message', onAck);

  // Route 1 — ask the host page to navigate itself.
  try {
    window.parent.postMessage({ type: EMBED_REDIRECT_MESSAGE, url }, '*');
  } catch {
    /* a host that refuses messages will never ack, so route 2 takes over */
  }

  // Route 2 — no answer, so navigate the top ourselves.
  setTimeout(() => {
    window.removeEventListener('message', onAck);
    if (settled) return;
    try {
      if (window.top) window.top.location.href = url;
    } catch {
      /* sandboxed frame with no embed.js on the page — nothing can reach out */
    }
  }, EMBED_ACK_TIMEOUT_MS);
}
