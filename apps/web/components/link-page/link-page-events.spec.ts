import { describe, expect, it } from 'vitest';
import { linkPageEventFromElement } from './link-page-events';

const el = (attrs: Record<string, string>) => ({ getAttribute: (n: string) => attrs[n] ?? null });

describe('linkPageEventFromElement', () => {
  it('describes a form, a link and a social click with its link_type', () => {
    expect(linkPageEventFromElement(el({ 'data-lp-type': 'form', 'data-lp-pos': '2', 'data-lp-slug': 'quote' }))).toEqual({
      type: 'click',
      linkType: 'form',
      position: 2,
      slug: 'quote',
    });
    expect(linkPageEventFromElement(el({ 'data-lp-type': 'link', 'data-lp-pos': '0' }))).toEqual({
      type: 'click',
      linkType: 'link',
      position: 0,
    });
    expect(
      linkPageEventFromElement(el({ 'data-lp-type': 'social', 'data-lp-pos': '1', 'data-lp-network': 'tiktok' })),
    ).toEqual({ type: 'click', linkType: 'social', position: 1, network: 'tiktok' });
  });

  it('ignores what it cannot describe', () => {
    expect(linkPageEventFromElement(el({}))).toBeNull();
    expect(linkPageEventFromElement(el({ 'data-lp-type': 'banner' }))).toBeNull();
    expect(linkPageEventFromElement(el({ 'data-lp-type': 'social', 'data-lp-network': 'myspace' }))).toEqual({
      type: 'click',
      linkType: 'social',
    });
  });
});
