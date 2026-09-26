'use client';

/**
 * One human-check widget, reporting what it does. Where it sits (right above a
 * button that finishes the form, or on the submitting screen) and what a
 * report means for the submit are decided by the renderers' shared
 * `useCaptchaGate`, identically for both layouts.
 *
 * It reports, as they happen:
 *
 * - `token`: the check passed. Can come more than once: a token left unused
 *   for five minutes expires and the widget fetches a fresh one on its own.
 * - `expired`: the last token is no longer valid; a fresh one follows.
 * - `error`: it could not run (the script did not load, the browser is
 *   unsupported, or the widget failed). Final for this widget: a new attempt
 *   is a new widget, remounted by the caller.
 * - `interactive`: the widget is (or stops) asking the person for a click.
 *
 * Silence (an iframe blocked by an extension fires no callback at all) is the
 * caller's to time out, only while a submit is actually waiting.
 */
import { useEffect, useRef } from 'react';
import { CAPTCHA_ACTION } from '@quill/types';
import { loadTurnstile } from '@/lib/captcha';

/** Below this container width the flexible widget would overflow; the compact one fits. */
const FLEXIBLE_MIN_WIDTH = 300;

export type CaptchaWidgetEvent =
  | { type: 'token'; token: string }
  | { type: 'expired' }
  | { type: 'error'; reason: string }
  | { type: 'interactive'; on: boolean };

export interface CaptchaChallengeProps {
  siteKey: string;
  /** Strict: visible to everyone. Automatic: shown only when the provider needs a click. */
  strict: boolean;
  /** Stamped on the token and compared by the API: ties the token to this session. */
  cData: string;
  language: 'en' | 'es';
  theme: 'light' | 'dark';
  onEvent: (event: CaptchaWidgetEvent) => void;
}

export function CaptchaChallenge({ siteKey, strict, cData, language, theme, onEvent }: CaptchaChallengeProps) {
  const container = useRef<HTMLDivElement | null>(null);
  // The latest handler, so the effect below runs once per mount.
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    let unmounted = false;
    let widgetId: string | undefined;
    const emit = (event: CaptchaWidgetEvent) => {
      if (!unmounted) handler.current(event);
    };

    loadTurnstile()
      .then((turnstile) => {
        const el = container.current;
        if (unmounted || !el) return;
        const width = el.clientWidth;
        widgetId =
          turnstile.render(el, {
            sitekey: siteKey,
            action: CAPTCHA_ACTION,
            cData,
            appearance: strict ? 'always' : 'interaction-only',
            language,
            theme,
            size: width > 0 && width < FLEXIBLE_MIN_WIDTH ? 'compact' : 'flexible',
            // A failure is final for this widget: the caller decides whether a
            // fresh one is worth it, so a broken check cannot loop by itself.
            retry: 'never',
            // A token left unused for five minutes (someone reading the last
            // question) expires; the widget quietly fetches a fresh one.
            'refresh-expired': 'auto',
            'response-field': false,
            callback: (token) => emit({ type: 'token', token }),
            'expired-callback': () => emit({ type: 'expired' }),
            'error-callback': (code) => {
              emit({ type: 'error', reason: `error ${code}` });
              // Handled: no console noise, and no exception thrown into the page.
              return true;
            },
            'unsupported-callback': () => emit({ type: 'error', reason: 'unsupported' }),
            'before-interactive-callback': () => emit({ type: 'interactive', on: true }),
            'after-interactive-callback': () => emit({ type: 'interactive', on: false }),
          }) ?? undefined;
      })
      .catch(() => emit({ type: 'error', reason: 'script' }));

    return () => {
      unmounted = true;
      if (widgetId) {
        try {
          window.turnstile?.remove(widgetId);
        } catch {
          // Already gone with its iframe; nothing left to clean.
        }
      }
    };
    // One widget per mount on purpose: the caller remounts (by key) for a
    // fresh attempt, so no prop change may re-render a widget mid-check.
  }, []);

  return (
    <div
      ref={container}
      className="pf-captcha__widget"
      data-testid="captcha-widget"
      data-captcha-mode={strict ? 'strict' : 'auto'}
    />
  );
}
