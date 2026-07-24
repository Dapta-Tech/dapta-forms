import { defineConfig } from '@playwright/test';

/**
 * E2E config for the METRICS worktree instance (web :3500 / api :4500, SQLite
 * .data/metrics-qa.db), booted separately from this worktree.
 *
 * Deliberately separate from qa/playwright.config.ts: that one targets :3400 and
 * carries `reuseExistingServer`, so on a machine already running the :3400
 * instance it would silently exercise THAT build instead of this branch's code —
 * a green run proving nothing about the change under test. There is no
 * `webServer` here on purpose: the instance is expected to be already up, so a
 * misconfigured run fails loudly instead of booting a second server.
 *
 *   npx playwright test -c qa/playwright.metrics.config.ts <spec> --reporter=line
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 1,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3500',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
