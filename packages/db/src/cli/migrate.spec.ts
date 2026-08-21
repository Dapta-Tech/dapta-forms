import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TSX_CLI = join(PACKAGE_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const UNREACHABLE_POSTGRES = 'postgres://quill:quill@127.0.0.1:1/quill';
const CHILD_TIMEOUT_MS = 12_000;
const TEST_TIMEOUT_MS = 20_000;

interface ChildResult {
  code: number | null;
  elapsedMs: number;
  stderr: string;
  timedOut: boolean;
}

function runCli(script: string, databaseUrl: string): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [TSX_CLI, script], {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let timedOut = false;
    let spawnError: Error | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, CHILD_TIMEOUT_MS);

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      spawnError = error;
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (spawnError) {
        reject(spawnError);
        return;
      }
      resolve({ code, elapsedMs: Date.now() - startedAt, stderr, timedOut });
    });
  });
}

describe('database CLIs', () => {
  it('prints an unreachable PostgreSQL migration cause and exits promptly', async () => {
    const result = await runCli('src/cli/migrate.ts', UNREACHABLE_POSTGRES);

    expect(result.timedOut).toBe(false);
    expect(result.elapsedMs).toBeLessThan(5_000);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('[migrate] failed:');
    expect(result.stderr).toMatch(/ECONNREFUSED|connect/i);
  }, TEST_TIMEOUT_MS);

  it('refuses a PostgreSQL reset without falling through to database work', async () => {
    const result = await runCli('src/cli/reset.ts', UNREACHABLE_POSTGRES);

    expect(result.timedOut).toBe(false);
    expect(result.elapsedMs).toBeLessThan(5_000);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('[reset] refusing to reset a Postgres database');
    expect(result.stderr).not.toMatch(/\[reset\] failed:|ECONNREFUSED|connect/i);
  }, TEST_TIMEOUT_MS);

  it('does not use immediate process exits in database CLIs', () => {
    const cliDirectory = join(PACKAGE_ROOT, 'src', 'cli');
    for (const file of readdirSync(cliDirectory).filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))) {
      expect(readFileSync(join(cliDirectory, file), 'utf8')).not.toContain('process.exit(');
    }
  });
});
