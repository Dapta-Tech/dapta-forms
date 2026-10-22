'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { t, type FormsMessages } from '@quill/shared';
import { AgentLogo } from '@/components/agent-logos';
import { MCP_APPS, MCP_APP_NAMES, type McpApp } from '@/components/mcp-logos';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
// Types only: the builders run on the server, where the MCP address is read.
import type { McpSnippets } from '@/lib/developer-skill/mcp-connect';
import { CodePanel, type CopyLabels } from './code-panel';
import { stepText } from './step-text';
import { WALK_DURATIONS, Walkthrough } from './walkthrough';

type ConnectMessages = FormsMessages['admin']['developers']['connect'];
type StepCopy = { title: string; body: string };

/** Per-browser memory of the picked app: a convenience, never a source of truth. */
const APP_KEY = 'dforms.mcp.app';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** Whether the person asked for less motion; follows the setting live. False on the server. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let query: MediaQueryList;
    try {
      query = window.matchMedia(REDUCED_MOTION);
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

function readStored(): string | null {
  try {
    return window.localStorage.getItem(APP_KEY);
  } catch {
    return null;
  }
}

function writeStored(value: string) {
  try {
    window.localStorage.setItem(APP_KEY, value);
  } catch {
    // Private mode or blocked storage: the guide works the same, it only forgets.
  }
}

/**
 * Where each app is opened from its first step. Claude's connectors page is
 * the one its docs link to; Claude Desktop answers `claude://` (documented
 * for a new chat, where the + menu starts the flow); ChatGPT has no
 * documented deep link to its apps settings, so its home.
 */
export const OPEN_LINKS = {
  claude: 'https://claude.ai/customize/connectors',
  claudeDesktop: 'claude://claude.ai/new',
  chatgpt: 'https://chatgpt.com/',
} as const;

/**
 * A phone or a computer, from the browser: a mobile user agent, or a coarse
 * pointer on a narrow screen. Computer on the server and until it is known,
 * so nothing a computer can do is hidden by mistake on first paint.
 */
export function useDevice(): 'phone' | 'desktop' {
  const [device, setDevice] = useState<'phone' | 'desktop'>('desktop');
  useEffect(() => {
    try {
      const ua = navigator.userAgent;
      const mobileUa = /iPhone|iPod|Android.+Mobile|Windows Phone|Mobile Safari/i.test(ua);
      const coarseNarrow = window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 768;
      setDevice(mobileUa || coarseNarrow ? 'phone' : 'desktop');
    } catch {
      setDevice('desktop');
    }
  }, []);
  return device;
}

/** How many numbered steps an app's walkthrough plays: one frame per step. */
export function stepCount(app: McpApp): number {
  return WALK_DURATIONS[app].length;
}

/** The guide's step titles for an app, for the walkthrough's corner chip. */
function captionsOf(m: ConnectMessages, app: McpApp): string[] {
  const key = { claude: 'claude', chatgpt: 'chatgpt', 'claude-code': 'claudeCode', codex: 'codex', cursor: 'cursor', openclaw: 'openclaw', hermes: 'hermes' } as const;
  return m.apps[key[app]].steps.map((s) => s.title);
}

/**
 * "Connect with your account": the recommended way in. Three benefits, a tab
 * per AI app with its official logo, then, full width, the app's animated
 * walkthrough (each app's interface redrawn in code with dForms as the
 * connector, or a replay of the real CLI), and under it the numbered
 * steps with the MCP URL and the commands in copy blocks. The step playing is
 * lit; clicking a step's number jumps the walkthrough there.
 *
 * `snippets` is built on the server for this environment's `MCP_PUBLIC_URL`.
 * The page renders this card only when the MCP takes a sign-in, so every
 * snippet connects with the URL alone: no key, no key variable.
 */
export function ConnectGuide({ m, snippets }: { m: ConnectMessages; snippets: McpSnippets }) {
  const [app, setApp] = useState<McpApp>('claude');
  const [step, setStep] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const reduced = useReducedMotion();
  const device = useDevice();
  useEffect(() => {
    const stored = readStored();
    if (stored && (MCP_APPS as readonly string[]).includes(stored)) setApp(stored as McpApp);
  }, []);
  const pick = (next: McpApp) => {
    setApp(next);
    setStep(0);
    writeStored(next);
  };

  // The walkthrough loops through the app's steps on a timer, one frame per
  // step; with reduced motion it rests on the last frame and lights no step.
  const lastStep = stepCount(app) - 1;
  const shown = reduced ? lastStep : Math.min(step, lastStep);
  // Only a click pauses it (on the frame or the button), never the pointer passing over.
  const paused = userPaused;
  useEffect(() => {
    if (reduced || paused) return;
    const timer = setTimeout(() => setStep((s) => (s >= lastStep ? 0 : s + 1)), WALK_DURATIONS[app][shown]);
    return () => clearTimeout(timer);
  }, [app, shown, lastStep, reduced, paused]);

  const jump = (i: number) => setStep(i);
  const active = reduced ? null : shown;
  const copy: CopyLabels = { copy: m.copy, copied: m.copied, copyFailed: m.copyFailed };
  const name = MCP_APP_NAMES[app];

  return (
    <section
      aria-labelledby="connect-signin-title"
      data-testid="mcp-connect"
      className="overflow-hidden rounded-2xl border border-border bg-card"
    >
      <div className="border-b border-border bg-signal/[0.07] px-5 py-5 sm:px-7 sm:py-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 id="connect-signin-title" className="text-lg font-semibold text-foreground">
            {m.signinTitle}
          </h2>
          <span
            data-testid="mcp-connect-recommended"
            className="pill-pulse inline-flex items-center gap-1 rounded-full bg-signal px-2.5 py-0.5 text-xs font-semibold text-[#0b4a28]"
          >
            <i aria-hidden className="pi pi-star-fill text-[#0b4a28]" style={{ fontSize: 10 }} />
            {m.recommended}
          </span>
        </div>
        <ul className="mt-5 grid gap-3 sm:grid-cols-3" data-testid="mcp-connect-benefits">
          <Benefit icon="pi-key" title={m.benefits.noKey.title} body={m.benefits.noKey.body} />
          <Benefit icon="pi-building" title={m.benefits.workspaces.title} body={m.benefits.workspaces.body} />
          <Benefit icon="pi-users" title={m.benefits.members.title} body={m.benefits.members.body} />
        </ul>
      </div>

      <div className="px-5 py-6 sm:px-7">
        <p className="mb-3 text-sm text-muted-foreground">{m.signinIntro}</p>
        <AppTabs label={m.appsLabel} app={app} onPick={pick}>
          <div className="flex flex-col gap-7">
            <Walkthrough
              app={app}
              step={shown}
              captions={captionsOf(m, app)}
              paused={paused}
              userPaused={userPaused}
              reduced={reduced}
              onToggle={() => setUserPaused((p) => !p)}
              label={t(m.media.terminalLabel, { app: name })}
              playLabel={m.media.play}
              pauseLabel={m.media.pause}
              m={m.walkthrough}
              prompt={m.prompt}
              snippets={snippets}
            />
            <AppSteps app={app} m={m} snippets={snippets} copy={copy} active={active} onStep={jump} device={device} />
          </div>
        </AppTabs>

        <p
          data-testid="mcp-connect-tip"
          className="mt-6 flex gap-3 rounded-xl border border-signal/40 bg-signal/[0.08] p-4 text-sm text-muted-foreground"
        >
          <i aria-hidden className="pi pi-check-circle mt-0.5 shrink-0 text-signal-ink" style={{ fontSize: 16 }} />
          <span>{stepText(m.tip)}</span>
        </p>
      </div>
    </section>
  );
}

function Benefit({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <li className="flex gap-3 rounded-xl border border-border bg-card p-3.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-signal/15 text-signal-ink">
        <i aria-hidden className={`pi ${icon}`} style={{ fontSize: 14 }} />
      </span>
      <span className="min-w-0 text-sm">
        <strong className="block font-semibold text-foreground">{title}</strong>
        <span className="text-muted-foreground">{body}</span>
      </span>
    </li>
  );
}

/**
 * One tab per app, each with its official logo. The strip scrolls sideways on
 * a narrow screen instead of wrapping, and the picked tab scrolls into view.
 */
function AppTabs({
  label,
  app,
  onPick,
  children,
}: {
  label: string;
  app: McpApp;
  onPick: (app: McpApp) => void;
  children: ReactNode;
}) {
  const base = useId();
  const tabs = useRef<Partial<Record<McpApp, HTMLButtonElement | null>>>({});
  const tabId = (a: McpApp) => `${base}-tab-${a}`;
  const panelId = `${base}-panel`;

  const onKeyDown = (e: KeyboardEvent) => {
    const at = MCP_APPS.indexOf(app);
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (at + 1) % MCP_APPS.length;
    else if (e.key === 'ArrowLeft') next = (at - 1 + MCP_APPS.length) % MCP_APPS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = MCP_APPS.length - 1;
    if (next === null) return;
    e.preventDefault();
    const picked = MCP_APPS[next]!;
    onPick(picked);
    tabs.current[picked]?.focus();
  };

  return (
    <div className="min-w-0">
      <div className="-mx-5 overflow-x-auto px-5 pb-1 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div
          role="tablist"
          aria-label={label}
          onKeyDown={onKeyDown}
          data-testid="mcp-app-tabs"
          className="flex w-max min-w-full gap-2"
        >
          {MCP_APPS.map((a) => {
            const selected = a === app;
            return (
              <button
                key={a}
                ref={(el) => {
                  tabs.current[a] = el;
                }}
                type="button"
                role="tab"
                id={tabId(a)}
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                data-testid={`mcp-app-${a}`}
                onClick={(e) => {
                  onPick(a);
                  e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
                }}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected
                    ? 'border-signal bg-signal/10 text-foreground shadow-sm'
                    : 'border-border bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-lg border text-foreground',
                    selected ? 'border-signal/40 bg-card' : 'border-border bg-panel',
                  )}
                >
                  <AgentLogo app={a} size={16} />
                </span>
                {MCP_APP_NAMES[a]}
              </button>
            );
          })}
        </div>
      </div>
      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(app)}
        data-testid="mcp-app-panel"
        data-app={app}
        className="mt-5"
      >
        {children}
      </div>
    </div>
  );
}

/** The numbered steps of one app, each with its copy block where the app asks for one. */
function AppSteps({
  app,
  m,
  snippets,
  copy,
  active,
  onStep,
  device,
}: {
  app: McpApp;
  m: ConnectMessages;
  snippets: McpSnippets;
  copy: CopyLabels;
  device: 'phone' | 'desktop';
  /** The step the walkthrough is on, or null when nothing plays. */
  active: number | null;
  /** Jump the walkthrough to a step. */
  onStep: (i: number) => void;
}) {
  const url = (
    <CodePanel label={m.urlLabel} code={snippets.url} language="text" copyLabel={m.copyUrl} m={copy} wrap testId="mcp-url" />
  );
  const prompt = (
    <CodePanel label={m.promptLabel} code={m.prompt} language="text" copyLabel={m.copyPrompt} m={copy} wrap testId="mcp-prompt" />
  );
  const command = (code: string, testId: string) => (
    <CodePanel label="bash" code={code} language="curl" copyLabel={m.copyCommand} m={copy} wrap testId={testId} />
  );
  const phone = device === 'phone';
  const phoneNote = (
    <p data-testid="mcp-phone-note" className="flex gap-2 rounded-lg border border-border bg-panel px-3 py-2 text-sm text-muted-foreground">
      <i aria-hidden className="pi pi-desktop mt-0.5 shrink-0" style={{ fontSize: 13 }} />
      {t(m.open.phoneNote, { app: MCP_APP_NAMES[app] })}
    </p>
  );
  // The first step of a terminal app: one click copies the add command; on a phone, the note instead.
  const firstCommand = (code: string, testId: string) => (
    <div className="flex flex-col gap-3">
      {phone ? (
        phoneNote
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <CopyCommandButton code={code} label={m.open.copyCommand} copied={m.open.copied} testId={`${testId}-big-copy`} />
          <span className="text-sm text-muted-foreground">{m.open.pasteHint}</span>
        </div>
      )}
      {command(code, testId)}
    </div>
  );

  let steps: { copy: StepCopy; extra?: ReactNode }[];
  let note: string | null = null;
  switch (app) {
    case 'claude': {
      const s = m.apps.claude.steps;
      steps = [
        {
          copy: s[0]!,
          extra: (
            <div className="flex flex-wrap gap-2">
              <OpenLink href={OPEN_LINKS.claude} label={m.open.claude} app="claude" testId="mcp-open-claude" external />
              {phone ? null : (
                <OpenLink href={OPEN_LINKS.claudeDesktop} label={m.open.claudeDesktop} app="claude" testId="mcp-open-claude-desktop" soft />
              )}
            </div>
          ),
        },
        { copy: s[1]!, extra: url },
        { copy: s[2]! },
        { copy: s[3]!, extra: prompt },
      ];
      break;
    }
    case 'chatgpt': {
      const s = m.apps.chatgpt.steps;
      steps = [
        { copy: s[0]!, extra: <OpenLink href={OPEN_LINKS.chatgpt} label={m.open.chatgpt} app="chatgpt" testId="mcp-open-chatgpt" external /> },
        { copy: s[1]!, extra: url },
        { copy: s[2]! },
        { copy: s[3]! },
        { copy: s[4]!, extra: prompt },
      ];
      break;
    }
    case 'claude-code': {
      const s = m.apps.claudeCode.steps;
      steps = [
        { copy: s[0]!, extra: firstCommand(snippets.claudeCode, 'mcp-claude-code-command') },
        { copy: s[1]! },
        { copy: s[2]!, extra: prompt },
      ];
      note = m.apps.claudeCode.note;
      break;
    }
    case 'codex': {
      const s = m.apps.codex.steps;
      steps = [
        { copy: s[0]!, extra: firstCommand(snippets.codexAdd, 'mcp-codex-add') },
        { copy: s[1]!, extra: command(snippets.codexLogin, 'mcp-codex-login') },
        { copy: s[2]!, extra: prompt },
      ];
      note = m.apps.codex.note;
      break;
    }
    case 'cursor': {
      const s = m.apps.cursor.steps;
      steps = [
        {
          copy: s[0]!,
          extra: (
            <div className="flex flex-col gap-3">
              {phone ? (
                phoneNote
              ) : (
                <div>
                  <a href={snippets.cursorDeeplink} data-testid="mcp-cursor-deeplink" className={buttonVariants({ variant: 'default' })}>
                    <AgentLogo app="cursor" size={15} />
                    {m.addToCursor}
                  </a>
                </div>
              )}
              <CodePanel
                label="mcp.json"
                code={snippets.cursorJson}
                language="json"
                copyLabel={m.copyConfig}
                m={copy}
                testId="mcp-cursor-json"
              />
            </div>
          ),
        },
        { copy: s[1]! },
        { copy: s[2]!, extra: prompt },
      ];
      break;
    }
    case 'openclaw': {
      const s = m.apps.openclaw.steps;
      steps = [
        { copy: s[0]!, extra: firstCommand(snippets.openclawSet, 'mcp-openclaw-set') },
        { copy: s[1]!, extra: command(snippets.openclawLogin, 'mcp-openclaw-login') },
        { copy: s[2]!, extra: prompt },
      ];
      break;
    }
    case 'hermes': {
      const s = m.apps.hermes.steps;
      steps = [
        {
          copy: s[0]!,
          extra: (
            <div className="flex flex-col gap-3">
              {phone ? (
                phoneNote
              ) : (
                <CopyCommandButton code={snippets.hermesConfig} label={m.copyConfig} copied={m.open.copied} testId="mcp-hermes-config-big-copy" />
              )}
              <CodePanel
                label="~/.hermes/config.yaml"
                code={snippets.hermesConfig}
                language="text"
                copyLabel={m.copyConfig}
                m={copy}
                testId="mcp-hermes-config"
              />
            </div>
          ),
        },
        { copy: s[1]!, extra: command(snippets.hermesLogin, 'mcp-hermes-login') },
        { copy: s[2]!, extra: prompt },
      ];
      break;
    }
  }

  return (
    <>
      <ol className="flex flex-col" data-testid={`mcp-steps-${app}`}>
        {steps.map((step, i) => (
          <Step
            key={`${app}-${i}`}
            n={i + 1}
            title={step.copy.title}
            last={i === steps.length - 1}
            active={active === i}
            onSelect={() => onStep(i)}
          >
            <p className="text-sm text-muted-foreground">{stepText(step.copy.body)}</p>
            {step.extra ? <div className="mt-3">{step.extra}</div> : null}
          </Step>
        ))}
      </ol>
      {note ? (
        <p data-testid="mcp-steps-note" className="flex gap-2 text-xs text-muted-foreground">
          <i aria-hidden className="pi pi-info-circle mt-px shrink-0" style={{ fontSize: 12 }} />
          <span>{stepText(note)}</span>
        </p>
      ) : null}
    </>
  );
}

function Step({
  n,
  title,
  last,
  active,
  onSelect,
  children,
}: {
  n: number;
  title: string;
  last: boolean;
  active: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <li data-active={active || undefined} data-testid="mcp-step" className="relative flex min-w-0 gap-4">
      <div className="flex shrink-0 flex-col items-center">
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onClick={onSelect}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-all duration-300',
            active
              ? 'bg-signal text-signal-foreground ring-4 ring-signal/25'
              : 'border border-border bg-background text-muted-foreground',
          )}
        >
          {n}
        </button>
        {last ? null : <span aria-hidden className="mt-1 w-px flex-1 bg-border" />}
      </div>
      <div
        className={cn(
          '-mt-1.5 min-w-0 flex-1 rounded-xl px-3 pt-1.5 transition-colors duration-300',
          active ? 'bg-signal/[0.08]' : 'bg-transparent',
          last ? 'pb-3' : 'mb-3 pb-3',
        )}
      >
        <h3 className="pt-0.5 text-sm font-semibold text-foreground">{title}</h3>
        <div className="mt-1">{children}</div>
      </div>
    </li>
  );
}

/** A button that opens the app where its first step happens, with the app's mark. */
function OpenLink({
  href,
  label,
  app,
  testId,
  external,
  soft,
}: {
  href: string;
  label: string;
  app: McpApp;
  testId: string;
  external?: boolean;
  soft?: boolean;
}) {
  return (
    <a
      href={href}
      data-testid={testId}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={buttonVariants({ variant: soft ? 'soft' : 'default' })}
    >
      <AgentLogo app={app} size={15} />
      {label}
      {external ? <i aria-hidden className="pi pi-external-link" style={{ fontSize: 11 }} /> : null}
    </a>
  );
}

/** The big "Copy command": one click puts the add command on the clipboard. */
function CopyCommandButton({ code, label, copied, testId }: { code: string; label: string; copied: string; testId: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setDone(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(false), 2000);
    } catch {
      setDone(false);
    }
  };
  return (
    <button type="button" data-testid={testId} data-state={done ? 'copied' : 'idle'} onClick={() => void onClick()} className={buttonVariants({ variant: 'default' })}>
      <i aria-hidden className={`pi ${done ? 'pi-check' : 'pi-copy'}`} style={{ fontSize: 13 }} />
      <span aria-live="polite">{done ? copied : label}</span>
    </button>
  );
}
