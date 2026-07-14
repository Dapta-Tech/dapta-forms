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
