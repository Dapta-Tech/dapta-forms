'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { t, type FormsMessages } from '@quill/shared';
import { AgentLogo } from '@/components/agent-logos';
import { FormsMark } from '@/components/brand/forms-logo';
import { MCP_APP_NAMES, type McpApp } from '@/components/mcp-logos';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { CONNECT_PATH } from './agent-banner';
import './agent-promo.css';

type CardMessages = FormsMessages['admin']['home']['agentCard'];

/** The apps the card cycles through, in the dforms.ai landing's order. */
const CARD_APPS: readonly McpApp[] = ['claude', 'chatgpt', 'claude-code', 'codex', 'cursor', 'openclaw', 'hermes'];

/**
 * One steady beat per prompt, whatever its length: it types in TYPE_TOTAL_MS,
 * the answer holds for HOLD_MS, it erases in ERASE_TOTAL_MS and the next one
 * starts BETWEEN_MS later. Every app gets the same time on screen.
 */
export const TYPE_TOTAL_MS = 1800;
export const HOLD_MS = 3400;
export const ERASE_TOTAL_MS = 420;
export const BETWEEN_MS = 380;
const TYPE_TICKS = 36;
const ERASE_TICKS = 12;

/** The logos float on one shared beat, a quarter of it apart, so the row moves evenly. */
const FLOAT_DUR = '4s';
const FLOAT: CSSProperties[] = CARD_APPS.map((_, i) => ({
  ['--dur' as string]: FLOAT_DUR,
  ['--delay' as string]: `${-(i * 4) / CARD_APPS.length}s`,
  ['--amp' as string]: i % 2 === 0 ? '5px' : '-5px',
  ['--tilt' as string]: i % 2 === 0 ? '1.4deg' : '-1.4deg',
}));

type Phase = 'typing' | 'done' | 'erasing';

/**
 * The typing loop, ported from the dforms.ai landing's prompt carousel
 * (`ag-hero.js`): each prompt types itself in, holds while the agent answers,
 * erases, and the next one starts in the next app. The clock only runs while
 * the card is on screen and the tab is visible. With reduced motion nothing
 * moves: the first prompt sits complete, with its answer.
 */
function usePromptLoop(prompts: readonly string[], reduced: boolean, visible: boolean) {
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(prompts[0]?.length ?? 0);
  const [phase, setPhase] = useState<Phase>('done');

  useEffect(() => {
    if (reduced || !visible || prompts.length === 0) return;
    const text = prompts[index] ?? '';
    let timer: ReturnType<typeof setTimeout>;
    const typeStep = Math.max(1, Math.ceil(text.length / TYPE_TICKS));
    const eraseStep = Math.max(1, Math.ceil(text.length / ERASE_TICKS));
    if (phase === 'typing') {
      if (shown < text.length)
        timer = setTimeout(() => setShown((n) => Math.min(text.length, n + typeStep)), TYPE_TOTAL_MS / TYPE_TICKS);
      else timer = setTimeout(() => setPhase('done'), 0);
    } else if (phase === 'done') {
      timer = setTimeout(() => setPhase('erasing'), HOLD_MS);
    } else if (shown > 0) {
      timer = setTimeout(() => setShown((n) => Math.max(0, n - eraseStep)), ERASE_TOTAL_MS / ERASE_TICKS);
    } else {
      timer = setTimeout(() => {
        setIndex((i) => (i + 1) % prompts.length);
        setPhase('typing');
      }, BETWEEN_MS);
    }
    return () => clearTimeout(timer);
  }, [prompts, index, shown, phase, reduced, visible]);

  if (reduced) return { index: 0, text: prompts[0] ?? '', phase: 'done' as Phase };
  return { index, text: (prompts[index] ?? '').slice(0, shown), phase };
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let query: MediaQueryList;
    try {
      query = window.matchMedia('(prefers-reduced-motion: reduce)');
    } catch {
      return;
    }
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener?.('change', sync);
    return () => query.removeEventListener?.('change', sync);
  }, []);
  return reduced;
}

/** Whether `el` is on screen and the tab is visible: the loop rests otherwise. */
function useOnScreen(ref: RefObject<HTMLElement | null>): boolean {
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setOnScreen(entry?.isIntersecting ?? true));
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  useEffect(() => {
    const sync = () => setTabVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  return onScreen && tabVisible;
}

/**
 * The home's big "Connect your agent" card. On the left, what connecting
 * gives and the way in; on the right, the dforms.ai landing's animation: a
 * prompt typed into Claude, Claude Code, Codex, Cursor or ChatGPT, and the
 * form the agent creates and publishes in dForms.
 */
export function AgentCard({ m }: { m: CardMessages }) {
  const box = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const visible = useOnScreen(box);
  // A click on the chat holds it still, another starts it again. The pointer
  // passing over never does: only a click pauses.
  const [paused, setPaused] = useState(false);
  const { index, text, phase } = usePromptLoop(m.prompts, reduced, visible && !paused);
  const app = CARD_APPS[index % CARD_APPS.length]!;
  const answered = phase === 'done';

  return (
    <section
      aria-labelledby="agent-card-title"
      data-testid="home-agent-card"
      className="mb-10 overflow-hidden rounded-2xl border border-border bg-card"
    >
      <div className="grid gap-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col justify-center p-6 sm:p-8">
          <p className="mb-3 inline-flex w-fit items-center gap-2 rounded-full border border-signal/40 bg-signal/10 px-3 py-1 text-xs font-semibold text-signal-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-signal" aria-hidden />
            {m.eyebrow}
          </p>
          <h2 id="agent-card-title" className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {m.title}
          </h2>
          <p className="mt-2 max-w-md text-muted-foreground">{m.body}</p>
          <ul className="mt-6 flex flex-wrap gap-2 sm:gap-3" aria-label={CARD_APPS.map((a) => MCP_APP_NAMES[a]).join(', ')}>
            {CARD_APPS.map((a, i) => (
              <li key={a} className="ap-float" style={FLOAT[i]}>
                <span
                  title={MCP_APP_NAMES[a]}
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-xl border bg-card text-foreground shadow-sm transition-all duration-300 sm:h-11 sm:w-11',
                    a === app && !reduced ? 'border-signal ring-4 ring-signal/20' : 'border-border',
                  )}
                >
                  <AgentLogo app={a} size={24} />
                </span>
              </li>
            ))}
          </ul>
          <Link
            href={CONNECT_PATH}
            data-testid="home-agent-card-cta"
            className={`${buttonVariants({ variant: 'default' })} mt-7 w-fit`}
          >
            {m.cta}
            <i aria-hidden className="pi pi-arrow-right" style={{ fontSize: 12 }} />
          </Link>
        </div>

        <div className="border-t border-border bg-panel p-4 sm:p-6 lg:border-l lg:border-t-0">
          <div
            ref={box}
            role="img"
            aria-label={m.label}
            data-testid="home-agent-demo"
            data-app={app}
            data-phase={phase}
            data-paused={paused || undefined}
            onClick={() => setPaused((p) => !p)}
            className="flex h-[440px] cursor-pointer flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm sm:h-[400px]"
          >
            <div aria-hidden className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
              <span key={app} className="ap-in flex items-center gap-2 text-sm font-semibold text-foreground">
                <AgentLogo app={app} size={18} />
                {MCP_APP_NAMES[app]}
              </span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-signal" />
                {m.connected}
              </span>
            </div>

            <div aria-hidden className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
              {text ? (
                <p className="ml-auto line-clamp-4 max-w-[90%] shrink-0 rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-sm text-foreground">
                  {text}
                  {phase === 'typing' ? <span className="ap-caret" /> : null}
                </p>
              ) : null}
              {answered ? (
                <div className="flex flex-col gap-2">
                  <p className="ap-in flex flex-nowrap gap-1.5 overflow-hidden" style={{ ['--d' as string]: '0.05s' }}>
                    {['create_form', 'set_scoring', 'publish_form'].map((tool) => (
                      <span
                        key={tool}
                        className="shrink-0 rounded-md border border-border bg-panel px-2 py-0.5 font-mono text-2xs text-muted-foreground"
                      >
                        dforms · {tool}
                      </span>
                    ))}
                  </p>
                  <div
                    className="ap-in rounded-xl border border-border bg-background p-3"
                    style={{ ['--d' as string]: '0.35s' }}
                  >
                    <div className="mb-2.5 flex items-center justify-between gap-2">
                      <FormsMark className="h-4 w-auto text-foreground" />
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-signal text-signal-foreground">
                        <i className="pi pi-check" style={{ fontSize: 9 }} />
                      </span>
                    </div>
                    <span className="mb-1.5 block h-2 w-2/3 rounded-full bg-muted" />
                    <span className="mb-3 block h-7 w-full rounded-md border border-border" />
                    <span className="block h-7 w-24 rounded-md bg-signal" />
                  </div>
                  <p className="ap-in flex items-center gap-1.5 text-sm text-foreground" style={{ ['--d' as string]: '0.6s' }}>
                    <i className="pi pi-check-circle text-signal-ink" style={{ fontSize: 13 }} />
                    {m.done}
                  </p>
                </div>
              ) : null}
            </div>

            <div aria-hidden className="border-t border-border p-3">
              <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm text-faint">
                <span className="flex-1 truncate">{t(m.placeholder, { app: MCP_APP_NAMES[app] })}</span>
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-background">
                  <i className="pi pi-arrow-up" style={{ fontSize: 11 }} />
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
