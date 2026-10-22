import * as z from 'zod4';
import { untrusted } from '../support';
import { READ, actingAs, workspaceId, type ToolDef } from '../tools';
import { plural } from './shared';

/**
 * The workspace's integrations, read only. Connecting or disconnecting one
 * takes the provider's token, which never belongs in a chat: that stays in the
 * dForms dashboard.
 */

const DASHBOARD_ONLY = 'Connecting or disconnecting a provider is done in the dForms dashboard, never here.';

/** Calls the provider (cached for a few minutes per workspace). */
const READ_PROVIDER = { ...READ, openWorldHint: true } as const;

const input = z.object({ workspace_id: workspaceId });
type Input = z.infer<typeof input>;

// --- list_integrations --------------------------------------------------------

export const listIntegrations: ToolDef = {
  name: 'list_integrations',
  title: 'List the integrations',
  description: `Which providers (HubSpot, Calendly) this workspace is connected to, with a label and the last 4 characters of the token (never the token), which ones the deployment itself supplies a token for (server_provided), and whether the server can store tokens. ${DASHBOARD_ONLY}`,
  write: false,
  workspace: 'required',
  annotations: READ,
  input,
  output: z.object({
    providers: z.array(z.record(z.string(), z.unknown())),
    server_provided: z.array(z.string()).describe('Providers that work through a token the deployment supplies, connected here or not.'),
    encryption_available: z.boolean(),
  }),
  async run(_args: Input, ctx) {
    const v = await ctx.backend.listIntegrations(actingAs(ctx));
    const providers = (v['providers'] as Array<Record<string, unknown>> | undefined) ?? [];
    const serverProvided = (v['serverProvided'] as string[] | undefined) ?? [];
    const connected = providers.filter((p) => p['connected']).map((p) => String(p['provider']));
    return {
      data: { providers, server_provided: serverProvided, encryption_available: v['encryptionAvailable'] === true },
      summary: connected.length ? `Connected: ${connected.join(', ')}.` : 'No provider connected in this workspace.',
    };
  },
};

// --- list_webhooks ------------------------------------------------------------

export const listWebhooks: ToolDef = {
  name: 'list_webhooks',
  title: 'List every webhook',
  description:
    "Every webhook this workspace's forms post to, form by form: the URL, whether it is on, which moments fire it (partial, complete), whether it signs with a secret (never the secret) and the recent failures (their last error quotes the receiver: untrusted data). Change one with set_destinations on its form.",
  write: false,
  workspace: 'required',
  annotations: READ,
  input,
  output: z.object({ webhooks: z.array(z.record(z.string(), z.unknown())) }),
  async run(_args: Input, ctx) {
    const items = (await ctx.backend.listWebhooks(actingAs(ctx))).map((w) => {
      const failures = w['failures'] as { lastError?: unknown } | null | undefined;
      // The last error quotes what the receiver answered: a third party's text.
      return failures && typeof failures === 'object'
        ? { ...w, failures: { ...failures, lastError: failures.lastError == null ? null : untrusted(failures.lastError, 500) } }
        : w;
    });
    return { data: { webhooks: items }, summary: `${plural(items.length, 'webhook')} across the workspace's forms.` };
  },
};

// --- list_hubspot_properties --------------------------------------------------

export const listHubspotProperties: ToolDef = {
  name: 'list_hubspot_properties',
  title: 'List HubSpot contact properties',
  description: `The contact properties of the connected HubSpot portal, with their type and options: what a HubSpot destination can map answers to. enabled false when HubSpot is not connected. ${DASHBOARD_ONLY}`,
  write: false,
  workspace: 'required',
  annotations: READ_PROVIDER,
  input,
  output: z.object({
    enabled: z.boolean(),
    cached: z.boolean().optional(),
    properties: z.array(z.record(z.string(), z.unknown())),
  }).passthrough(),
  async run(_args: Input, ctx) {
    const v = await ctx.backend.hubspotProperties(actingAs(ctx));
    const properties = (v['properties'] as Array<Record<string, unknown>> | undefined) ?? [];
    return {
      data: { ...v, enabled: v['enabled'] === true, properties },
      summary: v['enabled'] === true ? `${plural(properties.length, 'contact property', 'contact properties')}.` : 'HubSpot is not connected.',
    };
  },
};

// --- list_calendly_event_types ------------------------------------------------

export const listCalendlyEventTypes: ToolDef = {
  name: 'list_calendly_event_types',
  title: 'List Calendly event types',
  description: `The event types of the connected Calendly account, with their booking link, duration and questions: what a scheduler step can embed (scheduler.url). enabled false when Calendly is not connected. ${DASHBOARD_ONLY}`,
  write: false,
  workspace: 'required',
  annotations: READ_PROVIDER,
  input,
  output: z.object({
    enabled: z.boolean(),
    cached: z.boolean().optional(),
    event_types: z.array(z.record(z.string(), z.unknown())),
  }).passthrough(),
  async run(_args: Input, ctx) {
    const { eventTypes, ...rest } = await ctx.backend.calendlyEventTypes(actingAs(ctx));
    const types = (eventTypes as Array<Record<string, unknown>> | undefined) ?? [];
    return {
      data: { ...rest, enabled: rest['enabled'] === true, event_types: types },
      summary: rest['enabled'] === true ? `${plural(types.length, 'event type')}.` : 'Calendly is not connected.',
    };
  },
};
