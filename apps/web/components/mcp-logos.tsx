'use client';

import { useEffect, useState } from 'react';

/** The AI apps the MCP item stands for, in the order they take turns. */
export const MCP_LOGOS = ['claude', 'openai', 'cursor'] as const;
export type McpLogo = (typeof MCP_LOGOS)[number];

/**
 * Logos drawn in their own brand color instead of the row's ink. Claude's
 * mark is orange in the original, and the same hex Dapta's admin panel uses
 * for it. ChatGPT and Cursor are monochrome marks, so they take
 * `currentColor` (dark on light, light on dark) like the rest of the rail.
 */
export const MCP_BRAND_COLORS: Partial<Record<McpLogo, string>> = { claude: '#d97757' };

/** How long each logo stays before the next one fades in. */
export const MCP_ROTATE_MS = 2600;

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.(REDUCED_MOTION).matches;
  } catch {
    return false;
  }
}

/**
 * The icon of the rail's MCP item: the Claude, ChatGPT and Cursor logos taking
 * turns with a crossfade, the same mark Dapta's admin panel uses for its MCP
 * entry. Each logo is a CSS mask (the files live in `public/mcp/logos/`).
 * Claude keeps its brand orange in every state and theme (`MCP_BRAND_COLORS`);
 * the monochrome ChatGPT and Cursor marks are filled with `currentColor`, so
 * they take the rail row's ink: muted when idle, full when hovered or
 * current, in light and in dark.
 *
 * Decoration only. The row's label ("MCP") is its accessible name, so the
 * stack is `aria-hidden` and a screen reader hears one stable name instead of
 * three brands cycling.
 *
 * Starts on the first logo on the server and on the client alike, so hydration
 * agrees. Rotation stops while `paused` (the pointer is on the row: nobody
 * should have to chase the target they are reading) and never starts under
 * `prefers-reduced-motion`; globals.css also zeroes the transition there.
 */
export function McpLogos({ size = 20, paused = false }: { size?: number; paused?: boolean }) {
  const [index, setIndex] = useState(0);
  const [still, setStill] = useState(true);

  // Read the motion preference after mount (the server cannot know it), and
  // follow it if it changes while the page is open.
  useEffect(() => {
    setStill(prefersReducedMotion());
    let query: MediaQueryList | undefined;
    try {
      query = window.matchMedia?.(REDUCED_MOTION);
    } catch {
      query = undefined;
    }
    if (!query?.addEventListener) return;
    const onChange = (e: MediaQueryListEvent) => setStill(e.matches);
    query.addEventListener('change', onChange);
    return () => query?.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (still || paused) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % MCP_LOGOS.length), MCP_ROTATE_MS);
    return () => clearInterval(timer);
  }, [still, paused]);

  return (
    <span
      aria-hidden
      data-testid="mcp-logos"
      className="mcp-logos shrink-0"
      style={{ width: size, height: size }}
    >
      {MCP_LOGOS.map((logo, i) => (
        <span
          key={logo}
          data-logo={logo}
          data-active={i === index ? 'true' : undefined}
          className={`mcp-logos__logo${i === index ? ' is-active' : ''}`}
          style={{
            WebkitMaskImage: `url(/mcp/logos/${logo}.svg)`,
            maskImage: `url(/mcp/logos/${logo}.svg)`,
            ...(MCP_BRAND_COLORS[logo] ? { backgroundColor: MCP_BRAND_COLORS[logo] } : {}),
          }}
        />
      ))}
    </span>
  );
}
