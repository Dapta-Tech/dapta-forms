import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginStartedEvent, recordLoginStarted, type LoginStart } from './login-started';

/**
 * `forms_login_started`: what the login route records about a login start, and
 * that the send can never break the login.
 */

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const LANDING_ID = '0192f0a4-7c1e-7d2b-9a3c-5e6f7a8b9c0d';
const ON = { key: 'phc_test', host: 'https://ingest.example.test/', environment: 'dev' as const };

const start = (over: Partial<LoginStart> = {}): LoginStart => ({
  screen: 'sign-up',
  landingId: LANDING_ID,
  utmSource: 'linkedin',
  origin: 'https://app.forms.example',
  userAgent: CHROME,
  at: new Date('2026-11-22T21:00:00.000Z'),
  ...over,
});

describe('loginStartedEvent', () => {
  it('files a start under the landing id, with the screen, the campaign source and the host', () => {
    expect(loginStartedEvent(start())).toEqual({
      event: 'forms_login_started',
      distinct_id: LANDING_ID,
      timestamp: '2026-11-22T21:00:00.000Z',
      properties: {
        product: 'forms',
        screen: 'sign-up',
        has_ph_id: true,
        utm_source: 'linkedin',
        $host: 'app.forms.example',
        $geoip_disable: true,
      },
    });
  });

  it('without a landing id: a random id and no person profile', () => {
    const body = loginStartedEvent(start({ landingId: null, utmSource: null, screen: 'sign-in' }), () => 'r-1');
    expect(body).toEqual({
      event: 'forms_login_started',
      distinct_id: 'forms-login-r-1',
      timestamp: '2026-11-22T21:00:00.000Z',
      properties: {
        product: 'forms',
        screen: 'sign-in',
        has_ph_id: false,
        $host: 'app.forms.example',
        $geoip_disable: true,
        $process_person_profile: false,
      },
    });
  });

  it('caps the source like parseAttribution does', () => {
    const body = loginStartedEvent(start({ utmSource: 'x'.repeat(500) }));
    expect(body?.properties.utm_source).toBe('x'.repeat(128));
  });

  it('refuses a landing id that is not id-shaped, like the login route does', () => {
    const body = loginStartedEvent(start({ landingId: 'ana@example.com' }), () => 'r-2');
    expect(body?.distinct_id).toBe('forms-login-r-2');
    expect(JSON.stringify(body)).not.toContain('ana@example.com');
  });

  it.each([
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'facebookexternalhit/1.1',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
    'curl/8.4.0',
    'WhatsApp/2.23.20.0 A',
    'Viber/13.3.0.16',
  ])('sends nothing for an automated client (%s)', (userAgent) => {
    expect(loginStartedEvent(start({ userAgent }))).toBeNull();
  });

  it('sends nothing without a user agent', () => {
    expect(loginStartedEvent(start({ userAgent: null }))).toBeNull();
  });
});

describe('recordLoginStarted', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('posts one capture to the configured host with the write key and a timeout', async () => {
    await recordLoginStarted(start(), ON, fetchMock as unknown as typeof fetch);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string; signal?: unknown }];
    expect(url).toBe('https://ingest.example.test/capture/');
    expect(init.signal).toBeDefined();
    expect(JSON.parse(init.body)).toMatchObject({
      api_key: 'phc_test',
      event: 'forms_login_started',
      distinct_id: LANDING_ID,
    });
  });

  it('tags the event with the deployment it came from', async () => {
    await recordLoginStarted(start(), ON, fetchMock as unknown as typeof fetch);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const props = (JSON.parse(init.body) as { properties: Record<string, unknown> }).properties;
    expect(props.environment).toBe('dev');
    // The event's own properties are kept beside it.
    expect(props.product).toBe('forms');
  });

  it('does nothing with analytics off', async () => {
    await recordLoginStarted(start(), { key: null, host: ON.host, environment: 'local' }, fetchMock as unknown as typeof fetch);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws: a dead connection or a refused key is one warning', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    await expect(recordLoginStarted(start(), ON, fetchMock as unknown as typeof fetch)).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(recordLoginStarted(start(), ON, fetchMock as unknown as typeof fetch)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
