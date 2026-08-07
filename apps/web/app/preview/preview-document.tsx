'use client';

import { useEffect, useState } from 'react';
import type { FormConfig as PublicFormConfig } from '@quill/types';
import { FormRenderer } from '@/app/[accountCode]/[handle]/[slug]/form-renderer';
import { VerticalFormRenderer } from '@/app/[accountCode]/[handle]/[slug]/vertical-form-renderer';
import {
  PREVIEW_ACCOUNT_CODE,
  PREVIEW_CHANNEL,
  PREVIEW_SLUG,
  readPreviewMessage,
  type PreviewConfigMessage,
} from './protocol';

/**
 * The preview DOCUMENT: the real public form, in its own viewport.
 *
 * It renders `FormRenderer` / `VerticalFormRenderer` — the exact components the
 * public page mounts, not a lookalike — so a design axis added to the renderer
 * reaches the builder for free and the two can never disagree. The 310-line
 * hand-copied `live-preview.tsx` that used to stand in for them is gone.
 *
 * Because this is its own browsing context, `@media`, `dvh` and `vw` resolve
 * against the IFRAME's width and height rather than the author's monitor. That
 * is the whole point: a 390px frame is a 390px viewport, so the phone layout the
 * respondent gets is the layout the author sees.
 *
 * The config arrives by `postMessage` (see `protocol.ts`), so the preview is the
 * live editor state — no autosave wait, no publish.
 */
export function PreviewDocument() {
  const [input, setInput] = useState<PreviewConfigMessage | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const message = readPreviewMessage(event, window.parent);
      if (message?.type === 'config') setInput(message);
    }
    window.addEventListener('message', onMessage);
    // Announce readiness only AFTER the listener exists, so the config posted in
    // reply can never land in the gap before we can hear it. Targeted at this
    // exact origin — never '*', which would leak a draft config to any embedder.
    window.parent?.postMessage(
      { channel: PREVIEW_CHANNEL, type: 'ready' },
      window.location.origin,
    );
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const Renderer = input?.layout === 'vertical' ? VerticalFormRenderer : FormRenderer;

  return (
    <>
      {/* The frame's width is a PROMISE about the respondent's width, so a
          classic scrollbar inside it would be a 10px lie (globals.css themes
          scrollbars to a real 10px track on every platform, macOS included).
          Suppressed here, in the preview document only — the public page keeps
          its themed scrollbars. */}
      <style>{SCROLLBAR_RESET}</style>
      {/* Same wrapper depth as the public page (`page.tsx` renders the renderer
          inside one plain div), so nothing about the box tree differs. */}
      <div data-testid="live-preview" data-preview-state={input ? 'ready' : 'waiting'}>
        {input ? (
          <Renderer
            key={input.revision}
            accountCode={PREVIEW_ACCOUNT_CODE}
            slug={PREVIEW_SLUG}
            name={input.name}
            config={input.config as unknown as PublicFormConfig}
            locale={input.locale}
          />
        ) : null}
      </div>
    </>
  );
}

const SCROLLBAR_RESET = `
  html, body { scrollbar-width: none !important; -ms-overflow-style: none !important; }
  * { scrollbar-width: none !important; }
  *::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
`;

/* ── Inertness ─────────────────────────────────────────────────────────────
 * The preview is a picture of the form, not the form. Fields render and accept
 * typing so the author can feel it, but NOTHING it does may reach the server —
 * an accidental real submission from a preview is a data-integrity bug, not a
 * cosmetic one.
 *
 * The renderers' whole server surface is three Server Actions (`submitFormAction`,
 * `recordEventAction`, `recordBookingAction` in the public route's `actions.ts`).
 * They are imported at module scope by `form-renderer.tsx`, which this task may
 * not touch and which must not grow a preview-only prop anyway — the public
 * renderer should not know a preview exists. So the fence is drawn at the
 * document's network edge instead, which is also the stronger place: it holds
 * for anything the renderer might call in future, not just today's three.
 *
 * Server Actions dispatch as a same-origin POST. Every same-origin mutating
 * request from this document is therefore blocked, which covers all three
 * without depending on Next's internal header names. Cross-origin requests are
 * left alone so an author's own scheduler embed still renders. `/_next/` and
 * `/__nextjs` are exempt so the dev overlay keeps working inside the frame.
 *
 * A blocked call returns a promise that NEVER SETTLES rather than one that
 * rejects: nothing in the renderer catches, so a rejection would be an unhandled
 * rejection in the console, and a synthetic Response would be unparseable Flight
 * that makes Next fall back to a hard navigation — which would reload the frame
 * and throw away the posted config. Never-settling leaves the form parked on its
 * own "Submitting…" screen, which is a real screen of the author's form, and the
 * frame's Restart button takes it back to the cover.
 */
const FENCE_FLAG = '__daptaFormsPreviewFenced';

function installPreviewNetworkFence(): void {
  if (typeof window === 'undefined') return;
  const flags = window as unknown as Record<string, unknown>;
  if (flags[FENCE_FLAG]) return;
  flags[FENCE_FLAG] = true;

  const realFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (isBlockedRequest(input, init)) return new Promise<Response>(() => {});
    return realFetch(input as RequestInfo, init);
  }) as typeof window.fetch;

  const realBeacon = navigator.sendBeacon?.bind(navigator);
  if (realBeacon) {
    navigator.sendBeacon = ((url: string | URL, data?: BodyInit | null) => {
      // Reported as delivered: a `false` return makes callers retry by other
      // means, which is the opposite of what a fence wants.
      if (isSameOrigin(url)) return true;
      return realBeacon(url, data);
    }) as typeof navigator.sendBeacon;
  }
}

function isBlockedRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method === 'GET' || method === 'HEAD') return false;
  const raw = input instanceof Request ? input.url : String(input);
  if (!isSameOrigin(raw)) return false;
  const url = toUrl(raw);
  if (!url) return true; // unparseable and same-origin-by-default: block
  if (url.pathname.startsWith('/_next/') || url.pathname.startsWith('/__nextjs')) return false;
  return true;
}

function isSameOrigin(value: string | URL): boolean {
  const url = toUrl(value);
  // A relative URL resolves against this document, so it is same-origin.
  return url ? url.origin === window.location.origin : true;
}

function toUrl(value: string | URL): URL | null {
  try {
    return new URL(String(value), window.location.href);
  } catch {
    return null;
  }
}

// Module scope, not an effect: the renderers fire `view` / `step_view` from
// mount effects, so the fence has to be standing before React renders anything.
installPreviewNetworkFence();
