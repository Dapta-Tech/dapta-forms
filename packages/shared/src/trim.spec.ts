import { describe, expect, it } from 'vitest';
import { trimChar, trimTrailing } from './trim';

describe('trimTrailing', () => {
  it('drops every trailing occurrence and nothing else', () => {
    expect(trimTrailing('https://api.example.com///', '/')).toBe('https://api.example.com');
    expect(trimTrailing('https://api.example.com', '/')).toBe('https://api.example.com');
    expect(trimTrailing('///', '/')).toBe('');
    expect(trimTrailing('', '/')).toBe('');
  });

  it('stays linear on a long run that is not at the end', () => {
    const input = `${'/'.repeat(200_000)}x`;
    const started = performance.now();
    expect(trimTrailing(input, '/')).toBe(input);
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe('trimChar', () => {
  it('drops the character at both ends', () => {
    expect(trimChar('--get-v1-forms--', '-')).toBe('get-v1-forms');
    expect(trimChar('get-v1', '-')).toBe('get-v1');
    expect(trimChar('---', '-')).toBe('');
  });

  it('stays linear on a long run in the middle', () => {
    const input = `a${'-'.repeat(200_000)}b`;
    const started = performance.now();
    expect(trimChar(input, '-')).toBe(input);
    expect(performance.now() - started).toBeLessThan(100);
  });
});
