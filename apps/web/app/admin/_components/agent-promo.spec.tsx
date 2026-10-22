// @vitest-environment happy-dom
/**
 * The home's "Connect your agent" banner and card: both lead to the connector
 * guide, the banner stays put, and the card's typing loop follows the
 * dforms.ai landing and holds still with reduced motion.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@quill/shared';

import { AgentBanner } from './agent-banner';
import { AgentCard } from './agent-card';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = getMessages('en').admin.home;
let root: Root;
let host: HTMLDivElement;
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);

function motion(reduce: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: reduce && q.includes('reduce'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

async function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(node));
}

beforeEach(() => {
  motion(false);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('AgentBanner', () => {
  it('says what it is for, shows every app logo once to a screen reader, and links to the guide', async () => {
    await mount(<AgentBanner m={h.agentBanner} />);
    expect(host.textContent).toContain(h.agentBanner.title);
    expect($('[data-testid="home-agent-banner-cta"]')!.getAttribute('href')).toBe('/admin/developers/connect');
    const lists = host.querySelectorAll('[data-testid="home-agent-marquee"] ul');
    expect(lists).toHaveLength(2);
    expect(lists[1]!.getAttribute('aria-hidden')).toBe('true');
    expect(lists[0]!.querySelectorAll('svg[data-agent]')).toHaveLength(7);
  });

  it('cannot be closed', async () => {
    await mount(<AgentBanner m={h.agentBanner} />);
    expect($('[data-testid="home-agent-banner-dismiss"]')).toBeNull();
  });
});

describe('AgentCard', () => {
  it('opens on the first prompt, answered, with the guide one click away', async () => {
    await mount(<AgentCard m={h.agentCard} />);
    const demo = $('[data-testid="home-agent-demo"]')!;
    expect(demo.textContent).toContain(h.agentCard.prompts[0]);
    expect(demo.textContent).toContain(h.agentCard.done);
    expect(demo.dataset.app).toBe('claude');
    expect($('[data-testid="home-agent-card-cta"]')!.getAttribute('href')).toBe('/admin/developers/connect');
  });

  it('erases, then types the next prompt in the next app', async () => {
    vi.useFakeTimers();
    try {
      await mount(<AgentCard m={h.agentCard} />);
      const demo = () => $('[data-testid="home-agent-demo"]')!;
      for (let i = 0; i < 400 && demo().dataset.phase !== 'typing'; i++) {
        await act(async () => void vi.advanceTimersByTime(100));
      }
      expect(demo().dataset.app).toBe('chatgpt');
      for (let i = 0; i < 400 && demo().dataset.phase === 'typing'; i++) {
        await act(async () => void vi.advanceTimersByTime(40));
      }
      expect(demo().textContent).toContain(h.agentCard.prompts[1]);
      expect(demo().dataset.phase).toBe('done');
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives every prompt the same time on screen, whatever its length', async () => {
    vi.useFakeTimers();
    try {
      await mount(<AgentCard m={h.agentCard} />);
      const demo = () => $('[data-testid="home-agent-demo"]')!;
      const starts: number[] = [];
      let elapsed = 0;
      let last = demo().dataset.app;
      while (starts.length < 4 && elapsed < 60000) {
        await act(async () => void vi.advanceTimersByTime(50));
        elapsed += 50;
        if (demo().dataset.app !== last) {
          last = demo().dataset.app;
          starts.push(elapsed);
        }
      }
      const gaps = starts.slice(1).map((t, i) => t - starts[i]!);
      expect(gaps.length).toBe(3);
      for (const g of gaps) expect(Math.abs(g - gaps[0]!)).toBeLessThanOrEqual(150);
    } finally {
      vi.useRealTimers();
    }
  });

  it('pauses only on a click, never when the pointer passes over', async () => {
    vi.useFakeTimers();
    try {
      await mount(<AgentCard m={h.agentCard} />);
      const demo = () => $('[data-testid="home-agent-demo"]')!;
      await act(async () => void demo().dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
      for (let i = 0; i < 200 && demo().dataset.app === 'claude'; i++) await act(async () => void vi.advanceTimersByTime(100));
      expect(demo().dataset.app).toBe('chatgpt');
      await act(async () => demo().click());
      expect(demo().dataset.paused).toBe('true');
      const before = demo().textContent;
      await act(async () => void vi.advanceTimersByTime(30000));
      expect(demo().dataset.app).toBe('chatgpt');
      expect(demo().textContent).toBe(before);
      await act(async () => demo().click());
      expect(demo().dataset.paused).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds still on the first prompt with reduced motion', async () => {
    motion(true);
    vi.useFakeTimers();
    try {
      await mount(<AgentCard m={h.agentCard} />);
      await act(async () => void vi.advanceTimersByTime(30000));
      const demo = $('[data-testid="home-agent-demo"]')!;
      expect(demo.dataset.app).toBe('claude');
      expect(demo.textContent).toContain(h.agentCard.prompts[0]);
      expect(demo.textContent).toContain(h.agentCard.done);
    } finally {
      vi.useRealTimers();
    }
  });

  it('speaks Spanish with the Spanish catalog', async () => {
    const es = getMessages('es').admin.home.agentCard;
    await mount(<AgentCard m={es} />);
    expect(host.textContent).toContain(es.title);
    expect(host.textContent).toContain(es.prompts[0]);
  });
});
