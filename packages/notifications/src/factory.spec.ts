import { describe, it, expect, vi } from 'vitest';
import { createEmailProvider } from './factory';
import { HttpEmailProvider } from './adapters/http';
import { LogOnlyEmailProvider } from './adapters/log-only';

/**
 * The env-gate rule (KEY): a bare fork (nothing set) stays log-only; the Dapta
 * deployment (EMAIL_PROVIDER=http + endpoint + transactional-v1 credentials)
 * gets the real signed provider. Missing pieces degrade to log-only — a
 * submission never blocks on mail config.
 */
describe('createEmailProvider — env gating', () => {
  it('defaults to log-only for a bare fork (provider unset → log-only)', () => {
    expect(createEmailProvider({ provider: 'log-only', fromEmail: 'forms@example.com' })).toBeInstanceOf(
      LogOnlyEmailProvider,
    );
  });

  it('falls back to log-only when http is selected but no endpoint is set', () => {
    expect(createEmailProvider({ provider: 'http', fromEmail: 'forms@example.com', http: {} })).toBeInstanceOf(
      LogOnlyEmailProvider,
    );
  });

  it('falls back to log-only when transactional-v1 has an endpoint but no credentials', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = createEmailProvider({
      provider: 'http',
      fromEmail: 'form@notifications-dapta.ai',
      http: { endpoint: 'https://email.example.com/api/internal/email/send', profile: 'transactional-v1' },
    });
    expect(provider).toBeInstanceOf(LogOnlyEmailProvider);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('builds the signed HTTP provider when endpoint + clientId + secret are all set', () => {
    const provider = createEmailProvider({
      provider: 'http',
      fromEmail: 'form@notifications-dapta.ai',
      fromName: 'Dapta Forms',
      http: {
        endpoint: 'https://email.example.com/api/internal/email/send',
        profile: 'transactional-v1',
        clientId: 'forms',
        signingSecret: 'x'.repeat(48),
      },
    });
    expect(provider).toBeInstanceOf(HttpEmailProvider);
    expect(provider.requiresAccountContext).toBe(true);
  });
});
