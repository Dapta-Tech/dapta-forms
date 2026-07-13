import { describe, it, expect, vi } from 'vitest';
import { createEmailProvider } from './factory';
import { HttpEmailProvider } from './adapters/http';
import { LogOnlyEmailProvider } from './adapters/log-only';

const base = { fromEmail: 'x@example.com' as const };
const ENDPOINT = 'https://mail.example.test/api/internal/email/send';

/**
 * never-break-env-vars: a config gap on the transactional profile must NEVER
 * crash the API at boot — legacy key keeps sending (deprecated), no credential
 * degrades to log-only, both with a loud WARN.
 */
describe('createEmailProvider — transactional-v1 config gaps never throw', () => {
  it('legacy EMAIL_HTTP_API_KEY only → HttpEmailProvider + deprecation WARN', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const p = createEmailProvider({
        ...base,
        provider: 'http',
        http: { endpoint: ENDPOINT, profile: 'transactional-v1', apiKey: 'legacy-key' },
      });
      expect(p).toBeInstanceOf(HttpEmailProvider);
      expect(spy.mock.calls.flat().join('\n')).toContain('DEPRECATED');
    } finally {
      spy.mockRestore();
    }
  });

  it('no credential at all → log-only + loud WARN (bookings never block on mail config)', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const p = createEmailProvider({
        ...base,
        provider: 'http',
        http: { endpoint: ENDPOINT, profile: 'transactional-v1' },
      });
      expect(p).toBeInstanceOf(LogOnlyEmailProvider);
      expect(spy.mock.calls.flat().join('\n')).toContain('falling back to log-only');
    } finally {
      spy.mockRestore();
    }
  });

  it('full HMAC pair still selects the signed transport with no WARN', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const p = createEmailProvider({
        ...base,
        provider: 'http',
        http: {
          endpoint: ENDPOINT,
          profile: 'transactional-v1',
          clientId: 'calendars',
          signingSecret: 'calendar-test-signing-secret-with-32-characters',
        },
      });
      expect(p).toBeInstanceOf(HttpEmailProvider);
      expect((p as HttpEmailProvider).requiresAccountContext).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
