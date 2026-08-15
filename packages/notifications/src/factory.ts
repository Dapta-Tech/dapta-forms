import type { EmailProvider } from './email.port';
import { LogOnlyEmailProvider } from './adapters/log-only';
import { NoopEmailProvider } from './adapters/noop';
import { SmtpEmailProvider } from './adapters/smtp';
import { HttpEmailProvider, type HttpWireProfile } from './adapters/http';

export interface EmailConfig {
  provider: 'log-only' | 'noop' | 'smtp' | 'http';
  fromEmail: string;
  fromName?: string;
  smtp?: {
    host?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    pass?: string;
  };
  http?: {
    endpoint?: string;
    /** Wire/profile to speak (`generic` default, or `transactional-v1`). */
    profile?: HttpWireProfile;
    /** Bearer token — `generic` profile. */
    token?: string;
    /** Stable service identity — `transactional-v1` profile. */
    clientId?: string;
    /** HMAC signing secret — `transactional-v1` profile. */
    signingSecret?: string;
    /**
     * DEPRECATED: pre-HMAC static service key (EMAIL_HTTP_API_KEY). Accepted as
     * a Bearer fallback on the transactional wire so existing deployments keep
     * sending after an upgrade (never-break-env-vars). Prefer clientId+secret.
     */
    apiKey?: string;
    /** Message category — `transactional-v1` profile (defaults to `lifecycle`). */
    category?: string;
  };
}

/**
 * Select the EmailProvider from configuration. Falls back to log-only whenever a
 * chosen provider is missing its required settings, so the app always boots and
 * submission flows always complete (rule 1: a bare fork runs with nothing set).
 */
export function createEmailProvider(config: EmailConfig): EmailProvider {
  switch (config.provider) {
    case 'noop':
      return new NoopEmailProvider();
    case 'smtp':
      if (config.smtp?.host) {
        return new SmtpEmailProvider({
          host: config.smtp.host,
          port: config.smtp.port ?? 587,
          secure: config.smtp.secure ?? false,
          user: config.smtp.user,
          pass: config.smtp.pass,
          fromEmail: config.fromEmail,
          fromName: config.fromName,
        });
      }
      return new LogOnlyEmailProvider();
    case 'http':
      if (config.http?.endpoint) {
        if (
          config.http.profile === 'transactional-v1' &&
          (!config.http.clientId || !config.http.signingSecret)
        ) {
          // Config gaps must NEVER crash the API at boot (never-break-env-vars):
          // an upgraded deployment that still carries only the legacy static key
          // keeps sending (deprecated Bearer fallback); with no credential at
          // all we degrade to log-only and say so loudly — submissions never block
          // on mail config.
          const legacyKey = config.http.apiKey || config.http.token;
          if (!legacyKey) {
            console.warn(
              '[email:http] transactional-v1 selected but EMAIL_HTTP_CLIENT_ID/EMAIL_HTTP_SIGNING_SECRET ' +
                'are missing and no legacy EMAIL_HTTP_API_KEY is set — falling back to log-only. ' +
                'No real mail will be sent until the HMAC credentials are configured.',
            );
            return new LogOnlyEmailProvider();
          }
          console.warn(
            '[email:http] transactional-v1 running on the DEPRECATED static API key ' +
              '(EMAIL_HTTP_API_KEY) — configure EMAIL_HTTP_CLIENT_ID + EMAIL_HTTP_SIGNING_SECRET ' +
              'to switch to signed requests.',
          );
        }
        return new HttpEmailProvider({
          endpoint: config.http.endpoint,
          profile: config.http.profile,
          token: config.http.token,
          clientId: config.http.clientId,
          signingSecret: config.http.signingSecret,
          apiKey: config.http.apiKey,
          category: config.http.category,
          fromEmail: config.fromEmail,
          fromName: config.fromName,
        });
      }
      return new LogOnlyEmailProvider();
    case 'log-only':
    default:
      return new LogOnlyEmailProvider();
  }
}
