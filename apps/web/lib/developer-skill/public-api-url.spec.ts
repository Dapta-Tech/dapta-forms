import { describe, expect, it } from 'vitest';
import { publicApiUrl } from './public-api-url';

describe('publicApiUrl', () => {
  it('prefers PUBLIC_API_URL over every other variable', () => {
    expect(
      publicApiUrl({
        PUBLIC_API_URL: 'https://api.example.com/',
        API_URL: 'https://other.example.com',
        NEXT_PUBLIC_API_URL: 'https://baked.example.com',
      }),
    ).toBe('https://api.example.com');
  });

  it('keeps a path prefix and drops the trailing slash', () => {
    expect(publicApiUrl({ PUBLIC_API_URL: 'https://example.com/forms-api/' })).toBe(
      'https://example.com/forms-api',
    );
  });

  it('never prints a cluster-internal API_URL to a customer', () => {
    expect(publicApiUrl({ API_URL: 'http://forms-api.lab.svc.cluster.local' })).toBeNull();
    expect(publicApiUrl({ API_URL: 'http://api:4000' })).toBeNull();
  });

  it('never prints a private network address either', () => {
    for (const internal of [
      'http://10.0.3.7:4000',
      'http://172.17.0.1:4000',
      'http://192.168.1.20:4000',
      'http://169.254.1.1',
      'http://[fd00::1]:4000',
    ]) {
      expect(publicApiUrl({ API_URL: internal }), internal).toBeNull();
    }
    // A public address is still fine, and so is 172.x outside the private block.
    expect(publicApiUrl({ API_URL: 'http://172.32.0.1:4000' })).toBe('http://172.32.0.1:4000');
  });

  it('falls back to the runtime NEXT_PUBLIC_API_URL when API_URL is cluster-internal', () => {
    // The usual deployment: the web calls the API inside the cluster and the
    // per-environment config also carries the public address.
    expect(
      publicApiUrl({
        API_URL: 'http://forms-api.lab.svc.cluster.local',
        NEXT_PUBLIC_API_URL: 'https://api.example.com/',
      }),
    ).toBe('https://api.example.com');
  });

  it('is null when every configured address is internal', () => {
    expect(
      publicApiUrl({ API_URL: 'http://api:4000', NEXT_PUBLIC_API_URL: 'http://10.0.0.5:4000' }),
    ).toBeNull();
  });

  it('uses a public API_URL as is', () => {
    expect(publicApiUrl({ API_URL: 'https://api.example.com' })).toBe('https://api.example.com');
  });

  it('uses NEXT_PUBLIC_API_URL for a fork that sets nothing else', () => {
    expect(publicApiUrl({ NEXT_PUBLIC_API_URL: 'https://api.example.com' })).toBe(
      'https://api.example.com',
    );
  });

  it('defaults to the local API for a bare clone', () => {
    expect(publicApiUrl({})).toBe('http://localhost:4000');
    expect(publicApiUrl({ API_URL: 'http://localhost:4000' })).toBe('http://localhost:4000');
  });

  it('ignores a malformed or non-http PUBLIC_API_URL', () => {
    expect(publicApiUrl({ PUBLIC_API_URL: 'not a url', API_URL: 'https://api.example.com' })).toBe(
      'https://api.example.com',
    );
    expect(publicApiUrl({ PUBLIC_API_URL: 'ftp://api.example.com' })).toBe('http://localhost:4000');
  });
});
