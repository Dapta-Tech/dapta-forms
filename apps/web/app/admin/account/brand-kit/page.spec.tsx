/**
 * The Brand kit page as the server renders it, for the "Made with dForms"
 * row: first on the page when the deployment draws the attribution at all,
 * gone when it does not (no signup URL, or NEXT_PUBLIC_HIDE_BADGE), the link
 * taken from the deployment's DAPTA_AI_URL only, and a member read-only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

vi.mock('next/font/google', () => {
  const font = () => ({ className: 'font', variable: '--font', style: { fontFamily: 'font' } });
  return {
    DM_Sans: font,
    Figtree: font,
    Fraunces: font,
    Hanken_Grotesk: font,
    JetBrains_Mono: font,
    Inter: font,
    Manrope: font,
    Playfair_Display: font,
    Poppins: font,
    Space_Grotesk: font,
    Work_Sans: font,
  };
});
vi.mock('@/lib/locale', () => ({ getLocale: async () => 'en' }));
vi.mock('./actions', () => ({
  saveAttributionAction: vi.fn(),
  saveBrandKitAction: vi.fn(),
  applyBrandKitAction: vi.fn(),
  revertBrandKitAction: vi.fn(),
}));
const api = vi.hoisted(() => ({
  role: 'owner' as string,
  status: { hideAttribution: false, canHide: false, showing: true } as unknown,
  statusCalls: 0,
}));
vi.mock('@/lib/admin-api', () => ({
  isAdminRole: (role: string) => role === 'owner' || role === 'admin',
  adminApi: {
    me: async () => ({ role: api.role, accountName: 'Acme' }),
    getBranding: async () => ({ config: null, updatedAt: null }),
    listForms: async () => [],
    attributionStatus: async () => {
      api.statusCalls += 1;
      return api.status;
    },
  },
}));

import BrandKitPage from './page';

const render = async () => renderToStaticMarkup((await BrandKitPage()) as ReactElement);
const ENV = ['NEXT_PUBLIC_SIGNUP_URL', 'NEXT_PUBLIC_LANDING_URL', 'NEXT_PUBLIC_HIDE_BADGE', 'DAPTA_AI_URL'] as const;
const saved: Record<string, string | undefined> = {};

describe('Brand kit: the attribution row', () => {
  beforeEach(() => {
    for (const k of ENV) saved[k] = process.env[k];
    process.env.NEXT_PUBLIC_SIGNUP_URL = 'https://example.com/signup';
    delete process.env.NEXT_PUBLIC_HIDE_BADGE;
    delete process.env.DAPTA_AI_URL;
    api.role = 'owner';
    api.status = { hideAttribution: false, canHide: false, showing: true };
    api.statusCalls = 0;
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('leads the settings list, above the logo row', async () => {
    const html = await render();
    const row = html.indexOf('data-testid="attribution-setting"');
    expect(row).toBeGreaterThan(-1);
    expect(row).toBeLessThan(html.indexOf('Logo'));
  });

  it('links "Dapta AI" to the deployment landing, and only to it', async () => {
    process.env.DAPTA_AI_URL = 'https://platform.example.test';
    expect(await render()).toMatch(/<a href="https:\/\/platform\.example\.test\/" target="_blank" rel="noreferrer"[^>]*>Dapta AI<\/a>/);
  });

  it('with no DAPTA_AI_URL, or one that is not http(s), the note is plain text', async () => {
    expect(await render()).not.toMatch(/>Dapta AI<\/a>/);
    process.env.DAPTA_AI_URL = 'javascript:alert(1)';
    const html = await render();
    expect(html).not.toContain('javascript:');
    expect(html).toContain('Only for Dapta AI subscribers.');
  });

  it('is gone, and never asked for, on a deployment with no attribution at all', async () => {
    delete process.env.NEXT_PUBLIC_SIGNUP_URL;
    expect(await render()).not.toContain('attribution-setting');
    process.env.NEXT_PUBLIC_SIGNUP_URL = 'https://example.com/signup';
    process.env.NEXT_PUBLIC_HIDE_BADGE = '1';
    expect(await render()).not.toContain('attribution-setting');
    expect(api.statusCalls).toBe(0);
  });

  it('a member sees it read-only', async () => {
    api.role = 'member';
    api.status = { hideAttribution: false, canHide: true, showing: true };
    const html = await render();
    expect(html).toContain('data-testid="attribution-read-only"');
    expect(html).toMatch(/data-testid="attribution-switch"[^>]*disabled=""|disabled=""[^>]*data-testid="attribution-switch"/);
  });
});
