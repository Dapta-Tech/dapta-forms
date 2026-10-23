// @vitest-environment happy-dom
/**
 * The connector guide, driven like a person would: a tab per app in the
 * owner's order, the animated walkthrough full width above the numbered steps
 * (each app redrawn in code, or a CLI replay), the step playing lit and
 * named in the frame, dForms as the connector and the URL alone everywhere.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages, type Locale } from '@quill/shared';
import { mcpSnippets } from '@/lib/developer-skill/mcp-connect';
import { ConnectGuide } from './connect-guide';
import { WALK_DURATIONS } from './walkthrough';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const URL_ = 'https://mcp.forms.example.com/mcp';
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

const LISTING = 'https://claude.ai/directory/dforms';

async function mount(locale: Locale = 'en', directory: string | null = null) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const msgs = getMessages(locale).admin.developers.connect;
  await act(async () => root.render(<ConnectGuide m={msgs} snippets={mcpSnippets(URL_, directory)} />));
}
const pick = (app: string) => act(async () => $(`[data-testid="mcp-app-${app}"]`)!.click());
const walk = () => $('[data-testid="mcp-walkthrough"]')!;
const lit = () => [...document.querySelectorAll('[data-testid="mcp-step"]')].findIndex((li) => li.hasAttribute('data-active'));
const stepButton = (i: number) => document.querySelectorAll('[data-testid="mcp-step"]')[i]!.querySelector<HTMLElement>('button')!;

beforeEach(() => {
  window.localStorage.clear();
  motion(false);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('ConnectGuide', () => {
  it('orders the apps Claude, ChatGPT, Claude Code, Codex, Cursor, OpenClaw, Hermes, each with its official mark', async () => {
    await mount();
    const tabs = [...document.querySelectorAll('[role="tab"]')].map((b) => b.getAttribute('data-testid'));
    expect(tabs).toEqual(['claude', 'chatgpt', 'claude-code', 'codex', 'cursor', 'openclaw', 'hermes'].map((a) => `mcp-app-${a}`));
    for (const app of ['claude', 'chatgpt', 'claude-code', 'codex', 'cursor', 'openclaw', 'hermes']) {
      expect($(`[data-testid="mcp-app-${app}"] svg[data-agent="${app}"]`)).not.toBeNull();
    }
    expect($('[data-testid="mcp-app-claude"]')!.getAttribute('aria-selected')).toBe('true');
  });

  it('puts the walkthrough above the steps, full width', async () => {
    await mount();
    const panel = $('[data-testid="mcp-app-panel"]')!;
    const media = panel.querySelector('[data-testid="mcp-walkthrough"]')!;
    const steps = panel.querySelector('[data-testid="mcp-steps-claude"]')!;
    expect(media.compareDocumentPosition(steps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(media.parentElement!.className).not.toMatch(/grid-cols/);
  });

  it('animates every app in code, with no video anywhere, and names the step in the frame', async () => {
    await mount('es');
    const es = getMessages('es').admin.developers.connect;
    for (const app of ['claude', 'chatgpt', 'claude-code', 'codex', 'cursor', 'openclaw', 'hermes']) {
      await pick(app);
      expect(host.querySelector('video')).toBeNull();
      expect(walk().dataset.kind).toBe(['claude', 'chatgpt', 'cursor'].includes(app) ? 'app' : 'terminal');
    }
    await pick('claude');
    expect(walk().textContent).toContain(es.apps.claude.steps[0]!.title);
  });

  it('draws dForms as the connector in every frame of Claude, ChatGPT and Cursor, never Dapta', async () => {
    await mount();
    const seen: string[] = [];
    for (const app of ['claude', 'chatgpt', 'cursor'] as const) {
      await pick(app);
      for (let i = 0; i < WALK_DURATIONS[app].length; i++) {
        await act(async () => stepButton(i).click());
        expect(walk().dataset.step).toBe(String(i));
        const text = walk().textContent ?? '';
        expect(text, `${app} ${i}`).not.toMatch(/Dapta/i);
        seen.push(text);
      }
    }
    const all = seen.join(' ');
    expect(all).toContain('dForms');
    expect(all).toContain(URL_);
    // Real dForms tools, from the MCP catalog.
    expect(all).toContain('list_forms');
    // The neutral sign-in: email, then the code.
    const s = getMessages('en').admin.developers.connect.walkthrough.signIn;
    expect(all).toContain(s.title);
    expect(all).toContain(s.checkEmail);
  });

  it('gives each terminal app its commands, with the URL alone', async () => {
    await mount();
    await pick('claude-code');
    expect(walk().dataset.kind).toBe('terminal');
    expect($('[data-testid="mcp-claude-code-command"]')!.textContent).toContain(
      `claude mcp add --transport http --scope user dforms ${URL_}`,
    );
    await pick('codex');
    expect($('[data-testid="mcp-codex-add"]')!.textContent).toContain(`codex mcp add dforms --url ${URL_}`);
    expect($('[data-testid="mcp-codex-login"]')!.textContent).toContain('codex mcp login dforms');
    await pick('openclaw');
    expect($('[data-testid="mcp-openclaw-set"]')!.textContent).toContain(
      `openclaw mcp set dforms '{"url":"${URL_}","transport":"streamable-http","auth":"oauth"}'`,
    );
    expect($('[data-testid="mcp-openclaw-login"]')!.textContent).toContain('openclaw mcp login dforms');
    await pick('cursor');
    expect($('[data-testid="mcp-cursor-deeplink"]')!.getAttribute('href')).toMatch(
      /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=dforms&config=/,
    );
  });

  it('never shows a key, a key variable or the identity provider on any tab', async () => {
    await mount();
    for (const app of ['claude', 'chatgpt', 'claude-code', 'codex', 'cursor', 'openclaw', 'hermes']) {
      await pick(app);
      expect(host.textContent).not.toMatch(/DFORMS_API_KEY|Bearer|dforms_[A-Za-z0-9]|Dapta/);
    }
  });

  it('loops a walkthrough one frame per step, lights it, and jumps on a click', async () => {
    vi.useFakeTimers();
    try {
      await mount();
      const d = WALK_DURATIONS.claude;
      expect(walk().dataset.step).toBe('0');
      expect(lit()).toBe(0);
      await act(async () => void vi.advanceTimersByTime(d[0]!));
      expect(walk().dataset.step).toBe('1');
      expect(lit()).toBe(1);
      for (const ms of d.slice(1)) await act(async () => void vi.advanceTimersByTime(ms));
      expect(walk().dataset.step).toBe('0');
      await act(async () => stepButton(2).click());
      expect(walk().dataset.step).toBe('2');
    } finally {
      vi.useRealTimers();
    }
  });

  it('pauses only on a click, on the frame or the button, never on the pointer passing over', async () => {
    vi.useFakeTimers();
    try {
      await mount();
      await pick('claude-code');
      const stage = walk().querySelector<HTMLElement>('[role="img"]')!;
      const d = WALK_DURATIONS['claude-code'];
      await act(async () => void stage.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
      await act(async () => void vi.advanceTimersByTime(d[0]!));
      expect(walk().dataset.step).toBe('1');
      await act(async () => stage.click());
      await act(async () => void vi.advanceTimersByTime(20000));
      expect(walk().dataset.step).toBe('1');
      expect($('[data-testid="mcp-walkthrough-toggle"]')!.getAttribute('aria-pressed')).toBe('true');
      await act(async () => $('[data-testid="mcp-walkthrough-toggle"]')!.click());
      await act(async () => void vi.advanceTimersByTime(d[1]!));
      expect(walk().dataset.step).toBe('2');
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens each app from its first step, fitted to a computer', async () => {
    await mount();
    expect($('[data-testid="mcp-open-claude"]')!.getAttribute('href')).toBe('https://claude.ai/customize/connectors');
    expect($('[data-testid="mcp-open-claude"]')!.getAttribute('target')).toBe('_blank');
    expect($('[data-testid="mcp-open-claude-desktop"]')!.getAttribute('href')).toBe('claude://claude.ai/new');
    await pick('chatgpt');
    expect($('[data-testid="mcp-open-chatgpt"]')!.getAttribute('href')).toBe('https://chatgpt.com/');
    await pick('cursor');
    expect($('[data-testid="mcp-cursor-deeplink"]')).not.toBeNull();
    for (const [app, id, code] of [
      ['claude-code', 'mcp-claude-code-command', `claude mcp add --transport http --scope user dforms ${URL_}`],
      ['codex', 'mcp-codex-add', `codex mcp add dforms --url ${URL_}`],
    ] as const) {
      await pick(app);
      const writeText = vi.fn(async () => undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      await act(async () => $(`[data-testid="${id}-big-copy"]`)!.click());
      expect(writeText).toHaveBeenCalledWith(code);
      expect($(`[data-testid="${id}-big-copy"]`)!.dataset.state).toBe('copied');
    }
    expect($('[data-testid="mcp-phone-note"]')).toBeNull();
  });

  it('on a phone, keeps the web links and swaps what needs a computer for a note', async () => {
    const ua = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent');
    Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile Safari', configurable: true });
    try {
      await mount();
      expect($('[data-testid="mcp-open-claude"]')).not.toBeNull();
      expect($('[data-testid="mcp-open-claude-desktop"]')).toBeNull();
      await pick('chatgpt');
      expect($('[data-testid="mcp-open-chatgpt"]')).not.toBeNull();
      await pick('cursor');
      expect($('[data-testid="mcp-cursor-deeplink"]')).toBeNull();
      expect($('[data-testid="mcp-phone-note"]')!.textContent).toContain('Cursor');
      await pick('codex');
      expect($('[data-testid="mcp-codex-add-big-copy"]')).toBeNull();
      expect($('[data-testid="mcp-phone-note"]')!.textContent).toContain('Codex');
    } finally {
      if (ua) Object.defineProperty(window.navigator, 'userAgent', ua);
      else delete (window.navigator as { userAgent?: string }).userAgent;
    }
  });

  it('shows the finished last frame and lights no step with reduced motion', async () => {
    motion(true);
    await mount();
    await pick('openclaw');
    expect(walk().dataset.step).toBe(String(WALK_DURATIONS.openclaw.length - 1));
    expect(lit()).toBe(-1);
  });

  it('remembers the picked app in this browser', async () => {
    await mount();
    await pick('cursor');
    expect(window.localStorage.getItem('dforms.mcp.app')).toBe('cursor');
    await act(async () => root.unmount());
    host.remove();
    await mount();
    expect($('[data-testid="mcp-app-cursor"]')!.getAttribute('aria-selected')).toBe('true');
  });
});

describe('ConnectGuide with the Claude directory listing', () => {
  const steps = (app: string) => [...document.querySelectorAll(`[data-testid="mcp-steps-${app}"] [data-testid="mcp-step"] h3`)].map((h) => h.textContent);

  it('leaves Claude and Claude Code exactly as before when the deployment has no listing', async () => {
    await mount();
    const c = getMessages('en').admin.developers.connect;
    expect(steps('claude')).toEqual(c.apps.claude.steps.map((s) => s.title));
    expect($('[data-testid="mcp-claude-directory"]')).toBeNull();
    expect($('[data-testid="mcp-claude-fallback"]')).toBeNull();
    expect($('[data-testid="mcp-open-claude"]')).not.toBeNull();
    await pick('claude-code');
    expect($('[data-testid="mcp-claude-code-directory"]')).toBeNull();
    expect($('[data-testid="mcp-steps-note"]')!.textContent).toContain('/mcp');
  });

  it('starts Claude at the listing, in a new tab, with the custom connector folded under the steps', async () => {
    await mount('en', LISTING);
    const d = getMessages('en').admin.developers.connect.apps.claudeDirectory;
    expect(steps('claude')).toEqual(d.steps.map((s) => s.title));
    const link = $('[data-testid="mcp-claude-directory"]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(LISTING);
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    // The custom connector path is still there, closed, with the URL to paste.
    const fallback = $('[data-testid="mcp-claude-fallback"]') as HTMLDetailsElement;
    expect(fallback.open).toBe(false);
    expect(fallback.textContent).toContain(d.fallbackTitle);
    expect(fallback.querySelector('[data-testid="mcp-url"]')!.textContent).toContain(URL_);
    expect($('[data-testid="mcp-open-claude"]')).toBeNull();
  });

  it('draws the listing in the walkthrough, one frame per step, dForms and never Dapta', async () => {
    await mount('es', LISTING);
    const d = getMessages('es').admin.developers.connect.apps.claudeDirectory;
    expect(d.steps).toHaveLength(WALK_DURATIONS.claude.length);
    const seen: string[] = [];
    for (let i = 0; i < WALK_DURATIONS.claude.length; i++) {
      await act(async () => stepButton(i).click());
      expect(walk().textContent).toContain(d.steps[i]!.title);
      expect(walk().textContent).not.toMatch(/Dapta/i);
      seen.push(walk().textContent ?? '');
    }
    expect(seen[0]).toContain('dForms');
    expect(seen[1]).toContain('claude.ai/directory/dforms');
    expect(seen[1]).toContain('Connect');
    expect(seen.join(' ')).not.toContain('Add custom connector');
  });

  it('tells Claude Code it may already have the connector, with the way to the listing, in place of the note', async () => {
    await mount('en', LISTING);
    await pick('claude-code');
    const c = getMessages('en').admin.developers.connect.apps.claudeCode;
    const card = $('[data-testid="mcp-claude-code-directory"]')!;
    expect(card.textContent).toContain(c.directoryTitle);
    expect(card.querySelector('a')!.getAttribute('href')).toBe(LISTING);
    expect(steps('claude-code')).toEqual(c.steps.map((s) => s.title));
    expect($('[data-testid="mcp-steps-note"]')).toBeNull();
  });

  it('keeps the listing button on a phone, where claude.ai opens too', async () => {
    const ua = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent');
    Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile Safari', configurable: true });
    try {
      await mount('en', LISTING);
      expect($('[data-testid="mcp-claude-directory"]')).not.toBeNull();
      await pick('claude-code');
      expect($('[data-testid="mcp-phone-note"]')).not.toBeNull();
      expect($('[data-testid="mcp-claude-code-directory"] a')).not.toBeNull();
    } finally {
      if (ua) Object.defineProperty(window.navigator, 'userAgent', ua);
      else delete (window.navigator as { userAgent?: string }).userAgent;
    }
  });
});
