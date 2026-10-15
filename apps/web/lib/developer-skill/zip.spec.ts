import { describe, expect, it } from 'vitest';
import { readZip } from '@/lib/test/read-zip';
import { crc32, createZip } from './zip';

describe('crc32', () => {
  it('matches the standard check value', () => {
    // The CRC-32 of the ASCII digits 1 to 9 is the published check value.
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('createZip', () => {
  it('round-trips nested paths, UTF-8 text and both storage methods', () => {
    const long = 'Repeat me. '.repeat(500);
    const zip = createZip([
      { path: 'SKILL.md', content: long },
      { path: 'reference/errors.md', content: 'Configuración: sí' },
      { path: 'a.txt', content: 'x' },
    ]);
    const files = readZip(zip);
    expect([...files.keys()]).toEqual(['SKILL.md', 'reference/errors.md', 'a.txt']);
    expect(files.get('SKILL.md')).toBe(long);
    expect(files.get('reference/errors.md')).toBe('Configuración: sí');
    expect(files.get('a.txt')).toBe('x');
    // Deflate actually ran on the repetitive file.
    expect(zip.length).toBeLessThan(long.length);
  });

  it('refuses a path that could escape the folder it is unpacked into', () => {
    expect(() => createZip([{ path: '../evil.md', content: '' }])).toThrow();
    expect(() => createZip([{ path: '/abs.md', content: '' }])).toThrow();
  });
});
