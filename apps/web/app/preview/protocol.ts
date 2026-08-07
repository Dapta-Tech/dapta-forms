import type { FormConfig, FormLayout } from '@quill/engine';

/**
 * The contract between the builder's `PreviewFrame` and the preview DOCUMENT it
 * iframes (`/preview`). Kept in one module so the two sides cannot drift on the
 * channel name, the message shape, or the origin rule.
 *
 * WHY an iframe at all: the preview used to render the public markup as a
 * subtree of the ADMIN document, so every `@media` query, every `dvh` and every
 * `vw` resolved against the browser window rather than the 390px frame. A
 * "mobile" preview on a 1440px screen was the DESKTOP rendering squeezed into a
 * phone-shaped box — `(max-width: 480px)` was false, `(min-width: 769px)` was
 * TRUE, and `clamp(28px, 6vw, 38px)` measured 6vw of 1440. An iframe has its own
 * viewport, so all three resolve against the frame width by construction, with
 * no change to the public stylesheet.
 *
 * WHY postMessage rather than a URL: the preview must show the IN-MEMORY editor
 * state. A server-rendered preview would show the last AUTOSAVE (900ms behind
 * every keystroke) and the public URL shows the last PUBLISH — which is the bug
 * that made authors change every colour, press Preview, and be shown the old
 * design with nothing explaining why.
 */

/** Path of the preview document. Deliberately outside `[accountCode]`. */
export const PREVIEW_ROUTE = '/preview';

/** Marks a message as ours. Anything without it is ignored. */
export const PREVIEW_CHANNEL = 'dapta-forms-preview';

/**
 * The renderers need an account code and slug. Inside the preview they are
 * never addresses: they key a `sessionStorage` id and the attribution link.
 * Every request they could produce is fenced before it leaves the document
 * (see `installPreviewNetworkFence`), so they name nothing real on purpose.
 */
export const PREVIEW_ACCOUNT_CODE = 'preview';
export const PREVIEW_SLUG = 'preview';

/** Child → parent, once per document load: "I am listening, send the config." */
export interface PreviewReadyMessage {
  channel: typeof PREVIEW_CHANNEL;
  type: 'ready';
}

/** Parent → child: the whole preview input, re-sent on every editor change. */
export interface PreviewConfigMessage {
  channel: typeof PREVIEW_CHANNEL;
  type: 'config';
  /**
   * Bumped ONLY by an explicit Restart. The renderer is keyed on it, so editing
   * a colour updates the live form in place (no remount, no lost walk) while
   * Restart returns it to the cover and replays the entry animation.
   */
  revision: number;
  config: FormConfig;
  /** Already resolved through `publicTitle` by the sender. */
  name: string;
  locale: string;
  layout: FormLayout;
  /**
   * Where the renderer should START: a runtime step index, or `'cover'` for the
   * renderer's own default entry. Absent = default entry too. This is how the
   * builder's prev/next navigation works — the frame remounts the renderer at
   * the requested screen rather than puppeting its internal state.
   */
  screen?: number | 'cover';
}

export type PreviewMessage = PreviewReadyMessage | PreviewConfigMessage;

/**
 * Read an inbound `message` event as one of ours, or return null.
 *
 * Inbound messages are treated as UNTRUSTED even though the frame is
 * same-origin: `window.postMessage` is reachable by anything that can get a
 * handle on the window. Three gates, all of which must pass:
 *  1. `event.origin` is exactly this document's origin — never `'*'`, never a
 *     prefix match, never a configured allowlist;
 *  2. `event.source` is the exact window we expect to be talking to (the child
 *     frame on the parent side, `window.parent` on the child side);
 *  3. the payload carries our channel marker and a structurally plausible body.
 *
 * (3) is a shape check, not a schema parse: the editor sends a DRAFT config that
 * is mid-edit by definition, and rejecting it on a transiently-invalid field
 * would blank the preview exactly when the author is looking at it. Nothing here
 * is persisted or trusted beyond rendering.
 */
export function readPreviewMessage(
  event: MessageEvent,
  expectedSource: Window | null | undefined,
  /** This document's own origin — passed in so the gate is pure and testable. */
  selfOrigin: string,
): PreviewMessage | null {
  if (!selfOrigin || event.origin !== selfOrigin) return null;
  if (!expectedSource || event.source !== expectedSource) return null;

  const data: unknown = event.data;
  if (!data || typeof data !== 'object') return null;
  const body = data as Record<string, unknown>;
  if (body.channel !== PREVIEW_CHANNEL) return null;

  if (body.type === 'ready') return { channel: PREVIEW_CHANNEL, type: 'ready' };

  if (body.type === 'config') {
    const config = body.config;
    if (!config || typeof config !== 'object') return null;
    if (!Array.isArray((config as { steps?: unknown }).steps)) return null;
    // A malformed `screen` degrades to "absent" rather than rejecting the whole
    // message — same policy as the other envelope fields: the config is a
    // mid-edit draft, and blanking the preview over a bad hint would be worse
    // than opening at the default screen.
    const screen =
      body.screen === 'cover' ||
      (typeof body.screen === 'number' && Number.isInteger(body.screen) && body.screen >= 0)
        ? (body.screen as number | 'cover')
        : undefined;
    return {
      channel: PREVIEW_CHANNEL,
      type: 'config',
      revision: typeof body.revision === 'number' ? body.revision : 0,
      config: config as FormConfig,
      name: typeof body.name === 'string' ? body.name : '',
      locale: typeof body.locale === 'string' ? body.locale : 'en',
      layout: body.layout === 'vertical' ? 'vertical' : 'slides',
      screen,
    };
  }

  return null;
}

/**
 * The network fence's decision function, pure so it can be unit-tested: given a
 * request the preview document is about to make, should it be swallowed?
 *
 * Blocked = same-origin AND mutating. GET/HEAD pass (page assets, RSC
 * payloads); cross-origin passes untouched (an author's own Calendly embed must
 * keep working); `/_next/` and `/__nextjs` pass so the dev overlay works inside
 * the frame. Everything else same-origin is exactly the renderers' Server
 * Action surface — the three actions that would write a real submission.
 *
 * `baseHref` is the document's own URL (relative requests resolve against it);
 * explicit rather than read from `window` so node tests can exercise the matrix.
 */
export function isBlockedPreviewRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  baseHref: string,
): boolean {
  const method = (
    init?.method ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
  ).toUpperCase();
  if (method === 'GET' || method === 'HEAD') return false;
  const raw = typeof Request !== 'undefined' && input instanceof Request ? input.url : String(input);
  if (!isPreviewSameOrigin(raw, baseHref)) return false;
  const url = toPreviewUrl(raw, baseHref);
  if (!url) return true; // unparseable and same-origin-by-default: block
  if (url.pathname.startsWith('/_next/') || url.pathname.startsWith('/__nextjs')) return false;
  return true;
}

/** Same-origin test against the document's own URL. Unparseable = relative = same-origin. */
export function isPreviewSameOrigin(value: string | URL, baseHref: string): boolean {
  const url = toPreviewUrl(value, baseHref);
  if (!url) return true;
  try {
    return url.origin === new URL(baseHref).origin;
  } catch {
    return true;
  }
}

function toPreviewUrl(value: string | URL, baseHref: string): URL | null {
  try {
    return new URL(String(value), baseHref);
  } catch {
    return null;
  }
}
