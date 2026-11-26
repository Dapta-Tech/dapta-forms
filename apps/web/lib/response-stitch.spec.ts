import { describe, expect, it } from 'vitest';
import { stitchHosts, stitchRedirect } from './response-stitch';

const ID = '019a6b2e-7c3d-7e4f-8a5b-1c2d3e4f5a6b';
const LANDING = 'https://dforms.ai/';

describe('stitchHosts', () => {
  it('is the landing host with and without www.', () => {
    expect(stitchHosts('https://dforms.ai/')).toEqual(['dforms.ai', 'www.dforms.ai']);
    expect(stitchHosts('https://www.dforms.ai/en/')).toEqual(['dforms.ai', 'www.dforms.ai']);
  });

  it('is empty with no landing, or one that does not parse', () => {
    expect(stitchHosts(undefined)).toEqual([]);
    expect(stitchHosts('')).toEqual([]);
    expect(stitchHosts('not a url')).toEqual([]);
  });
});

describe('stitchRedirect', () => {
  it('adds ph_id to a redirect to the landing, keeping its query and hash', () => {
    expect(stitchRedirect('https://dforms.ai/ventas/?utm_source=ig_a#top', ID, LANDING)).toBe(
      `https://dforms.ai/ventas/?utm_source=ig_a&ph_id=${ID}#top`,
    );
    expect(stitchRedirect('https://www.dforms.ai/ventas/', ID, LANDING)).toBe(
      `https://www.dforms.ai/ventas/?ph_id=${ID}`,
    );
  });

  it('leaves every other host byte-identical, subdomains of the landing included', () => {
    for (const url of [
      'https://example.com/welcome?src=form#top',
      'https://app.dforms.ai/login',
      'https://dforms.ai.example.com/x',
      ' https://example.com/x ',
    ]) {
      expect(stitchRedirect(url, ID, LANDING)).toBe(url);
    }
  });

  it('changes nothing without an id, without a landing, or when ph_id is already there', () => {
    const url = 'https://dforms.ai/ventas/';
    expect(stitchRedirect(url, '', LANDING)).toBe(url);
    expect(stitchRedirect(url, ID, undefined)).toBe(url);
    expect(stitchRedirect(`${url}?ph_id=abc`, ID, LANDING)).toBe(`${url}?ph_id=abc`);
  });
});
