import { test, expect, type Page } from '@playwright/test';
import { mount } from './mount';

/**
 * The Integrations page's card grid, in a real layout engine.
 *
 * Opening one card's connect form must leave the card beside it exactly as it
 * was, and at rest the buttons of a row must start on the same line. Both are
 * layout, which happy-dom cannot see; `connections-layout.spec.tsx` pins the
 * classes in CI and this spec checks that a browser turns them into the boxes
 * they promise (the subgrid is new to this grid, and WebKit is where subgrid
 * gaps differ most).
 *
 * The cards are measured by what they DRAW: each section is an invisible
 * subgrid, and its header and body are the visible top and bottom of the card.
 */

const CONNECTED_AT = Date.UTC(2026, 10, 1);

async function setup(page: Page, theme: 'light' | 'dark', spec: Record<string, unknown> = {}) {
  // Wide enough for the two-column grid (`lg`).
  await page.setViewportSize({ width: 1280, height: 1000 });
  await mount(
    page,
    `<main style="width: 1040px; padding: 24px">` +
      `<div data-connections='${JSON.stringify({ dcal: true, ...spec })}'></div></main>`,
    theme,
  );
}

/** Each card's drawn box and its first body button, keyed by card name. */
async function cards(page: Page) {
  return page.$$eval('[data-testid="connections-grid"] > section', (sections) =>
    Object.fromEntries(
      sections.map((s) => {
        const drawn = [...s.children].map((c) => c.getBoundingClientRect()).filter((r) => r.height > 0);
        const top = Math.min(...drawn.map((r) => r.top));
        const bottom = Math.max(...drawn.map((r) => r.bottom));
        const right = Math.max(...drawn.map((r) => r.right));
        const button = s.querySelector('[data-testid="card-body"] button, [data-testid="card-body"] a');
        return [
          s.querySelector('h2')!.textContent!,
          {
            top,
            height: bottom - top,
            right,
            columnRight: s.getBoundingClientRect().right,
            button: button ? button.getBoundingClientRect().top : null,
          },
        ];
      }),
    ),
  );
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`connections grid (${theme})`, () => {
    test('at rest, the buttons of a row start on the same line', async ({ page }) => {
      // Google Sheets offered (its note sits under the button) and HubSpot
      // supplied by nobody: every body starts with its button.
      await setup(page, theme);
      const c = await cards(page);
      for (const [a, b] of [
        ['HubSpot', 'dCal'],
        ['Calendly', 'Google Sheets'],
        ['Salesforce', 'HighLevel'],
      ] as const) {
        expect(c[a]!.top, `${a} and ${b} share a row`).toBeCloseTo(c[b]!.top, 0);
        expect(c[a]!.button, `${a} button vs ${b}`).toBeCloseTo(c[b]!.button!, 0);
      }
    });

    test("opening a card's connect form leaves its neighbour exactly as it was", async ({ page }) => {
      await setup(page, theme);
      for (const [opens, neighbour] of [
        ['HubSpot', 'dCal'],
        ['Salesforce', 'HighLevel'],
        ['Calendly', 'Google Sheets'],
      ] as const) {
        const before = await cards(page);
        await page.locator('section', { has: page.locator('h2', { hasText: opens }) }).getByRole('button', { name: 'Connect' }).click();
        const after = await cards(page);
        expect(after[opens]!.height, `${opens} grows`).toBeGreaterThan(before[opens]!.height + 40);
        expect(after[neighbour]!.height, `${neighbour} keeps its height`).toBeCloseTo(before[neighbour]!.height, 0);
        expect(after[neighbour]!.button, `${neighbour} keeps its button`).toBeCloseTo(before[neighbour]!.button!, 0);
        await page.locator('section', { has: page.locator('h2', { hasText: opens }) }).getByRole('button', { name: 'Cancel' }).click();
      }
    });

    test('a long unbroken label stays inside its column', async ({ page }) => {
      await setup(page, theme, {
        providers: [
          {
            provider: 'salesforce',
            connected: true,
            last4: 'abcd',
            label: 'integration.user.with.a.really.long.address@subdomain.example-company.com',
            connectedAt: CONNECTED_AT,
          },
        ],
      });
      const c = await cards(page);
      for (const [name, card] of Object.entries(c)) {
        expect(card.right, `${name} fits its column`).toBeLessThanOrEqual(card.columnRight + 0.5);
      }
    });
  });
}
