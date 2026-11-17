// @vitest-environment happy-dom
/**
 * Which answers the Connect tab offers the destination pickers (HubSpot,
 * Google Sheets, Salesforce), as the tab builds them from the LIVE editor
 * config.
 *
 * Pinned here: a `name` question is offered as the two answers it actually
 * stores (`firstname`, `lastname`), never as its own step key. A name step
 * never writes under its key, so a mapping on it delivered nothing at all, and
 * the author had no way to see that from the editor.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FormConfig } from '@quill/engine';
import { getMessages } from '@quill/shared';
import type { QuestionMeta } from '../../integrations/auto-map';

const seen = vi.hoisted(() => ({ questions: null as QuestionMeta[] | null }));

vi.mock('@/lib/connect-sync', () => ({ awaitPendingDestinationWrite: () => Promise.resolve() }));
vi.mock('./connect-emails-section', () => ({ ConnectEmailsSection: () => null }));
vi.mock('./connect-actions', () => ({
  loadConnectIntegrationsAction: () =>
    Promise.resolve({
      ok: true,
      data: {
        destinations: [],
        hubspot: null,
        hubspotConnected: false,
        googleSheetsConnected: false,
        googleSheetsAvailable: false,
        googlePickerAvailable: false,
        salesforceConnected: false,
        salesforceFields: null,
        calendlyConnected: false,
        formName: 'Form',
      },
    }),
}));
// The editor itself is covered by its own specs; here only what it is handed.
vi.mock('../../integrations/integrations-editor', () => ({
  IntegrationsEditor: ({ questions }: { questions: QuestionMeta[] }) => {
    seen.questions = questions;
    return (
      <ul data-testid="offered">
        {questions.map((q) => (
          <li key={q.key} data-key={q.key}>
            {q.label}
          </li>
        ))}
      </ul>
    );
  },
}));

import { ConnectPanel } from './connect-panel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  seen.questions = null;
});

const CONFIG = {
  version: 1,
  steps: [
    { key: 'intro', type: 'message', question: 'Hola' },
    { key: 'nombre_completo', type: 'name', question: 'Nombre y Apellido' },
    { key: 'email', type: 'email', question: 'Correo' },
  ],
} as unknown as FormConfig;

async function render(config: FormConfig, locale: 'en' | 'es') {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <ConnectPanel
        formId="f1"
        config={config}
        onTrackingChange={() => {}}
        onSpamProtectionChange={() => {}}
        m={getMessages(locale).admin.editor}
        locale={locale}
      />,
    ),
  );
  const items = [...host.querySelectorAll('[data-testid="offered"] li')];
  return { keys: items.map((li) => li.getAttribute('data-key')), labels: items.map((li) => li.textContent) };
}

describe('ConnectPanel: the answers offered to the destination pickers', () => {
  it('offers a name question as its first and last name, under the keys its answer is stored', async () => {
    const { keys, labels } = await render(CONFIG, 'es');
    expect(keys).toEqual(['firstname', 'lastname', 'email']);
    expect(labels).toEqual(['Nombre y Apellido · Nombre', 'Nombre y Apellido · Apellido', 'Correo']);
    expect(keys).not.toContain('nombre_completo');
  });

  it('labels the halves in the author’s language when the step has no labels of its own', async () => {
    const im = getMessages('en').admin.integrations;
    const { labels } = await render(CONFIG, 'en');
    expect(labels.slice(0, 2)).toEqual([`Nombre y Apellido · ${im.nameFirstPart}`, `Nombre y Apellido · ${im.nameLastPart}`]);
  });

  it('hands auto-map which half each entry is', async () => {
    await render(CONFIG, 'en');
    expect(seen.questions?.map((q) => q.namePart)).toEqual(['first', 'last', undefined]);
  });
});
