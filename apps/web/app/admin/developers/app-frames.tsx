'use client';

import type { ReactNode } from 'react';
import { t, type FormsMessages } from '@quill/shared';
import { AgentLogo } from '@/components/agent-logos';
import { FormsMark } from '@/components/brand/forms-logo';
import { cn } from '@/lib/cn';
import { CHATGPT_UI as G, CLAUDE_UI as C, CURSOR_UI as K } from './app-ui';
import { AnswerTable, FormsTile, Pointer, Typed, at } from './walk-kit';

type WalkMessages = FormsMessages['admin']['developers']['connect']['walkthrough'];

export interface AppFrameProps {
  step: number;
  m: WalkMessages;
  prompt: string;
  url: string;
  cursorJson: string;
}

/** The dForms tools a connected app shows: real names from the MCP catalog. */
const SHOWN_TOOLS = ['list_forms', 'get_form', 'create_form', 'update_form', 'publish_form', 'list_responses'] as const;

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/* ── The dForms sign-in, as the apps open it in the browser ──────────────── */

/**
 * Log in to your account: email, then the 6-digit code by email, then back
 * in the app. Neutral, dForms only. `d` shifts the whole sequence.
 */
function SignIn({ m, app, url, d = 0 }: { m: WalkMessages; app: string; url: string; d?: number }) {
  const s = m.signIn;
  const code = ['4', '8', '2', '9', '1', '7'];
  return (
    <div className="wt-fade absolute inset-0 z-20 flex flex-col bg-[#141414] text-[#e8e8e8]" style={at(d)}>
      <div className="flex h-6 shrink-0 items-center gap-2 bg-[#202020] px-3 text-[8.5px] text-[#9a9a9a]">
        <span>‹ › ⟳</span>
        <span className="flex-1 truncate rounded bg-[#2b2b2b] px-2 py-0.5 font-mono">{host(url)}/oauth2/authorize</span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center">
        <FormsMark className="h-6 w-auto text-white" />
        <p className="mt-2 text-[13px] font-semibold">{s.title}</p>
        <div className="mt-3 w-[230px] rounded-xl border border-white/10 bg-[#1b1b1b] p-3.5">
          <p className="mb-1 text-[8.5px] text-[#9a9a9a]">{s.emailLabel}</p>
          <div className="flex h-7 items-center rounded-md border border-white/15 px-2 text-[10px]">
            <Typed text={s.email} d={d + 0.3} dur={0.8} />
          </div>
          <span className="wt-press mt-2 flex h-7 items-center justify-center rounded-md bg-[#3DDC84] text-[10px] font-semibold text-black" style={at(d + 1.3)}>
            {s.continue}
          </span>
          <div className="wt-fade mt-3 text-center" style={at(d + 1.8)}>
            <p className="text-[10px] font-semibold">{s.checkEmail}</p>
            <p className="mt-0.5 text-[8.5px] text-[#9a9a9a]">
              {s.codeSentTo} <span className="font-semibold text-white">{s.email}</span>
            </p>
            <div className="mt-2 flex justify-center gap-1">
              {code.map((digit, i) => (
                <span key={i} className="wt-pop flex h-7 w-6 items-center justify-center rounded-md border border-white/20 font-mono text-[11px]" style={at(d + 2.2 + i * 0.15)}>
                  {digit}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[7.5px] text-[#7a7a7a]">{s.noCode}</p>
          </div>
        </div>
      </div>
      <Pointer x={330} y={210} d={d + 0.9} fx={60} fy={60} />
      <div className="wt-pop absolute bottom-4 right-4 flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-[10px] font-medium text-black shadow-xl" style={at(d + 3.6)}>
        <FormsTile size={14} />
        {t(s.connected, { app })}
        <span className="text-[#16a34a]">✓</span>
      </div>
    </div>
  );
}

/* ── Claude ───────────────────────────────────────────────────────────────── */

const CL_BG = '#262624';
const CL_INPUT = '#30302e';
const CL_MENU = '#2b2a27';
const CL_LINE = 'rgba(255,255,255,0.09)';

function ClaudeComposer({ children, typed }: { children?: ReactNode; typed?: ReactNode }) {
  return (
    <div className="relative mx-auto w-[400px]">
      <div className="rounded-2xl border p-2.5" style={{ background: CL_INPUT, borderColor: CL_LINE }}>
        <p className="h-6 px-1 text-[10.5px] text-[#9b9890]">{typed ?? C.placeholder}</p>
        <div className="flex items-center justify-between">
          <span className="flex h-6 w-6 items-center justify-center rounded-md text-[13px] text-[#c2c0b6]">+</span>
          <span className="flex items-center gap-2 text-[9px] text-[#9b9890]">
            <span>
              {C.model} <span className="opacity-70">{C.effort}</span>
            </span>
            <span>{C.mode}</span>
          </span>
        </div>
      </div>
      {children}
    </div>
  );
}

function MenuRow({ children, hl, d, chevron, className }: { children: ReactNode; hl?: boolean; d?: number; chevron?: boolean; className?: string }) {
  return (
    <div
      className={cn('flex items-center justify-between rounded-md px-2 py-[3px]', hl && 'wt-hl bg-white/[0.07]', className)}
      style={hl ? at(d) : undefined}
    >
      <span className="flex flex-1 items-center gap-2">{children}</span>
      {chevron ? <span className="opacity-60">›</span> : null}
    </div>
  );
}

function Toggle({ on = true }: { on?: boolean }) {
  return (
    <span className={cn('relative h-3 w-5 rounded-full', on ? 'bg-[#2c84db]' : 'bg-white/15')}>
      <span className={cn('absolute top-0.5 h-2 w-2 rounded-full bg-white', on ? 'left-[10px]' : 'left-0.5')} />
    </span>
  );
}

function ClaudeFrame({ step, m, prompt, url }: AppFrameProps) {
  if (step === 0) {
    return (
      <div className="absolute inset-0 text-[10px] text-[#e5e3dc]" style={{ background: CL_BG }}>
        <div className="pt-[58px] text-center font-serif text-[19px] text-[#ebe9e2]">
          <span className="text-[#d97757]">✻</span> {C.greeting}
        </div>
        <div className="mt-3">
          <ClaudeComposer>
            <span className="wt-press absolute bottom-[10px] left-[10px] h-6 w-6 rounded-md" style={at(0.5)} />
            <div className="wt-pop absolute left-0 top-[92px] w-[150px] rounded-lg border p-1 shadow-2xl" style={{ ...at(0.8), background: CL_MENU, borderColor: CL_LINE }}>
              {C.menu.map((x) => (
                <MenuRow key={x}>{x}</MenuRow>
              ))}
              <div className="my-1 h-px bg-white/10" />
              <MenuRow chevron>{C.skills}</MenuRow>
              <MenuRow chevron hl d={1.5}>
                {C.connectors}
              </MenuRow>
              <MenuRow chevron>{C.designSystem}</MenuRow>
              <MenuRow>{C.addPlugins}</MenuRow>
            </div>
            <div className="wt-pop absolute left-[156px] top-[60px] w-[160px] rounded-lg border p-1 shadow-2xl" style={{ ...at(1.9), background: CL_MENU, borderColor: CL_LINE }}>
              <MenuRow chevron hl d={2.6}>
                + {C.addConnector}
              </MenuRow>
              <MenuRow>{C.manageConnectors}</MenuRow>
              <div className="my-1 h-px bg-white/10" />
              {C.apps.map((x) => (
                <MenuRow key={x} className="justify-between">
                  <span className="flex flex-1 items-center justify-between gap-2">
                    {x}
                    <Toggle />
                  </span>
                </MenuRow>
              ))}
              <div className="my-1 h-px bg-white/10" />
              <MenuRow chevron>{C.toolAccess}</MenuRow>
            </div>
            <div className="wt-pop absolute left-[322px] top-[60px] w-[130px] rounded-lg border p-1 shadow-2xl" style={{ ...at(3), background: CL_MENU, borderColor: CL_LINE }}>
              <MenuRow>{C.browseConnectors}</MenuRow>
              <MenuRow hl d={3.7}>
                ⋯ {C.addCustomConnector}
              </MenuRow>
            </div>
          </ClaudeComposer>
        </div>
        <Pointer x={130} y={160} d={0.1} out={1.1} />
        <Pointer x={190} y={250} d={1.1} fx={-60} fy={-80} out={2.2} />
        <Pointer x={300} y={146} d={2.2} fx={-100} fy={90} out={3.3} />
        <Pointer x={430} y={138} d={3.3} fx={-120} fy={0} />
      </div>
    );
  }
  if (step === 1) {
    return (
      <div className="absolute inset-0 text-[10px] text-[#e5e3dc]" style={{ background: CL_BG }}>
        <div className="absolute inset-0 bg-black/50" />
        <div className="wt-pop absolute left-1/2 top-[42px] w-[330px] -translate-x-1/2 rounded-xl border p-4 shadow-2xl" style={{ ...at(0.1), background: '#2a2927', borderColor: CL_LINE }}>
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold text-white">{C.addCustomConnector}</p>
            <span className="opacity-60">×</span>
          </div>
          <p className="mt-1.5 text-[9px] text-[#b8b5ab]">{C.dialogBody}</p>
          <div className="mt-2.5 flex h-6 items-center rounded-md border px-2" style={{ borderColor: CL_LINE, background: '#1f1e1d' }}>
            <Typed text="dForms" d={0.5} dur={0.5} />
          </div>
          <p className="mt-1 text-[8.5px] text-[#9b9890]">{C.shownInList}</p>
          <div className="mt-2 flex h-6 items-center rounded-md border border-[#5b8def] px-2 font-mono text-[9.5px]" style={{ background: '#1f1e1d' }}>
            <Typed text={url} d={1.3} dur={1.2} />
          </div>
          <p className="mt-1 text-[8.5px] text-[#9b9890]">{C.urlHint}</p>
          <p className="mt-2 text-[8.5px] text-[#9b9890]">{C.trust}</p>
          <div className="mt-3 flex justify-end gap-2">
            <span className="rounded-md border px-2.5 py-1" style={{ borderColor: CL_LINE }}>
              {C.cancel}
            </span>
            <span className="wt-press rounded-md bg-white px-2.5 py-1 font-semibold text-black" style={at(3.4)}>
              {C.continue}
            </span>
          </div>
        </div>
        <Pointer x={462} y={276} d={2.8} fx={-140} fy={-90} />
      </div>
    );
  }
  if (step === 2) {
    return (
      <div className="absolute inset-0 text-[10px] text-[#e5e3dc]" style={{ background: CL_BG }}>
        <div className="flex h-full flex-col items-center justify-center text-center">
          <p className="text-[14px] font-semibold text-white">{C.finishTitle}</p>
          <span className="wt-press mt-3 rounded-md bg-white px-3 py-1 font-semibold text-black" style={at(0.6)}>
            {C.continueConnecting}
          </span>
        </div>
        <Pointer x={330} y={196} d={0.1} out={1.1} />
        <SignIn m={m} app="Claude" url={url} d={1.1} />
      </div>
    );
  }
  return (
    <div className="absolute inset-0 text-[10.5px] text-[#e5e3dc]" style={{ background: CL_BG }}>
      <div className="mx-auto flex h-full w-[440px] flex-col py-4">
        <div className="flex-1 space-y-2.5 overflow-hidden">
          <p className="wt-fade ml-auto w-fit rounded-xl px-3 py-1.5" style={{ ...at(1.6), background: '#141413' }}>
            {prompt}
          </p>
          <p className="wt-fade flex items-center gap-1.5 text-[9.5px] text-[#9b9890]" style={at(2.2)}>
            <FormsTile size={12} /> {C.used} dForms <span className="font-mono">list_forms</span> ›
          </p>
          <AnswerTable a={m.answer} d={2.7} className="font-serif" />
        </div>
        <div className="rounded-2xl border px-3 py-2" style={{ background: CL_INPUT, borderColor: CL_LINE }}>
          <span className="text-[#9b9890]">{prompt.length ? <Typed text={prompt} d={0.2} dur={1} /> : C.reply}</span>
        </div>
      </div>
    </div>
  );
}

/* ── ChatGPT (desktop app, Work mode) ─────────────────────────────────────── */

const GP_BG = '#212121';
const GP_PANEL = '#303030';
const GP_LINE = 'rgba(255,255,255,0.08)';

function GptSidebar() {
  return (
    <div className="flex w-7 shrink-0 flex-col items-center gap-3 border-r pt-8 text-[#8e8e8e]" style={{ borderColor: GP_LINE }}>
      {['⌂', '◷', '▤', '◎', '⋯'].map((x) => (
        <span key={x} className="text-[10px]">
          {x}
        </span>
      ))}
    </div>
  );
}

function PluginsPage({ children, tab = 'public' }: { children?: ReactNode; tab?: 'public' | 'personal' }) {
  return (
    <div className="flex-1 px-8 pt-11">
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-semibold text-white">{G.plugins}</p>
        <span className="rounded-full bg-white px-2.5 py-0.5 text-[9px] font-semibold text-black">{G.add} ▾</span>
      </div>
      <p className="mt-1 text-[9.5px] text-[#b4b4b4]">{G.pluginsIntro}</p>
      <div className="mt-3 flex gap-2 text-[9.5px]">
        <span className={cn('rounded-full px-2.5 py-0.5', tab === 'public' ? 'bg-white/10 text-white' : 'text-[#b4b4b4]')}>{G.public}</span>
        <span className={cn('rounded-full px-2.5 py-0.5', tab === 'personal' ? 'bg-white/10 text-white' : 'text-[#b4b4b4]')}>{G.personal}</span>
      </div>
      {children}
    </div>
  );
}

function ChatGptFrame({ step, m, prompt, url }: AppFrameProps) {
  const shell = (body: ReactNode, extra?: ReactNode) => (
    <div className="absolute inset-0 flex text-[10px] text-[#ececec]" style={{ background: GP_BG }}>
      <GptSidebar />
      {body}
      {extra}
    </div>
  );
  if (step === 0) {
    return shell(
      <div className="relative flex-1">
        <div className="pt-[66px] text-center text-[17px] text-white">{G.title}</div>
        <div className="mx-auto mt-4 w-[400px] rounded-2xl p-2.5" style={{ background: GP_PANEL }}>
          <p className="h-6 px-1 text-[10.5px] text-[#9a9a9a]">{G.placeholder}</p>
          <div className="flex items-center justify-between text-[9px]">
            <span className="flex items-center gap-2">
              <span>+</span>
              <span className="text-[#f0883e]">⊘ {G.fullAccess}</span>
            </span>
            <span className="text-[#b4b4b4]">
              {G.model} <span className="opacity-60">{G.light}</span> ◉
            </span>
          </div>
        </div>
        <div className="mx-auto mt-1.5 flex w-[400px] gap-3 px-2 text-[9px] text-[#b4b4b4]">
          {G.chips.map((c, i) => (
            <span key={c} className={cn(i === 2 && 'wt-hl rounded bg-white/10 px-1 text-white')} style={i === 2 ? at(0.7) : undefined}>
              {c}
            </span>
          ))}
        </div>
        <div className="wt-pop absolute left-[240px] top-[205px] w-[150px] rounded-lg border p-1 shadow-2xl" style={{ ...at(1), background: '#2a2a2a', borderColor: GP_LINE }}>
          <div className="px-2 py-[3px] text-[#8e8e8e]">⌕ {G.searchPlugins}</div>
          {G.pluginMenu.map((x) => (
            <div key={x} className="px-2 py-[3px]">
              {x}
            </div>
          ))}
          <div className="my-1 h-px bg-white/10" />
          <div className="wt-hl flex justify-between rounded bg-white/10 px-2 py-[3px]" style={at(1.8)}>
            {G.connectPlugins} <span>›</span>
          </div>
        </div>
        <div className="wt-fade absolute inset-0 flex" style={{ ...at(2.6), background: GP_BG }}>
          <PluginsPage>
            <p className="mt-4 text-[10.5px] font-semibold">{G.imported}</p>
            {G.importedApps.map((a) => (
              <div key={a} className="flex items-center justify-between border-b py-1.5 text-[10px]" style={{ borderColor: GP_LINE }}>
                {a}
                <span className="text-[#b4b4b4]">{G.finishSetup}</span>
              </div>
            ))}
          </PluginsPage>
          <div className="wt-pop absolute right-8 top-[46px] rounded-lg border p-1 shadow-2xl" style={{ ...at(3.4), background: '#2a2a2a', borderColor: GP_LINE }}>
            <div className="wt-hl rounded bg-white/10 px-2.5 py-1" style={at(3.9)}>
              {G.createMcpApp}
            </div>
          </div>
        </div>
        <Pointer x={262} y={202} d={0.2} out={1.2} />
        <Pointer x={300} y={300} d={1.2} fx={-60} fy={-80} out={2.8} />
        <Pointer x={590} y={40} d={2.8} fx={-200} fy={200} out={3.6} />
        <Pointer x={560} y={72} d={3.6} fx={30} fy={-30} />
      </div>,
    );
  }
  if (step === 1) {
    return shell(
      <div className="relative flex-1">
        <PluginsPage />
        <div className="absolute inset-0 bg-black/50" />
        <div className="wt-pop absolute left-1/2 top-[14px] h-[330px] w-[340px] -translate-x-1/2 overflow-hidden rounded-xl border shadow-2xl" style={{ ...at(0.1), background: '#262626', borderColor: GP_LINE }}>
          <div className="wt-scroll p-4" style={at(2.6)}>
            <p className="text-[13px] font-semibold text-white">{G.newPlugin}</p>
            <p className="mt-2 text-[8.5px] text-[#9a9a9a]">
              <span className="mr-2 rounded bg-white/10 px-1.5 py-0.5 text-white">{G.chooseIcon}</span>
              {G.iconHint}
            </p>
            <p className="mt-2.5 text-[9px]">{G.name}</p>
            <div className="mt-1 flex h-6 items-center rounded-md border px-2" style={{ borderColor: GP_LINE, background: '#1e1e1e' }}>
              <Typed text="dForms" d={0.5} dur={0.5} />
            </div>
            <p className="mt-2 text-[9px]">{G.description}</p>
            <div className="mt-1 flex h-6 items-center rounded-md border px-2 text-[#777]" style={{ borderColor: GP_LINE, background: '#1e1e1e' }}>
              {G.descriptionPlaceholder}
            </div>
            <p className="mt-2 text-[9px]">{G.connection}</p>
            <p className="mt-0.5 flex gap-3 text-[8.5px]">
              <span className="text-white">{G.serverUrl}</span>
              <span className="text-[#9a9a9a]">{G.tunnel}</span>
            </p>
            <div className="mt-1 flex h-6 items-center rounded-md border border-[#5b8def] px-2 font-mono text-[9.5px]" style={{ background: '#1e1e1e' }}>
              <Typed text={url} d={1.2} dur={1.1} />
            </div>
            <p className="mt-2 text-[9px]">{G.authentication}</p>
            <div className="mt-1 flex h-6 items-center rounded-md border px-2" style={{ borderColor: GP_LINE, background: '#1e1e1e' }}>
              {G.oauth}
            </div>
            <div className="mt-2 rounded-md border px-2 py-1.5 text-[8.5px]" style={{ borderColor: GP_LINE }}>
              {G.advanced} <span className="float-right">›</span>
            </div>
            <div className="mt-2 rounded-md bg-[#3b1d1a] px-2 py-1.5 text-[8.5px] text-[#ffb4a8]">
              △ {G.risk} <span className="underline">{G.learnMore}</span>
            </div>
            <div className="mt-2 flex gap-2 rounded-md border px-2 py-1.5 text-[8.5px]" style={{ borderColor: GP_LINE }}>
              <span className="wt-check mt-0.5 flex h-3 w-3 shrink-0 items-center justify-center rounded-sm bg-white text-[8px] text-black" style={at(3.6)}>
                ✓
              </span>
              <span>
                <span className="font-semibold">{G.understand}</span>
                <br />
                <span className="text-[#9a9a9a]">{G.understandBody}</span>
              </span>
            </div>
            <div className="mt-2.5 flex justify-end">
              <span className="wt-press rounded-full bg-white px-3 py-1 font-semibold text-black" style={at(4.4)}>
                {G.create}
              </span>
            </div>
          </div>
        </div>
        <Pointer x={240} y={268} d={3.2} fx={60} fy={-80} out={4} />
        <Pointer x={470} y={318} d={4} fx={-200} fy={-40} />
      </div>,
    );
  }
  if (step === 2) {
    return shell(
      <div className="relative flex-1">
        <PluginsPage />
        <div className="absolute inset-0 bg-black/50" />
        <div className="wt-pop absolute left-1/2 top-[30px] w-[280px] -translate-x-1/2 rounded-xl border p-4 text-center shadow-2xl" style={{ ...at(0.1), background: '#262626', borderColor: GP_LINE }}>
          <div className="flex items-center justify-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-black">
              <AgentLogo app="chatgpt" size={18} />
            </span>
            <span className="text-[#777]">···</span>
            <FormsTile size={28} />
          </div>
          <p className="mt-2 text-[12px] font-semibold text-white">{G.connect} dForms</p>
          <div className="mt-2 space-y-1.5 text-left text-[8.5px]">
            <p>
              <span className="font-semibold text-white">{G.permissions}</span>
              <br />
              <span className="text-[#9a9a9a]">{G.permissionsBody}</span>
            </p>
            <p>
              <span className="font-semibold text-white">{G.inControl}</span>
              <br />
              <span className="text-[#9a9a9a]">{G.inControlBody}</span>
            </p>
          </div>
          <span className="wt-press mt-3 flex h-7 items-center justify-center rounded-full bg-white text-[10px] font-semibold text-black" style={at(1)}>
            {G.continueTo} dForms ↗
          </span>
        </div>
        <Pointer x={330} y={226} d={0.3} out={1.5} />
        <SignIn m={m} app="ChatGPT" url={url} d={1.5} />
      </div>,
    );
  }
  if (step === 3) {
    return shell(
      <div className="relative flex-1">
        <PluginsPage tab="personal">
          <p className="mt-4 text-[10.5px] font-semibold">{G.createdByYou}</p>
          <div className="wt-hl mt-2 flex items-center justify-between rounded-lg bg-white/[0.06] px-2 py-2" style={at(0.9)}>
            <span className="flex items-center gap-2">
              <FormsTile size={20} />
              <span>
                <span className="font-semibold">dForms</span>
                <br />
                <span className="text-[8.5px] text-[#9a9a9a]">dForms</span>
              </span>
            </span>
            <span className="wt-press rounded-full bg-white px-2.5 py-0.5 text-[9px] font-semibold text-black" style={at(1.6)}>
              {G.installPlugin}
            </span>
          </div>
        </PluginsPage>
        <div className="wt-pop absolute left-1/2 top-[100px] w-[260px] -translate-x-1/2 rounded-lg border p-3 shadow-2xl" style={{ ...at(2.4), background: '#2c2c2c', borderColor: GP_LINE }}>
          <p className="text-[11px] font-semibold text-white">{G.openTitle}</p>
          <p className="mt-1 text-[8.5px] text-[#b4b4b4]">{G.openBody}</p>
          <div className="mt-2.5 flex justify-end gap-2 text-[9px]">
            <span className="rounded-md bg-white/10 px-2 py-0.5">{G.cancel}</span>
            <span className="wt-press rounded-md bg-[#3d7cf5] px-2 py-0.5 font-semibold text-white" style={at(3.2)}>
              {G.openChatGPT}
            </span>
          </div>
        </div>
        <div className="wt-pop absolute bottom-4 right-4 rounded-lg bg-white px-3 py-1.5 text-[10px] font-medium text-black shadow-xl" style={at(4)}>
          <FormsTile size={12} className="mr-1.5 align-middle" /> dForms · {G.installed} ✓
        </div>
        <Pointer x={110} y={70} d={0.1} fx={60} fy={60} out={1} />
        <Pointer x={575} y={108} d={1} fx={-300} fy={0} out={2.7} />
        <Pointer x={410} y={168} d={2.7} fx={150} fy={-60} />
      </div>,
    );
  }
  return shell(
    <div className="relative flex flex-1">
      <div className="flex flex-1 flex-col px-8 py-4">
        <div className="flex-1 space-y-2.5 overflow-hidden">
          <p className="wt-fade ml-auto w-fit rounded-2xl px-3 py-1.5" style={{ ...at(1.6), background: GP_PANEL }}>
            <span className="mr-1 text-[#6ea8ff]">dForms</span>
            {prompt}
          </p>
          <p className="wt-fade text-[9.5px] text-[#9a9a9a]" style={at(2.1)}>
            {G.working} ›
          </p>
          <p className="wt-fade flex items-center gap-1.5 text-[9.5px] text-[#9a9a9a]" style={at(2.4)}>
            ⌘ <span className="font-mono">list_forms</span>
          </p>
          <AnswerTable a={m.answer} d={2.9} />
        </div>
        <div className="flex items-center gap-2 rounded-2xl px-3 py-2" style={{ background: GP_PANEL }}>
          <span className="rounded bg-[#3d7cf5]/20 px-1.5 text-[9px] text-[#6ea8ff]">dForms</span>
          <span className="flex-1 truncate">
            <Typed text={prompt} d={0.4} dur={1} />
          </span>
          <span className="wt-press flex h-5 w-5 items-center justify-center rounded-full bg-white text-black" style={at(1.4)}>
            ↑
          </span>
        </div>
      </div>
      <div className="w-[120px] shrink-0 border-l px-3 pt-5 text-[9px] text-[#9a9a9a]" style={{ borderColor: GP_LINE }}>
        <p className="mb-1 text-white">{G.sources}</p>
        <p className="wt-fade flex items-center gap-1.5" style={at(2.6)}>
          <FormsTile size={12} /> dForms
        </p>
      </div>
    </div>,
  );
}

/* ── Cursor (agents window) ───────────────────────────────────────────────── */

const CU_BG = '#181818';
const CU_SIDE = '#141414';
const CU_LINE = 'rgba(255,255,255,0.08)';

function CursorShell({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex text-[9.5px] text-[#d6d6d6]" style={{ background: CU_BG }}>
      <div className="w-[96px] shrink-0 border-r px-2 pt-7" style={{ background: CU_SIDE, borderColor: CU_LINE }}>
        <div className="absolute left-2 top-2 flex gap-1">
          <i className="h-2 w-2 rounded-full bg-[#FF5F57]" />
          <i className="h-2 w-2 rounded-full bg-[#FEBC2E]" />
          <i className="h-2 w-2 rounded-full bg-[#28C840]" />
        </div>
        {K.nav.map((x, i) => (
          <p key={x} className={cn('rounded px-1.5 py-1', i === 2 && 'bg-white/[0.07] text-white')}>
            {x}
          </p>
        ))}
        <p className="mt-3 px-1.5 text-[8.5px] text-[#8a8a8a]">{K.projects}</p>
        <p className="px-1.5 py-1">+ {K.newProject}</p>
      </div>
      {children}
    </div>
  );
}

function CursorCustomize({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 px-4 pt-10">
      <div className="flex items-center gap-2">
        <span className="flex-1 rounded-md border px-2 py-1 text-[#8a8a8a]" style={{ borderColor: CU_LINE }}>
          ⌕ {K.search}
        </span>
        <span className="rounded-md bg-white px-2 py-1 font-semibold text-black">{K.marketplace}</span>
      </div>
      <div className="mt-2 flex gap-2 text-[9px]">
        {K.filters.map((f) => (
          <span key={f} className={cn('rounded px-1.5 py-0.5', f === 'MCPs' ? 'bg-white/10 text-white' : 'text-[#9a9a9a]')}>
            {f}
          </span>
        ))}
      </div>
      {children}
    </div>
  );
}

function ServerRow({ status, d, action }: { status: ReactNode; d?: number; action?: ReactNode }) {
  return (
    <div className="wt-fade mt-1.5 flex items-center justify-between rounded-md border px-2 py-1.5" style={{ ...at(d), borderColor: CU_LINE }}>
      <span className="flex items-center gap-2">
        <FormsTile size={16} />
        <span>
          <span className="text-white">dforms</span> <span className="rounded bg-white/10 px-1 text-[8px]">{K.user}</span>
          <br />
          <span className="text-[8.5px]">{status}</span>
        </span>
      </span>
      {action}
    </div>
  );
}

function CursorFrame({ step, m, prompt, url, cursorJson }: AppFrameProps) {
  if (step === 0) {
    const lines = cursorJson.split('\n');
    return (
      <CursorShell>
        <CursorCustomize>
          <p className="wt-fade mt-3 text-[8.5px] text-[#8a8a8a]" style={at(3.3)}>
            {K.needsAttention} 1
          </p>
          <ServerRow
            d={3.4}
            status={<span className="text-[#e5a50a]">{K.needsAuth}</span>}
            action={
              <span className="wt-hl rounded px-1.5 py-0.5 text-[#4c9df3]" style={at(4.6)}>
                {K.authenticate}
              </span>
            }
          />
          <div className="mt-1.5 rounded-md border px-2 py-1.5 text-[#9a9a9a]" style={{ borderColor: CU_LINE }}>
            + <span className="text-white">{K.newServer}</span>
            <br />
            <span className="pl-2.5 text-[8.5px]">{K.newServerHint}</span>
          </div>
        </CursorCustomize>
        <div className="w-[230px] shrink-0 border-l font-mono text-[9px]" style={{ borderColor: CU_LINE, background: '#1b1b1b' }}>
          <div className="border-b px-2 py-1.5 text-[#9a9a9a]" style={{ borderColor: CU_LINE }}>
            {'{}'} mcp.json · ~ › .cursor › mcp.json
          </div>
          <div className="px-2 py-2 leading-[1.6]">
            {lines.map((line, i) => (
              <div key={i} className="wt-fade flex gap-2" style={at(0.6 + i * 0.35)}>
                <span className="w-3 text-right text-[#5a5a5a]">{i + 1}</span>
                <span className="whitespace-pre text-[#ce9178]">{line}</span>
              </div>
            ))}
          </div>
        </div>
        <Pointer x={150} y={110} d={0.1} fx={-60} fy={60} out={4} />
        <Pointer x={350} y={120} d={4} fx={-150} fy={60} />
      </CursorShell>
    );
  }
  if (step === 1) {
    const s = m.signIn;
    return (
      <CursorShell>
        <CursorCustomize>
          <p className="mt-3 text-[8.5px] text-[#8a8a8a]">
            {K.connected} 1
          </p>
          <ServerRow status={<span className="text-[#3fb950]">● {SHOWN_TOOLS.length}+ {K.toolsEnabled}</span>} />
        </CursorCustomize>
        <div className="wt-pop absolute right-4 top-6 w-[220px] rounded-lg border p-2.5 shadow-2xl" style={{ ...at(4.4), background: '#1f1f1f', borderColor: CU_LINE }}>
          <p className="flex items-center gap-1.5 font-semibold text-white">
            <FormsTile size={14} /> {K.configure} dforms
          </p>
          <p className="text-[8px] text-[#8a8a8a]">{K.source}</p>
          <p className="mt-1.5 text-[8.5px] text-[#9a9a9a]">{K.environments}</p>
          <div className="mt-0.5 flex justify-between rounded border px-1.5 py-1" style={{ borderColor: CU_LINE }}>
            <span>
              {K.local} <span className="text-[#3fb950]">· {K.connected}</span>
            </span>
            <span>{K.logout}</span>
          </div>
          <p className="mt-1.5 text-[8.5px] text-[#9a9a9a]">
            {K.tools} · {K.reads}
          </p>
          {SHOWN_TOOLS.slice(0, 4).map((tool, i) => (
            <div key={tool} className="wt-fade flex justify-between py-0.5 font-mono text-[8.5px]" style={at(4.7 + i * 0.12)}>
              {tool}
              <Toggle />
            </div>
          ))}
          <div className="mt-1 flex justify-end">
            <span className="rounded bg-[#3b82f6] px-2 py-0.5 text-[8.5px] text-white">{K.done}</span>
          </div>
        </div>
        {/* The browser asking to let Cursor in, before the panel above. */}
        <div className="wt-out absolute inset-0 z-20 flex flex-col bg-[#141414]" style={at(4)}>
          <div className="flex h-6 shrink-0 items-center gap-2 bg-[#202020] px-3 text-[8.5px] text-[#9a9a9a]">
            <span className="flex-1 truncate rounded bg-[#2b2b2b] px-2 py-0.5 font-mono">{host(url)}/oauth2/authorize</span>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <div className="flex items-center gap-2">
              <FormsMark className="h-5 w-auto text-white" />
              <span className="text-[#777]">···</span>
              <span className="text-white">
                <AgentLogo app="cursor" size={20} />
              </span>
            </div>
            <p className="mt-2 w-[220px] text-[13px] font-semibold leading-tight text-white">{t(s.consentTitle, { app: 'Cursor' })}</p>
            <div className="mt-3 w-[230px] rounded-xl border border-white/10 bg-[#1b1b1b] p-3 text-left">
              <p className="text-[8.5px]">{s.redirectNote}</p>
              <p className="mt-1 font-mono text-[9px]">◍ localhost:8787</p>
              <p className="mt-2 rounded bg-[#fef3c7] px-2 py-1.5 text-[8px] text-[#78350f]">{t(s.warning, { app: 'Cursor' })}</p>
              <span className="mt-2 flex h-6 items-center justify-center rounded-md border border-white/20 text-[9.5px]">{s.cancel}</span>
              <span className="wt-press mt-1.5 flex h-6 items-center justify-center rounded-md bg-[#3DDC84] text-[9.5px] font-semibold text-black" style={at(2.6)}>
                {s.allow}
              </span>
            </div>
          </div>
          <Pointer x={320} y={300} d={1.8} fx={80} fy={-40} />
        </div>
      </CursorShell>
    );
  }
  return (
    <CursorShell>
      <div className="flex flex-1 flex-col px-5 py-3">
        <p className="wt-fade rounded-md border px-2.5 py-1.5 text-white" style={{ ...at(1.4), borderColor: CU_LINE, background: '#202020' }}>
          {prompt}
        </p>
        <p className="wt-fade mt-2 text-[#8a8a8a]" style={at(1.8)}>
          {K.thought}
        </p>
        <div className="wt-fade mt-1.5 rounded-md border p-2 font-mono text-[8.5px]" style={{ ...at(2.1), borderColor: CU_LINE }}>
          <p className="font-sans text-[9px]">
            ◌ {K.running} <span className="font-semibold text-white">list_forms</span> {K.in} dforms
          </p>
          <p className="mt-1 text-[#9a9a9a]">{'{ "limit": 50 }'}</p>
          <div className="mt-1 flex justify-end gap-2 font-sans">
            <span className="text-[#8a8a8a]">{K.skip}</span>
            <span className="rounded bg-white/10 px-1.5">{K.alwaysRun}</span>
            <span className="wt-press rounded bg-[#3b82f6] px-1.5 text-white" style={at(2.8)}>
              {K.run} ↵
            </span>
          </div>
        </div>
        <p className="wt-fade mt-2 text-[#8a8a8a]" style={at(3.2)}>
          {K.explored}
        </p>
        <AnswerTable a={m.answer} d={3.4} className="mt-1" />
        <div className="mt-auto rounded-md border px-2 py-1.5 text-[#8a8a8a]" style={{ borderColor: CU_LINE, background: '#1f1f1f' }}>
          <Typed text={prompt} d={0.3} dur={0.9} />
          <p className="mt-1 text-[8px]">+ {K.model}</p>
        </div>
      </div>
      <Pointer x={455} y={150} d={2.3} fx={-80} fy={80} />
    </CursorShell>
  );
}

export const APP_FRAMES = { claude: ClaudeFrame, chatgpt: ChatGptFrame, cursor: CursorFrame };
