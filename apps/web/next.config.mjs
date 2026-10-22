import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotenv } from '@quill/config/dotenv';

const here = dirname(fileURLToPath(import.meta.url));

// Load the monorepo-root .env (in addition to Next's own apps/web/.env*) so a
// self-hoster's single root .env reaches the web app too, at build AND at server
// boot (standalone re-loads this config). Real env is never overridden (H3).
loadDotenv({ cwd: join(here, '..', '..') });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The dev-only overlay badge sits in the bottom-left corner, which is exactly
  // where the sidebar footer's icon row lands when the rail is EXPANDED — a hit
  // test at the theme toggle's centre returned `NEXTJS-PORTAL`, so the control was
  // unclickable and read as missing. Collapsed, the icons stack vertically and
  // clear it, which is why the bug looked like "the toggle disappears when I open
  // the menu". Reordering the row would only move the problem onto sign-out.
  // Production never renders this element, so turning it off costs nothing and
  // makes local dev match what ships.
  devIndicators: false,
  // Next 16 allows only ONE dev server per build directory, which broke the
  // repo's own documented "second instance on :3400" workflow (see the
  // local-dev skill) — a second `next dev` in this folder exits with "Another
  // next dev server is already running". Giving the second instance its own
  // `NEXT_DIST_DIR` gives it its own lock, so a throwaway QA instance can run
  // beside the one you are working in. Unset everywhere else = plain `.next`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // @quill/* ship plain compiled ES2022 JS, so Next consumes them as normal ESM
  // — no transpilePackages (re-transpiling them injects unresolvable @swc/helpers
  // under pnpm's isolated layout).
  // Node runtime only — deployment-agnostic (self-host on any Node/Docker host
  // AND one-click Vercel). No Vercel-only APIs.
  output: 'standalone',
  // Anchor Turbopack to this monorepo (a stray lockfile elsewhere can mislead it).
  turbopack: {
    root: join(here, '..', '..'),
  },
  // `/admin/developers` is a group in the rail (Connect, API docs), and the old
  // API keys page became the connector guide at `/admin/developers/connect`.
  // Both old addresses are in skill zips people already downloaded, so they
  // keep working as real HTTP redirects, answered before any page renders. The
  // pages at those paths redirect too, for anything that reaches them anyway.
  // Temporary, not permanent: a browser caches a 308 forever, and the paths
  // may hold pages of their own one day.
  async redirects() {
    return [
      { source: '/admin/developers', destination: '/admin/developers/connect', permanent: false },
      { source: '/admin/developers/keys', destination: '/admin/developers/connect', permanent: false },
      // The API docs page gave way to Tools: what an agent can do, in plain words.
      { source: '/admin/developers/docs', destination: '/admin/developers/tools', permanent: false },
      { source: '/admin/developers/docs/:path*', destination: '/admin/developers/tools', permanent: false },
    ];
  },
  // A session replay (PostHog) rebuilds the page on the replay tool's origin
  // and loads our stylesheet's fonts from here, as absolute URLs. Fonts are
  // always fetched in CORS mode, so without this header every recording falls
  // back to a system face and stops looking like the app. Only the static
  // media (next/font's self-hosted files, hashed and public by design) gets
  // it: no page, API route or server action is opened to other origins.
  async headers() {
    return [
      {
        source: '/_next/static/media/:path*',
        headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }],
      },
    ];
  },
};

export default nextConfig;
