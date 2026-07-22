import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const API = 'http://127.0.0.1:4400';
const RUN = Math.random().toString(36).slice(2, 8);
let seq = 0;
function uniqueName(label: string): string {
  seq += 1;
  return `a11y2-${label}-${RUN}-${seq}`;
}
const cover = (headline: string) => ({ enabled: true, headline, ctaText: 'Start' });

async function createForm(
  request: APIRequestContext,
  name: string,
  config: Record<string, unknown>,
): Promise<{ id: string; slug: string }> {
  const res = await request.post(`${API}/v1/forms`, { data: { name, config: { version: 1, ...config } } });
  expect(res.ok(), `form creation failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; slug: string };
  return { id: body.id, slug: body.slug };
}

async function openEditor(page: Page, id: string, tab?: string): Promise<void> {
  await page.goto(`/admin/forms/${id}/edit${tab ? `?tab=${tab}` : ''}`);
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible({ timeout: 20_000 });
}

async function active(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return { tag: 'none' };
    return {
      tag: el.tagName,
      testid: el.getAttribute('data-testid'),
      label: el.getAttribute('aria-label'),
      text: (el.textContent || '').trim().slice(0, 40),
      value: (el as HTMLInputElement).value?.slice(0, 30),
      focusVisible: el.matches(':focus-visible'),
      outline: getComputedStyle(el).outlineWidth + ' ' + getComputedStyle(el).outlineStyle,
      boxShadow: getComputedStyle(el).boxShadow?.slice(0, 60),
    };
  });
}

test.describe('V5 a11y round 2', () => {
  test.setTimeout(90_000);

  test('slider number fields: accessible names (A2/A3 surface)', async ({ page, request }) => {
    const { id } = await createForm(request, uniqueName('slider'), {
      cover: cover('Slider a11y QA'),
      scoring: { enabled: true },
      steps: [
        {
          key: 'leads',
          type: 'slider',
          question: 'Leads?',
          min: 0,
          max: 100,
          default: 10,
          sliderScoring: [{ min: 0, max: 50, points: 1 }],
        },
      ],
    });
    await openEditor(page, id);

    // Every number input in the slider props grid + its computed a11y wiring.
    const info = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label')).map((l) => ({
        text: (l.textContent || '').trim(),
        htmlFor: l.getAttribute('for'),
      }));
      const nums = Array.from(document.querySelectorAll<HTMLInputElement>('input[type=number]')).map((i) => ({
        id: i.id || null,
        ariaLabel: i.getAttribute('aria-label'),
        labelledby: i.getAttribute('aria-labelledby'),
        value: i.value,
        // the visible label text sitting above it, for context
        nearbyLabel: (i.closest('div')?.parentElement?.querySelector('label')?.textContent || '').trim(),
      }));
      return { labels: labels.slice(0, 25), nums };
    });
    console.log('SLIDER labels:', JSON.stringify(info.labels));
    console.log('SLIDER number inputs:', JSON.stringify(info.nums, null, 1));

    console.log('byRole spinbutton Default count =', await page.getByRole('spinbutton', { name: /Default/i }).count());
    console.log('byRole spinbutton Min count =', await page.getByRole('spinbutton', { name: /Min/i }).count());
    console.log('byRole spinbutton ANY-name list =', JSON.stringify(await page.getByRole('spinbutton').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))));

    // Drive the A2 warning purely by keyboard on the 4th number field (Default).
    const nums = page.locator('input[type=number]');
    const count = await nums.count();
    console.log('number field count =', count);
    const def = nums.nth(3);
    await def.click();
    await def.fill('500');
    await page.waitForTimeout(600);
    const warn = page.getByTestId('slider-default-out-of-range');
    console.log('A2 default-out-of-range count=', await warn.count(), 'role=', await warn.first().getAttribute('role').catch(() => 'x'), 'text=', (await warn.first().textContent().catch(() => ''))?.trim().slice(0, 120));
    console.log('A2 default input aria-invalid=', await def.getAttribute('aria-invalid'), 'describedby=', await def.getAttribute('aria-describedby'));

    // max below min
    const max = nums.nth(1);
    await max.fill('-5');
    await page.waitForTimeout(600);
    const w2 = page.getByTestId('slider-max-below-min');
    console.log('A2 max-below-min count=', await w2.count(), 'role=', await w2.first().getAttribute('role').catch(() => 'x'));
    console.log('A3 range-unreachable count=', await page.getByTestId('slider-range-unreachable').count(), 'role=', await page.getByTestId('slider-range-unreachable').first().getAttribute('role').catch(() => 'x'));
  });

  test('HelpTip full keyboard sequence', async ({ page, request }) => {
    const { id } = await createForm(request, uniqueName('helptip'), {
      cover: cover('HelpTip QA'),
      steps: [{ key: 'phone', type: 'phone', question: 'Your phone?' }],
    });
    await openEditor(page, id);

    const trigger = page.getByTestId('help-tip-trigger').first();
    await expect(trigger).toBeVisible();
    console.log('HT trigger tag=', await trigger.evaluate((e) => e.tagName), 'aria-label=', await trigger.getAttribute('aria-label'));

    // 1. Reach it by TAB from the control before it.
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    // Focus the element right before the tip, then Tab.
    await trigger.evaluate((el) => {
      const all = Array.from(document.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex="0"]'));
      const i = all.indexOf(el as HTMLElement);
      all[i - 1]?.focus();
    });
    console.log('HT before tab, focus=', JSON.stringify(await active(page)));
    await page.keyboard.press('Tab');
    console.log('HT after tab, focus=', JSON.stringify(await active(page)));
    console.log('HT bubble visible after tab-in =', await page.getByTestId('help-tip-bubble').count());
    console.log('HT describedby after tab-in =', await trigger.getAttribute('aria-describedby'), 'expanded=', await trigger.getAttribute('aria-expanded'));

    // 2. The natural "activate" gesture on a focused control CLOSES it.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    console.log('HT after Enter: bubble count=', await page.getByTestId('help-tip-bubble').count(), 'expanded=', await trigger.getAttribute('aria-expanded'));
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    console.log('HT after Space: bubble count=', await page.getByTestId('help-tip-bubble').count());

    // 3. Escape from a keyboard-open tip, then the SAME element stays focused.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    console.log('HT after Escape: bubble count=', await page.getByTestId('help-tip-bubble').count(), 'focus=', JSON.stringify(await active(page)));

    // 4. With the tip closed by Escape while still focused, can the keyboard user
    //    re-open it without leaving and coming back?
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    console.log('HT re-open by Enter after Escape: bubble count=', await page.getByTestId('help-tip-bubble').count());

    // 5. Focus ring on the trigger.
    console.log('HT focus styles =', JSON.stringify(await active(page)));

    // 6. Mouse-click to pin open, then move the pointer away.
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await trigger.click();
    await page.waitForTimeout(150);
    console.log('HT after mouse click: bubble count=', await page.getByTestId('help-tip-bubble').count());
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
    console.log('HT after moving pointer away: bubble count=', await page.getByTestId('help-tip-bubble').count());
  });

  test('create dialog: focus trap + restore', async ({ page }) => {
    await page.goto('/admin/forms');
    const createBtn = page.getByRole('button', { name: /^Create/ }).first();
    await expect(createBtn).toBeVisible({ timeout: 20_000 });
    await createBtn.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('input[name="name"]')).toBeVisible();

    // Identify the create dialog node precisely.
    const dlgInfo = await page.evaluate(() => {
      const ds = Array.from(document.querySelectorAll('[role=dialog],[role=alertdialog]'));
      return ds.map((d) => ({
        role: d.getAttribute('role'),
        modal: d.getAttribute('aria-modal'),
        labelledby: d.getAttribute('aria-labelledby'),
        hasNameInput: !!d.querySelector('input[name=name]'),
        hidden: (d as HTMLElement).offsetParent === null,
        cls: d.className?.toString().slice(0, 60),
      }));
    });
    console.log('DIALOGS:', JSON.stringify(dlgInfo, null, 1));

    // Tab 10 times and record whether focus is inside the dialog that owns the input.
    const path: unknown[] = [];
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      path.push(
        await page.evaluate(() => {
          const owner = Array.from(document.querySelectorAll('[role=dialog],[role=alertdialog]')).find((d) =>
            d.querySelector('input[name=name]'),
          );
          const el = document.activeElement as HTMLElement | null;
          return {
            tag: el?.tagName,
            text: (el?.textContent || '').trim().slice(0, 24),
            testid: el?.getAttribute('data-testid'),
            insideCreateDialog: owner && el ? owner.contains(el) : null,
          };
        }),
      );
    }
    console.log('TRAP path:', JSON.stringify(path, null, 1));

    // Shift+Tab backwards from the first field, too.
    await page.locator('input[name="name"]').focus();
    const back: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Shift+Tab');
      back.push(
        await page.evaluate(() => {
          const owner = Array.from(document.querySelectorAll('[role=dialog],[role=alertdialog]')).find((d) =>
            d.querySelector('input[name=name]'),
          );
          const el = document.activeElement as HTMLElement | null;
          return { tag: el?.tagName, text: (el?.textContent || '').trim().slice(0, 24), insideCreateDialog: owner && el ? owner.contains(el) : null };
        }),
      );
    }
    console.log('TRAP back path:', JSON.stringify(back, null, 1));

    // Focus restore: close with Escape while focus is inside the dialog.
    await page.locator('input[name="name"]').focus();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    console.log('after Escape: name input count=', await page.locator('input[name="name"]').count(), 'focus=', JSON.stringify(await active(page)));

    // Reopen, submit empty, check the error and focus target precisely.
    await createBtn.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('input[name="name"]')).toBeVisible();
    const submit = page.getByRole('button', { name: 'Create form' });
    await submit.focus();
    console.log('before submit focus=', JSON.stringify(await active(page)));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const focusAfter = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      const input = document.querySelector('input[name=name]');
      return { tag: el?.tagName, isNameInput: el === input, text: (el?.textContent || '').trim().slice(0, 24), type: el?.getAttribute('type') };
    });
    console.log('CREATE after empty submit: error count=', await page.getByTestId('create-form-name-error').count(), 'focus=', JSON.stringify(focusAfter));
  });

  test('results inert fieldset detail', async ({ page, request }) => {
    const { id } = await createForm(request, uniqueName('inert'), {
      cover: cover('Inert QA'),
      scoring: { enabled: false },
      steps: [
        { key: 'pick', type: 'multiple_choice', question: 'Pick', options: [{ label: 'A', value: 'a', points: 5 }] },
      ],
      outcomes: [
        { id: 'p2', label: 'P2', minScore: 0, redirectUrl: 'https://example.com/p2' },
        { id: 'p1', label: 'P1', minScore: 5, redirectUrl: 'https://example.com/p1' },
      ],
    });
    await openEditor(page, id, 'results');
    const end = page.getByTestId('results-end');
    await expect(end).toBeVisible();
    console.log('scoring-off=', await end.getAttribute('data-scoring-off'));
    const inert = page.getByTestId('results-outcomes-inert');
    console.log('inert reason:', (await inert.first().textContent())?.trim());
    const fs = end.locator('fieldset');
    console.log('fieldset disabled=', await fs.getAttribute('disabled'), 'aria-describedby=', await fs.getAttribute('aria-describedby'), 'legends=', await fs.locator('legend').count());
    const inside = await fs.evaluate((el) => {
      const sel = 'a[href],button,input,select,textarea,[tabindex],[role=button],[role=combobox]';
      return Array.from(el.querySelectorAll<HTMLElement>(sel)).map((e) => ({
        tag: e.tagName,
        testid: e.getAttribute('data-testid'),
        role: e.getAttribute('role'),
        disabledProp: (e as HTMLButtonElement).disabled ?? null,
        tabindex: e.getAttribute('tabindex'),
        text: (e.textContent || '').trim().slice(0, 24),
      }));
    });
    console.log('inside fieldset:', JSON.stringify(inside, null, 1));

    // Tab the whole page and see whether anything inside the fieldset receives focus.
    await page.keyboard.press('Tab');
    const reached: unknown[] = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      reached.push(
        await page.evaluate(() => {
          const fs2 = document.querySelector('[data-testid=results-end] fieldset');
          const el = document.activeElement as HTMLElement | null;
          return {
            t: el?.tagName,
            id: el?.getAttribute('data-testid'),
            x: (el?.getAttribute('aria-label') || (el?.textContent || '')).trim().slice(0, 22),
            inFs: fs2 && el ? fs2.contains(el) : false,
          };
        }),
      );
    }
    console.log('TAB ORDER results:', JSON.stringify(reached));

    // Turn scoring ON via keyboard and confirm the panel comes alive.
    const toggle = page.getByRole('switch').first();
    console.log('first switch label=', await toggle.getAttribute('aria-label'));
  });

  test('reveal edit link: focus after navigation + tab semantics', async ({ page, request }) => {
    const { id } = await createForm(request, uniqueName('reveal'), {
      cover: cover('Reveal QA'),
      reveal: { enabled: true, headline: 'Matching…', durationMs: 800 },
      steps: [{ key: 'email', type: 'email', question: 'Email?' }],
    });
    await openEditor(page, id);

    const tabsInfo = await page.evaluate(() => {
      const t = document.querySelector('[data-testid=editor-tab-design]');
      const list = t?.parentElement;
      return {
        tabTag: t?.tagName,
        tabRole: t?.getAttribute('role'),
        ariaSelected: t?.getAttribute('aria-selected'),
        ariaCurrent: t?.getAttribute('aria-current'),
        listRole: list?.getAttribute('role'),
      };
    });
    console.log('EDITOR TABS semantics:', JSON.stringify(tabsInfo));

    const info = page.getByTestId('reveal-point-info');
    await info.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    const edit = page.getByTestId('reveal-point-edit');
    console.log('edit link present=', await edit.count(), 'tag=', await edit.first().evaluate((e) => e.tagName));

    // Escape while popover open
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    console.log('after Escape popover still open? count=', await page.getByTestId('reveal-point-edit').count());

    // Activate with keyboard, check focus after nav
    await edit.first().focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1200);
    console.log('URL now=', page.url());
    console.log('focus after nav=', JSON.stringify(await active(page)));
    const tabsAfter = await page.evaluate(() => {
      const t = document.querySelector('[data-testid=editor-tab-design]');
      return { ariaSelected: t?.getAttribute('aria-selected'), ariaCurrent: t?.getAttribute('aria-current'), cls: t?.className?.toString().slice(0, 80) };
    });
    console.log('design tab after nav:', JSON.stringify(tabsAfter));
    // Is the reveal panel present / does anything announce the move?
    console.log('reveal panel testids present:', await page.locator('[data-testid^=reveal-]').count());
  });

  test('bare @key token warning semantics', async ({ page, request }) => {
    const { id } = await createForm(request, uniqueName('token'), {
      cover: cover('Token QA'),
      steps: [
        { key: 'email', type: 'email', question: 'Email?' },
        { key: 'company', type: 'text', question: 'Company?' },
      ],
    });
    await openEditor(page, id);
    await page.getByRole('button', { name: /Company\?/ }).first().click();
    const title = page.getByTestId('canvas-title-input');
    await expect(title).toBeVisible();
    await title.click();
    await title.fill('');
    await title.pressSequentially('Hi @nosuchkey there', { delay: 25 });
    await page.waitForTimeout(800);
    const warn = page.getByTestId('token-warning');
    console.log('TOKEN warn count=', await warn.count(), 'kind=', await warn.first().getAttribute('data-kind').catch(() => 'x'), 'form=', await warn.first().getAttribute('data-form').catch(() => 'x'));
    console.log('TOKEN role=', await warn.first().getAttribute('role').catch(() => 'x'), 'aria-live=', await warn.first().getAttribute('aria-live').catch(() => 'x'), 'text=', (await warn.first().textContent().catch(() => ''))?.trim().slice(0, 100));
    console.log('TOKEN textarea describedby=', await title.getAttribute('aria-describedby'), 'role=', await title.getAttribute('role'), 'expanded=', await title.getAttribute('aria-expanded'), 'controls=', await title.getAttribute('aria-controls'), 'activedesc=', await title.getAttribute('aria-activedescendant'));

    // bracket form for comparison
    await title.fill('');
    await title.pressSequentially('Hi [nosuchkey] there', { delay: 25 });
    await page.waitForTimeout(600);
    console.log('BRACKET warn count=', await page.getByTestId('token-warning').count(), 'kind=', await page.getByTestId('token-warning').first().getAttribute('data-kind').catch(() => 'x'), 'form=', await page.getByTestId('token-warning').first().getAttribute('data-form').catch(() => 'x'), 'role=', await page.getByTestId('token-warning').first().getAttribute('role').catch(() => 'x'));
  });

  test('multi-pick chips: real Tab reachability + focus ring', async ({ page, request }) => {
    const { id } = await createForm(request, uniqueName('chips'), {
      cover: cover('Chips QA'),
      steps: [
        {
          key: 'tools',
          type: 'multiple_choice',
          selectionMode: 'multiple',
          question: 'Which tools?',
          options: [
            { label: 'Alpha', value: 'a', points: 0 },
            { label: 'Beta', value: 'b', points: 0 },
          ],
        },
        { key: 'topic', type: 'text', question: 'Tell us more', questionField: 'tools', questionVariants: { a: 'Alpha follow-up' } },
      ],
    });
    await openEditor(page, id);
    await page.getByRole('button', { name: /Tell us more/ }).first().click();
    const chips = page.getByTestId('variant-multi-option');
    await expect(chips.first()).toBeVisible();

    // Tab to the first chip from the control before it, so :focus-visible applies.
    await chips.first().evaluate((el) => {
      const all = Array.from(document.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex="0"]'));
      all[all.indexOf(el as HTMLElement) - 1]?.focus();
    });
    await page.keyboard.press('Tab');
    console.log('CHIP reached by Tab:', JSON.stringify(await active(page)));

    // The group semantics
    const grp = await chips.first().evaluate((el) => {
      const g = el.closest('[role=group]');
      return { groupRole: g?.getAttribute('role'), groupLabel: g?.getAttribute('aria-label'), childCount: g?.children.length };
    });
    console.log('CHIP group:', JSON.stringify(grp));

    // Sole-ticked option untick with Space
    const alpha = chips.first();
    console.log('before untick: pressed=', await alpha.getAttribute('aria-pressed'));
    await alpha.focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
    console.log('after Space untick attempt: pressed=', await alpha.getAttribute('aria-pressed'), 'disabled=', await alpha.getAttribute('disabled'), 'aria-disabled=', await alpha.getAttribute('aria-disabled'));
    // Any message rendered anywhere?
    const alerts = await page.locator('[role=alert]').allTextContents();
    console.log('alerts on page:', JSON.stringify(alerts));
    // Does the draft change at all?
  });
});
