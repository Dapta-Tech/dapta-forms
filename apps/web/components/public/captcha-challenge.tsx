'use client';

/**
 * One run of the human check, on the submitting screen of a form with spam
 * protection on. Mounted per attempt (the caller keys it), so a retry is a
 * fresh widget and never a reset of a half-finished one.
 *
 * It reports exactly one outcome, whatever the widget does after that:
 *
 * - `onToken`: the check passed; the token goes to the API with the submit.
 * - `onUnavailable`: it could not run. The script did not load, the browser is
 *   unsupported, the widget errored, or nothing at all happened within
 *   `timeoutMs` (an iframe blocked by an extension fires no callback at all).
 *
 * `onInteractive` tracks the one moment the person has to act: the widget is
 * asking for a click. The caller shows its prompt then, and the own timeout
 * stops counting, because a person reading the checkbox is not an outage. It
 * starts again once the click is done: a widget that goes quiet after it is.
 *
 * Nothing here decides what happens with the outcome; the renderers' shared
 * `useCaptchaGate` and `submitFinal` do, identically for both layouts.
 */
import { useEffect, useRef } from 'react';
import { CAPTCHA_ACTION } from '@quill/types';
import { loadTurnstile } from '@/lib/captcha';

/** No callback at all for this long means the widget is not coming. */
export const CAPTCHA_TIMEOUT_MS = 15_000;

/** Below this container width the flexible widget would overflow; the compact one fits. */
const FLEXIBLE_MIN_WIDTH = 300;

export interface CaptchaChallengeProps {
  siteKey: string;
  /** Strict: visible to everyone. Automatic: shown only when the provider needs a click. */
  strict: boolean;
  /** Stamped on the token and compared by the API: ties the token to this session. */
  cData: string;
  language: 'en' | 'es';
  theme: 'light' | 'dark';
  timeoutMs?: number;
  onToken: (token: string) => void;
  onUnavailable: (reason: string) => void;
  onInteractive: (interactive: boolean) => void;
}

export function CaptchaChallenge({
  siteKey,
  strict,
  cData,
  language,
  theme,
  timeoutMs = CAPTCHA_TIMEOUT_MS,
  onToken,
  onUnavailable,
  onInteractive,
}: CaptchaChallengeProps) {
  const container = useRef<HTMLDivElement | null>(null);
  // Latest callbacks, so the effect below runs once per mount.
  const handlers = useRef({ onToken, onUnavailable, onInteractive });
  handlers.current = { onToken, onUnavailable, onInteractive };

  useEffect(() => {
    let settled = false;
    let unmounted = false;
    let widgetId: string | undefined;
    const settle = (report: () => void) => {
      if (settled || unmounted) return;
      settled = true;
      clearTimeout(timer);
      report();
    };
    const arm = () => setTimeout(() => settle(() => handlers.current.onUnavailable('timeout')), timeoutMs);
    let timer = arm();

    loadTurnstile()
      .then((turnstile) => {
        const el = container.current;
        if (settled || unmounted || !el) return;
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
            // One outcome per mount: a retry is the caller's, on a fresh widget.
            retry: 'never',
            'refresh-expired': 'manual',
            'response-field': false,
            callback: (token) => settle(() => handlers.current.onToken(token)),
            'error-callback': (code) => {
              settle(() => handlers.current.onUnavailable(`error ${code}`));
              // Handled: no console noise, and no exception thrown into the page.
              return true;
            },
            'unsupported-callback': () => settle(() => handlers.current.onUnavailable('unsupported')),
            'before-interactive-callback': () => {
              if (settled || unmounted) return;
              clearTimeout(timer);
              handlers.current.onInteractive(true);
            },
            'after-interactive-callback': () => {
              if (settled || unmounted) return;
              handlers.current.onInteractive(false);
              clearTimeout(timer);
              timer = arm();
            },
          }) ?? undefined;
      })
      .catch(() => settle(() => handlers.current.onUnavailable('script')));

    return () => {
      unmounted = true;
      clearTimeout(timer);
      if (widgetId) {
        try {
          window.turnstile?.remove(widgetId);
        } catch {
          // Already gone with its iframe; nothing left to clean.
        }
      }
    };
    // One widget per mount on purpose: the caller remounts (by key) to run it
    // again, so no prop change may re-render the widget under a pending check.
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
