'use client';

/**
 * Pieces shared by BOTH public renderers — slides (`form-renderer.tsx`) and
 * vertical (`vertical-form-renderer.tsx`). Extracted so the two layouts can
 * never drift on session identity, UTM/prefill capture, the scheduler→booking
 * mapping, the banner shell, or the thank-you screen. Pure presentation +
 * browser-only capture helpers; every flow decision stays in `@quill/engine`.
 */
import { useState } from 'react';
import type { Answers, FormCover, FormStep, ResolvedEnding } from '@quill/engine';
import { nameFields, isSafeHttpUrl, interpolate, showBanner } from '@quill/engine';
import type { OutcomeBooking } from '@quill/types';
import type { getMessages } from '@quill/shared';
import { signupHref } from '@/lib/growth';

export function useSessionId(key: string): string {
  const [id] = useState(() => {
    if (typeof window === 'undefined') return '';
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    window.sessionStorage.setItem(key, fresh);
    return fresh;
  });
  return id;
}

/** Read `utm_*` query params from the current URL into a flat string map. */
export function captureUtm(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const utm: Record<string, string> = {};
  for (const [k, v] of params.entries()) {
    if (k.toLowerCase().startsWith('utm_') && v) utm[k] = v;
  }
  return utm;
}

/** A query value can never be longer than this once seeded (defense-in-depth). */
export const PREFILL_MAX_LEN = 512;

/**
 * URL-parameter prefill (V4-13): read the query string and seed the answer for
 * each param whose key matches a DECLARED field — a step's own key, or a `name`
 * step's subfields (`nameFields`). Security-scoped by design:
 *  - only keys that correspond to a declared step field are ever read (an
 *    arbitrary `?anything=` is ignored — never trust the URL to name new fields);
 *  - `utm_*` is captured separately (`captureUtm`) and skipped here;
 *  - values are treated as PLAIN answer strings, capped in length, never eval'd
 *    or interpreted as markup — and the engine re-validates every answer on
 *    submit, so a bad value can only be rejected, never trusted.
 * A prefilled HIDDEN step carries its answer into the submission though it is
 * never shown; a prefilled VISIBLE step simply renders pre-filled.
 */
export function capturePrefill(steps: FormStep[]): Answers {
  if (typeof window === 'undefined') return {};
  const declared = new Set<string>();
  for (const step of steps) {
    if (step.type === 'message') continue; // message steps capture no answer
    for (const key of nameFields(step)) declared.add(key);
  }
  if (declared.size === 0) return {};
  const params = new URLSearchParams(window.location.search);
  const seed: Answers = {};
  for (const [key, value] of params.entries()) {
    if (key.toLowerCase().startsWith('utm_')) continue;
    if (!declared.has(key)) continue;
    if (typeof value !== 'string' || value === '') continue;
    seed[key] = value.slice(0, PREFILL_MAX_LEN);
  }
  return seed;
}

/**
 * Map a `scheduler` step's config to the booking shape the shared BookingScreen
 * embeds, or `null` when no event type has been picked yet (renders a fallback).
 * "Show event details? → No" becomes Calendly's `hide_event_type_details=1`.
 * The URL is re-guarded to http(s) — it flows into an embed (XSS defense).
 */
export function schedulerToBooking(
  scheduler: NonNullable<FormStep['scheduler']>,
  customAnswers: Record<string, string> = {},
): OutcomeBooking | null {
  const url = scheduler.url?.trim();
  if (!url || !isSafeHttpUrl(url)) return null;
  const provider = scheduler.provider ?? 'calendly';
  let finalUrl = url;
  if (provider === 'calendly') {
    try {
      const u = new URL(url);
      if (scheduler.hideEventDetails) u.searchParams.set('hide_event_type_details', '1');
      // The event type's custom questions are prefilled by their positional id,
      // so they ride the URL as-is (the embed builder preserves existing query
      // params). Built-in name/email travel through the overlaid answers.
      for (const [field, value] of Object.entries(customAnswers)) {
        if (value) u.searchParams.set(field, value);
      }
      finalUrl = u.toString();
    } catch {
      /* keep the original url */
    }
  }
  return { provider, url: finalUrl, prefill: scheduler.prefill !== false };
}

/**
 * Per-phase page shell. The promo banner (`cover.bannerText`) renders ONCE here
 * as the first child of `.pf`, so it is a full-width strip pinned to the top of
 * the viewport; everything else lives in `.pf__main`, which owns the remaining
 * height. Desktop's per-phase vertical centering is applied to `.pf__main`
 * (public-form.css), so centering the content group can never drag the banner
 * toward the middle of the page.
 *
 * WHICH phases show it is `cover.bannerScope` (see `showBanner`): every phase by
 * default, or the cover alone — hence `isCover`, set only by the cover phase.
 */
export function PhaseShell({
  cover,
  isCover = false,
  children,
  ...rootProps
}: {
  cover?: FormCover | null;
  isCover?: boolean;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  const banner = showBanner(cover, isCover) ? cover?.bannerText : null;
  return (
    <div {...rootProps}>
      {banner ? <div className="pf__banner">{banner}</div> : null}
      <div className="pf__main">{children}</div>
    </div>
  );
}

/**
 * The thank-you screen, shared verbatim by both layouts: outcome/ending copy
 * (with `[key]` interpolation), the optional growth CTA, inside the banner
 * shell. The caller resolves the ending (outcome → form-level → built-in copy)
 * so this stays a dumb view.
 */
export function DoneScreen({
  ending,
  answers,
  m,
  accountCode,
  cover,
  style,
}: {
  ending: ResolvedEnding;
  answers: Answers;
  m: ReturnType<typeof getMessages>['renderer'];
  accountCode: string;
  cover?: FormCover | null;
  style?: React.CSSProperties;
}) {
  const cta = signupHref('confirmation', accountCode);
  return (
    <PhaseShell className="pf pf--done" style={style} cover={cover}>
      <div className="pf-done__inner pf-animate">
        <div className="pf-done__check" aria-hidden="true">
          ✓
        </div>
        {/* The heading interpolates too. It did not, so a `[firstname]` typed
            into a range's heading reached the respondent as literal text —
            while the body right beneath it resolved correctly. */}
        <h1 className="pf-done__title">
          {ending.headline ? interpolate(ending.headline, answers) : m.thankYouTitle}
        </h1>
        <p className="pf-done__body">
          {ending.body ? interpolate(ending.body, answers) : m.thankYouBody}
        </p>
        {cta ? (
          <>
            <p className="pf-done__cta-question">{m.ctaQuestion}</p>
            <a className="pf-done__cta" href={cta} target="_blank" rel="noopener noreferrer">
              {m.ctaAction}
              <span className="sr-only"> {m.newTab}</span>
            </a>
          </>
        ) : null}
      </div>
    </PhaseShell>
  );
}
