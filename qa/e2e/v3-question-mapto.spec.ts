import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * V3 — per-question HubSpot "Map to" in the Build tab (Typeform parity).
 *
 * Clicking a question in Build shows a "HubSpot" section in the right settings
 * panel (`qs-hubspot-section`):
 *  a. with an ENABLED hubspot destination (and the QA env's account-level
 *     HubSpot connection), a searchable "Map to" property picker
 *     (`qs-hubspot-mapto`) preloaded with this question's current mapping;
 *     picking a property saves IMMEDIATELY against the LIVE config's
 *     destinations (partial write) and flashes a saved indicator
 *     (`qs-hubspot-saved`);
 *  b. the mapping persists: after a reload the section shows it again, and the
 *     Connect tab's "Map questions" row for the same question shows the SAME
 *     property — both surfaces read/write the one live `fieldMappings` record;
 *  c. without an enabled hubspot destination the section shows a hint plus a
 *     "Set up in Connect" CTA (`qs-hubspot-connect-cta`) that switches the
 *     editor to the Connect tab.
 *
 * Forms are created per test via the admin API under unique `v3w5-` prefixed
 * names (per-run token + counter, never Date.now) so slugs stay collision-free.
 * The QA account's HubSpot connection is real — never disconnect it.
 */

const API = 'http://localhost:4400';

const RUN = Math.random().toString(36).slice(2, 8);
let seq = 0;
function uniqueName(label: string): string {
  seq += 1;
  return `v3w5-mapto-${label}-${RUN}-${seq}`;
}

/** Cover + an email question (the mapping target) + a text question. */
function buildConfig(withDestination: boolean) {
  return {
    version: 1,
    cover: { enabled: true, headline: 'Map to QA', ctaText: 'Start' },
    steps: [
      { key: 'work_email', type: 'email', question: 'Work email', required: true },
      { key: 'company', type: 'text', question: 'Company name' },
    ],
    // POST /v1/forms writes the LIVE config, so the destination is live+enabled
    // from creation (destinations are never staged in editor drafts).
    ...(withDestination ? { destinations: [{ type: 'hubspot', enabled: true }] } : {}),
  };
}

async function createForm(
  request: APIRequestContext,
  name: string,
  config: ReturnType<typeof buildConfig>,
): Promise<{ id: string }> {
  const res = await request.post(`${API}/v1/forms`, { data: { name, config } });
  expect(res.ok(), `create form failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: string };
}

test('picking a "Map to" property saves the live mapping; it persists and matches the Connect tab', async ({
  page,
  request,
}, testInfo) => {
  const { id } = await createForm(
    request,
    uniqueName(`map-w${testInfo.workerIndex}`),
    buildConfig(true),
  );

  await page.goto(`/admin/forms/${id}/edit`);

  // Build tab: the first question (the email step) is selected by default and
  // the HubSpot section renders in the right settings panel. (Generous timeout:
  // a dev-server first compile of the editor route can take >5s.)
  const section = page.getByTestId('qs-hubspot-section');
  await expect(section).toBeVisible({ timeout: 20_000 });

  // The Map to picker appears once the account-level HubSpot data resolves
  // (server action; the QA account is connected with a real property list).
  const mapto = page.getByTestId('qs-hubspot-mapto');
  await expect(mapto).toBeVisible({ timeout: 20_000 });

  // Open the searchable picker, filter, and pick the `email` contact property.
  await mapto.getByRole('button', { name: 'Map to' }).click();
  await mapto.getByRole('textbox').fill('email');
  await mapto.getByRole('option', { name: 'Email (email)', exact: true }).click();

  // Optimistic UI + the saved flash once the server confirms.
  await expect(mapto.getByRole('button', { name: 'Map to' })).toContainText('Email (email)');
  await expect(page.getByTestId('qs-hubspot-saved')).toBeVisible({ timeout: 15_000 });

  // The LIVE config's hubspot destination carries the mapping (partial write —
  // the single source of truth both editor surfaces read).
  await expect
    .poll(
      async () => {
        const res = await request.get(`${API}/v1/forms/${id}`);
        const f = (await res.json()) as {
          config?: {
            destinations?: { type: string; fieldMappings?: Record<string, string> }[];
          };
        };
        return (
          f.config?.destinations?.find((d) => d.type === 'hubspot')?.fieldMappings?.work_email ??
          null
        );
      },
      { timeout: 15_000, message: 'live destinations should carry fieldMappings.work_email' },
    )
    .toBe('email');

  // Persistence: reload the editor — the section re-reads the live
  // destinations and preselects the stored property.
  await page.goto(`/admin/forms/${id}/edit`);
  await expect(page.getByTestId('qs-hubspot-mapto').getByRole('button', { name: 'Map to' })).toContainText(
    'Email (email)',
    { timeout: 20_000 },
  );

  // Single source of truth: the Connect tab's "Map questions" row for this
  // question shows the same property in its picker.
  await page.getByTestId('editor-tab-connect').click();
  const integrations = page.getByTestId('connect-integrations');
  await expect(integrations).toBeVisible();
  await expect(
    integrations.getByRole('button', { name: 'Work email → HubSpot property' }),
  ).toContainText('Email (email)', { timeout: 20_000 });
});

test('switching questions scopes the picker to each question’s own mapping', async ({
  page,
  request,
}, testInfo) => {
  const { id } = await createForm(
    request,
    uniqueName(`scope-w${testInfo.workerIndex}`),
    buildConfig(true),
  );

  await page.goto(`/admin/forms/${id}/edit`);
  const mapto = page.getByTestId('qs-hubspot-mapto');
  await expect(mapto).toBeVisible({ timeout: 20_000 });

  // Map question 1 (work_email) → email.
  await mapto.getByRole('button', { name: 'Map to' }).click();
  await mapto.getByRole('textbox').fill('email');
  await mapto.getByRole('option', { name: 'Email (email)', exact: true }).click();
  await expect(page.getByTestId('qs-hubspot-saved')).toBeVisible({ timeout: 15_000 });

  // Select question 2 (company): the cached data renders instantly and its
  // picker is EMPTY (mappings are per question key, "None" prompt row shows).
  await page.getByRole('button', { name: /Company name/ }).first().click();
  await expect(mapto.getByRole('button', { name: 'Map to' })).toContainText('None');

  // Back to question 1: still mapped.
  await page.getByRole('button', { name: /Work email/ }).first().click();
  await expect(mapto.getByRole('button', { name: 'Map to' })).toContainText('Email (email)');
});

test('without an enabled HubSpot destination the section shows the "Set up in Connect" CTA', async ({
  page,
  request,
}, testInfo) => {
  const { id } = await createForm(
    request,
    uniqueName(`cta-w${testInfo.workerIndex}`),
    buildConfig(false),
  );

  await page.goto(`/admin/forms/${id}/edit`);

  const section = page.getByTestId('qs-hubspot-section');
  await expect(section).toBeVisible({ timeout: 20_000 });

  // Connected account, but this form has no enabled hubspot destination →
  // muted hint + CTA; no Map to picker.
  const cta = page.getByTestId('qs-hubspot-connect-cta');
  await expect(cta).toBeVisible({ timeout: 20_000 });
  await expect(section.getByText(/isn.t enabled on this form/)).toBeVisible();
  await expect(page.getByTestId('qs-hubspot-mapto')).toHaveCount(0);

  // The CTA switches the editor to the Connect tab (URL syncs shallowly).
  await cta.click();
  await expect(page.getByTestId('connect-panel')).toBeVisible();
  await expect(page).toHaveURL(/tab=connect/);
});
