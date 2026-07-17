import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Screenshot capture for the V2 feedback presentation. Not a functional test —
 * it drives each changed surface and saves a PNG to qa/shots/. Run:
 *   npx playwright test -c qa/playwright.config.ts qa/e2e/shots.spec.ts --reporter=list
 */

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(here, '..', 'shots');
mkdirSync(SHOTS, { recursive: true });
const API = 'http://localhost:4400';
const shot = (name: string) => resolve(SHOTS, `${name}.png`);

let accountCode = '';

test.beforeAll(async ({ request }) => {
  accountCode = (await (await request.get(`${API}/v1/me`)).json()).accountCode;
});

async function createForm(request: any, name: string, config: any): Promise<{ id: string; slug: string }> {
  const res = await request.post(`${API}/v1/forms`, { data: { name, config } });
  const body = await res.json();
  return { id: body.id, slug: body.slug };
}

test('F1 · interpolation — no dangling comma', async ({ page, request }) => {
  const { slug } = await createForm(request, 'Shot Interpolation', {
    version: 1,
    cover: { enabled: true, headline: 'Quick question', ctaText: 'Start' },
    steps: [
      // The interpolated question is AUTHORED first (authored order is now the
      // runtime order), so it renders before any name is captured — the empty
      // [firstname] token must sweep its comma.
      { key: 'problem', type: 'multiple_choice', question: '[firstname], what problem are you solving?', flowGroup: 'qualification', options: [{ label: 'Leads', value: 'leads' }, { label: 'Support', value: 'support' }] },
      { key: 'firstname', type: 'name', question: "What's your name?", fields: ['firstname', 'lastname'], flowGroup: 'lead_capture' },
    ],
    scoring: { enabled: false },
    outcomes: [{ id: 'done', label: 'Thanks', minScore: 0 }],
  });
  await page.goto(`/${accountCode}/me/${slug}`);
  await page.locator('.pf__btn').first().click();
  await expect(page.locator('.pf__question')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot('f1-interpolation'), fullPage: false });
  const q = await page.locator('.pf__question').first().innerText();
  expect(q.trim().startsWith(',')).toBeFalsy();
});

test('F2 · soft banner', async ({ page, request }) => {
  const { slug } = await createForm(request, 'Shot Banner', {
    version: 1,
    branding: { primaryColor: '#CCFF00' },
    cover: { enabled: true, bannerText: 'Book a call and get a free onboarding session', badge: '2-minute assessment', headline: 'Find the right plan for your team', subheadline: 'Answer a few questions and book a call.', ctaText: 'Start now' },
    steps: [{ key: 'email', type: 'email', question: 'Email?' }],
    outcomes: [{ id: 'done', label: 'Thanks', minScore: 0 }],
  });
  await page.goto(`/${accountCode}/me/${slug}`);
  await expect(page.locator('.pf__banner')).toBeVisible();
  await page.screenshot({ path: shot('f2-banner'), fullPage: false });
});

test('N1 · phone country picker', async ({ page, request }) => {
  const { slug } = await createForm(request, 'Shot Phone', {
    version: 1,
    cover: { enabled: false },
    steps: [{ key: 'phone', type: 'phone', question: "What's your phone number?", required: true }],
    outcomes: [{ id: 'done', label: 'Thanks', minScore: 0 }],
  });
  await page.goto(`/${accountCode}/me/${slug}`);
  await expect(page.locator('.pf-phone').first()).toBeVisible();
  // open the country picker
  const trigger = page.locator('.pf-phone__country, [aria-haspopup="listbox"]').first();
  if (await trigger.isVisible().catch(() => false)) {
    await trigger.click();
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: shot('n1-phone'), fullPage: false });
});

test('N2 · branded dropdown open (builder)', async ({ page, request }) => {
  const { id } = await createForm(request, 'Shot Dropdown', {
    version: 1,
    steps: [{ key: 'pick', type: 'multiple_choice', question: 'Pick', options: [{ label: 'A', value: 'a' }] }],
    outcomes: [{ id: 'done', label: 'Done', minScore: 0 }],
  });
  await page.goto(`/admin/forms/${id}/edit`);
  await page.waitForLoadState('networkidle');
  // open the question-type branded select
  const combo = page.locator('button[aria-haspopup="listbox"]').first();
  if (await combo.isVisible().catch(() => false)) {
    await combo.click();
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: shot('n2-dropdown'), fullPage: false });
});

test('N3 · integrations connections page', async ({ page }) => {
  await page.goto('/admin/integrations');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot('n3-connections'), fullPage: true });
});

test('N3 · per-form HubSpot mapping', async ({ page, request }) => {
  const { id } = await createForm(request, 'Shot Mapping', {
    version: 1,
    steps: [
      { key: 'email', type: 'email', question: 'Work email?' },
      { key: 'firstname', type: 'name', question: 'Name?', fields: ['firstname', 'lastname'] },
      { key: 'phone', type: 'phone', question: 'Phone?' },
    ],
    outcomes: [{ id: 'done', label: 'Done', minScore: 0 }],
    // Pre-enable HubSpot with a couple of mappings so the Typeform-style
    // mapping UI renders expanded on load (deterministic, no toggle race).
    destinations: [
      {
        type: 'hubspot',
        enabled: true,
        fieldMappings: { email: 'email', firstname: 'firstname' },
      },
    ],
  });
  await page.goto(`/admin/forms/${id}/integrations`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await page.getByText(/Map questions/i).first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot('n3-mapping'), fullPage: true });
});

test('N4 · editor header link buttons', async ({ page, request }) => {
  const { id } = await createForm(request, 'Shot Editor Links', {
    version: 1,
    steps: [{ key: 'email', type: 'email', question: 'Email?' }],
    outcomes: [{ id: 'done', label: 'Done', minScore: 0 }],
  });
  await page.goto(`/admin/forms/${id}/edit`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('editor-copy-link')).toBeVisible();
  await page.screenshot({ path: shot('n4-editor-links'), fullPage: false });
});

test('N5 · notifications settings', async ({ page }) => {
  await page.goto('/admin/settings');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  // scroll to the notifications section if present
  const notif = page.getByText(/notification|notificaci/i).first();
  if (await notif.isVisible().catch(() => false)) await notif.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('n5-notifications'), fullPage: true });
});

test('N6 · webhook event triggers', async ({ page, request }) => {
  const { id } = await createForm(request, 'Shot Webhook', {
    version: 1,
    steps: [{ key: 'email', type: 'email', question: 'Email?' }],
    outcomes: [{ id: 'done', label: 'Done', minScore: 0 }],
    destinations: [{ type: 'webhook', enabled: true, events: ['complete'], settings: { url: 'http://localhost:4400/health' } }],
  });
  await page.goto(`/admin/forms/${id}/integrations`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  const webhook = page.getByText(/webhook/i).first();
  if (await webhook.isVisible().catch(() => false)) await webhook.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('n6-webhook-events'), fullPage: true });
});

test('N4b · copy-link copied state', async ({ page, context, request }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const { id } = await createForm(request, 'Shot Copied', {
    version: 1,
    steps: [{ key: 'email', type: 'email', question: 'Email?' }],
    outcomes: [{ id: 'done', label: 'Done', minScore: 0 }],
  });
  await page.goto(`/admin/forms/${id}/edit`);
  await page.waitForLoadState('networkidle');
  await page.getByTestId('editor-copy-link').click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: shot('n4b-copied'), fullPage: false });
});
