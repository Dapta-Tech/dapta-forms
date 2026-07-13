import { describe, it, expect } from 'vitest';
import { checkWebhookUrl } from './webhook-url';

// A deterministic fake resolver so DNS-name cases never hit the network.
const resolveTo =
  (address: string, family = 4) =>
  async () => [{ address, family }];
const resolveFail = async () => {
  throw new Error('ENOTFOUND');
};

describe('H3 — webhook subscriber URL guard (anti-SSRF)', () => {
  it('accepts a public https endpoint (public DNS name)', async () => {
    expect(await checkWebhookUrl('https://hooks.example.com/x', resolveTo('93.184.216.34'))).toEqual({
      ok: true,
    });
  });

  it('accepts a public https IP literal without any DNS', async () => {
    expect((await checkWebhookUrl('https://198.51.100.10/x', resolveFail)).ok).toBe(true);
  });

  it('rejects non-https schemes', async () => {
    expect(await checkWebhookUrl('http://hooks.example.com', resolveTo('93.184.216.34'))).toMatchObject({
      ok: false,
      reason: 'must_be_https',
    });
  });

  it('rejects loopback, link-local metadata, and private IP literals', async () => {
    for (const url of [
      'https://127.0.0.1/x',
      'https://169.254.169.254/latest/meta-data', // cloud metadata
      'https://10.1.2.3/x',
      'https://192.168.0.1/x',
      'https://172.16.9.9/x',
      'https://[::1]/x',
    ]) {
      expect((await checkWebhookUrl(url, resolveFail)).ok).toBe(false);
    }
  });

  it('rejects internal/loopback hostnames by name', async () => {
    for (const url of [
      'https://localhost/x',
      'https://db.internal/x',
      'https://svc.local/x',
      'https://metadata.google.internal/x',
    ]) {
      expect((await checkWebhookUrl(url, resolveTo('93.184.216.34'))).ok).toBe(false);
    }
  });

  it('rejects a public name that RESOLVES to a private address (DNS rebinding)', async () => {
    expect(await checkWebhookUrl('https://rebind.evil.test/x', resolveTo('127.0.0.1'))).toMatchObject({
      ok: false,
      reason: 'resolves_to_private_ip',
    });
    expect(
      await checkWebhookUrl('https://rebind6.evil.test/x', resolveTo('fd00::1', 6)),
    ).toMatchObject({ ok: false, reason: 'resolves_to_private_ip' });
  });

  it('rejects an unresolvable host and malformed URLs', async () => {
    expect((await checkWebhookUrl('https://nope.invalid/x', resolveFail)).ok).toBe(false);
    expect((await checkWebhookUrl('not a url', resolveFail)).ok).toBe(false);
  });
});
