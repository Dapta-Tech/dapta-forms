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
import { captchaCData, type OutcomeBooking, type PublicCaptcha, type SubmissionVisit } from '@quill/types';
import type { getMessages } from '@quill/shared';
import type { FormDesignProps } from '@/lib/form-design';
import { signupHref } from '@/lib/growth';
import { warmTurnstile } from '@/lib/captcha';
import { createHostVisit, utmParams, type HostVisit, type ResolvedVisit } from '@/lib/host-visit';
import { isTransportError, type TransportError } from '@/lib/call-action';
import { CaptchaChallenge, type CaptchaWidgetEvent } from '@/components/public/captcha-challenge';

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

/**
 * Read `utm_*` query params from the current URL into a flat string map, by
 * the same rules as the landing's (`utmParams`): a key carrying a control is
 * skipped, controls leave a value, an empty value is no parameter.
 */
export function captureUtm(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  return utmParams(new URLSearchParams(window.location.search));
}

/**
 * The landing's campaign under the form's own (#199), all or nothing: an
 * iframe `src` that carries any `utm_*` keeps exactly those, and only a `src`
 * with none takes the landing's. Mixing the two would credit one visit to two
 * campaigns.
 */
export function mergeHostUtm(
  own: Record<string, string>,
  host: Record<string, string> | undefined,
): Record<string, string> {
  if (Object.keys(own).length > 0) return own;
  return host ? { ...host } : {};
}

/**
 * What the public page tells a renderer about the page it is answered on
 * (#199). Only the public page passes it: without it (the builder preview)
 * nothing is asked of anyone and no submit carries a visit.
 */
export interface VisitCapture {
  /** The FORM loads its own HubSpot tracking code, so a direct link may send its cookie. */
  hubspotTracking: boolean;
}

/**
 * The page the form is answered on, for the submits (see `lib/host-visit.ts`).
 * Starts asking the host page at mount; the function it returns resolves the
 * visit for ONE submit (never rejects, waits at most 500 ms), or undefined
 * without `capture` or when the page switched it off.
 */
export function useHostVisit(
  capture: VisitCapture | undefined,
  formTitle: string,
): () => Promise<ResolvedVisit | undefined> {
  const visit = useRef<HostVisit | null>(null);
  const enabled = capture !== undefined;
  const hubspotTracking = capture?.hubspotTracking === true;
  useEffect(() => {
    if (!enabled) return;
    const current = createHostVisit({ hubspotTracking, formTitle });
    visit.current = current;
    const stop = current.start();
    return () => {
      stop();
      if (visit.current === current) visit.current = null;
    };
  }, [enabled, hubspotTracking, formTitle]);
  return useCallback(() => visit.current?.resolve() ?? Promise.resolve(undefined), []);
}

/** The submit's top-level `visit`, only when there is one. */
export function visitField(resolved: ResolvedVisit | undefined): { visit?: SubmissionVisit } {
  return resolved ? { visit: resolved.visit } : {};
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
 * Shared by both layouts so they can never disagree on where the human check
 * runs, what a failure means, or what the respondent is told.
 *
 * Where it runs:
 * - INLINE, right above a button that finishes the form (the one-page Submit,
 *   and a slides step whose own button ends the form, Enter included). The
 *   widget mounts once the person has started and the button area is on
 *   screen, and verifies while they finish, so the submit usually has its
 *   token already. The screen never changes for it: a checkbox, when the
 *   provider asks for one, appears where the person is already looking.
 * - On the SUBMITTING screen otherwise (a single-choice auto-advance, a reveal
 *   or a scheduler as the last step): the one point those finishes share.
 * ------------------------------------------------------------------------- */

/** What one run of the check produced. */
export type CaptchaResult = { status: 'token'; token: string } | { status: 'unavailable'; reason: string };

/** No callback at all for this long, while a submit waits, means the widget is not coming. */
export const CAPTCHA_TIMEOUT_MS = 15_000;

/**
 * A token is good for five minutes. One held without its widget (a one-page
 * reveal unmounts the button area before the submit) is dropped a little
 * before that, so the API is never handed one about to lapse.
 */
export const HELD_TOKEN_TTL_MS = 270_000;

/** A check that ended because the flow moved on, not because it failed: nothing to report. */
export function captchaAborted(result: CaptchaResult): boolean {
  return (
    result.status === 'unavailable' &&
    (result.reason === 'superseded' || result.reason === 'unmounted' || result.reason === 'slot gone')
  );
}

type Place = 'inline' | 'screen';
type WidgetState = 'idle' | 'running' | 'interactive' | 'done' | 'failed';

export interface CaptchaGate {
  /** True only when the API served this form with a check: never in the builder preview. */
  enabled: boolean;
  /** Strict mode: the check is visible to everyone and the hidden field rides the submit. */
  strict: boolean;
  /** The submitting-screen widget is waiting for a click: show the prompt there. */
  interactive: boolean;
  /**
   * The person has started (the first start or answer): the inline widget may
   * mount from now on, when its button is on screen. Nothing loads before.
   */
  arm: () => void;
  /** `arm`, plus loading the provider script ahead of a finish on the submitting screen. */
  prewarm: () => void;
  /** Whether a submit right now runs its check inline (a slot is mounted above its button). */
  inlineReady: () => boolean;
  /** Get a token for ONE submit attempt, from the inline widget or the submitting screen's. */
  challenge: () => Promise<CaptchaResult>;
  /**
   * Wait for the inline widget's token WITHOUT spending it: the next
   * `challenge` takes it. For a finish that plays an interstitial between the
   * button and the submit, so the check (and a checkbox) happens above the
   * button, not after the interstitial.
   */
  hold: () => Promise<CaptchaResult>;
  /** The slot to render right above a button that finishes the form; null without a check. */
  inline: React.ReactNode;
  /** The widget for the submitting screen; null until a check runs there. */
  widget: React.ReactNode;
  /** Strict mode's hidden field, for every screen a respondent answers on; else null. */
  honeypot: React.ReactNode;
  /** The top-level submit fields the check adds: `hp` in strict mode, nothing otherwise. */
  submitFields: () => { hp?: string };
}

interface Waiter {
  place: Place;
  /** `hold`: a token keeps for the next `challenge` instead of being spent. */
  keep: boolean;
  resolve: (result: CaptchaResult) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * The human check for one form session. Inert (and loads nothing) unless the
 * page handed it `captcha`, which only `page.tsx` does, and only when the API
 * served the form with one; the builder preview never passes it.
 */
export function useCaptchaGate(
  captcha: PublicCaptcha | undefined,
  opts: { sessionId: string; locale: 'en' | 'es'; theme: 'light' | 'dark'; prompt: string },
): CaptchaGate {
  const strict = captcha?.strict === true;

  // Each place has at most one live widget; bumping its generation remounts it
  // (a fresh widget, hence a fresh token), and events from an older one are
  // dropped. The screen widget exists only while a check runs there.
  const [gen, setGen] = useState<Record<Place, number>>({ inline: 1, screen: 0 });
  const gens = useRef<Record<Place, number>>({ inline: 1, screen: 0 });
  const [state, setState] = useState<Record<Place, WidgetState>>({ inline: 'idle', screen: 'idle' });
  const [armed, setArmed] = useState(false);
  // A submit is waiting on the inline widget: mount it even if not in view yet.
  const [inlineWanted, setInlineWanted] = useState(false);

  const slots = useRef(0); // inline slots mounted right now
  const held = useRef<{ place: Place; gen: number; token: string; at: number } | null>(null); // unspent token
  const stale = useRef<Record<Place, boolean>>({ inline: false, screen: false }); // cannot give another token
  const clicking = useRef<Record<Place, boolean>>({ inline: false, screen: false }); // asking for a click
  const waiter = useRef<Waiter | null>(null);

  const mark = useCallback((place: Place, next: WidgetState) => {
    setState((s) => (s[place] === next ? s : { ...s, [place]: next }));
  }, []);

  const finish = useCallback((result: CaptchaResult) => {
    const w = waiter.current;
    if (!w) return;
    waiter.current = null;
    if (w.timer) clearTimeout(w.timer);
    w.resolve(result);
  }, []);

  // Silence is only an outage while a submit waits, and never while the
  // person is looking at a checkbox: reading it is not a failure.
  const armTimer = useCallback(
    (w: Waiter) => {
      if (w.timer) clearTimeout(w.timer);
      w.timer = setTimeout(() => {
        if (waiter.current !== w) return;
        stale.current[w.place] = true;
        finish({ status: 'unavailable', reason: 'timeout' });
      }, CAPTCHA_TIMEOUT_MS);
    },
    [finish],
  );

  const remount = useCallback(
    (place: Place) => {
      gens.current = { ...gens.current, [place]: gens.current[place] + 1 };
      setGen(gens.current);
      stale.current[place] = false;
      clicking.current[place] = false;
      mark(place, 'running');
    },
    [mark],
  );

  const onEvent = useCallback(
    (place: Place, from: number, e: CaptchaWidgetEvent) => {
      if (gens.current[place] !== from) return; // a replaced widget
      const w = waiter.current && waiter.current.place === place ? waiter.current : null;
      switch (e.type) {
        case 'token':
          clicking.current[place] = false;
          mark(place, 'done');
          if (w && !w.keep) {
            // Spent by this submit: the next attempt needs a new widget.
            stale.current[place] = true;
            finish({ status: 'token', token: e.token });
          } else {
            held.current = { place, gen: from, token: e.token, at: Date.now() };
            stale.current[place] = false;
            if (w) finish({ status: 'token', token: e.token });
          }
          return;
        case 'expired':
          if (held.current?.place === place && held.current.gen === from) held.current = null;
          mark(place, 'running');
          return;
        case 'error':
          if (held.current?.place === place) held.current = null;
          stale.current[place] = true;
          clicking.current[place] = false;
          mark(place, 'failed');
          if (w) finish({ status: 'unavailable', reason: e.reason });
          return;
        case 'interactive':
          clicking.current[place] = e.on;
          mark(place, e.on ? 'interactive' : 'running');
          if (w) {
            if (e.on && w.timer) clearTimeout(w.timer);
            else if (!e.on) armTimer(w);
          }
          return;
      }
    },
    [armTimer, finish, mark],
  );

  const run = useCallback(
    (keep: boolean): Promise<CaptchaResult> => {
      if (!captcha) return Promise.resolve({ status: 'unavailable', reason: 'disabled' });
      finish({ status: 'unavailable', reason: 'superseded' });
      // A token already in hand is used by this attempt (and spent, unless it
      // is only being held). It can outlive its widget: a one-page reveal
      // unmounts the button area before the submit.
      const ready = held.current;
      if (ready && Date.now() - ready.at < HELD_TOKEN_TTL_MS) {
        if (!keep) {
          held.current = null;
          stale.current[ready.place] = true;
        }
        return Promise.resolve({ status: 'token', token: ready.token });
      }
      if (ready) {
        // Too old to trust: its widget (if still there) is replaced below.
        held.current = null;
        stale.current[ready.place] = true;
      }
      const place: Place = slots.current > 0 ? 'inline' : 'screen';
      if (keep && place === 'screen') return Promise.resolve({ status: 'unavailable', reason: 'no slot' });
      return new Promise<CaptchaResult>((resolve) => {
        const w: Waiter = { place, keep, resolve };
        waiter.current = w;
        if (place === 'inline') {
          setInlineWanted(true);
          if (stale.current.inline) remount('inline');
        } else {
          remount('screen');
        }
        if (!clicking.current[place]) armTimer(w);
      });
    },
    [captcha, finish, remount, armTimer],
  );
  const challenge = useCallback(() => run(false), [run]);
  const hold = useCallback(() => run(true), [run]);

  // A slot above a finishing button counts while it is mounted. One that goes
  // away while its submit waits takes its widget with it: fail that attempt
  // rather than wait on a widget that no longer exists.
  const registerSlot = useCallback(() => {
    slots.current += 1;
    return () => {
      slots.current -= 1;
      if (slots.current === 0 && waiter.current?.place === 'inline') {
        finish({ status: 'unavailable', reason: 'slot gone' });
      }
    };
  }, [finish]);

  // A slot that starts its widget starts a NEW one (a slot mounts fresh on
  // every visit to its step), whatever the last one ended as.
  const activateSlot = useCallback(() => {
    stale.current.inline = false;
    clicking.current.inline = false;
    mark('inline', 'running');
  }, [mark]);

  // A renderer that goes away mid-check must not leave its submit awaiting forever.
  useEffect(() => () => finish({ status: 'unavailable', reason: 'unmounted' }), [finish]);

  const arm = useCallback(() => {
    if (captcha) setArmed(true);
  }, [captcha]);
  const prewarm = useCallback(() => {
    if (!captcha) return;
    setArmed(true);
    warmTurnstile();
  }, [captcha]);
  const inlineReady = useCallback(() => Boolean(captcha) && slots.current > 0, [captcha]);

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

  const widgetProps = captcha
    ? {
        siteKey: captcha.siteKey,
        strict,
        cData: captchaCData(opts.sessionId),
        language: opts.locale,
        theme: opts.theme,
      }
    : null;

  const inline = widgetProps ? (
    <CaptchaInlineSlot
      strict={strict}
      mount={armed || inlineWanted}
      force={inlineWanted}
      state={state.inline}
      prompt={opts.prompt}
      register={registerSlot}
      onActivate={activateSlot}
    >
      <CaptchaChallenge
        key={gen.inline}
        {...widgetProps}
        onEvent={(e) => onEvent('inline', gen.inline, e)}
      />
    </CaptchaInlineSlot>
  ) : null;

  const widget =
    widgetProps && gen.screen > 0 ? (
      <div className="pf-captcha" data-captcha-mode={strict ? 'strict' : 'auto'} data-captcha-state={state.screen}>
        <CaptchaChallenge
          key={gen.screen}
          {...widgetProps}
          onEvent={(e) => onEvent('screen', gen.screen, e)}
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
    interactive: state.screen === 'interactive',
    arm,
    prewarm,
    inlineReady,
    challenge,
    hold,
    inline,
    widget,
    honeypot,
    submitFields,
  };
}

/**
 * The place right above a finishing button. Renders its widget once the
 * person has started (`mount`) AND the place is on screen, and keeps it from
 * then on; `force` (a submit waiting) skips the on-screen part. The on-screen
 * test is an IntersectionObserver with the implicit root, which inside a
 * cross-origin iframe measures against the HOST page's viewport: an embedded
 * form only loads the check once its end has been scrolled into view.
 */
function CaptchaInlineSlot({
  strict,
  mount,
  force,
  state,
  prompt,
  register,
  onActivate,
  children,
}: {
  strict: boolean;
  mount: boolean;
  force: boolean;
  state: WidgetState;
  prompt: string;
  register: () => () => void;
  onActivate: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => register(), [register]);

  useEffect(() => {
    if (inView || !ref.current) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setInView(true);
        obs.disconnect();
      }
    });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [inView]);

  useEffect(() => {
    if (active || !(force || (mount && inView))) return;
    onActivate();
    setActive(true);
  }, [active, force, mount, inView, onActivate]);

  return (
    <div
      ref={ref}
      className="pf-captcha pf-captcha--inline"
      data-testid="captcha-inline"
      data-captcha-mode={strict ? 'strict' : 'auto'}
      data-captcha-state={active ? state : 'idle'}
    >
      {state === 'interactive' ? <p className="pf-captcha__prompt">{prompt}</p> : null}
      {active ? children : null}
    </div>
  );
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
      return m.errors.captcha;
    // Only a page loaded before the owner turned protection on sends no token:
    // it has no check to run, so trying again would loop. It has to reload.
    case 'CAPTCHA_REQUIRED':
      return m.errors.captcha_required;
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
  | { ok: false; message: string }
  /** A newer run took over, or the page went away: the caller does nothing. */
  | { ok: false; aborted: true };

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
 * - A token: submit with it.
 * - One automatic retry on a fresh widget, shared by two cases: a token the API
 *   refused (it may simply have expired while the person looked away) and a
 *   widget error, which the provider documents as worth retrying. A second
 *   failure of either kind is the one the person sees.
 * - No token (the widget did not load, errored twice, timed out, or the
 *   browser is unsupported): fail closed WITHOUT losing anything. The answers
 *   are saved as a partial, which the API never delivers while protection is
 *   on, and the person is told they are saved and asked to try again.
 * - A run cut short by a newer one (or by the page going away, or by its
 *   button area going away) is dropped: whoever superseded it owns the screen.
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
      if (captchaAborted(check)) return { ok: false, aborted: true };
      if (attempt === 0 && check.reason.startsWith('error')) continue;
      const saved = await savePartial();
      if (!isTransportError(saved) && saved.ok) return { ok: false, message: m.captcha.unavailable };
      return toFinal(saved, m);
    }
    const res = await send({ captchaToken: check.token, ...gate.submitFields() });
    if (attempt === 0 && !isTransportError(res) && !res.ok && res.error === 'CAPTCHA_FAILED') continue;
    return toFinal(res, m);
  }
}
