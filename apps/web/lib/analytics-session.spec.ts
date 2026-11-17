/**
 * Reading the browser's analytics session id out of the cookie the admin
 * snippet writes, so server-side events can link to their recording.
 */
import { describe, it, expect } from 'vitest';
import { ANALYTICS_SESSION_HEADER, analyticsSessionHeaders, sessionIdFromCookie } from './analytics-session';
import { ANALYTICS_SESSION_COOKIE, buildAnalyticsSnippet } from './product-analytics';

const SESSION = '019a5c3e-7d2b-7c41-9b1e-3f6a2d8c4e10';

function jar(values: Record<string, string>) {
  return { get: (name: string) => (name in values ? { value: values[name]! } : undefined) };
}

describe('sessionIdFromCookie', () => {
  it('reads a session id, encoded or not', () => {
    expect(sessionIdFromCookie(SESSION)).toBe(SESSION);
    expect(sessionIdFromCookie(encodeURIComponent(SESSION))).toBe(SESSION);
  });

  it('drops missing, malformed or odd-shaped values', () => {
    expect(sessionIdFromCookie(undefined)).toBeNull();
    expect(sessionIdFromCookie('%E0%A4%A')).toBeNull();
    expect(sessionIdFromCookie('not-a-session')).toBeNull();
    expect(sessionIdFromCookie(`${SESSION};x=1`)).toBeNull();
  });
});

describe('analyticsSessionHeaders', () => {
  const live = { [ANALYTICS_SESSION_COOKIE]: SESSION };

  it('forwards the session in one header', () => {
    expect(analyticsSessionHeaders(jar(live), { key: 'phc_test' })).toEqual({
      [ANALYTICS_SESSION_HEADER]: SESSION,
    });
  });

  it('sends nothing when analytics is off', () => {
    expect(analyticsSessionHeaders(jar(live), { key: null })).toEqual({});
  });

  it('sends nothing without the cookie', () => {
    expect(analyticsSessionHeaders(jar({}), { key: 'phc_test' })).toEqual({});
  });
});

describe('the admin snippet', () => {
  it('mirrors the live session id into the cookie the server reads', () => {
    const snippet = buildAnalyticsSnippet('phc_test', 'https://us.i.posthog.com');
    expect(snippet).toContain('loaded:function(ph){ph.onSessionId(');
    expect(snippet).toContain(`"${ANALYTICS_SESSION_COOKIE}="`);
  });
});
