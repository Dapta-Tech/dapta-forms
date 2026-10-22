/**
 * `PUT /v1/link-page` and the MCP endpoint read bodies past the global 100 KB
 * parser ceiling (a page at the schema's limits is about 160 KB), and only
 * those routes do.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LINK_PAGE_MAX_BODY_BYTES } from '@quill/types';
import { MCP_MAX_BODY_BYTES, isLinkPageWrite, isMcpPost, linkPageBodyParser } from './link-page-body';

const GLOBAL_LIMIT = 100 * 1024;
let server: Server;
let base: string;

/** Our reader, then a stand-in for the global parser: it refuses past 100 KB unless the body is already read. */
beforeAll(async () => {
  const mw = linkPageBodyParser();
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const r = req as IncomingMessage & { body?: unknown; _body?: boolean };
    mw(r as never, res as never, () => {
      if (r._body) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ via: 'link-page', bytes: JSON.stringify(r.body).length }));
        return;
      }
      let size = 0;
      req.on('data', (c: Buffer) => (size += c.length));
      req.on('end', () => {
        res.statusCode = size > GLOBAL_LIMIT ? 413 : 200;
        res.end(JSON.stringify({ via: 'global' }));
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const json = (bytes: number) => JSON.stringify({ page: { version: 1, bio: 'x'.repeat(bytes) } });

describe('the link page body reader', () => {
  it('reads a 160 KB page on PUT /v1/link-page', async () => {
    const res = await fetch(`${base}/v1/link-page`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: json(160_000) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ via: 'link-page' });
  });

  it('still refuses a body past its own ceiling', async () => {
    const res = await fetch(`${base}/v1/link-page`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: json(LINK_PAGE_MAX_BODY_BYTES + 10),
    });
    expect(res.status).toBe(413);
  });

  it('answers 400 to a body that is not JSON', async () => {
    const res = await fetch(`${base}/v1/link-page`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{nope' });
    expect(res.status).toBe(400);
  });

  it('reads the same page inside an MCP call, and refuses one past the MCP ceiling', async () => {
    const call = (bytes: number) =>
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'update_link_page', arguments: JSON.parse(json(bytes)) } });
    const ok = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: call(LINK_PAGE_MAX_BODY_BYTES - 1_000) });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ via: 'link-page' });
    const big = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: call(MCP_MAX_BODY_BYTES) });
    expect(big.status).toBe(413);
  });

  it('leaves every other route on the global limit', async () => {
    const res = await fetch(`${base}/v1/forms/x`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: json(160_000) });
    expect(res.status).toBe(413);
  });

  it('matches only the write, with or without a query or trailing slash', () => {
    const h = { 'content-type': 'application/json' };
    expect(isLinkPageWrite({ method: 'PUT', url: '/v1/link-page?x=1', headers: h })).toBe(true);
    expect(isLinkPageWrite({ method: 'PUT', url: '/v1/link-page/', headers: h })).toBe(true);
    expect(isLinkPageWrite({ method: 'GET', url: '/v1/link-page', headers: h })).toBe(false);
    expect(isLinkPageWrite({ method: 'PUT', url: '/v1/link-pages', headers: h })).toBe(false);
    expect(isLinkPageWrite({ method: 'PUT', url: '/v1/link-page', headers: { 'content-type': 'text/plain' } })).toBe(false);
    expect(isMcpPost({ method: 'POST', url: '/mcp', headers: h })).toBe(true);
    expect(isMcpPost({ method: 'GET', url: '/mcp', headers: h })).toBe(false);
    expect(isMcpPost({ method: 'POST', url: '/mcp/x', headers: h })).toBe(false);
  });
});
