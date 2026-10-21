'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { FormsMessages } from '@quill/shared';
import { buttonVariants, Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { SETUP_AGENTS, SETUP_AGENT_NAMES, exportKeyCommand, type SetupAgent } from '@/lib/developer-skill/agent-setup';
// Types only: the builders run on the server, where the MCP address is read.
import type { McpSnippets } from '@/lib/developer-skill/mcp-connect';
import { CodePanel, rich, type CopyLabels } from './docs/code-panel';

type GuideMessages = FormsMessages['admin']['developers']['guide'];

/** Per-browser memory of the guide: a convenience, never a source of truth. */
const AGENT_KEY = 'dforms.mcp.agent';

const HINT_KEY: Record<SetupAgent, keyof GuideMessages['mcpHint']> = {
  'claude-code': 'claudeCode',
  codex: 'codex',
  cursor: 'cursor',
};

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the guide works the same, it only forgets.
  }
}

/**
 * The three steps that connect an agent to this workspace through the dForms
 * MCP server: create a key, connect the agent (the key in the environment,
 * then the MCP entry for that agent), ask it for something. It sits above the
 * key list and opens the same create dialog, so there is one way to make a key.
 *
 * Every snippet names the `DFORMS_API_KEY` variable, never a key, and comes
 * from the server already built for this environment's MCP address (`mcp`);
 * with no public address it is null and the guide says so. The skill zip stays
 * below, for an agent without MCP.
 *
 * A step shows as done from what the page can know: the caller has a key, one
 * of the listed keys has been used. None of that blocks a step.
 */
export function SetupGuide({
  m,
  copy,
  mcp,
  skill,
  createLabel,
  hasKey,
  agentConnected,
  onCreate,
}: {
  m: GuideMessages;
  copy: CopyLabels;
  mcp: McpSnippets | null;
  skill: {
    available: boolean;
    href: string;
    button: string;
    unavailable: string;
  };
  createLabel: string;
  hasKey: boolean;
  agentConnected: boolean;
  onCreate: () => void;
}) {
  const [agent, setAgent] = useState<SetupAgent>('claude-code');
  useEffect(() => {
    const stored = readStored(AGENT_KEY);
    if (stored && (SETUP_AGENTS as readonly string[]).includes(stored)) setAgent(stored as SetupAgent);
  }, []);

  const pickAgent = (next: SetupAgent) => {
    setAgent(next);
    writeStored(AGENT_KEY, next);
  };

  return (
    <section
      aria-labelledby="setup-guide-title"
      data-testid="setup-guide"
      className="mb-10 rounded-xl border border-border bg-card p-5 sm:p-6"
    >
      <h2 id="setup-guide-title" className="text-lg font-semibold text-foreground">
        {m.title}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{m.intro}</p>

      <ol className="mt-6 flex flex-col">
        <Step n={1} title={m.keyTitle} done={hasKey} doneLabel={m.stepDone} testId="setup-step-key">
          <p className="text-sm text-muted-foreground">{hasKey ? m.keyDone : m.keyBody}</p>
          <div className="mt-3">
            <Button variant={hasKey ? 'soft' : 'default'} data-testid="setup-create-key" onClick={onCreate}>
              <i aria-hidden className="pi pi-plus" style={{ fontSize: 13 }} />
              {createLabel}
            </Button>
          </div>
        </Step>

        <Step n={2} title={m.agentTitle} done={agentConnected} doneLabel={m.stepDone} testId="setup-step-agent">
          <p className="mb-3 text-sm text-muted-foreground">{agentConnected ? m.agentDone : m.agentBody}</p>
          <AgentTabs m={m} copy={copy} mcp={mcp} agent={agent} onPick={pickAgent} />
        </Step>

        <Step n={3} title={m.tryTitle} done={false} doneLabel={m.stepDone} last testId="setup-step-try">
          <p className="mb-2 text-sm text-muted-foreground">{m.promptHint}</p>
          <CodePanel
            label={SETUP_AGENT_NAMES[agent]}
            code={m.prompt}
            language="text"
            copyLabel={m.copyPrompt}
            m={copy}
            wrap
            testId="setup-prompt"
          />
          <p className="mt-4 flex gap-2 text-xs text-muted-foreground" data-testid="setup-chat-note">
            <i aria-hidden className="pi pi-info-circle mt-px shrink-0" style={{ fontSize: 12 }} />
            <span>{m.chatNote}</span>
          </p>
        </Step>
      </ol>

      <div data-testid="setup-skill" className="mt-6 border-t border-border pt-5">
        <h3 className="text-sm font-semibold text-foreground">{m.skillTitle}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{m.skillBody}</p>
        <div className="mt-3">
          {skill.available ? (
            <a
              href={skill.href}
              download
              data-testid="api-keys-skill-download"
              className={buttonVariants({ variant: 'soft' })}
            >
              <i aria-hidden className="pi pi-download" style={{ fontSize: 14 }} />
              {skill.button}
            </a>
          ) : (
            <p data-testid="api-keys-skill-unavailable" className="text-sm text-muted-foreground">
              {skill.unavailable}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/** One numbered step, with the rail that joins it to the next. */
function Step({
  n,
  title,
  done,
  doneLabel,
  last,
  testId,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  doneLabel: string;
  last?: boolean;
  testId: string;
  children: ReactNode;
}) {
  return (
    <li data-testid={testId} data-done={done || undefined} className="relative flex min-w-0 gap-4">
      <div className="flex shrink-0 flex-col items-center">
        <span
          aria-hidden
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
            done ? 'bg-signal text-signal-foreground' : 'border border-border bg-background text-foreground',
          )}
        >
          {done ? <i className="pi pi-check" style={{ fontSize: 11 }} /> : n}
        </span>
        {last ? null : <span aria-hidden className="mt-1 w-px flex-1 bg-border" />}
      </div>
      <div className={cn('min-w-0 flex-1', last ? 'pb-0' : 'pb-7')}>
        <h3 className="pt-0.5 text-sm font-semibold text-foreground">
          {title}
          {done ? <span className="sr-only"> ({doneLabel})</span> : null}
        </h3>
        <div className="mt-1">{children}</div>
      </div>
    </li>
  );
}

/** Claude Code, Codex, Cursor: the key line, then the MCP entry in each agent's own form. */
function AgentTabs({
  m,
  copy,
  mcp,
  agent,
  onPick,
}: {
  m: GuideMessages;
  copy: CopyLabels;
  mcp: McpSnippets | null;
  agent: SetupAgent;
  onPick: (agent: SetupAgent) => void;
}) {
  const base = useId();
  const tabs = useRef<Record<SetupAgent, HTMLButtonElement | null>>({
    'claude-code': null,
    codex: null,
    cursor: null,
  });
  const tabId = (a: SetupAgent) => `${base}-tab-${a}`;
  const panelId = `${base}-panel`;

  const onKeyDown = (e: KeyboardEvent) => {
    const at = SETUP_AGENTS.indexOf(agent);
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (at + 1) % SETUP_AGENTS.length;
    else if (e.key === 'ArrowLeft') next = (at - 1 + SETUP_AGENTS.length) % SETUP_AGENTS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = SETUP_AGENTS.length - 1;
    if (next === null) return;
    e.preventDefault();
    const picked = SETUP_AGENTS[next]!;
    onPick(picked);
    tabs.current[picked]?.focus();
  };

  return (
    <div className="min-w-0">
      <div
        role="tablist"
        aria-label={m.agentsLabel}
        onKeyDown={onKeyDown}
        className="inline-flex max-w-full gap-1 overflow-x-auto rounded-lg border border-border bg-panel p-1"
      >
        {SETUP_AGENTS.map((a) => {
          const selected = a === agent;
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
              data-testid={`setup-agent-${a}`}
              onClick={() => onPick(a)}
              className={cn(
                'shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {SETUP_AGENT_NAMES[a]}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(agent)}
        data-testid="setup-agent-panel"
        data-agent={agent}
        className="mt-4 flex flex-col gap-5"
      >
        <SubStep label={`1. ${m.keyCommandLabel}`} hint={m.keyCommandHint}>
          <CodePanel
            label="bash"
            code={exportKeyCommand()}
            language="curl"
            copyLabel={m.copyCommand}
            m={copy}
            testId="setup-export"
          />
        </SubStep>
        <SubStep label={`2. ${m.mcpLabel}`} hint={mcp ? m.mcpHint[HINT_KEY[agent]] : ''}>
          {mcp === null ? (
            <p data-testid="setup-mcp-unavailable" className="text-sm text-muted-foreground">
              {m.mcpUnavailable}
            </p>
          ) : agent === 'cursor' ? (
            <div className="flex flex-col gap-3">
              <div>
                <a
                  href={mcp.cursorDeeplink}
                  data-testid="setup-cursor-deeplink"
                  className={buttonVariants({ variant: 'default' })}
                >
                  <i aria-hidden className="pi pi-external-link" style={{ fontSize: 13 }} />
                  {m.addToCursor}
                </a>
              </div>
              <p className="text-xs text-muted-foreground">{rich(m.cursorFileHint)}</p>
              <CodePanel
                label="mcp.json"
                code={mcp.cursorJson}
                language="json"
                copyLabel={m.copyCommand}
                m={copy}
                testId="setup-mcp-config"
              />
            </div>
          ) : (
            <CodePanel
              label={agent === 'codex' ? 'config.toml' : 'bash'}
              code={agent === 'codex' ? mcp.codexToml : mcp.claudeCode}
              language={agent === 'codex' ? 'text' : 'curl'}
              copyLabel={m.copyCommand}
              m={copy}
              testId="setup-mcp-config"
            />
          )}
        </SubStep>
      </div>
    </div>
  );
}

function SubStep({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium text-foreground">{label}</p>
      {hint ? <p className="mb-2 mt-0.5 text-xs text-muted-foreground">{rich(hint)}</p> : <div className="mb-2" />}
      {children}
    </div>
  );
}
