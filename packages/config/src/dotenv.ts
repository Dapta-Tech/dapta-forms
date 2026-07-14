/**
 * .env loader (H3). A self-hoster who copies `.env.example` to `.env` expects it
 * to take effect — but nothing loaded it: the API and Next read only
 * `process.env`, and turbo/Next never inject the monorepo-root `.env`. This
 * loads it explicitly at boot for both apps.
 *
 * NEVER overrides an already-set variable (`override` stays false): a real
 * deployment's injected env (k8s / Docker `-e` / the shell) ALWAYS wins over a
 * committed-nowhere `.env`. Files are loaded lowest-priority last, so an
 * app-local `.env` beats the root `.env`, and both lose to the real environment.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config as dotenvConfig } from 'dotenv';

function findWorkspaceRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 20; i++) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

/**
 * Populate `process.env` from `.env` files without clobbering set vars. Loads an
 * optional app-local `.env` (in `cwd`) first, then the monorepo-root `.env`.
 * Safe no-op when a file is absent.
 */
export function loadDotenv(options: { cwd?: string } = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const local = resolve(cwd, '.env');
  if (existsSync(local)) dotenvConfig({ path: local });
  const root = resolve(findWorkspaceRoot(cwd), '.env');
  if (root !== local && existsSync(root)) dotenvConfig({ path: root });
}
