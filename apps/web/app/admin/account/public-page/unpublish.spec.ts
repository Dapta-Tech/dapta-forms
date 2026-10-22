import { describe, expect, it } from 'vitest';
import { linkPageSchema } from '@quill/types';
import { savedBody, unpublishBody } from './unpublish';

describe('unpublishing the link page', () => {
  it('writes the last saved page with enabled false, and it always validates', () => {
    const saved = linkPageSchema.parse({
      version: 1,
      enabled: true,
      bio: 'Saved bio',
      items: [{ type: 'link', label: 'Store', url: 'https://shop.acme.example' }],
      socials: { whatsapp: '+57 300 123 4567' },
    });
    const body = unpublishBody(savedBody(saved));
    expect(body.enabled).toBe(false);
    expect(body.bio).toBe('Saved bio');
    // The stored WhatsApp digits go back with their +, so the body is valid
    // even though a bare number would not be.
    const parsed = linkPageSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.socials?.whatsapp).toBe('573001234567');
  });

  it('works for a page that was never saved', () => {
    expect(unpublishBody(savedBody(null))).toEqual({ version: 1, enabled: false });
    expect(linkPageSchema.safeParse(unpublishBody(null)).success).toBe(true);
  });
});
