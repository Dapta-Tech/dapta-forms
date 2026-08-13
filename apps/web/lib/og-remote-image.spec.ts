/**
 * Unit tests for the author-supplied image fetch behind the share card.
 *
 * The behaviour under test is entirely about REFUSAL: this helper decides which
 * author URLs the server is willing to resolve and which bytes Satori is able to
 * draw. Every rejection has to come back as null, because the alternative is a
 * throw inside `ImageResponse` and a link that unfurls with no card at all.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { remoteImageDataUri } from './og-remote-image';

function respond(type: string, bytes = Buffer.from([1, 2, 3]), status = 200) {
  return new Response(bytes, { status, headers: { 'content-type': type } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('remoteImageDataUri — what it will draw', () => {
  it('returns the bytes inline so Satori never re-fetches without the guards', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond('image/png')));
    const uri = await remoteImageDataUri('https://cdn.example.com/logo.png');
    expect(uri).toBe(`data:image/png;base64,${Buffer.from([1, 2, 3]).toString('base64')}`);
  });

  it('accepts SVG, which is how the product’s own marks reach a card', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond('image/svg+xml')));
    await expect(remoteImageDataUri('https://cdn.example.com/logo.svg')).resolves.toContain(
      'data:image/svg+xml;base64,',
    );
  });

  it('tolerates a charset on the content type', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond('image/svg+xml; charset=utf-8')));
    await expect(remoteImageDataUri('https://cdn.example.com/logo.svg')).resolves.not.toBeNull();
  });
});

describe('remoteImageDataUri — what it refuses', () => {
  it('drops WebP, the one common format Satori cannot decode', async () => {
    // This is the case that made every WordPress-hosted logo a render error
    // rather than a missing logo.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond('image/webp')));
    await expect(remoteImageDataUri('https://cdn.example.com/logo.webp')).resolves.toBeNull();
  });

  it('drops AVIF for the same reason', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond('image/avif')));
    await expect(remoteImageDataUri('https://cdn.example.com/logo.avif')).resolves.toBeNull();
  });

  it('drops a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond('image/png', Buffer.from([1]), 404)));
    await expect(remoteImageDataUri('https://cdn.example.com/gone.png')).resolves.toBeNull();
  });

  it('drops a body past the size cap even when the header understated it', async () => {
    const huge = Buffer.alloc(1_600_000, 7);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond('image/png', huge)));
    await expect(remoteImageDataUri('https://cdn.example.com/huge.png')).resolves.toBeNull();
  });

  it('swallows a fetch that throws, so a dead origin costs only the logo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ETIMEDOUT')));
    await expect(remoteImageDataUri('https://cdn.example.com/slow.png')).resolves.toBeNull();
  });
});

describe('remoteImageDataUri — where it will not reach', () => {
  it('never leaves the request to a loopback or private host', async () => {
    // Server-side fetching is the difference between this and the <img> the form
    // page emits, and it is the difference an author could otherwise aim inward.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    for (const url of [
      'http://localhost:4000/admin',
      'http://127.0.0.1/',
      'http://10.0.0.5/logo.png',
      'http://192.168.1.4/logo.png',
      'http://169.254.169.254/latest/meta-data/',
      'http://172.16.0.9/logo.png',
      'http://kubernetes.default.internal/logo.png',
    ]) {
      await expect(remoteImageDataUri(url)).resolves.toBeNull();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a non-http scheme', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(remoteImageDataUri('file:///etc/passwd')).resolves.toBeNull();
    await expect(remoteImageDataUri('data:image/png;base64,AAAA')).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('treats absent, blank and malformed the same way', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    for (const value of [null, undefined, '', '   ', 'not a url']) {
      await expect(remoteImageDataUri(value)).resolves.toBeNull();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
