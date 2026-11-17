import { defineConfig, devices } from '@playwright/test';

/**
 * Component-level browser specs: one real component, its real compiled CSS, a
 * real layout engine, and no server.
 *
 * Deliberately separate from qa/playwright.config.ts. That one boots (or
 * reuses) the whole stack on :3400 and :4400 to drive the admin end to end;
 * these specs answer a narrower question, "where does this box land?", that
 * happy-dom cannot answer at all (it has no layout) and that the full stack
 * answers slowly and only for the screens that happen to exist. There is no
 * `webServer` and no `baseURL` here on purpose: see qa/component/mount.ts.
 *
 *   pnpm qa:component
 *   npx playwright test -c qa/playwright.component.config.ts --project=webkit
 */
export default defineConfig({
  testDir: './component',
  timeout: 30_000,
  workers: 1,
  reporter: [['list']],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
