import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadServerEnv } from '@slate/config/env';
import { AppModule } from './app.module';

async function bootstrap() {
  const env = loadServerEnv();
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  // CORS (P1-4): NEVER reflect an arbitrary origin. Use the explicit allowlist
  // (CORS_ORIGINS="https://a.com,https://b.com") when set; otherwise default to
  // the app's OWN web origin (PUBLIC_APP_URL) so clone-and-run works
  // (web:3000 → api) without opening the authed surface to every site. Embed the
  // public widget on other domains by adding them to CORS_ORIGINS.
  const configured = env.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean);
  const origins = configured && configured.length > 0 ? configured : [env.PUBLIC_APP_URL];
  app.enableCors({ origin: origins, credentials: true });
  console.log(`[api] CORS allowlist: ${origins.join(', ')}`);
  await app.listen(env.API_PORT);
  console.log(`[api] listening on http://localhost:${env.API_PORT} (db=${env.DATABASE_URL.replace(/\/\/([^:@/]+):[^@]+@/, '//$1:***@')})`);
}

bootstrap().catch((err) => {
  console.error('[api] failed to start:', err);
  process.exit(1);
});
