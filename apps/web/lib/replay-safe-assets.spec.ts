/**
 * Session replays (PostHog) rebuild the page inside the replay tool, on ITS
 * origin. Anything the page draws from a file named by a CSS `url()` is fetched
 * again from there: a relative path resolves against the replay tool's host and
 * 404s, and a mask image or a font is a CORS request our static files do not
 * answer. The MCP rail icon was a mask over `url(/mcp/logos/*.svg)` and showed
 * as an empty slot in every recording, while the app drew it fine.
 *
 * So the web app's CSS and components name no file in `url()`: icons are inline
 * SVG or data URIs (`icons.css`), and the only `url()` arguments left are data
 * URIs, fragment references (`url(#mask-id)` inside an inline SVG), absolute
 * author-supplied URLs, and values built at runtime.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const ROOTS = ['app', 'components', 'lib'];

/** `url(...)` arguments that name a file on the page's own origin. */
export function relativeUrls(source: string): string[] {
  const found: string[] = [];
  for (const line of source.split('\n')) {
    const t = line.trim();
    if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) continue;
    // Lowercase only: `new URL(...)` is code, not CSS.
    for (const m of line.matchAll(/(?<![\w.$-])url\(([^)]*)\)/g)) {
      const arg = m[1]!.trim().replace(/^['"`]|['"`]$/g, '');
      if (arg === '' || /^(data:|https?:|#|\$\{|var\()/i.test(arg)) continue;
      found.push(arg);
    }
  }
  return found;
}

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (/\.(css|tsx?)$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name)) yield path;
  }
}

describe('relativeUrls', () => {
  it('catches the mask the MCP icon used to load, in either style syntax', () => {
    expect(relativeUrls('maskImage: `url(/mcp/logos/${logo}.svg)`,')).toEqual(['/mcp/logos/${logo}.svg']);
    expect(relativeUrls(".x { mask-image: url('/mcp/logos/claude.svg'); }")).toEqual(['/mcp/logos/claude.svg']);
    expect(relativeUrls('.y { background: url(img/bg.png) }')).toEqual(['img/bg.png']);
    expect(relativeUrls('src: url("../fonts/a.woff2")')).toEqual(['../fonts/a.woff2']);
  });

  it('lets through what a replay can draw or never fetches', () => {
    const fine = [
      `.pi-x{--pi:url("data:image/svg+xml,%3Csvg%3E")}`,
      '<g mask={`url(#${maskId})`}>',
      'vars["--pf-bg-image"] = `url("${design.backgroundImage}")`;',
      'background: url(https://cdn.example.com/a.png);',
      'mask: var(--pi, linear-gradient(transparent, transparent));',
      'z.string().url()',
      'curl: apiCurl(e, apiUrl),',
      ' * a comment about `url(/mcp/logos/*.svg)`',
    ];
    for (const line of fine) expect(relativeUrls(line), line).toEqual([]);
  });
});

describe('web app sources', () => {
  it('name no same-origin file in a CSS url(), so a session replay draws what the app draws', () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of sources(join(WEB, root))) {
        for (const url of relativeUrls(readFileSync(file, 'utf8'))) {
          offenders.push(`${relative(WEB, file)}: url(${url})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// The app's own faces (next/font self-hosts them under `/_next/static/media/`)
// reach a replay through the recorded stylesheet, as absolute URLs on our
// origin. A font is always fetched in CORS mode, so without this header a
// recording swaps every heading and label to the fallback face.
describe('self-hosted fonts', () => {
  it('are served with Access-Control-Allow-Origin, so a replay on another origin loads them', async () => {
    const { default: config } = await import('../next.config.mjs');
    const rules = (await config.headers?.()) ?? [];
    const media = rules.find((r) => r.source === '/_next/static/media/:path*');
    expect(media?.headers).toContainEqual({ key: 'Access-Control-Allow-Origin', value: '*' });
    // Only the static media: pages, API routes and server actions get no CORS header.
    for (const rule of rules) {
      if (rule.headers.some((h) => h.key.toLowerCase() === 'access-control-allow-origin')) {
        expect(rule.source.startsWith('/_next/static/')).toBe(true);
      }
    }
  });
});
