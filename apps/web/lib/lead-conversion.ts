/**
 * The ONE place a completed submission becomes a conversion event.
 *
 * The form page loads a Meta Pixel (`components/tracking/tracking-scripts.tsx`)
 * that fires a single `PageView` on init, which tells Meta who LOOKED at the
 * form. It never told Meta who FINISHED it, so a campaign could only optimize
 * against visits, and the thank-you screen cannot supply the missing signal on
 * its own, because it is not a page load at all: the public form is one document
 * changing phase, so no pixel notices it. Hence this module.
 *
 * Called from the success branch of `finalize` in BOTH public renderers
 * (`form-renderer.tsx`, `vertical-form-renderer.tsx`) and nowhere else. It is a
 * separate module rather than a shared submit hook on purpose: those two files
 * own the most delicate flow in the product, and the conversion event is the
 * only thing they need to agree on here.
 *
 * Three rules it exists to keep:
 *
 *  1. AFTER the server confirmed. A partial submission is not a lead, and a
 *     submit that failed and will be retried is not a lead either. The caller
 *     invokes this past its `res.ok` check.
 *
 *  2. EXACTLY ONCE per session. The lock lives in `sessionStorage`, keyed off
 *     the session key the renderers already use (`quill-form-<account>-<slug>`),
 *     because a `useRef` dies with the document: a respondent who reloads the
 *     thank-you screen, or re-submits after a reload, would report a second
 *     lead and inflate the campaign's conversion count.
 *
 *  3. BEFORE the caller navigates. `fbq` is fire-and-forget over the network, so
 *     an immediate `window.location` assignment cancels its request, which is
 *     exactly what a redirect ending with a zero delay does. Callers fire this
 *     BEFORE the `submit` funnel event they already await, so that existing wait
 *     doubles as the window for the pixel's request to leave. No new timer, no
 *     added latency.
 *
 * Nothing here is required: a form with no pixel and no GTM container has no
 * `window.fbq` and no `window.dataLayer`, so this makes zero requests and
 * touches nothing. Both dispatches are also wrapped, because a third-party stub
 * that throws must never strand a visitor mid-submit.
 *
 * EMBEDDED FORMS (decided, v1 scope): inside an iframe this fires the form's OWN
 * pixel, from inside the frame, and tells the host page nothing. That works with
 * no cooperation from the host, because the pixel is form config and loads in
 * the frame with the rest of the page. What v1 deliberately does NOT do is ask
 * the host to fire ITS pixel: that would need a new message type in
 * `public/embed.js` (which carries the height, the redirect, the scroll into
 * view and the page context the form asks for at submit), it would run
 * on pages we do not control, and we could not know whether the host already
 * fires a Lead of its own. Double counting is the precise failure this module
 * exists to prevent. The honest limitation: in a cross-site frame the pixel
 * request is a third-party context that Safari partitions, so embedded
 * attribution is weaker than top-level, and a silent host-side event would hide
 * that rather than fix it. If someone asks for it, the shape is a
 * `dapta-forms:lead` message handled by `embed.js`, opt-in per iframe, and
 * documented as mutually exclusive with the host's own Lead.
 */

/** Meta's standard conversion event for a completed lead form. */
export const LEAD_PIXEL_EVENT = 'Lead';

/**
 * The `dataLayer` event name for the same conversion, so a form tracked through
 * a GTM container instead of a bare pixel can trigger on it. Named in the
 * snake_case the platform's own `dataLayer` events already use.
 */
export const LEAD_DATALAYER_EVENT = 'form_lead';

/**
 * Where the "this session already reported" mark lives, next to the session id.
 *
 * The separator is `#` because a slug may contain hyphens (`^[a-z0-9]+(-[a-z0-9]+)*$`,
 * `packages/shared/src/handle.ts`) and slugs are editable. With a `-` separator the
 * mark for the form `demo` would BE the session key of the form `demo-lead`, so in
 * one tab each would overwrite the other's session id. `#` cannot occur in a slug,
 * so the two namespaces can never meet.
 */
export function leadReportedKey(sessionKey: string): string {
  return `${sessionKey}#lead`;
}

type Fbq = (...args: unknown[]) => void;
type TrackedWindow = Window & { fbq?: Fbq; dataLayer?: unknown[] };

/**
 * Fallback lock for the lifetime of THIS document, used when `sessionStorage`
 * is unavailable (a private window with site data blocked). It still covers the
 * double click, which is the common case; a reload would then report again, and
 * for an ad campaign an occasional duplicate beats a missing conversion.
 */
const reportedInThisDocument = new Set<string>();

/** Take the once-per-session lock, or report that someone already has it. */
function claimLead(sessionKey: string, sessionId: string): boolean {
  const key = leadReportedKey(sessionKey);
  const mark = `${key}=${sessionId}`;
  if (reportedInThisDocument.has(mark)) return false;
  reportedInThisDocument.add(mark);
  try {
    if (window.sessionStorage.getItem(key) === sessionId) return false;
    window.sessionStorage.setItem(key, sessionId);
  } catch {
    /* storage blocked: the in-document mark above is the whole lock */
  }
  return true;
}

/**
 * Report a completed submission as a conversion, at most once per form session.
 *
 * Returns whether this call is the one that reported it, which is what the unit
 * tests assert on; the renderers ignore it.
 */
export function reportLeadConversion({
  sessionKey,
  sessionId,
}: {
  /** The renderer's session-storage key, `quill-form-<accountCode>-<slug>`. */
  sessionKey: string;
  /** The id stored under it: the identity of THIS attempt at the form. */
  sessionId: string;
}): boolean {
  if (typeof window === 'undefined') return false;
  if (!sessionKey || !sessionId) return false;
  if (!claimLead(sessionKey, sessionId)) return false;

  const w = window as TrackedWindow;
  try {
    if (typeof w.fbq === 'function') w.fbq('track', LEAD_PIXEL_EVENT);
  } catch {
    /* a broken vendor stub cannot be allowed to strand the submit */
  }
  try {
    // Guarded, never created: the PUBLIC page initializes `dataLayer` nowhere
    // (the only init lives inside the GTM snippet), so with no container
    // configured the array simply does not exist. Creating one here would push
    // into something no container will ever read.
    if (Array.isArray(w.dataLayer)) w.dataLayer.push({ event: LEAD_DATALAYER_EVENT });
  } catch {
    /* same posture as the pixel above */
  }
  return true;
}
