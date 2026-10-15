// @vitest-environment happy-dom
/**
 * The Developers page's keys section, driven like a person would.
 *
 * What it promises, each pinned below:
 *   - a member sees a list without the "Created by" column; an owner or admin
 *     sees it, with their own keys marked;
 *   - the empty state says what a key is, and a failed load says so instead
 *     of claiming emptiness;
 *   - a new key is shown ONCE: after the dialog closes it is nowhere on the page;
 *   - the eleventh key gets a clear message, not a generic failure;
 *   - revoking asks first, and a confirmed revoke takes the row off the list.
 *
 * The server actions are mocked: the `/v1/api-keys` routes land in another
 * ticket, and these specs pin the page against the spec's contract.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages, type Locale } from '@quill/shared';
import type { ApiKey } from '@/lib/admin-api';

const actions = vi.hoisted(() => ({
  createApiKeyAction: vi.fn(),
  revokeApiKeyAction: vi.fn(),
}));
vi.mock('./actions', () => actions);
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), toast: vi.fn() }));
vi.mock('@/components/toast', () => ({ useToast: () => toasts }));

import { ApiKeysPanel, type ApiKeysViewer } from './api-keys';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SECRET = 'dforms_EXAMPLEexampleEXAMPLEexample0000a1b2';

const key = (over: Partial<ApiKey> = {}): ApiKey => ({
  id: 'key-1',
  name: 'Claude Code',
  last4: 'k1k1',
  createdAt: Date.UTC(2026, 9, 1, 15, 0),
  lastUsedAt: null,
  createdBy: { memberId: 'mem-me', name: 'Alex Rivera', email: 'alex@example.com' },
  ...over,
});

const member: ApiKeysViewer = {
  memberId: 'mem-me',
  role: 'member',
  displayName: 'Alex Rivera',
  email: 'alex@example.com',
};
const admin: ApiKeysViewer = { ...member, role: 'admin' };
const owner: ApiKeysViewer = { ...member, role: 'owner' };

let root: Root;
let host: HTMLDivElement;
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];

async function mount(
  opts: { keys?: ApiKey[]; viewer?: ApiKeysViewer; loadError?: boolean; locale?: Locale } = {},
) {
  const locale = opts.locale ?? 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <ApiKeysPanel
        initialKeys={opts.keys ?? []}
        loadError={opts.loadError ?? false}
        viewer={opts.viewer ?? member}
        m={getMessages(locale).admin.developers.keys}
        locale={locale}
        timeZone="UTC"
      />,
    ),
  );
}

/** Types into a controlled input the way the browser does: native setter, then an input event. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const click = (el: Element | null) => act(async () => (el as HTMLElement).click());
const m = getMessages('en').admin.developers.keys;

beforeEach(() => {
  actions.createApiKeyAction.mockReset();
  actions.revokeApiKeyAction.mockReset();
  toasts.success.mockReset();
  toasts.error.mockReset();
});

/** A promise the test settles by hand, to hold a server action in flight. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

describe('ApiKeysPanel: roles', () => {
  it('shows a member their keys without the Created by column', async () => {
    await mount({ keys: [key()], viewer: member });
    expect($$('[data-testid="api-key-row"]')).toHaveLength(1);
    expect(document.body.textContent).toContain('Claude Code');
    expect(document.body.textContent).toContain('•••• k1k1');
    expect(document.body.textContent).not.toContain(m.colCreatedBy);
    expect($('[data-testid="api-key-created-by"]')).toBeNull();
    expect(document.body.textContent).toContain(m.subtitle);
  });

  it.each([
    ['admin', admin],
    ['owner', owner],
  ])('shows an %s every key with who created it, marking their own', async (_role, viewer) => {
    await mount({
      viewer,
      keys: [
        key(),
        key({
          id: 'key-2',
          name: 'n8n',
          last4: 'k2k2',
          createdBy: { memberId: 'mem-2', name: 'Sam Lee', email: 'sam@example.com' },
        }),
        key({ id: 'key-3', name: 'Old script', createdBy: { memberId: 'mem-3', name: null, email: null } }),
      ],
    });
    expect($$('[data-testid="api-key-row"]')).toHaveLength(3);
    expect(document.body.textContent).toContain(m.colCreatedBy);
    const creators = $$('[data-testid="api-key-created-by"]').map((el) => el.textContent);
    expect(creators[0]).toContain(m.you);
    expect(creators[1]).toContain('Sam Lee');
    expect(creators[2]).toContain(m.unknownCreator);
    expect(document.body.textContent).toContain(m.subtitleAdmin);
  });

  it('says Never for a key that has not been used, and the date for one that has', async () => {
    await mount({
      keys: [key(), key({ id: 'key-2', lastUsedAt: Date.UTC(2026, 9, 10, 9, 30) })],
    });
    const lastUsed = $$('[data-testid="api-key-last-used"]').map((el) => el.textContent);
    expect(lastUsed[0]).toContain(m.neverUsed);
    expect(lastUsed[1]).toContain('Oct 10, 2026');
  });
});

describe('ApiKeysPanel: empty and error states', () => {
  it('explains what a key is when there are none', async () => {
    await mount({ keys: [] });
    expect($('[data-testid="api-keys-empty"]')?.textContent).toContain(m.emptyTitle);
    expect($('[data-testid="api-keys-empty"]')?.textContent).toContain(m.emptyBody);
    expect($$('[data-testid="api-key-row"]')).toHaveLength(0);
    // Starting is one click away from the explanation.
    expect($('[data-testid="api-key-create"]')).not.toBeNull();
  });

  it('says the list could not load instead of claiming there are no keys', async () => {
    await mount({ keys: [], loadError: true });
    expect(document.body.textContent).toContain(m.loadError);
    expect($('[data-testid="api-keys-empty"]')).toBeNull();
  });

  it('speaks Spanish with the Spanish catalog', async () => {
    const es = getMessages('es').admin.developers.keys;
    await mount({ keys: [], locale: 'es' });
    expect(document.body.textContent).toContain(es.emptyTitle);
    expect(document.body.textContent).toContain(es.create);
  });
});

describe('ApiKeysPanel: create', () => {
  async function createNamed(name: string) {
    await click($('[data-testid="api-key-create"]'));
    const input = $<HTMLInputElement>('[data-testid="api-key-name"]')!;
    expect(input).not.toBeNull();
    await act(async () => type(input, name));
    await click($('[data-testid="api-key-create-submit"]'));
  }

  it('shows the full key once, with a copy button and a warning, then never again', async () => {
    actions.createApiKeyAction.mockResolvedValue({
      ok: true,
      key: { id: 'key-9', name: 'Cursor', last4: 'a1b2', createdAt: Date.UTC(2026, 9, 12), key: SECRET },
    });
    await mount({ keys: [] });
    await createNamed('Cursor');

    expect(actions.createApiKeyAction).toHaveBeenCalledWith('Cursor');
    const shown = $<HTMLInputElement>('[data-testid="api-key-secret"]');
    expect(shown?.value).toBe(SECRET);
    expect(shown?.readOnly).toBe(true);
    expect($('[data-testid="api-key-copy"]')).not.toBeNull();
    expect($('[role="dialog"]')?.textContent).toContain(m.createdWarning);

    // The list already carries the new key, masked.
    const rows = $$('[data-testid="api-key-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('•••• a1b2');
    expect(rows[0]!.textContent).not.toContain(SECRET);

    await click($('[data-testid="api-key-done"]'));
    expect($('[role="dialog"]')).toBeNull();
    expect(document.body.innerHTML).not.toContain(SECRET);

    // Opening the dialog again starts a new key; the old one is gone for good.
    await click($('[data-testid="api-key-create"]'));
    expect($('[data-testid="api-key-secret"]')).toBeNull();
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it('drops the key when the dialog is closed with Escape too', async () => {
    actions.createApiKeyAction.mockResolvedValue({
      ok: true,
      key: { id: 'key-9', name: 'Cursor', last4: 'a1b2', createdAt: Date.UTC(2026, 9, 12), key: SECRET },
    });
    await mount({ keys: [] });
    await createNamed('Cursor');
    expect(document.body.innerHTML).toContain(SECRET);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect($('[role="dialog"]')).toBeNull();
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it('copies the key to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    actions.createApiKeyAction.mockResolvedValue({
      ok: true,
      key: { id: 'key-9', name: 'Cursor', last4: 'a1b2', createdAt: Date.UTC(2026, 9, 12), key: SECRET },
    });
    await mount({ keys: [] });
    await createNamed('Cursor');
    await click($('[data-testid="api-key-copy"]'));
    expect(writeText).toHaveBeenCalledWith(SECRET);
    expect($('[data-testid="api-key-copy"]')?.textContent).toContain(m.copied);
  });

  it('says plainly when the ten-key limit is reached, and keeps the dialog open', async () => {
    actions.createApiKeyAction.mockResolvedValue({ ok: false, code: 'KEY_LIMIT' });
    await mount({ keys: [key()] });
    await createNamed('One more');
    expect($('[role="alert"]')?.textContent).toBe(m.errorLimit);
    expect($('[data-testid="api-key-name"]')).not.toBeNull();
    expect($$('[data-testid="api-key-row"]')).toHaveLength(1);
  });

  it('does not send a blank name', async () => {
    await mount({ keys: [] });
    await click($('[data-testid="api-key-create"]'));
    const submit = $<HTMLButtonElement>('[data-testid="api-key-create-submit"]')!;
    expect(submit.disabled).toBe(true);
    await act(async () => type($<HTMLInputElement>('[data-testid="api-key-name"]')!, '   '));
    expect(submit.disabled).toBe(true);
    expect(actions.createApiKeyAction).not.toHaveBeenCalled();
  });

  it('stays open while the key is being created, so its secret is not lost', async () => {
    const pending = deferred<unknown>();
    actions.createApiKeyAction.mockReturnValue(pending.promise);
    await mount({ keys: [] });
    await createNamed('Cursor');
    // Escape and the backdrop both try to close it mid-request.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect($('[role="dialog"]')).not.toBeNull();
    await act(async () => {
      pending.resolve({
        ok: true,
        key: { id: 'key-9', name: 'Cursor', last4: 'a1b2', createdAt: Date.UTC(2026, 9, 12), key: SECRET },
      });
    });
    expect($<HTMLInputElement>('[data-testid="api-key-secret"]')?.value).toBe(SECRET);
  });

  it('turns a dropped connection into the generic failure, not a crash', async () => {
    actions.createApiKeyAction.mockRejectedValue(new Error('Failed to find Server Action'));
    await mount({ keys: [] });
    await createNamed('Cursor');
    expect($('[role="alert"]')?.textContent).toBe(m.errorFailed);
  });
});

describe('ApiKeysPanel: revoke', () => {
  it('asks first, and a confirmed revoke takes the key off the list', async () => {
    actions.revokeApiKeyAction.mockResolvedValue({ ok: true });
    await mount({ keys: [key(), key({ id: 'key-2', name: 'n8n', last4: 'k2k2' })] });

    await click($$('[data-testid="api-key-revoke"]')[0]!);
    const confirm = $('[data-testid="confirm-dialog"]');
    expect(confirm?.textContent).toContain(m.revokeTitle);
    expect(confirm?.textContent).toContain('Claude Code');
    expect(actions.revokeApiKeyAction).not.toHaveBeenCalled();

    await click($('[data-testid="confirm-dialog-confirm"]'));
    expect(actions.revokeApiKeyAction).toHaveBeenCalledWith('key-1');
    const rows = $$('[data-testid="api-key-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('n8n');
  });

  it('keeps the key when the confirmation is cancelled', async () => {
    await mount({ keys: [key()] });
    await click($('[data-testid="api-key-revoke"]'));
    await click($('[data-testid="confirm-dialog-cancel"]'));
    expect(actions.revokeApiKeyAction).not.toHaveBeenCalled();
    expect($$('[data-testid="api-key-row"]')).toHaveLength(1);
  });

  it('keeps the key on the list when the API refuses', async () => {
    actions.revokeApiKeyAction.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    await mount({ keys: [key()], viewer: admin });
    await click($('[data-testid="api-key-revoke"]'));
    await click($('[data-testid="confirm-dialog-confirm"]'));
    expect($$('[data-testid="api-key-row"]')).toHaveLength(1);
  });

  it('never says revoked when the key was not found in this workspace', async () => {
    actions.revokeApiKeyAction.mockResolvedValue({ ok: false, code: 'GONE' });
    await mount({ keys: [key()] });
    await click($('[data-testid="api-key-revoke"]'));
    await click($('[data-testid="confirm-dialog-confirm"]'));
    expect(toasts.success).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalledWith(m.revokeErrorGone);
  });

  it('keeps a second revoke busy when the first one finishes', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    actions.revokeApiKeyAction.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await mount({ keys: [key(), key({ id: 'key-2', name: 'n8n', last4: 'k2k2' })] });
    await click($$('[data-testid="api-key-revoke"]')[0]!);
    await click($('[data-testid="confirm-dialog-confirm"]'));
    await click($$('[data-testid="api-key-revoke"]')[1]!);
    await click($('[data-testid="confirm-dialog-confirm"]'));
    await act(async () => first.resolve({ ok: true }));
    const rows = $$('[data-testid="api-key-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.querySelector<HTMLButtonElement>('[data-testid="api-key-revoke"]')!.disabled).toBe(true);
    await act(async () => second.resolve({ ok: true }));
    expect($('[data-testid="api-keys-empty"]')).not.toBeNull();
  });

  it('shows the empty state once the last key is revoked', async () => {
    actions.revokeApiKeyAction.mockResolvedValue({ ok: true });
    await mount({ keys: [key()] });
    await click($('[data-testid="api-key-revoke"]'));
    await click($('[data-testid="confirm-dialog-confirm"]'));
    expect($('[data-testid="api-keys-empty"]')).not.toBeNull();
  });
});
