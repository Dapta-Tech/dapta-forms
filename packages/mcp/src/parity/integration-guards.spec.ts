import { describe, expect, it } from 'vitest';
import { BackendError } from '../backend';
import { CATALOG } from '../catalog';
import { bootHarness, errorText, structured } from '../__tests__/harness';

/**
 * What the MCP says about integrations the workspace cannot deliver through:
 * a destination whose provider is not connected (refused or warned about by
 * the route, carried through here), the providers list_integrations names,
 * and the dCal event types no MCP credential can read.
 */

const URL = 'https://app.example.test/admin/integrations';

describe('set_destinations and a provider that is not connected', () => {
  it('passes the refusal through with its stable code, the page to connect it and what to do', async () => {
    const message = `Google Sheets is not connected in this workspace, so this destination would deliver nothing. Connecting Google Sheets takes a browser: open ${URL}, connect it there, then save the destinations again.`;
    const h = await bootHarness({
      backend: {
        setDestinations: async () => {
          throw new BackendError(400, 'INTEGRATION_NOT_CONNECTED', message, [], { integrationsUrl: URL });
        },
      },
    });
    try {
      const c = await h.connect(h.key('owner'));
      const text = errorText(
        await c.callTool({
          name: 'set_destinations',
          arguments: {
            form_id: 'form-1',
            destinations: [{ type: 'google-sheets', enabled: true, settings: { spreadsheetId: 's1' }, columns: [] }],
          },
        }),
      );
      expect(text).toMatch(/^INTEGRATION_NOT_CONNECTED: Google Sheets is not connected/);
      expect(text).toContain(URL);
      expect(text).toMatch(/browser/);
    } finally {
      await h.close();
    }
  });

  it('reports every warning of the save, and an empty list when there is none', async () => {
    const h = await bootHarness({
      backend: {
        setDestinations: async (_c, id, destinations) => ({
          formId: id,
          updatedAt: 2,
          destinations,
          formActivityError: null,
          sheetHeaders: null,
          warnings: [
            { code: 'INTEGRATION_NOT_CONNECTED', index: 1, type: 'salesforce', message: 'Salesforce is not connected.', integrationsUrl: URL },
            { code: 'DESTINATION_INCOMPLETE', index: 2, type: 'google-sheets', message: 'No spreadsheet yet.' },
          ],
        }),
      },
    });
    try {
      const c = await h.connect(h.key('owner'));
      const res = await c.callTool({
        name: 'set_destinations',
        arguments: { form_id: 'form-1', destinations: [{ type: 'webhook', enabled: true, settings: { url: 'https://example.test/h' } }] },
      });
      expect(structured<{ warnings: unknown }>(res).warnings).toEqual([
        { code: 'INTEGRATION_NOT_CONNECTED', index: 1, type: 'salesforce', message: 'Salesforce is not connected.', integrations_url: URL },
        { code: 'DESTINATION_INCOMPLETE', index: 2, type: 'google-sheets', message: 'No spreadsheet yet.', integrations_url: null },
      ]);
      expect(JSON.stringify(res)).toContain('Destination 2 (salesforce) delivers nothing yet');
    } finally {
      await h.close();
    }
    const plain = await bootHarness();
    try {
      const c = await plain.connect(plain.key('owner'));
      const res = await c.callTool({
        name: 'set_destinations',
        arguments: { form_id: 'form-1', destinations: [{ type: 'webhook', enabled: true, settings: { url: 'https://example.test/h' } }] },
      });
      expect(structured<{ warnings: unknown }>(res).warnings).toEqual([]);
    } finally {
      await plain.close();
    }
  });

  it('describes the Salesforce destination and the connection rule', async () => {
    const tool = CATALOG.find((t) => t.name === 'set_destinations')!;
    expect(tool.description).toMatch(/webhooks, HubSpot, Google Sheets and Salesforce/);
    expect(tool.description).toContain('INTEGRATION_NOT_CONNECTED');
    expect(tool.description).toMatch(/drive\.file/);
    const h = await bootHarness();
    try {
      const c = await h.connect(h.key('owner'));
      const listed = (await c.listTools()).tools.find((t) => t.name === 'set_destinations')!;
      const schema = JSON.stringify(listed.inputSchema);
      expect(schema).toContain('Salesforce: { \\"type\\": \\"salesforce\\"');
      expect(schema).toContain('fieldMappings');
      expect(JSON.stringify(listed.outputSchema)).toContain('INTEGRATION_NOT_CONNECTED');
    } finally {
      await h.close();
    }
  });
});

describe('list_integrations', () => {
  it('names the four providers, the ones not connected, the ones the deployment cannot connect, and dCal', async () => {
    const h = await bootHarness({
      backend: {
        listIntegrations: async () => ({
          encryptionAvailable: true,
          providers: [{ provider: 'salesforce', connected: true, last4: 'ab12', label: 'Acme org', connectedAt: 1 }],
          serverProvided: ['hubspot'],
          unavailable: ['google-sheets'],
          googlePicker: false,
          dcal: { createEventUrl: 'https://cal.example.test/admin/event-types' },
        }),
      },
    });
    try {
      const c = await h.connect(h.key('member'));
      const out = structured<Record<string, unknown>>(await c.callTool({ name: 'list_integrations', arguments: {} }));
      expect(out['not_connected']).toEqual(['calendly', 'google-sheets']);
      expect(out['unavailable']).toEqual(['google-sheets']);
      expect(out['server_provided']).toEqual(['hubspot']);
      expect(out['dcal']).toEqual({ create_event_url: 'https://cal.example.test/admin/event-types' });
    } finally {
      await h.close();
    }
  });

  it('reads an answer without the newer fields as no dCal and nothing unavailable', async () => {
    const h = await bootHarness();
    try {
      const c = await h.connect(h.key('owner'));
      const out = structured<Record<string, unknown>>(await c.callTool({ name: 'list_integrations', arguments: {} }));
      expect(out['unavailable']).toEqual([]);
      expect(out['dcal']).toBeNull();
      expect(out['not_connected']).toEqual(['calendly', 'google-sheets', 'salesforce']);
    } finally {
      await h.close();
    }
  });

  it('no longer describes itself as HubSpot and Calendly only', () => {
    const tool = CATALOG.find((t) => t.name === 'list_integrations')!;
    expect(tool.description).toMatch(/HubSpot, Calendly, Google Sheets, Salesforce/);
    expect(tool.description).toMatch(/dCal/);
  });
});

describe('list_event_types', () => {
  const calendly = {
    enabled: true,
    cached: false,
    connectedAs: 'ada@example.test',
    eventTypes: [{ name: 'Demo', schedulingUrl: 'https://calendly.com/example/demo' }],
  };

  it('lists Calendly event types, and the old name answers exactly as before', async () => {
    const h = await bootHarness({ backend: { calendlyEventTypes: async () => calendly } });
    try {
      const c = await h.connect(h.key('owner'));
      const general = structured<Record<string, unknown>>(
        await c.callTool({ name: 'list_event_types', arguments: { provider: 'calendly' } }),
      );
      expect(general).toMatchObject({ provider: 'calendly', enabled: true, reason: null, event_types: calendly.eventTypes });
      const alias = structured<Record<string, unknown>>(await c.callTool({ name: 'list_calendly_event_types', arguments: {} }));
      expect(alias).toMatchObject({ enabled: true, cached: false, connectedAs: 'ada@example.test', event_types: calendly.eventTypes });
      expect(alias).not.toHaveProperty('provider');
    } finally {
      await h.close();
    }
  });

  it('answers dCal with the specific reason, never a generic failure, and never asks the backend for dCal', async () => {
    const asked: string[] = [];
    const h = await bootHarness({
      backend: {
        calendlyEventTypes: async () => {
          asked.push('calendly');
          return calendly;
        },
        listIntegrations: async () => ({
          encryptionAvailable: true,
          providers: [],
          serverProvided: [],
          unavailable: [],
          dcal: { createEventUrl: 'https://cal.example.test/admin/event-types' },
        }),
      },
    });
    try {
      const c = await h.connect(h.key('owner'));
      const res = await c.callTool({ name: 'list_event_types', arguments: { provider: 'dcal' } });
      const out = structured<Record<string, unknown>>(res);
      expect(out).toMatchObject({
        provider: 'dcal',
        enabled: false,
        event_types: [],
        create_event_url: 'https://cal.example.test/admin/event-types',
      });
      expect(out['reason']).toMatch(/^dCal event types need a signed-in Dapta session/);
      expect(out['reason']).toMatch(/Pick the event in the form editor/);
      expect(asked).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it('says when the deployment has no dCal at all', async () => {
    const h = await bootHarness();
    try {
      const c = await h.connect(h.key('member'));
      const out = structured<Record<string, unknown>>(await c.callTool({ name: 'list_event_types', arguments: { provider: 'dcal' } }));
      expect(out).toMatchObject({ provider: 'dcal', enabled: false, reason: 'This dForms deployment has no dCal configured.', create_event_url: null });
    } finally {
      await h.close();
    }
  });

  it('says in its description that dCal needs a signed-in session', () => {
    const tool = CATALOG.find((t) => t.name === 'list_event_types')!;
    expect(tool.description).toMatch(/dCal event types need a signed-in Dapta session/);
    expect(tool.description).toMatch(/pick the event in the form editor/i);
  });
});
