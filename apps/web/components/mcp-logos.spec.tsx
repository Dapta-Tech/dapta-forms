// @vitest-environment happy-dom
/**
 * The MCP item's icon: Claude, ChatGPT and Cursor take turns every 2.6s, hold
 * still while the pointer is on the row, and never move under
 * prefers-reduced-motion.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { McpLogos, MCP_ROTATE_MS } from './mcp-logos';
import { AgentLogo } from './agent-logos';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let reduced = false;

beforeEach(() => {
  vi.useFakeTimers();
  reduced = false;
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('reduce') && reduced,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function mount(paused = false) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<McpLogos paused={paused} />));
}
const rerender = (paused: boolean) => act(async () => root.render(<McpLogos paused={paused} />));
const active = () => host.querySelector('[data-active="true"]')?.getAttribute('data-logo');
const tick = (ms = MCP_ROTATE_MS) => act(async () => void vi.advanceTimersByTime(ms));

describe('McpLogos', () => {
  it('draws the five logos as inline SVG, hidden from screen readers', async () => {
    await mount();
    const stack = host.querySelector<HTMLElement>('[data-testid="mcp-logos"]')!;
    expect(stack.getAttribute('aria-hidden')).toBe('true');
    const logos = [...stack.querySelectorAll<HTMLElement>('.mcp-logos__logo')];
    expect(logos.map((l) => l.dataset.logo)).toEqual(['claude', 'openai', 'cursor', 'openclaw', 'hermes']);
    for (const logo of logos) {
      const svg = logo.tagName.toLowerCase() === 'svg' ? logo : logo.querySelector('svg')!;
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg.querySelector('path')?.getAttribute('d')).toMatch(/^M/i);
    }
    expect(host.querySelectorAll('.is-active')).toHaveLength(1);
  });

  // A session replay rebuilds the DOM on the replay tool's own origin. A URL in
  // an inline style (a mask, a background) is fetched again from there, where a
  // relative path does not exist and a cross-origin mask is refused without
  // CORS, so the icon drew as a hole in every recording.
  it('loads nothing: no url() in any inline style and no external reference', async () => {
    await mount();
    for (const el of host.querySelectorAll<HTMLElement>('[style]')) {
      expect(el.getAttribute('style')).not.toMatch(/url\(/i);
    }
    expect(host.innerHTML).not.toMatch(/url\((?!#)|\bhref=|\bsrc=/i);
  });

  it('paints Claude in its brand orange and leaves ChatGPT and Cursor on the text color', async () => {
    await mount();
    const color = (logo: string) =>
      host.querySelector<SVGElement>(`[data-logo="${logo}"]`)!.style.color.toLowerCase();
    expect(['#d97757', 'rgb(217, 119, 87)']).toContain(color('claude'));
    // No inline color: the stylesheet's currentColor applies, so they follow the theme and the row state.
    expect(color('openai')).toBe('');
    expect(color('cursor')).toBe('');
  });

  it('takes turns every 2.6s, Claude, ChatGPT, Cursor, and round again', async () => {
    await mount();
    expect(active()).toBe('claude');
    await tick(MCP_ROTATE_MS - 1);
    expect(active()).toBe('claude');
    await tick(1);
    expect(active()).toBe('openai');
    await tick();
    expect(active()).toBe('cursor');
    await tick();
    expect(active()).toBe('openclaw');
    await tick();
    expect(active()).toBe('hermes');
    await tick();
    expect(active()).toBe('claude');
  });

  it('holds still while paused (the pointer is on the row) and goes on after', async () => {
    await mount();
    await tick();
    expect(active()).toBe('openai');
    await rerender(true);
    await tick(MCP_ROTATE_MS * 3);
    expect(active()).toBe('openai');
    await rerender(false);
    await tick();
    expect(active()).toBe('cursor');
  });

  it('never moves under prefers-reduced-motion', async () => {
    reduced = true;
    await mount();
    await tick(MCP_ROTATE_MS * 5);
    expect(active()).toBe('claude');
  });
});

describe('AgentLogo', () => {
  it('draws each app official mark inline, decorative unless asked for a name', () => {
    for (const app of ['chatgpt', 'claude', 'claude-code', 'cursor', 'codex'] as const) {
      const html = renderToStaticMarkup(<AgentLogo app={app} />);
      expect(html).toContain(`data-agent="${app}"`);
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toMatch(/<img|href=/);
    }
    expect(renderToStaticMarkup(<AgentLogo app="claude-code" />)).toContain('#D97757');
    expect(renderToStaticMarkup(<AgentLogo app="codex" title />)).toContain('aria-label="Codex"');
  });

  it('gives each Codex mark its own gradient id, so two on a page both draw', () => {
    const html = renderToStaticMarkup(
      <>
        <AgentLogo app="codex" />
        <AgentLogo app="codex" />
      </>,
    );
    const ids = [...html.matchAll(/linearGradient[^>]*id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(2);
  });
});
