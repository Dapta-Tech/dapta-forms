import { defineConfig } from '@playwright/test';

/**
 * E2E QA harness. Targets the dedicated SQLite QA instance (web :3400, api :4400)
 * booted by qa/dev-sqlite.sh — never the developer's :3000/:4000 instance, which
 * may point at a shared Postgres database.
 *
 * Run from the repo root:  npx playwright test -c qa/playwright.config.ts
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3400',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'bash dev-sqlite.sh',
    cwd: __dirname,
    url: 'http://localhost:3400',
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
