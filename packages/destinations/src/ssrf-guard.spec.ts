import { describe, it, expect } from 'vitest';
import { assertPublicWebhookUrl, classifyIp } from './ssrf-guard';

describe('classifyIp', () => {
  it('classifies IPv4 correctly', () => {
    expect(classifyIp('8.8.8.8')).toBe('public');
    expect(classifyIp('93.184.216.34')).toBe('public');
    expect(classifyIp('127.0.0.1')).toBe('loopback');
    expect(classifyIp('10.0.0.1')).toBe('blocked');
    expect(classifyIp('172.16.0.1')).toBe('blocked');
    expect(classifyIp('172.31.255.255')).toBe('blocked');
    expect(classifyIp('172.32.0.1')).toBe('public'); // just outside 172.16/12
    expect(classifyIp('192.168.1.1')).toBe('blocked');
    expect(classifyIp('169.254.169.254')).toBe('blocked'); // cloud metadata
    expect(classifyIp('100.64.0.1')).toBe('blocked'); // CGNAT
    expect(classifyIp('0.0.0.0')).toBe('blocked');
    expect(classifyIp('224.0.0.1')).toBe('blocked'); // multicast
  });

  it('classifies IPv6 correctly', () => {
    expect(classifyIp('::1')).toBe('loopback');
    expect(classifyIp('fc00::1')).toBe('blocked'); // ULA
    expect(classifyIp('fd12:3456::1')).toBe('blocked'); // ULA
    expect(classifyIp('fe80::1')).toBe('blocked'); // link-local
    expect(classifyIp('::ffff:10.0.0.1')).toBe('blocked'); // v4-mapped private
    expect(classifyIp('::ffff:8.8.8.8')).toBe('public'); // v4-mapped public
    expect(classifyIp('2606:4700:4700::1111')).toBe('public');
  });

  it('treats a non-IP string as blocked', () => {
    expect(classifyIp('not-an-ip')).toBe('blocked');
  });
});

describe('assertPublicWebhookUrl', () => {
  const resolvePublic = async () => ['93.184.216.34'];

  it('allows a public https host', async () => {
    await expect(
      assertPublicWebhookUrl('https://acme.io/hook', { allowLocalhost: false, resolve: resolvePublic }),
    ).resolves.toBeUndefined();
  });

  it('rejects a private IP literal', async () => {
    await expect(
      assertPublicWebhookUrl('https://192.168.0.10/x', { allowLocalhost: false }),
    ).rejects.toThrow(/private\/reserved/i);
  });

  it('rejects a host that resolves to a private address (DNS rebind)', async () => {
    await expect(
      assertPublicWebhookUrl('https://rebind.example.com/x', {
        allowLocalhost: false,
        resolve: async () => ['127.0.0.1', '10.0.0.9'],
      }),
    ).rejects.toThrow(/loopback|private/i);
  });

  it('rejects localhost in production posture', async () => {
    await expect(
      assertPublicWebhookUrl('http://localhost:9000/x', { allowLocalhost: false }),
    ).rejects.toThrow(/localhost/i);
  });

  it('allows localhost when explicitly permitted (non-prod)', async () => {
    await expect(
      assertPublicWebhookUrl('http://localhost:9000/x', { allowLocalhost: true }),
    ).resolves.toBeUndefined();
  });

  it('rejects a non-http(s) protocol', async () => {
    await expect(
      assertPublicWebhookUrl('ftp://acme.io/x', { allowLocalhost: false, resolve: resolvePublic }),
    ).rejects.toThrow(/protocol/i);
  });

  it('rejects a host that does not resolve', async () => {
    await expect(
      assertPublicWebhookUrl('https://nxdomain.example/x', {
        allowLocalhost: false,
        resolve: async () => [],
      }),
    ).rejects.toThrow(/did not resolve/i);
  });
});
