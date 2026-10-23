import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadServerEnv } from '@quill/config/env';
import { loadDotenv } from '@quill/config/dotenv';
import { AppModule } from './app.module';
import { databaseLogLabel } from './database-log-label';
import { configureCors } from './cors';
import { configureDeprecatedHosts } from './deprecated-hosts';
import { linkPageBodyParser } from './link-page-body';

async function bootstrap() {
  // Load .env (root + app-local) before reading env — a self-hoster's .env must
  // actually take effect. Real deployment env is never overridden (H3).
  loadDotenv();
  const env = loadServerEnv();
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  // On SIGTERM, close the app so its destroy hooks run: the outbox worker
  // stops polling.
  app.enableShutdownHooks();
  // Deprecated API hosts (off unless API_DEPRECATED_HOSTS is set): mounted
  // first, so every response on a listed host carries the headers, errors and
  // CORS refusals included. See deprecated-hosts.ts.
  const deprecated = configureDeprecatedHosts(app, env);
  if (deprecated) {
    console.log(`[api] deprecated hosts: ${deprecated.hosts.join(', ')} (successor ${deprecated.successorOrigin})`);
  }
  // CORS (P1-4): an explicit allowlist, never a reflected origin; `/mcp` has
  // its own (MCP_ALLOWED_ORIGINS, no credentials). See cors.ts.
  const origins = configureCors(app, env);
  // `PUT /v1/link-page` and the MCP (`update_link_page`) read a larger body
  // than the global 100 KB parser allows (an inlined logo); mounted before
  // it, and for those two routes only.
  app.use(linkPageBodyParser());
  console.log(`[api] CORS allowlist: ${origins.join(', ')}`);
  await app.listen(env.API_PORT);
  console.log(`[api] listening on http://localhost:${env.API_PORT} (db=${databaseLogLabel(env.DATABASE_URL)})`);
}

bootstrap().catch((err) => {
  console.error('[api] failed to start:', err);
  process.exit(1);
});
