import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * V3 W4 — HubSpot custom-mapping + value-map key UX ("Form step key no se sabe
 * qué tiene que ir ahí").
 *
 * The free-text "Form step key" inputs became a branded searchable Select
 * (grouped: the form's own unmapped questions + the auto-captured UTM system
 * fields) with a "Custom key…" escape hatch back to free text for
 * hidden/advanced keys:
 *  a. a custom-mapping row's key picker lists the unmapped question keys AND
 *     utm_source; picking utm_source + a property saves and re-hydrates;
 *  b. a value-map group's key picker lists questions only (choice types
 *     first — they are the translate case) and persists an answer→CRM row;
 *  c. the "Custom key…" escape swaps the row to a free-text input (with a way
 *     back), and a saved custom key renders back in custom mode.
 *
 * The save payload shape is unchanged (plain string keys in the destination
 * config) — asserted via the admin API after each save.
 *
 * Forms are created per test via the admin API (v3w4- slug prefix via the
 * name); unique names use a worker-scoped counter (no Date.now()). This QA
 * env's account-level HubSpot connection is real — the tests only read the
 * property list and never touch the connection.
 */

const API = 'http://localhost:4400';

let seq = 0;
function formName(label: string, workerIndex: number): string {
  seq += 1;
  return `v3w4 mapping ${label} w${workerIndex}-${seq}`;
}

/** Email + a choice question ("área") — the value-map/translate case. */
const baseConfig = {
  version: 1,
  cover: { enabled: true, headline: 'Mapping UX QA', ctaText: 'Start' },
  steps: [
    { key: 'email', type: 'email', question: 'Email', required: true },
    {
      key: 'area',
      type: 'multiple_choice',
      question: 'área',
      options: [
        { label: 'Ventas', value: 'Ventas' },
        { label: 'Soporte', value: 'Soporte' },
      ],
    },
  ],
};

async function createForm(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post(`${API}/v1/forms`, { data: { name, config: baseConfig } });
  expect(res.ok(), `create form failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; slug: string };
  expect(body.slug.startsWith('v3w4-'), `slug ${body.slug} must be v3w4- prefixed`).toBeTruthy();
  return body.id;
}

async function getHubspotDestination(request: APIRequestContext, id: string) {
  const res = await request.get(`${API}/v1/forms/${id}`);
  expect(res.ok(), `GET form failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as {
    config?: { destinations?: Array<Record<string, unknown>> };
  };
  return (body.config?.destinations ?? []).find((d) => d.type === 'hubspot');
}

/** Open the Connect tab and wait for the embedded IntegrationsEditor. */
async function openConnect(page: Page, id: string) {
  await page.goto(`/admin/forms/${id}/edit?tab=connect`);
  await expect(page.getByTestId('connect-panel')).toBeVisible();
  await expect(page.getByRole('switch', { name: 'HubSpot', exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

/** Enable the HubSpot card (fresh forms start disabled; the body is collapsed). */
async function enableHubspot(page: Page) {
  const toggle = page.getByRole('switch', { name: 'HubSpot', exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
}

async function saveAndToast(page: Page) {
  await page.getByRole('button', { name: 'Save integrations', exact: true }).click();
  await expect(page.getByText('Integrations saved.')).toBeVisible({ timeout: 10_000 });
}

/** The custom row's HubSpot property picker (exact label — question rows are
 *  prefixed "<question> → HubSpot property", UTM rows "utm_x HubSpot property"). */
async function pickRowProperty(page: Page, search: string, optionLabel: string) {
  const trigger = page.getByRole('button', { name: 'HubSpot property', exact: true });
  await trigger.click();
  await page.getByPlaceholder('Search…').fill(search);
  await page.getByRole('option', { name: optionLabel, exact: true }).click();
  await expect(trigger).toContainText(optionLabel);
}

test('custom mapping key Select lists unmapped questions + UTM system fields; utm_source mapping persists', async ({
  page,
  request,
}, testInfo) => {
  const id = await createForm(request, formName('key-select', testInfo.workerIndex));
  await openConnect(page, id);
  await enableHubspot(page);

  await page.getByRole('button', { name: 'Add mapping', exact: true }).click();
  const keySelect = page.getByTestId('mapping-key-select');
  await expect(keySelect).toBeVisible();

  // Open the key picker: grouped options — both (unmapped) questions under
  // "Form questions", the UTMs under "System fields", plus the custom escape.
  await keySelect.getByRole('button', { name: 'Form step key' }).click();
  await expect(keySelect.getByRole('listbox')).toBeVisible();
  await expect(keySelect.getByRole('option', { name: 'Form questions', exact: true })).toBeVisible();
  await expect(keySelect.getByRole('option', { name: 'Email (email)', exact: true })).toBeVisible();
  await expect(keySelect.getByRole('option', { name: 'área (area)', exact: true })).toBeVisible();
  await expect(keySelect.getByRole('option', { name: 'System fields', exact: true })).toBeVisible();
  await expect(keySelect.getByRole('option', { name: 'utm_source', exact: true })).toBeVisible();
  await expect(keySelect.getByRole('option', { name: 'Custom key…', exact: true })).toBeVisible();

  // Pick utm_source and map it to the portal's real utm_source property.
  await keySelect.getByRole('option', { name: 'utm_source', exact: true }).click();
  await expect(keySelect.getByRole('button', { name: 'Form step key' })).toContainText('utm_source');
  await pickRowProperty(page, 'utm_source', 'utm_source (utm_source)');

  await saveAndToast(page);

  // Payload shape unchanged: plain string keys in the destination config.
  const dest = await getHubspotDestination(request, id);
  expect(dest, 'hubspot destination should exist').toBeTruthy();
  expect(dest!.fieldMappings).toEqual({ utm_source: 'utm_source' });

  // Re-open: the stored key renders back in SELECT mode, still utm_source.
  await openConnect(page, id);
  await expect(page.getByRole('switch', { name: 'HubSpot', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(
    page.getByTestId('mapping-key-select').getByRole('button', { name: 'Form step key' }),
  ).toContainText('utm_source');
  await expect(page.getByTestId('mapping-key-custom')).toHaveCount(0);
});

test('value map key Select lists questions (choice types first); Ventas→sales row persists', async ({
  page,
  request,
}, testInfo) => {
  const id = await createForm(request, formName('valuemap', testInfo.workerIndex));
  await openConnect(page, id);
  await enableHubspot(page);

  await page.getByRole('button', { name: 'Add value translation', exact: true }).click();
  const vmSelect = page.getByTestId('valuemap-key-select');
  await expect(vmSelect).toBeVisible();

  // Open the picker: questions only (no System fields group), the choice
  // question "área" FIRST (before the email question), custom escape last.
  await vmSelect.getByRole('button', { name: 'Form step key' }).click();
  await expect(vmSelect.getByRole('listbox')).toBeVisible();
  await expect(vmSelect.getByRole('option', { name: 'Form questions', exact: true })).toBeVisible();
  await expect(vmSelect.getByRole('option').nth(1)).toHaveText('área (area)');
  await expect(vmSelect.getByRole('option', { name: 'Email (email)', exact: true })).toBeVisible();
  await expect(vmSelect.getByRole('option', { name: 'System fields' })).toHaveCount(0);
  await expect(vmSelect.getByRole('option', { name: 'Custom key…', exact: true })).toBeVisible();

  await vmSelect.getByRole('option', { name: 'área (area)', exact: true }).click();
  await expect(vmSelect.getByRole('button', { name: 'Form step key' })).toContainText('área (area)');

  // The translate row uses the clarified placeholders (answer → CRM value).
  await page.getByPlaceholder('Answer in the form').fill('Ventas');
  await page.getByPlaceholder('Value in HubSpot').fill('sales');

  await saveAndToast(page);

  const dest = await getHubspotDestination(request, id);
  expect(dest, 'hubspot destination should exist').toBeTruthy();
  expect(dest!.valueMaps).toEqual({ area: { Ventas: 'sales' } });

  // Re-open: group re-hydrates with the question selected and the row values.
  await openConnect(page, id);
  await expect(
    page.getByTestId('valuemap-key-select').getByRole('button', { name: 'Form step key' }),
  ).toContainText('área (area)');
  await expect(page.getByPlaceholder('Answer in the form')).toHaveValue('Ventas');
  await expect(page.getByPlaceholder('Value in HubSpot')).toHaveValue('sales');
});

test('Custom key… escape swaps to free text (with a way back); my_hidden_field persists in custom mode', async ({
  page,
  request,
}, testInfo) => {
  const id = await createForm(request, formName('custom-key', testInfo.workerIndex));
  await openConnect(page, id);
  await enableHubspot(page);

  await page.getByRole('button', { name: 'Add mapping', exact: true }).click();
  const keySelect = page.getByTestId('mapping-key-select');

  // Escape hatch: the row swaps to the free-text input…
  await keySelect.getByRole('button', { name: 'Form step key' }).click();
  await keySelect.getByRole('option', { name: 'Custom key…', exact: true }).click();
  await expect(page.getByTestId('mapping-key-custom')).toBeVisible();
  await expect(page.getByTestId('mapping-key-select')).toHaveCount(0);

  // …and "Back to list" restores the Select.
  await page.getByRole('button', { name: 'Back to list', exact: true }).click();
  await expect(page.getByTestId('mapping-key-select')).toBeVisible();
  await expect(page.getByTestId('mapping-key-custom')).toHaveCount(0);

  // Back into custom mode: type a hidden key and map it to a real property.
  await keySelect.getByRole('button', { name: 'Form step key' }).click();
  await keySelect.getByRole('option', { name: 'Custom key…', exact: true }).click();
  await page.getByTestId('mapping-key-custom').fill('my_hidden_field');
  await pickRowProperty(page, 'City', 'City (city)');

  await saveAndToast(page);

  const dest = await getHubspotDestination(request, id);
  expect(dest, 'hubspot destination should exist').toBeTruthy();
  expect(dest!.fieldMappings).toEqual({ my_hidden_field: 'city' });

  // Re-open: a key that matches neither group renders back in CUSTOM mode.
  await openConnect(page, id);
  await expect(page.getByTestId('mapping-key-custom')).toHaveValue('my_hidden_field');
  await expect(page.getByTestId('mapping-key-select')).toHaveCount(0);
});
