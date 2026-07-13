import {
  SHORT_CODE_ALPHABET,
  canClaimVanitySlug,
  deriveHandleBase,
  generateShortCode,
  handleCandidate,
  isReservedPublicSlug,
  isShortCode,
  validateVanitySlug,
} from './short-links';

describe('short-links (pure rules)', () => {
  describe('short codes', () => {
    it('alphabet excludes every ambiguous symbol (0, o, 1, l)', () => {
      for (const bad of ['0', 'o', '1', 'l']) expect(SHORT_CODE_ALPHABET).not.toContain(bad);
      expect(new Set(SHORT_CODE_ALPHABET).size).toBe(SHORT_CODE_ALPHABET.length);
    });

    it('generates 6-char codes strictly from the alphabet', () => {
      for (let i = 0; i < 200; i++) {
        const code = generateShortCode();
        expect(code).toHaveLength(6);
        expect(isShortCode(code)).toBe(true);
        for (const ch of code) expect(SHORT_CODE_ALPHABET).toContain(ch);
      }
    });

    it('isShortCode rejects legacy and vanity shapes', () => {
      for (const v of ['acct-d3466b0b3ef84267', 'dev-felipe', 'acme', 'ab3d9', 'ab3d9qq', '7K3D9Q', 'ab-d9q']) {
        expect(isShortCode(v)).toBe(false);
      }
    });
  });

  describe('vanity slugs', () => {
    it('accepts lowercase [a-z0-9-] between 3 and 30 chars', () => {
      for (const v of ['dapta', 'acme-inc', 'a2c', 'x'.repeat(30)]) {
        expect(validateVanitySlug(v)).toBeNull();
      }
    });

    it('rejects bad shapes', () => {
      for (const v of ['ab', 'x'.repeat(31), '-abc', 'abc-', 'a--b', 'con espacios', 'a.b']) {
        expect(validateVanitySlug(v)).toBe('invalid');
      }
    });

    it('normalizes case instead of rejecting it', () => {
      expect(validateVanitySlug('ACME-Inc')).toBeNull();
    });

    it('blocks reserved route words (case-insensitive)', () => {
      for (const v of ['admin', 'api', 'login', 'signup', 'www', 'app', 'assets', 'manage', 'teams', 'settings', 'health', 'docs', 'static']) {
        expect(validateVanitySlug(v)).toBe('reserved');
        expect(isReservedPublicSlug(v.toUpperCase())).toBe(true);
      }
    });
  });

  describe('vanity entitlement gate (open-core policy)', () => {
    it('locked mode: only paying Dapta AI customers may claim', () => {
      expect(canClaimVanitySlug('locked', false)).toBe(false);
      expect(canClaimVanitySlug('locked', true)).toBe(true);
    });

    it('open mode (OSS default): everyone may claim', () => {
      expect(canClaimVanitySlug('open', false)).toBe(true);
      expect(canClaimVanitySlug('open', true)).toBe(true);
    });
  });

  describe('auto-handle derivation', () => {
    it('first initial + last name', () => {
      expect(deriveHandleBase('Felipe Gomez', 'felipe.gomez@example.com')).toBe('fgomez');
      expect(deriveHandleBase('Alex Rivera', null)).toBe('arivera');
      expect(deriveHandleBase('Ana María de la Cruz', null)).toBe('acruz');
    });

    it('strips accents and punctuation', () => {
      expect(deriveHandleBase('Óscar Gómez', null)).toBe('ogomez');
      expect(deriveHandleBase("D'Angelo O'Brien", null)).toBe('dobrien');
    });

    it('single-word names pass through; short names fall back to email local part', () => {
      expect(deriveHandleBase('Madonna', null)).toBe('madonna');
      expect(deriveHandleBase('Al B', 'al.b@example.com')).toBe('alb');
      expect(deriveHandleBase(null, 'jordan.lee@example.com')).toBe('jordanlee');
    });

    it('last-resort fallback is "host"', () => {
      expect(deriveHandleBase(null, null)).toBe('host');
      expect(deriveHandleBase('尹', 'ab@x.co')).toBe('host');
    });

    it('collision candidates suffix from 2', () => {
      expect(handleCandidate('fgomez', 1)).toBe('fgomez');
      expect(handleCandidate('fgomez', 2)).toBe('fgomez2');
      expect(handleCandidate('fgomez', 7)).toBe('fgomez7');
    });
  });
});
