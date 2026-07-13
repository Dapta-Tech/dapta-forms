import { Module } from '@nestjs/common';
import { createDb } from '@quill/db';
import { createEmailProvider, SubmissionNotifier, type EmailProvider } from '@quill/notifications';
import { loadServerEnv, type ServerEnv } from '@quill/config/env';
import { AUTH_PROVIDER, DB, EMAIL, ENTITLEMENTS, ENV, NOTIFIER, PREMIUM_MODE, RATE_LIMITER } from './tokens';
import { SubmissionService } from './submission.service';
import { AdminService } from './admin.service';
import { AuthService } from './auth.service';
import { EmailEffects } from './email-effects';
import { OutboxWorker } from './outbox.worker';
import { RateLimitGuard, createRateLimiter } from './rate-limit';
import { resolveEntitlementsProvider } from './entitlements.provider';
import { createAuthProvider } from './auth.provider';
import type { Db } from '@quill/db';
import { HealthController, DocsController } from './controllers';
import { PublicController } from './public.controller';
import { AdminCrudController } from './admin-crud.controller';

@Module({
  controllers: [HealthController, DocsController, PublicController, AdminCrudController],
  providers: [
    { provide: ENV, useFactory: () => loadServerEnv() },
    { provide: DB, useFactory: () => createDb() },
    {
      provide: EMAIL,
      useFactory: (env: ServerEnv) =>
        createEmailProvider({
          provider: env.EMAIL_PROVIDER,
          fromEmail: env.MAIL_FROM_EMAIL,
          fromName: env.MAIL_FROM_NAME,
          smtp: {
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_SECURE,
            user: env.SMTP_USER,
            pass: env.SMTP_PASS,
          },
          http: {
            endpoint: env.EMAIL_HTTP_ENDPOINT,
            profile: env.EMAIL_HTTP_PROFILE,
            token: env.EMAIL_HTTP_TOKEN,
            clientId: env.EMAIL_HTTP_CLIENT_ID,
            signingSecret: env.EMAIL_HTTP_SIGNING_SECRET,
            apiKey: env.EMAIL_HTTP_API_KEY,
            category: env.EMAIL_HTTP_CATEGORY,
          },
        }),
      inject: [ENV],
    },
    {
      provide: NOTIFIER,
      useFactory: (email: EmailProvider) => new SubmissionNotifier(email),
      inject: [EMAIL],
    },
    // Premium entitlements (vanity slug…): Forms is always free — the gate is the
    // customer's Dapta AI subscription via the upstream service. OSS default:
    // disabled provider + PREMIUM_FEATURES=open (everything unlocked).
    { provide: ENTITLEMENTS, useFactory: (env: ServerEnv) => resolveEntitlementsProvider(env), inject: [ENV] },
    { provide: PREMIUM_MODE, useFactory: (env: ServerEnv) => env.PREMIUM_FEATURES, inject: [ENV] },
    // Host auth backend selected by AUTH_PROVIDER (local stub / WorkOS overlay).
    {
      provide: AUTH_PROVIDER,
      useFactory: (env: ServerEnv, db: Db) => createAuthProvider(env, db),
      inject: [ENV, DB],
    },
    // Rate limiter for the public surface (P1-5): token bucket by default, noop
    // when RATE_LIMIT_ENABLED=false; swappable for a distributed limiter.
    { provide: RATE_LIMITER, useFactory: (env: ServerEnv) => createRateLimiter(env), inject: [ENV] },
    RateLimitGuard,
    SubmissionService,
    AdminService,
    AuthService,
    EmailEffects,
    // Drains the durable outbox (submission emails) with retry+backoff — no
    // silent loss on a provider outage (B1/B7/DM1).
    OutboxWorker,
  ],
})
export class AppModule {}
