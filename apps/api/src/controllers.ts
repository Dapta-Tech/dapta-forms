import { Controller, Get, Header, HttpException, HttpStatus, Inject } from '@nestjs/common';
import type { Db } from '@quill/db';
import { countOutbox, sql } from '@quill/db';
import { DB } from './tokens';
import { openapiSpec } from './openapi';

@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  private async dbState(): Promise<'up' | 'down'> {
    try {
      await this.db.get(sql`SELECT 1 AS ok`);
      return 'up';
    } catch {
      return 'down';
    }
  }

  /**
   * LIVENESS + a real DB probe. Returns 200 even when the DB is degraded (so a
   * load balancer keeps the node while surfacing the dependency state); `db` is
   * 'up' | 'down'. E10: never fail the endpoint on a degraded dependency.
   */
  @Get()
  async health() {
    const db = await this.dbState();
    return { status: db === 'up' ? 'ok' : 'degraded', service: 'forms-api', db, dialect: this.db.dialect };
  }

  /**
   * READINESS — distinct from liveness. A k8s readiness probe pulls the node out
   * of rotation when its hard dependency (the DB) is down: 503 when the DB is
   * unreachable, 200 otherwise. Also reports the outbox backlog (pending/failed)
   * so a stuck side-effect drainer is observable. Never throws on the backlog
   * query itself (best-effort).
   */
  @Get('ready')
  async ready() {
    const db = await this.dbState();
    let outbox: { pending: number; failed: number } | null = null;
    if (db === 'up') {
      try {
        outbox = {
          pending: await countOutbox(this.db, 'pending'),
          failed: await countOutbox(this.db, 'failed'),
        };
      } catch {
        outbox = null;
      }
    }
    const body = { status: db === 'up' ? 'ready' : 'unavailable', service: 'forms-api', db, outbox };
    if (db !== 'up') throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    return body;
  }
}

/** Public API documentation (E11): the OpenAPI JSON + a dependency-free viewer. */
@Controller()
export class DocsController {
  @Get('openapi.json')
  spec() {
    return openapiSpec;
  }

  @Get('docs')
  @Header('content-type', 'text/html; charset=utf-8')
  docs(): string {
    // No CDN (offline/CSP-safe): pretty-print the spec with a link to the raw JSON.
    return `<!doctype html><html><head><title>Quill API</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem}
pre{background:#f6f8fa;padding:1rem;border-radius:8px;overflow:auto}a{color:#2563eb}</style></head>
<body><h1>Quill API</h1><p>OpenAPI 3.1 · <a href="/openapi.json">/openapi.json</a></p>
<pre>${JSON.stringify(openapiSpec, null, 2).replace(/</g, '&lt;')}</pre></body></html>`;
  }
}
