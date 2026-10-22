'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { t, type FormsMessages } from '@quill/shared';
import type { McpApp } from '@/components/mcp-logos';
import { APP_FRAMES } from './app-frames';
import './walkthrough.css';
import { Line, StepChip, Typed, at, type Delay } from './walk-kit';

type WalkMessages = FormsMessages['admin']['developers']['connect']['walkthrough'];

/** The apps set up in a terminal: their walkthrough replays the CLI. */
export const TERMINAL_APPS = ['claude-code', 'codex', 'openclaw', 'hermes'] as const;
export type TerminalApp = (typeof TERMINAL_APPS)[number];
type WalkApp = McpApp;

/**
 * How long each step's frame plays, per app, in ms. One frame per numbered
 * step of the guide, so the step list can follow the animation.
 */
export const WALK_DURATIONS: Record<WalkApp, readonly number[]> = {
  claude: [6000, 6000, 6500, 6500],
  chatgpt: [6000, 6500, 6500, 5500, 6500],
  cursor: [6500, 6500, 7000],
  'claude-code': [4800, 6000, 6000],
  codex: [4400, 5200, 6000],
  openclaw: [4400, 5200, 6000],
  hermes: [4400, 5200, 6000],
};

/** The size the frames are drawn at (16:9); the stage scales them to its width. */
const W = 640;
const H = 360;

/** A macOS terminal window: the title bar, then the shell on the CLI's own dark background. */
function Terminal({ title, bg, children }: { title: string; bg: string; children: ReactNode }) {
  return (
    <div
      className="absolute inset-0 flex flex-col overflow-hidden font-mono text-[11.5px] leading-[1.55] text-[#d4d4d4]"
      style={{ background: bg, fontFamily: 'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace' }}
    >
      <div className="flex h-7 shrink-0 items-center gap-1.5 bg-[#2b2b2b] px-3 font-sans text-[11px] text-[#9a9a9a]">
        <i className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
        <i className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
        <i className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
        <span className="flex-1 text-center">{title}</span>
        <span className="w-10" />
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden px-4 py-3">{children}</div>
    </div>
  );
}

/** The shell prompt the commands are typed at. */
function Shell({ children, d = 0 }: { children: ReactNode } & Delay) {
  return (
    <Line d={d}>
      <span className="text-[#5fd7af]">~/studio</span> <span className="text-[#d4d4d4]">%</span> {children}
    </Line>
  );
}

function FormsList({ m, d, bullet, color }: { m: WalkMessages; d: number; bullet: string; color: string }) {
  return (
    <>
      <Line d={d} className="mt-1">
        <span style={{ color }}>{bullet}</span> {m.answer.intro}
      </Line>
      {m.answer.forms.map((f, i) => (
        <Line key={f.name} d={d + 0.3 + i * 0.25} className="pl-4">
          <span className="text-[#808080]">- </span>
          <span className="font-semibold text-white">{f.name}</span>
          <span className="text-[#808080]">: {f.stat}</span>
        </Line>
      ))}
    </>
  );
}

/* ── Claude Code: orange welcome box, the rounded input, ⏺ and ⎿ ─────────── */

const CC_ORANGE = '#D77757';

function ClaudeCodeBanner({ m }: { m: WalkMessages }) {
  return (
    <div className="mb-2 rounded-md border px-3 py-1.5" style={{ borderColor: CC_ORANGE }}>
      <div>
        <span style={{ color: CC_ORANGE }}>✻</span> <span className="font-semibold text-white">{m.ui.ccWelcome}</span>
      </div>
      <div className="pl-4 text-[#808080] italic">{m.ui.ccHelp}</div>
      <div className="pl-4 text-[#808080]">cwd: ~/studio</div>
    </div>
  );
}

function ClaudeCodeInput({ children, d = 0 }: { children: ReactNode } & Delay) {
  return (
    <div className="wt-fade mt-2 rounded-md border border-[#5a5a5a] px-2.5 py-1" style={at(d)}>
      <span className="text-[#d4d4d4]">&gt; </span>
      {children}
    </div>
  );
}

function ClaudeCodeFrame({ step, m, prompt, snippets }: FrameProps) {
  const u = m.ui;
  if (step === 0) {
    return (
      <Terminal title="zsh" bg="#1e1e1e">
        <Shell>
          <Typed text={snippets.claudeCode} d={0.3} dur={1.8} />
        </Shell>
        <Line d={2.4} className="text-[#d4d4d4]">
          {t(u.ccAdded, { url: snippets.url })}
        </Line>
        <Line d={2.8} className="text-[#808080]">
          File modified: ~/.claude.json
        </Line>
      </Terminal>
    );
  }
  if (step === 1) {
    return (
      <Terminal title="claude" bg="#1e1e1e">
        <ClaudeCodeBanner m={m} />
        <ClaudeCodeInput>
          <Typed text="/mcp" d={0.4} dur={0.4} />
        </ClaudeCodeInput>
        <div className="wt-pop mt-2 rounded-md border border-[#5a5a5a] px-3 py-1.5" style={at(1.2)}>
          <div className="font-semibold text-white">{u.ccManage}</div>
          <div className="wt-hl mt-1 rounded-sm bg-[#2f3b4d] px-1" style={at(1.7)}>
            <span style={{ color: CC_ORANGE }}>❯</span> 1. dforms <span className="text-[#e5c07b]">△ {u.needsAuth}</span>
          </div>
          <div className="wt-fade mt-1 pl-2" style={at(2.3)}>
            <span className="wt-hl rounded-sm bg-[#2f3b4d] px-1" style={at(2.7)}>
              <span style={{ color: CC_ORANGE }}>❯</span> 1. {u.authenticate}
            </span>
          </div>
        </div>
        <Line d={3.3} className="mt-1 text-[#808080]">
          {u.ccBrowser}
        </Line>
        <Line d={4.4} className="text-[#4eba65]">
          ✔ {u.ccAuthOk}
        </Line>
      </Terminal>
    );
  }
  return (
    <Terminal title="claude" bg="#1e1e1e">
      <ClaudeCodeBanner m={m} />
      <Line d={0.1} className="mt-1 text-[#9a9a9a]">
        &gt; <Typed text={prompt} d={0.2} dur={1} />
      </Line>
      <Line d={1.5} className="mt-1">
        <span className="text-[#4eba65]">⏺</span> <span className="font-semibold text-white">dforms - list_forms</span>{' '}
        <span className="text-[#808080]">(MCP)</span>
      </Line>
      <FormsList m={m} d={2.4} bullet="⏺" color="#ffffff" />
      <ClaudeCodeInput d={0.1}>
        <span className="wt-caret" />
      </ClaudeCodeInput>
    </Terminal>
  );
}

/* ── Codex CLI: the >_ header box, › prompt, • Called and └ ───────────────── */

function CodexHeader({ m }: { m: WalkMessages }) {
  return (
    <div className="mb-2 inline-block rounded-md border border-[#4a4a4a] px-3 py-1.5">
      <div>
        <span className="text-[#9a9a9a]">&gt;_</span> <span className="font-semibold text-white">OpenAI Codex</span>{' '}
        <span className="text-[#808080]">(v0.46.0)</span>
      </div>
      <div className="text-[#808080]">{m.ui.codexModel}</div>
    </div>
  );
}

function CodexFrame({ step, m, prompt, snippets }: FrameProps) {
  const u = m.ui;
  if (step === 0) {
    return (
      <Terminal title="zsh" bg="#0d0d0d">
        <Shell>
          <Typed text={snippets.codexAdd} d={0.3} dur={1.4} />
        </Shell>
        <Line d={2.2}>{u.codexAdded}</Line>
      </Terminal>
    );
  }
  if (step === 1) {
    return (
      <Terminal title="zsh" bg="#0d0d0d">
        <Shell>{snippets.codexAdd}</Shell>
        <Line>{u.codexAdded}</Line>
        <Shell d={0.3}>
          <Typed text={snippets.codexLogin} d={0.5} dur={0.8} />
        </Shell>
        <Line d={1.7} className="text-[#9a9a9a]">
          {u.codexAuthorize}
        </Line>
        <Line d={3.8} className="text-[#4eba65]">
          {u.codexLoggedIn}
        </Line>
      </Terminal>
    );
  }
  return (
    <Terminal title="codex" bg="#0d0d0d">
      <CodexHeader m={m} />
      <Line d={0.2} className="mt-1">
        <span className="text-[#5fd7ff]">›</span> <Typed text={prompt} d={0.3} dur={1} />
      </Line>
      <Line d={1.5} className="mt-1">
        <span className="text-[#808080]">•</span> {u.called}{' '}
        <span className="font-semibold text-[#c678dd]">dforms.list_forms</span>
        <span className="text-[#808080]">({'{}'})</span>
      </Line>
      <FormsList m={m} d={2.4} bullet="•" color="#808080" />
      <Line d={0.1} className="absolute bottom-3 left-4 right-4 text-[#808080]">
        <span className="text-[#5fd7ff]">›</span> <span className="wt-caret" />
      </Line>
    </Terminal>
  );
}

/* ── OpenClaw: its CLI, with the lobster red ───────────────────────────────── */

const CLAW_RED = '#FF4D4D';

function OpenClawFrame({ step, m, prompt, snippets }: FrameProps) {
  const u = m.ui;
  if (step === 0) {
    return (
      <Terminal title="zsh" bg="#111214">
        <Shell>
          <Typed text={snippets.openclawSet} d={0.3} dur={1.8} />
        </Shell>
        <Line d={2.6}>
          <span style={{ color: CLAW_RED }}>✓</span> {u.ocSaved}
        </Line>
      </Terminal>
    );
  }
  if (step === 1) {
    return (
      <Terminal title="zsh" bg="#111214">
        <Shell>
          <Typed text={snippets.openclawLogin} d={0.3} dur={0.8} />
        </Shell>
        <Line d={1.5} className="text-[#9a9a9a]">
          {u.ocLogin}
        </Line>
        <Line d={3.4}>
          <span style={{ color: CLAW_RED }}>✓</span> {u.ocLoggedIn}
        </Line>
      </Terminal>
    );
  }
  return (
    <Terminal title="openclaw" bg="#111214">
      <Line className="mb-2 font-semibold">
        <span style={{ color: CLAW_RED }}>🦞 OpenClaw</span>
      </Line>
      <Line d={0.1}>
        <span style={{ color: CLAW_RED }}>❯</span> <Typed text={prompt} d={0.2} dur={1} />
      </Line>
      <Line d={1.5} className="mt-1 text-[#9a9a9a]">
        ↳ {u.called} <span className="text-[#00E5CC]">dforms.list_forms</span>
      </Line>
      <FormsList m={m} d={2.1} bullet="●" color={CLAW_RED} />
    </Terminal>
  );
}

/* ── Hermes: its CLI, in Nous Research's gold ─────────────────────────────── */

const HERMES_GOLD = '#E8B04B';

function HermesFrame({ step, m, prompt, snippets }: FrameProps) {
  const u = m.ui;
  if (step === 0) {
    return (
      <Terminal title="zsh" bg="#111214">
        <Shell>
          <Typed text="hermes config edit" d={0.3} dur={0.8} />
        </Shell>
        {snippets.hermesConfig.split('\n').map((line, i) => (
          <Line key={i} d={1.4 + i * 0.35} className="whitespace-pre text-[#9cdcfe]">
            {line}
          </Line>
        ))}
        <Line d={3.2}>
          <span style={{ color: HERMES_GOLD }}>✓</span> {u.hmSaved}
        </Line>
      </Terminal>
    );
  }
  if (step === 1) {
    return (
      <Terminal title="zsh" bg="#111214">
        <Shell>
          <Typed text={snippets.hermesLogin} d={0.3} dur={0.8} />
        </Shell>
        <Line d={1.5} className="text-[#9a9a9a]">
          {u.hmLogin}
        </Line>
        <Line d={3.4}>
          <span style={{ color: HERMES_GOLD }}>✓</span> {u.hmLoggedIn}
        </Line>
      </Terminal>
    );
  }
  return (
    <Terminal title="hermes" bg="#111214">
      <Line className="mb-2 font-semibold">
        <span style={{ color: HERMES_GOLD }}>☤ Hermes Agent</span>
      </Line>
      <Line d={0.1}>
        <span style={{ color: HERMES_GOLD }}>❯</span> <Typed text={prompt} d={0.2} dur={1} />
      </Line>
      <Line d={1.5} className="mt-1 text-[#9a9a9a]">
        ↳ {u.called} <span className="text-[#00E5CC]">mcp_dforms_list_forms</span>
      </Line>
      <FormsList m={m} d={2.1} bullet="●" color={HERMES_GOLD} />
    </Terminal>
  );
}

interface FrameProps {
  step: number;
  m: WalkMessages;
  prompt: string;
  snippets: Snippets;
}

type Snippets = {
  url: string;
  claudeCode: string;
  codexAdd: string;
  codexLogin: string;
  openclawSet: string;
  openclawLogin: string;
  hermesConfig: string;
  hermesLogin: string;
  cursorJson: string;
};

const FRAMES: Record<WalkApp, (p: FrameProps) => ReactNode> = {
  claude: (p) => APP_FRAMES.claude({ step: p.step, m: p.m, prompt: p.prompt, url: p.snippets.url, cursorJson: p.snippets.cursorJson }),
  chatgpt: (p) => APP_FRAMES.chatgpt({ step: p.step, m: p.m, prompt: p.prompt, url: p.snippets.url, cursorJson: p.snippets.cursorJson }),
  cursor: (p) => APP_FRAMES.cursor({ step: p.step, m: p.m, prompt: p.prompt, url: p.snippets.url, cursorJson: p.snippets.cursorJson }),
  'claude-code': ClaudeCodeFrame,
  codex: CodexFrame,
  openclaw: OpenClawFrame,
  hermes: HermesFrame,
};

/**
 * The animated walkthrough above an app's steps, one frame per numbered step,
 * with this environment's URL and dForms as the connector. Claude, ChatGPT and
 * Cursor are redrawn in code after each app's own interface (app-frames.tsx);
 * Claude Code, Codex and OpenClaw replay the real CLI (its colors, glyphs and
 * prompts). No video. The parent owns `step`, so the step list lights the one
 * playing, and the corner chip names it.
 *
 * With reduced motion the parent passes the last step and nothing moves: each
 * frame is written in its final state (see walkthrough.css).
 */
export function Walkthrough({
  app,
  step,
  captions,
  paused,
  userPaused,
  reduced,
  onToggle,
  label,
  playLabel,
  pauseLabel,
  m,
  prompt,
  snippets,
}: {
  app: WalkApp;
  step: number;
  /** The guide's own title for each step, shown in the frame's corner. */
  captions: readonly string[];
  /** Held still by a click on the frame or on the pause button, never by the pointer passing over. */
  paused: boolean;
  userPaused: boolean;
  reduced: boolean;
  onToggle: () => void;
  label: string;
  playLabel: string;
  pauseLabel: string;
  m: WalkMessages;
  prompt: string;
  snippets: FrameProps['snippets'];
}) {
  const box = useRef<HTMLDivElement>(null);
  // One pixel over the stage's width, so subpixel rounding never leaves a band
  // of background at the right or bottom edge (the stage clips the overflow).
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setScale(((entry?.contentRect.width ?? W) + 1) / W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const durations = WALK_DURATIONS[app];
  const Frame = FRAMES[app];
  return (
    <figure className="m-0" data-testid="mcp-walkthrough" data-kind={(TERMINAL_APPS as readonly string[]).includes(app) ? 'terminal' : 'app'} data-app={app} data-step={step}>
      <div
        ref={box}
        role="img"
        aria-label={label}
        className="wt-stage relative w-full cursor-pointer overflow-hidden rounded-xl bg-[#111] ring-1 ring-border"
        style={{ aspectRatio: `${W} / ${H}` }}
        data-paused={paused || undefined}
        onClick={reduced ? undefined : onToggle}
      >
        <div aria-hidden className="absolute left-0 top-0 origin-top-left" style={{ width: W, height: H, transform: `scale(${scale})` }}>
          <div key={`${app}-${step}`} className="absolute inset-0">
            <Frame step={step} m={m} prompt={prompt} snippets={snippets} />
            {captions[step] ? (
              <StepChip n={step + 1} title={captions[step]!} low={(TERMINAL_APPS as readonly string[]).includes(app)} />
            ) : null}
          </div>
        </div>
      </div>
      <Progress
        segments={durations.length}
        step={step}
        fill={reduced ? 'all' : { durationMs: durations[step] ?? 4000, paused }}
        keyId={`${app}-${step}`}
        toggle={reduced ? null : { paused: userPaused, onToggle, playLabel, pauseLabel }}
      />
    </figure>
  );
}

/**
 * The step bar under a walkthrough: past steps full, the current one filling
 * (by CSS over its duration), and the
 * play/pause button.
 */
export function Progress({
  segments,
  step,
  fill,
  keyId,
  toggle,
}: {
  segments: number;
  step: number;
  fill: 'all' | { durationMs: number; paused: boolean };
  keyId: string;
  toggle: { paused: boolean; onToggle: () => void; playLabel: string; pauseLabel: string } | null;
}) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="flex flex-1 gap-1" aria-hidden>
        {Array.from({ length: segments }, (_, i) => (
          <span key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            {fill === 'all' || i < step ? (
              <span className="block h-full w-full bg-signal-edge" />
            ) : i === step ? (
              <span
                key={keyId}
                className="wt-progress block h-full w-full bg-signal-edge"
                style={{ ['--dur' as string]: `${fill.durationMs}ms`, animationPlayState: fill.paused ? 'paused' : 'running' }}
              />
            ) : null}
          </span>
        ))}
      </div>
      {toggle ? (
        <button
          type="button"
          data-testid="mcp-walkthrough-toggle"
          onClick={toggle.onToggle}
          aria-pressed={toggle.paused}
          aria-label={toggle.paused ? toggle.playLabel : toggle.pauseLabel}
          title={toggle.paused ? toggle.playLabel : toggle.pauseLabel}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <i aria-hidden className={`pi ${toggle.paused ? 'pi-play' : 'pi-pause'}`} style={{ fontSize: 12 }} />
        </button>
      ) : null}
    </div>
  );
}

