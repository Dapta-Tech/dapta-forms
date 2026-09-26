/**
 * The challenge provider's browser script (Cloudflare Turnstile), loaded on
 * demand for the one kind of form that needs it: one whose public payload
 * carries `captcha` (the owner turned spam protection on AND the deployment
 * has keys). Every other form, the builder preview included, never calls this
 * and makes no request to the provider.
 *
 * Loaded late on purpose. Not on view: a visitor who glances and leaves must
 * not have their address sent to a third party. `warmTurnstile` runs at the
 * first start or answer, so the script is ready by the final submit.
 *
 * The URL is the provider's own and must stay exactly this: proxying or
 * caching it breaks the widget whenever the provider ships an update.
 */

export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';
export const TURNSTILE_SCRIPT_SRC = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`;

/** The render options this app uses (the provider's names, kebab-case included). */
export interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  cData?: string;
  appearance?: 'always' | 'execute' | 'interaction-only';
  execution?: 'render' | 'execute';
  language?: string;
  theme?: 'light' | 'dark' | 'auto';
  size?: 'normal' | 'flexible' | 'compact';
  retry?: 'auto' | 'never';
  'refresh-expired'?: 'auto' | 'manual' | 'never';
  'response-field'?: boolean;
  callback?: (token: string) => void;
  'error-callback'?: (code: string) => boolean | void;
  'expired-callback'?: () => void;
  'unsupported-callback'?: () => void;
  'before-interactive-callback'?: () => void;
  'after-interactive-callback'?: () => void;
  'timeout-callback'?: () => void;
}

export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | undefined;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

/**
 * Load the script once and resolve with its API. Re-entrant: concurrent calls
 * share one tag. A failed load removes its tag and clears the memo, so the
 * respondent's "Try again" really does try again rather than replaying the
 * same rejection.
 */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('no browser'));
  }
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;

  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    const fail = (reason: string) => {
      loading = null;
      script.remove();
      reject(new Error(reason));
    };
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else fail('the challenge script defined no API');
    };
    script.onerror = () => fail('the challenge script failed to load');
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Get the script in flight early: a preconnect, then the load itself. Safe to
 * call on every start and answer; it does its work once. Failures are left for
 * the challenge to report, where there is a screen to report them on.
 */
export function warmTurnstile(): void {
  if (typeof document === 'undefined') return;
  if (!document.querySelector(`link[rel="preconnect"][href="${TURNSTILE_ORIGIN}"]`)) {
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = TURNSTILE_ORIGIN;
    document.head.appendChild(link);
  }
  loadTurnstile().catch(() => undefined);
}

/** Specs only: forget a memoized load between cases. */
export function resetTurnstileLoaderForTests(): void {
  loading = null;
}
