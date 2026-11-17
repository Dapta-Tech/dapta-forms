import { describe, expect, it } from 'vitest';
import {
  initialsOf,
  linkPageOgPath,
  plausibleAccountCode,
  publishedWorkspacePagePath,
  workspacePagePath,
} from './public-page';

describe('workspacePagePath', () => {
  it('is the workspace code at the root', () => {
    expect(workspacePagePath('acme')).toBe('/acme');
  });
});

describe('publishedWorkspacePagePath', () => {
  it('returns the path only while the page is published', () => {
    expect(publishedWorkspacePagePath('acme', { enabled: true })).toBe('/acme');
  });

  it('is null when the page is off, so Home hides its box', () => {
    expect(publishedWorkspacePagePath('acme', { enabled: false })).toBeNull();
  });

  it('is null when there is no page at all', () => {
    expect(publishedWorkspacePagePath('acme', null)).toBeNull();
    expect(publishedWorkspacePagePath('acme', undefined)).toBeNull();
  });
});

describe('plausibleAccountCode', () => {
  it('takes codes and vanity slugs', () => {
    expect(plausibleAccountCode('acme')).toBe(true);
    expect(plausibleAccountCode('a1b2c3')).toBe(true);
    expect(plausibleAccountCode('acme-studio')).toBe(true);
  });

  it('refuses file names and probes without a call to the API', () => {
    expect(plausibleAccountCode('favicon.ico')).toBe(false);
    expect(plausibleAccountCode('.env')).toBe(false);
    expect(plausibleAccountCode('-acme')).toBe(false);
    expect(plausibleAccountCode('a/b')).toBe(false);
    expect(plausibleAccountCode('')).toBe(false);
  });
});

describe('linkPageOgPath', () => {
  it('points at the share card route', () => {
    expect(linkPageOgPath('acme')).toBe('/api/public/pages/acme/og');
  });
});

describe('initialsOf', () => {
  it('takes the first letter of two words, or two letters of one', () => {
    expect(initialsOf('Acme Studio')).toBe('AS');
    expect(initialsOf('acme')).toBe('AC');
    expect(initialsOf('  ')).toBe('');
  });
});

describe('several pages per workspace', () => {
  it('puts the default page at the root and every other one under /p/', async () => {
    const { linkPagePublicPath } = await import('./public-page');
    expect(linkPagePublicPath('acme', { slug: 'main', isDefault: true })).toBe('/acme');
    expect(linkPagePublicPath('acme', { slug: 'expo-2026', isDefault: false })).toBe('/acme/p/expo-2026');
  });

  it('points each page at its own share card and event route', async () => {
    const { linkPageEventsPath } = await import('./public-page');
    expect(linkPageOgPath('acme')).toBe('/api/public/pages/acme/og');
    expect(linkPageOgPath('acme', 'expo')).toBe('/api/public/pages/acme/expo/og');
    expect(linkPageEventsPath('acme')).toBe('/api/public/pages/acme/events');
    expect(linkPageEventsPath('acme', 'expo')).toBe('/api/public/pages/acme/expo/events');
  });

  it('only asks the API about a slug of the vanity shape', async () => {
    const { plausiblePageSlug } = await import('./public-page');
    expect(plausiblePageSlug('expo-2026')).toBe(true);
    expect(plausiblePageSlug('EXPO')).toBe(true);
    for (const bad of ['ab', 'favicon.ico', '-x-', 'a'.repeat(31), '%2e%2e', 'expo 2026']) {
      expect(plausiblePageSlug(bad), bad).toBe(false);
    }
  });
});
