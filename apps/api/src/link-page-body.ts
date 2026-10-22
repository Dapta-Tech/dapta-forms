import { LINK_PAGE_MAX_BODY_BYTES } from '@quill/types';

/**
 * A JSON body reader for `PUT /v1/link-page` and the MCP endpoint
 * (`POST /mcp`) alone, mounted in `main.ts` before Nest's own parser.
 *
 * Nest parses every JSON body with body-parser's default 100 KB ceiling, and
 * a link page at the schema's limits (an inlined logo plus 30 long links) is
 * about 160 KB, so a legitimate save would answer 413. Raising the global
 * ceiling would raise it for every route; this reads only this one route's
 * body, up to `LINK_PAGE_MAX_BODY_BYTES`, and marks it parsed (`_body`), which
 * makes the global parser step aside for that request. Every other request
 * passes through untouched.
 *
 * The MCP endpoint reads the same page through `update_link_page`, inside a
 * JSON-RPC envelope, so it takes the page's ceiling plus room for the
 * envelope (`MCP_MAX_BODY_BYTES`): the largest page REST accepts is accepted
 * through the MCP too.
 */
interface BodyReq {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  _body?: boolean;
  on(event: 'data', cb: (chunk: Buffer) => void): unknown;
  on(event: 'end' | 'error', cb: (err?: Error) => void): unknown;
  destroy?(): void;
}

interface BodyRes {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
}

export const LINK_PAGE_BODY_PATH = '/v1/link-page';
export const MCP_BODY_PATH = '/mcp';

/** The MCP's ceiling: a whole link page plus its JSON-RPC envelope. */
export const MCP_MAX_BODY_BYTES = LINK_PAGE_MAX_BODY_BYTES + 16 * 1024;

type Head = Pick<BodyReq, 'method' | 'url' | 'headers'>;

const pathOf = (req: Head) => (req.url ?? '').split('?')[0]?.replace(/\/+$/, '');
const isJson = (req: Head) => String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json');

export function isLinkPageWrite(req: Head): boolean {
  return req.method === 'PUT' && pathOf(req) === LINK_PAGE_BODY_PATH && isJson(req);
}

export function isMcpPost(req: Head): boolean {
  return req.method === 'POST' && pathOf(req) === MCP_BODY_PATH && isJson(req);
}

/** The ceiling this reader applies to a request, or null when it leaves the request to the global parser. */
export function largeBodyLimit(req: Head, limit: number = LINK_PAGE_MAX_BODY_BYTES): number | null {
  if (isLinkPageWrite(req)) return limit;
  if (isMcpPost(req)) return limit + (MCP_MAX_BODY_BYTES - LINK_PAGE_MAX_BODY_BYTES);
  return null;
}

function refuse(res: BodyRes, status: number, error: string, message: string): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error, message }));
}

export function linkPageBodyParser(limit: number = LINK_PAGE_MAX_BODY_BYTES) {
  return (req: BodyReq, res: BodyRes, next: (err?: unknown) => void): void => {
    const max = req._body ? null : largeBodyLimit(req, limit);
    if (max === null) {
      next();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > max) {
        done = true;
        refuse(res, 413, 'PAYLOAD_TOO_LARGE', 'The body is larger than this endpoint accepts.');
        req.destroy?.();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', (err) => {
      if (done) return;
      done = true;
      next(err);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        req.body = text ? (JSON.parse(text) as unknown) : {};
      } catch {
        refuse(res, 400, 'BAD_REQUEST', 'The body is not valid JSON.');
        return;
      }
      req._body = true;
      next();
    });
  };
}
