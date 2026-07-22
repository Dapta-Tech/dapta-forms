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
};

export default nextConfig;
