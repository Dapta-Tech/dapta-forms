'use client';

import type { CSSProperties, ReactNode } from 'react';
import { FormsMark } from '@/components/brand/forms-logo';
import { cn } from '@/lib/cn';

/**
 * The pieces every walkthrough frame is drawn with. Each animated element is
 * written in its FINAL state; the CSS keyframes (walkthrough.css) only say
 * where it comes from, waiting at that start until its delay `--d`. With
 * reduced motion the animations are off and every frame shows its end state.
 */
export type Delay = { d?: number };
export const at = (d = 0, extra: CSSProperties = {}): CSSProperties => ({ ['--d' as string]: `${d}s`, ...extra });

/** Text that types itself in: one step per character over `dur` seconds, from `d`. */
export function Typed({ text, d = 0, dur, className }: { text: string; d?: number; dur?: number; className?: string }) {
  const n = Math.max(1, text.length);
  const seconds = dur ?? Math.min(1.6, Math.max(0.5, n * 0.035));
  return (
    <span
      className={cn('wt-type', className)}
      style={at(d, { ['--n' as string]: n, ['--dur' as string]: `${seconds}s` })}
    >
      {text}
    </span>
  );
}

export function Line({ children, d = 0, className }: { children: ReactNode; className?: string } & Delay) {
  return (
    <div className={cn('wt-fade whitespace-pre-wrap break-all', className)} style={at(d)}>
      {children}
    </div>
  );
}

/** The mouse pointer, flying in from (fx, fy) to (x, y) at `d`; gone at `out` when given. */
export function Pointer({
  x,
  y,
  d = 0,
  fx = 90,
  fy = 70,
  out,
}: { x: number; y: number; fx?: number; fy?: number; out?: number } & Delay) {
  const svg = (
    <svg
      aria-hidden
      className="wt-pointer"
      width="13"
      height="17"
      viewBox="0 0 16 20"
      style={at(d, { left: x, top: y, ['--fx' as string]: `${fx}px`, ['--fy' as string]: `${fy}px` })}
    >
      <path d="M1 1l12.5 11.5H7.6L4.3 18.4z" fill="#fff" stroke="#111" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
  // A pointer that hands over to the next one leaves at `out`, so only one shows at a time.
  return out === undefined ? svg : (
    <span className="wt-out" style={at(out)}>
      {svg}
    </span>
  );
}

/** The dForms connector icon: the dF mark on the dark tile the app and the landing use. */
export function FormsTile({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-[22%] bg-[#1a1a1c] ring-1 ring-white/10', className)}
      style={{ width: size, height: size }}
    >
      <FormsMark className="text-white" style={{ width: size * 0.74, height: 'auto' }} />
    </span>
  );
}

/** The green step chip in the frame's corner, with the guide's own step title; `low` puts it at the bottom, clear of a terminal's title bar and its output. */
export function StepChip({ n, title, low }: { n: number; title: string; low?: boolean }) {
  return (
    <span className={`absolute left-3 ${low ? 'bottom-3' : 'top-3'} z-40 inline-flex items-center gap-1.5 rounded-full bg-black/70 py-1 pl-1 pr-2.5 text-[9.5px] font-medium text-white shadow-lg ring-1 ring-white/10 backdrop-blur`}>
      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#3DDC84] text-[8px] font-bold text-black">{n}</span>
      {title}
    </span>
  );
}

export interface AnswerCopy {
  intro: string;
  forms: { name: string; stat: string }[];
  colForm: string;
  colResponses: string;
  colStatus: string;
  live: string;
}

/** The forms the agent lists, as a small table, row by row from `d`. */
export function AnswerTable({ a, d, className }: { a: AnswerCopy; d: number; className?: string }) {
  return (
    <div className={cn('wt-fade', className)} style={at(d)}>
      <p className="mb-1.5">{a.intro}</p>
      <div className="overflow-hidden rounded-md border border-white/10 text-[9.5px]">
        <div className="grid grid-cols-[1.6fr_1fr_0.8fr] border-b border-white/10 bg-white/[0.04] px-2 py-1 font-semibold">
          <span>{a.colForm}</span>
          <span>{a.colResponses}</span>
          <span>{a.colStatus}</span>
        </div>
        {a.forms.map((f, i) => (
          <div
            key={f.name}
            className="wt-fade grid grid-cols-[1.6fr_1fr_0.8fr] border-b border-white/10 px-2 py-1 last:border-b-0"
            style={at(d + 0.25 + i * 0.2)}
          >
            <span className="truncate">{f.name}</span>
            <span className="opacity-70">{f.stat.replace(/\D+$/, '')}</span>
            <span className="text-[#3DDC84]">{a.live}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

