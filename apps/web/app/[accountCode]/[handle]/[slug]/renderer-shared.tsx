'use client';

/**
 * Pieces shared by BOTH public renderers — slides (`form-renderer.tsx`) and
 * vertical (`vertical-form-renderer.tsx`). Extracted so the two layouts can
 * never drift on session identity, UTM/prefill capture, the scheduler→booking
 * mapping, the banner shell, or the thank-you screen. Pure presentation +
 * browser-only capture helpers; every flow decision stays in `@quill/engine`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Answers, FormCover, FormStep, ResolvedEnding } from '@quill/engine';
import { nameFields, isSafeHttpUrl, interpolate, showBanner } from '@quill/engine';
import { captchaCData, type OutcomeBooking, type PublicCaptcha } from '@quill/types';
import type { getMessages } from '@quill/shared';
import type { FormDesignProps } from '@/lib/form-design';
import { signupHref } from '@/lib/growth';
import { warmTurnstile } from '@/lib/captcha';
import { isTransportError, type TransportError } from '@/lib/call-action';
import { CaptchaChallenge } from '@/components/public/captcha-challenge';

type RendererMessages = ReturnType<typeof getMessages>['renderer'];

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
 * The answers a form starts with from its own configured DEFAULTS.
 *
 * Separate from `capturePrefill` and applied BEFORE it, which is the whole
 * precedence rule: default < URL < what the person types. A campaign link
 * carrying `?email=` has to win over a default the author set months earlier,
 * or the link would silently do nothing.
 *
 * A `name` step is skipped: it writes two subfield answers, not one under its
 * own key, so a single default has nowhere to go.
 */
export function captureDefaults(steps: FormStep[]): Answers {
  const seed: Answers = {};
  for (const step of steps) {
    if (step.type === 'message' || step.type === 'name') continue;
    const value = step.defaultValue;
    if (typeof value === 'string' && value !== '') seed[step.key] = value;
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
 * The banner strip's authored look, as inline custom properties.
 *
 * Exported and pure so BOTH renderers and the builder preview stamp identical
 * markup — a banner that reads as loud in the builder and washed out on the
 * public page is the exact bug this feature exists to fix.
 *
 * An unset axis emits NO variable, which is what keeps every stored config
 * pixel-identical: the stylesheet's own `var(…, <legacy fallback>)` answers
 * instead. The size is a `data-` attribute rather than a variable because it
 * moves two values (padding and type) that the CSS should keep together.
 */
export function bannerChromeProps(cover: FormCover | null | undefined): {
  style: React.CSSProperties;
  'data-pf-banner-size'?: string;
} {
  const vars: Record<string, string> = {};
  if (cover?.bannerColor) vars['--pf-banner-bg'] = cover.bannerColor;
  if (cover?.bannerTextColor) vars['--pf-banner-fg'] = cover.bannerTextColor;
  return {
    style: vars as React.CSSProperties,
    ...(cover?.bannerSize ? { 'data-pf-banner-size': cover.bannerSize } : {}),
  };
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
 * WHAT it looks like is `bannerChromeProps`.
 */
export function PhaseShell({
  cover,
  isCover = false,
  design,
  children,
  ...rootProps
}: {
  cover?: FormCover | null;
  isCover?: boolean;
  /**
   * The form's resolved design. Applied HERE, on the one element every phase of
   * BOTH layouts shares, so the cover, the steps, the one-page form, the
   * reveal, the booking screen and the thank-you can never disagree about the
   * form's look — and adding an axis does not mean editing every call site.
   */
  design?: FormDesignProps;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  const banner = showBanner(cover, isCover) ? cover?.bannerText : null;
  return (
    <div
      {...rootProps}
      {...(design?.attrs ?? {})}
      style={{ ...(design?.style ?? {}), ...rootProps.style }}
    >
      {/* An author-supplied face has to be declared in the document; there is no
          build step that could have hoisted it into the stylesheet. */}
      {design?.fontFace ? <style>{design.fontFace}</style> : null}
      {banner ? (
        <div className="pf__banner" {...bannerChromeProps(cover)}>
          {banner}
        </div>
      ) : null}
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
  design,
}: {
  ending: ResolvedEnding;
  answers: Answers;
  m: ReturnType<typeof getMessages>['renderer'];
  accountCode: string;
  cover?: FormCover | null;
  design?: FormDesignProps;
}) {
  const cta = signupHref('confirmation', accountCode);
  return (
    <PhaseShell className="pf pf--done" design={design} cover={cover}>
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

/* ── Spam protection ───────────────────────────────────────────────────────
 * Shared by both layouts so they can never disagree on when the human check
 * runs, what a failure means, or what the respondent is told. The check runs
 * on the SUBMITTING screen only: it is the one point every way of finishing a
 * form passes through (a button, a single-choice auto-advance, a terminal
 * step, a reveal or a scheduler as the last step, Enter, the one-page Submit).
 * ------------------------------------------------------------------------- */

/** What one run of the check produced. */
export type CaptchaResult = { status: 'token'; token: string } | { status: 'unavailable'; reason: string };

export interface CaptchaGate {
  /** True only when the API served this form with a check: never in the builder preview. */
  enabled: boolean;
  /** Strict mode: the check is visible to everyone and the hidden field rides the submit. */
  strict: boolean;
  /** The check is waiting for the person (a checkbox is showing): show the prompt. */
  interactive: boolean;
  /** Load the provider script ahead of the submit. Call at the first start or answer. */
  prewarm: () => void;
  /** Run the check once, on a fresh widget. Resolves with a token or `unavailable`. */
  challenge: () => Promise<CaptchaResult>;
  /** The widget block for the submitting screen; null until the first run. */
  widget: React.ReactNode;
  /** Strict mode's hidden field, for every screen a respondent answers on; else null. */
  honeypot: React.ReactNode;
  /** The top-level submit fields the check adds: `hp` in strict mode, nothing otherwise. */
  submitFields: () => { hp?: string };
}

/**
 * The human check for one form session. Inert (and loads nothing) unless the
 * page handed it `captcha`, which only `page.tsx` does, and only when the API
 * served the form with one; the builder preview never passes it.
 */
export function useCaptchaGate(
  captcha: PublicCaptcha | undefined,
  opts: { sessionId: string; locale: 'en' | 'es'; theme: 'light' | 'dark' },
): CaptchaGate {
  const strict = captcha?.strict === true;
  const [run, setRun] = useState(0);
  const [state, setState] = useState<'running' | 'interactive' | 'done' | 'failed'>('running');
  const runRef = useRef(0);
  const pending = useRef<{ id: number; resolve: (r: CaptchaResult) => void } | null>(null);

  const settle = useCallback((id: number, result: CaptchaResult) => {
    const waiting = pending.current;
    // A widget from a superseded run can still report; only the current one counts.
    if (!waiting || waiting.id !== id) return;
    pending.current = null;
    setState(result.status === 'token' ? 'done' : 'failed');
    waiting.resolve(result);
  }, []);

  const challenge = useCallback((): Promise<CaptchaResult> => {
    if (!captcha) return Promise.resolve({ status: 'unavailable', reason: 'disabled' });
    return new Promise<CaptchaResult>((resolve) => {
      pending.current?.resolve({ status: 'unavailable', reason: 'superseded' });
      const id = runRef.current + 1;
      runRef.current = id;
      pending.current = { id, resolve };
      setState('running');
      setRun(id);
    });
  }, [captcha]);

  // A renderer that goes away mid-check must not leave its submit awaiting forever.
  useEffect(
    () => () => {
      pending.current?.resolve({ status: 'unavailable', reason: 'unmounted' });
      pending.current = null;
    },
    [],
  );

  const prewarm = useCallback(() => {
    if (captcha) warmTurnstile();
  }, [captcha]);

  // The hidden field is uncontrolled on purpose: a bot that writes `.value`
  // straight into the DOM fires no event, and a controlled input would wipe
  // that value on the next render. Its last value is kept when a step screen
  // unmounts, so the submitting screen (where none is mounted) still has it.
  const hpEl = useRef<HTMLInputElement | null>(null);
  const hpLast = useRef('');
  const hpRef = useCallback((el: HTMLInputElement | null) => {
    if (hpEl.current && hpEl.current !== el && hpEl.current.value) hpLast.current = hpEl.current.value;
    hpEl.current = el;
  }, []);
  const submitFields = useCallback((): { hp?: string } => {
    if (!strict) return {};
    return { hp: hpEl.current?.value || hpLast.current || '' };
  }, [strict]);

  const widget =
    captcha && run > 0 ? (
      <div className="pf-captcha" data-captcha-mode={strict ? 'strict' : 'auto'} data-captcha-state={state}>
        <CaptchaChallenge
          key={run}
          siteKey={captcha.siteKey}
          strict={strict}
          cData={captchaCData(opts.sessionId)}
          language={opts.locale}
          theme={opts.theme}
          onToken={(token) => settle(run, { status: 'token', token })}
          onUnavailable={(reason) => settle(run, { status: 'unavailable', reason })}
          onInteractive={(on) => setState((s) => (s === 'done' || s === 'failed' ? s : on ? 'interactive' : 'running'))}
        />
      </div>
    ) : null;

  const honeypot = strict ? (
    <input
      ref={hpRef}
      type="text"
      name="pf_hp"
      className="pf-hp"
      defaultValue=""
      autoComplete="off"
      tabIndex={-1}
      aria-hidden="true"
    />
  ) : null;

  return {
    enabled: Boolean(captcha),
    strict,
    interactive: state === 'interactive',
    prewarm,
    challenge,
    widget,
    honeypot,
    submitFields,
  };
}

/** What the submit server action answers (see `submitFormAction`). */
export interface SubmitActionResult {
  ok: boolean;
  score?: number;
  outcome?: string | null;
  message?: string;
  /** The API's stable code, when it refused: what the copy below is chosen by. */
  error?: string;
}

/**
 * The respondent's copy for a refused submit, in their language, chosen by the
 * API's CODE and never by its message: every API message is English, and
 * respondents in Spanish used to read them verbatim. A code this map does not
 * know keeps today's behavior (the server message, else the generic line).
 */
export function submitErrorMessage(res: { error?: string; message?: string }, m: RendererMessages): string {
  switch (res.error) {
    case 'CAPTCHA_FAILED':
    case 'CAPTCHA_REQUIRED':
      return m.errors.captcha;
    case 'CAPTCHA_UNAVAILABLE':
      return m.captcha.unavailable;
    case 'RATE_LIMITED':
      return m.errors.rate_limited;
    case 'ANSWER_TOO_LONG':
      return m.errors.answer_too_long;
    default:
      return res.message ?? m.errors.submit;
  }
}

export type FinalSubmit =
  | { ok: true; score?: number; outcome?: string | null }
  | { ok: false; message: string };

function toFinal(res: SubmitActionResult | TransportError, m: RendererMessages): FinalSubmit {
  // Transport messages are technical noise; the respondent gets the generic line.
  if (isTransportError(res)) return { ok: false, message: m.errors.submit };
  if (res.ok) return { ok: true, score: res.score, outcome: res.outcome };
  return { ok: false, message: submitErrorMessage(res, m) };
}

/**
 * The final submit, with the human check when the form has one. Both layouts'
 * `finalize` call this and differ only in what they do with the answer.
 *
 * - No check: submit, as always.
 * - A token: submit with it. A refused token is retried ONCE on a fresh widget
 *   (it may simply have expired while the person looked away); a second
 *   refusal is shown.
 * - No token (the widget did not load, errored, timed out, or the browser is
 *   unsupported): fail closed WITHOUT losing anything. The answers are saved
 *   as a partial, which the API never delivers while protection is on, and the
 *   person is told they are saved and asked to try again.
 */
export async function submitFinal(args: {
  gate: CaptchaGate;
  m: RendererMessages;
  send: (fields: { captchaToken?: string; hp?: string }) => Promise<SubmitActionResult | TransportError>;
  savePartial: () => Promise<SubmitActionResult | TransportError>;
}): Promise<FinalSubmit> {
  const { gate, m, send, savePartial } = args;
  if (!gate.enabled) return toFinal(await send({}), m);
  for (let attempt = 0; ; attempt++) {
    const check = await gate.challenge();
    if (check.status === 'unavailable') {
      const saved = await savePartial();
      if (!isTransportError(saved) && saved.ok) return { ok: false, message: m.captcha.unavailable };
      return toFinal(saved, m);
    }
    const res = await send({ captchaToken: check.token, ...gate.submitFields() });
    if (attempt === 0 && !isTransportError(res) && !res.ok && res.error === 'CAPTCHA_FAILED') continue;
    return toFinal(res, m);
  }
}
