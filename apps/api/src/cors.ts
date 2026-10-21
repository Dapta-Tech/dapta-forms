import type { INestApplication } from '@nestjs/common';
import type { ServerEnv } from '@quill/config/env';
import { mcpCorsPolicy } from '@quill/mcp';

function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The browser origins the API answers (P1-4): NEVER reflect an arbitrary
 * origin. The explicit allowlist (CORS_ORIGINS="https://a.com,https://b.com")
 * when set; otherwise the app's OWN web origin (PUBLIC_APP_URL), so
 * clone-and-run works (web:3000 -> api) without opening the authed surface to
 * every site. Embed the public widget on other domains by adding them to
 * CORS_ORIGINS. PUBLIC_APP_URL defaults to empty (self-host dev); then the
 * local web origin.
 */
export function corsOrigins(env: Pick<ServerEnv, 'CORS_ORIGINS' | 'PUBLIC_APP_URL'>): string[] {
  const configured = csv(env.CORS_ORIGINS);
  return configured.length > 0 ? configured : [env.PUBLIC_APP_URL || 'http://localhost:3000'];
}

/** True for a request to the MCP endpoint, whose browser policy is its own. */
export function isMcpPath(url: string | undefined): boolean {
  const path = (url ?? '').split('?')[0];
  return path === '/mcp' || path === '/mcp/';
}

/**
 * CORS for the whole API. Every route keeps the policy above, with
 * credentials. `/mcp` answers only the origins in MCP_ALLOWED_ORIGINS (none by
 * default), without credentials, because it authenticates with a bearer key
 * and must not widen the dashboard's allowlist or be widened by it. The MCP
 * door checks the same list again on every request.
 */
export function configureCors(app: INestApplication, env: ServerEnv): string[] {
  const origins = corsOrigins(env);
  const rest = { origin: origins, credentials: true };
  const mcp = mcpCorsPolicy(csv(env.MCP_ALLOWED_ORIGINS));
  app.enableCors((req: { originalUrl?: string; url?: string }, callback: (err: Error | null, options: object) => void) =>
    callback(null, isMcpPath(req.originalUrl ?? req.url) ? mcp : rest),
  );
  return origins;
}
