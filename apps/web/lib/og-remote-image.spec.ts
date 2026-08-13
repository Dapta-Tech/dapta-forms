/**
 * Unit tests for the author-supplied image fetch behind the share card.
 *
 * The behaviour under test is entirely about REFUSAL: this helper decides which
 * author URLs the server is willing to resolve and which bytes Satori is able to
 * draw. Every rejection has to come back as null, because the alternative is a
 * throw inside `ImageResponse` and a link that unfurls with no card at all.
 *
 * DNS is injected everywhere: the guard now resolves hostnames before fetching,
 * and a unit test must not depend on the machine's resolver.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { remoteImageDataUri } from './og-remote-image';

function respond(type: string, bytes = Buffer.from([1, 2, 3]), status = 200) {
  return new Response(bytes, { status, headers: { 'content-type': type } });
}

/** A resolver that says every hostname lives at a public address. */
const publicDns = { resolve: async () => ['93.184.216.34'] };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('remoteImageDataUri — what it will draw', () => {
  it('returns the bytes inline so Satori never re-fetches without the guards', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond('image/png')));
    const uri = await remoteImageDataUri('https://cdn.example.com/logo.png', publicDns);
    expect(uri).toBe(`data:image/png;base64,${Buffer.from([1, 2, 3]).toString('base64')}`);
  });

  it('accepts SVG, which is how the product’s own marks reach a card', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond('image/svg+xml')));
    await expect(remoteImageDataUri('https://cdn.example.com/logo.svg', publicDns)).resolves.toContain(
      'data:image/svg+xml;base64,',
    );
  });

  it('tolerates a charset on the content type', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond('image/svg+xml; charset=utf-8')));
    await expect(remoteImageDataUri('https://cdn.example.com/logo.svg', publicDns)).resolves.not.toBeNull();
  });

  it('accepts a public IP literal without consulting DNS', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond('image/png')));
    const resolve = vi.fn();
    await expect(remoteImageDataUri('https://93.184.216.34/logo.png', { resolve })).resolves.not.toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('refuses to follow redirects — the Location target was never validated', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(respond('image/png'));
    vi.stubGlobal('fetch', fetchSpy);
    await remoteImageDataUri('https://cdn.example.com/logo.png', publicDns);
    expect(fetchSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ redirect: 'error' }));
  });
});

describe('remoteImageDataUri — what it refuses', () => {
  it('drops WebP, the one common format Satori cannot decode', async () => {
    // This is the case that made every WordPress-hosted logo a render error
    // rather than a missing logo.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond('image/webp')));
    await expect(remoteImageDataUri('https://cdn.example.com/logo.webp', publicDns)).resolves.toBeNull();
  });

  it('drops AVIF for the same reason', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond('image/avif')));
    await expect(remoteImageDataUri('https://cdn.example.com/logo.avif', publicDns)).resolves.toBeNull();
  });

  it('drops a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond('image/png', Buffer.from([1]), 404)));
    await expect(remoteImageDataUri('https://cdn.example.com/gone.png', publicDns)).resolves.toBeNull();
  });

  it('drops a body past the size cap even when the header understated it', async () => {
    const huge = Buffer.alloc(1_600_000, 7);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond('image/png', huge)));
    await expect(remoteImageDataUri('https://cdn.example.com/huge.png', publicDns)).resolves.toBeNull();
  });

  it('swallows a fetch that throws, so a dead origin costs only the logo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ETIMEDOUT')));
    await expect(remoteImageDataUri('https://cdn.example.com/slow.png', publicDns)).resolves.toBeNull();
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
      await expect(remoteImageDataUri(url, publicDns)).resolves.toBeNull();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a public-looking hostname that RESOLVES to a private address', async () => {
    // DNS rebinding's first half: nothing in the URL looks internal, the
    // resolver is what aims it inward. The name check alone cannot see this.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    for (const inward of ['10.0.0.5', '127.0.0.1', '169.254.169.254', '::1', 'fd00::2', '::ffff:192.168.1.9']) {
      await expect(
        remoteImageDataUri('https://logo.attacker.example/x.png', { resolve: async () => [inward] }),
      ).resolves.toBeNull();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses when ANY resolved address is private — one public A record is no alibi', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(
      remoteImageDataUri('https://logo.attacker.example/x.png', {
        resolve: async () => ['93.184.216.34', '10.0.0.5'],
      }),
    ).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses private IP literals in v6 forms the old regexes never saw', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    for (const url of ['http://[fd00::1]/x.png', 'http://[::ffff:10.0.0.5]/x.png', 'http://[fe80::1]/x.png']) {
      await expect(remoteImageDataUri(url, publicDns)).resolves.toBeNull();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('treats a hostname that does not resolve as unreachable', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(
      remoteImageDataUri('https://nope.example/x.png', {
        resolve: async () => {
          throw new Error('ENOTFOUND');
        },
      }),
    ).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a non-http scheme', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(remoteImageDataUri('file:///etc/passwd', publicDns)).resolves.toBeNull();
    await expect(remoteImageDataUri('data:image/png;base64,AAAA', publicDns)).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('treats absent, blank and malformed the same way', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    for (const value of [null, undefined, '', '   ', 'not a url']) {
      await expect(remoteImageDataUri(value, publicDns)).resolves.toBeNull();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
