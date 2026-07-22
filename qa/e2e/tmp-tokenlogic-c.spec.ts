import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/** THROWAWAY QA probe — A6 logic advisories (narrow) + contradiction guard. */

const API = 'http://localhost:4400';
const RUN = randomUUID().slice(0, 6);
let seq = 0;
function uniqueName(label: string): string {
  seq += 1;
  return `tmp-tlg-${label}-${RUN}-${seq}`;
}

async function createForm(
  request: APIRequestContext,
  name: string,
  config: unknown,
): Promise<{ id: string; path: string }> {
  const res0 = await request.get(`${API}/v1/me`);
  const code = ((await res0.json()) as { accountCode: string }).accountCode;
  const res = await request.post(`${API}/v1/forms`, { data: { name, config } });
  expect(res.ok(), `create failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; slug: string };
  return { id: body.id, path: `/${code}/me/${body.slug}` };
}

const Q_BUDGET = 'Budget?';
const Q_LEADS = 'Leads per month?';
const Q_PICK = 'Pick one';
const Q_REASON = 'Why?';

function logicConfig() {
  return {
    version: 1,
    cover: { enabled: true, headline: 'logic', ctaText: 'Start' },
    steps: [
      { key: 'budget', type: 'slider', question: Q_BUDGET, min: 0, max: 1000, default: 100 },
      { key: 'leads', type: 'slider', question: Q_LEADS, min: 0, max: 100, default: 10 },
      {
        key: 'pick',
        type: 'multiple_choice',
        question: Q_PICK,
        options: [
          { label: 'Alpha', value: 'a' },
          { label: 'Beta', value: 'b' },
          { label: 'Gamma', value: 'c' },
        ],
      },
      { key: 'reason', type: 'text', question: Q_REASON },
    ],
  };
}

async function pickFromSelect(page: Page, name: string, optionName: string) {
  const trigger = page.getByRole('button', { name });
  await trigger.scrollIntoViewIfNeeded();
  const listbox = page.getByRole('listbox', { name });
  for (let i = 0; i < 4; i += 1) {
    await trigger.click();
    if (await listbox.isVisible().catch(() => false)) break;
    await page.waitForTimeout(200);
  }
  await listbox.getByRole('option', { name: optionName, exact: true }).click();
}

/** Set one side (show|hide) to a numeric rule on a slider field. */
async function setNumericRule(
  page: Page,
  side: 'Show' | 'Hide',
  field: string,
  op: 'Equal to' | 'Greater than' | 'Less than' | 'Between',
  operands: { value?: string; min?: string; max?: string },
) {
  const label = side === 'Show' ? 'Show when' : 'Hide when';
  const testid = side === 'Show' ? 'logic-show' : 'logic-hide';
  await pickFromSelect(page, `${label} — Field`, field);
  await pickFromSelect(page, `${label} — Condition`, op);
  if (op === 'Between') {
    if (operands.min !== undefined) await page.getByTestId(`${testid}-min`).fill(operands.min);
    if (operands.max !== undefined) await page.getByTestId(`${testid}-max`).fill(operands.max);
  } else if (operands.value !== undefined) {
    await page.getByTestId(`${testid}-value`).fill(operands.value);
  }
}

async function advisories(page: Page, label: string) {
  const narrow = page.getByTestId('logic-narrow');
  const contra = page.getByTestId('logic-contradiction');
  const out = {
    case: label,
    narrow: (await narrow.count()) ? ((await narrow.textContent()) ?? '').trim() : null,
    contradiction: (await contra.count()) ? ((await contra.textContent()) ?? '').trim() : null,
  };
  // eslint-disable-next-line no-console
  console.log('ADVISORY ' + JSON.stringify(out));
  return out;
}

async function openReason(page: Page, id: string) {
  await page.goto(`/admin/forms/${id}/edit`);
  await expect(page.getByTestId('canvas-title-input')).toHaveValue(Q_BUDGET);
  await page.getByRole('button', { name: Q_REASON }).first().click();
  await expect(page.getByTestId('canvas-title-input')).toHaveValue(Q_REASON);
}

async function clearRules(page: Page) {
  // "Clear" buttons appear next to each configured rule.
  for (let i = 0; i < 4; i += 1) {
    const clear = page.getByRole('button', { name: 'Clear' }).first();
    if (!(await clear.isVisible().catch(() => false))) break;
    await clear.click();
    await page.waitForTimeout(100);
  }
}

test('A6 probe — numeric show/hide combination matrix', async ({ page, request }) => {
  const { id } = await createForm(request, uniqueName('matrix'), logicConfig());
  await openReason(page, id);

  // 1. documented happy path: show between 200..500 + hide gt 201
  await setNumericRule(page, 'Show', Q_BUDGET, 'Between', { min: '200', max: '500' });
  await setNumericRule(page, 'Hide', Q_BUDGET, 'Greater than', { value: '201' });
  await advisories(page, 'show between 200..500 / hide gt 201');

  // 2. hide clips a single endpoint: show between 0..100 + hide eq 0
  await clearRules(page);
  await setNumericRule(page, 'Show', Q_BUDGET, 'Between', { min: '0', max: '100' });
  await setNumericRule(page, 'Hide', Q_BUDGET, 'Equal to', { value: '0' });
  await advisories(page, 'show between 0..100 / hide eq 0');

  // 3. same but at the top end
  await clearRules(page);
  await setNumericRule(page, 'Show', Q_BUDGET, 'Between', { min: '0', max: '100' });
  await setNumericRule(page, 'Hide', Q_BUDGET, 'Equal to', { value: '100' });
  await advisories(page, 'show between 0..100 / hide eq 100');

  // 4. hole in the middle: show between 0..100 + hide between 40..60
  await clearRules(page);
  await setNumericRule(page, 'Show', Q_BUDGET, 'Between', { min: '0', max: '100' });
  await setNumericRule(page, 'Hide', Q_BUDGET, 'Between', { min: '40', max: '60' });
  await advisories(page, 'show between 0..100 / hide between 40..60 (hole)');

  // 5. no overlap at all: show between 0..100 + hide gt 500
  await clearRules(page);
  await setNumericRule(page, 'Show', Q_BUDGET, 'Between', { min: '0', max: '100' });
  await setNumericRule(page, 'Hide', Q_BUDGET, 'Greater than', { value: '500' });
  await advisories(page, 'show between 0..100 / hide gt 500 (inert hide)');

  // 6. open-ended show clipped by hide: show lt 100 + hide gt 50
  await clearRules(page);
  await setNumericRule(page, 'Show', Q_BUDGET, 'Less than', { value: '100' });
  await setNumericRule(page, 'Hide', Q_BUDGET, 'Greater than', { value: '50' });
  await advisories(page, 'show lt 100 / hide gt 50');

  // 7. open-ended the other way: show gt 10 + hide lt 50
  await clearRules(page);
  await setNumericRule(page, 'Show', Q_BUDGET, 'Greater than', { value: '10' });
  await setNumericRule(page, 'Hide', Q_BUDGET, 'Less than', { value: '50' });
  await advisories(page, 'show gt 10 / hide lt 50');

  // 8. different fields (must stay silent)
  await clearRules(page);
  await setNumericRule(page, 'Show', Q_BUDGET, 'Greater than', { value: '10' });
  await setNumericRule(page, 'Hide', Q_LEADS, 'Greater than', { value: '5' });
  await advisories(page, 'show budget gt 10 / hide leads gt 5 (different fields)');

  // 9. hard contradiction still works
  await clearRules(page);
  await setNumericRule(page, 'Show', Q_BUDGET, 'Equal to', { value: '5' });
  await setNumericRule(page, 'Hide', Q_BUDGET, 'Equal to', { value: '5' });
  await advisories(page, 'show eq 5 / hide eq 5 (contradiction)');

  // 10. show gt 10 / hide gt 20 (clips the open end)
  await clearRules(page);
  await setNumericRule(page, 'Show', Q_BUDGET, 'Greater than', { value: '10' });
  await setNumericRule(page, 'Hide', Q_BUDGET, 'Greater than', { value: '20' });
  await advisories(page, 'show gt 10 / hide gt 20');
});

test('A6 probe — incomplete + inverted operands', async ({ page, request }) => {
  const { id } = await createForm(request, uniqueName('bad'), logicConfig());
  await openReason(page, id);

  // A. show `gt` with NO value typed at all
  await pickFromSelect(page, 'Show when — Field', Q_BUDGET);
  await pickFromSelect(page, 'Show when — Condition', 'Greater than');
  await advisories(page, 'show gt <empty operand>');
  // eslint-disable-next-line no-console
  console.log('EMPTY OPERAND value input =', await page.getByTestId('logic-show-value').inputValue());

  // B. between with min > max
  await clearRules(page);
  await setNumericRule(page, 'Show', Q_BUDGET, 'Between', { min: '500', max: '200' });
  await advisories(page, 'show between min 500 max 200 (inverted)');

  // read back what got saved
  await page.waitForTimeout(1200);
  const res = await request.get(`${API}/v1/forms/${id}`);
  const body = (await res.json()) as { config?: { steps: unknown[] }; draftConfig?: { steps: unknown[] } };
  // eslint-disable-next-line no-console
  console.log('SAVED STEP: ' + JSON.stringify((body.draftConfig ?? body.config)?.steps?.[3]));
});

test('A6 probe — choice rules stay silent', async ({ page, request }) => {
  const { id } = await createForm(request, uniqueName('choice'), logicConfig());
  await openReason(page, id);

  // show pick in [Alpha, Beta] / hide pick in [Beta, Gamma] — partial overlap
  await pickFromSelect(page, 'Show when — Field', Q_PICK);
  await pickFromSelect(page, 'Hide when — Field', Q_PICK);
  // Both seed with the first option (Alpha). Toggle chips to build the sets.
  const showBox = page.locator('div', { hasText: /^Show when/ });
  // eslint-disable-next-line no-console
  console.log('choice chips present:', await page.getByRole('group', { name: 'Matches any of' }).count());
  await advisories(page, 'choice show[a] / hide[a] identical');

  // Now make hide = [Beta] only → partial/no overlap
  const groups = page.getByRole('group', { name: 'Matches any of' });
  await groups.nth(1).getByRole('button', { name: 'Beta' }).click();
  await groups.nth(1).getByRole('button', { name: 'Alpha' }).click();
  await advisories(page, 'choice show[a] / hide[b] (disjoint)');

  await groups.nth(0).getByRole('button', { name: 'Beta' }).click();
  await advisories(page, 'choice show[a,b] / hide[b] (partial overlap)');
  await expect(showBox.first()).toBeVisible();
});
