import * as z from 'zod4';
import { untrusted } from '../support';
import { READ, actingAs, workspaceId, type ToolContext, type ToolDef } from '../tools';
import { plural } from './shared';

/**
 * The workspace's integrations, read only. Connecting or disconnecting one
 * takes the provider's token, which never belongs in a chat: that stays in the
 * dForms dashboard.
 */

const DASHBOARD_ONLY = 'Connecting or disconnecting a provider happens in the dForms dashboard; no tool here does it.';

/** Calls the provider (cached for a few minutes per workspace). */
const READ_PROVIDER = { ...READ, openWorldHint: true } as const;

const input = z.object({ workspace_id: workspaceId });
type Input = z.infer<typeof input>;

// --- list_integrations --------------------------------------------------------

/** Every provider a workspace connects, in the order the dashboard shows them. */
const PROVIDERS = ['hubspot', 'calendly', 'google-sheets', 'salesforce'] as const;

export const listIntegrations: ToolDef = {
  name: 'list_integrations',
  title: 'List the integrations',
  description: `Which providers (HubSpot, Calendly, Google Sheets, Salesforce) this workspace is connected to, with a label and the last 4 characters of the credential (never the credential), which ones are not connected, which ones the deployment itself supplies a token for (server_provided, HubSpot and Calendly only), which ones this deployment cannot connect at all (unavailable: Google Sheets when the deployment has no Google OAuth client; such a provider is listed there only, never as connected or not_connected, even when a connection from before remains), and whether the server can store credentials. A Google Sheets or Salesforce destination delivers only while its provider is connected. dCal is not a connection: it reads the signed-in person's own Dapta session, so dcal says only whether this deployment has dCal, and where event types are created. ${DASHBOARD_ONLY}`,
  write: false,
  workspace: 'required',
  annotations: READ,
  input,
  output: z.object({
    providers: z.array(z.record(z.string(), z.unknown())).describe('The connected providers that can deliver here, one entry each.'),
    not_connected: z
      .array(z.enum(PROVIDERS))
      .describe('The providers this workspace has not connected, which the deployment does not supply and can connect.'),
    server_provided: z.array(z.string()).describe('Providers that work through a token the deployment supplies, connected here or not.'),
    unavailable: z.array(z.string()).describe('Providers this deployment cannot connect at all, whoever asks.'),
    encryption_available: z.boolean(),
    dcal: z
      .object({ create_event_url: z.string() })
      .nullable()
      .describe('Present when this deployment has dCal: where a person creates dCal event types. Null when it has none.'),
  }),
  async run(_args: Input, ctx) {
    const v = await ctx.backend.listIntegrations(actingAs(ctx));
    const serverProvided = (v['serverProvided'] as string[] | undefined) ?? [];
    const unavailable = (v['unavailable'] as string[] | undefined) ?? [];
    // A provider the deployment cannot connect cannot deliver either, even
    // with a connection left from before (Google Sheets once its OAuth client
    // is removed): it is reported in `unavailable` only.
    const providers = ((v['providers'] as Array<Record<string, unknown>> | undefined) ?? []).filter(
      (p) => !unavailable.includes(String(p['provider'])),
    );
    const connected = providers.filter((p) => p['connected']).map((p) => String(p['provider']));
    const notConnected = PROVIDERS.filter(
      (p) => !connected.includes(p) && !serverProvided.includes(p) && !unavailable.includes(p),
    );
    const dcalRaw = v['dcal'] as { createEventUrl?: unknown } | null | undefined;
    const dcal = dcalRaw && typeof dcalRaw.createEventUrl === 'string' ? { create_event_url: dcalRaw.createEventUrl } : null;
    return {
      data: {
        providers,
        not_connected: notConnected,
        server_provided: serverProvided,
        unavailable,
        encryption_available: v['encryptionAvailable'] === true,
        dcal,
      },
      summary: `${connected.length ? `Connected: ${connected.join(', ')}.` : 'No provider connected in this workspace.'}${
        notConnected.length ? ` Not connected: ${notConnected.join(', ')}.` : ''
      }`,
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

// --- list_event_types / list_calendly_event_types ---------------------------

/**
 * Why dCal event types are not listed here. dCal answers the person's own
 * Dapta session (the token the dashboard holds), and nothing an MCP call
 * carries is one: an MCP sign-in token is issued for the dForms MCP alone and
 * is never passed on to another service, and an API key is a credential for
 * dForms only. So the list is read where that session exists: the editor.
 */
const DCAL_NEEDS_SESSION =
  "dCal event types need a signed-in Dapta session, which an MCP connection or an API key does not carry, so they cannot be listed here. Pick the event in the form editor's scheduler step.";

const eventTypesOutput = z
  .object({
    provider: z.enum(['calendly', 'dcal']),
    enabled: z.boolean().describe('False when the event types could not be read; reason says why.'),
    reason: z.string().nullable().describe('Why enabled is false, as a sentence. Null when enabled.'),
    cached: z.boolean().optional(),
    event_types: z.array(z.record(z.string(), z.unknown())),
    create_event_url: z
      .string()
      .nullable()
      .optional()
      .describe('For dCal: where a person creates event types, when this deployment has dCal. Null when it has none.'),
  })
  .passthrough();

type EventTypesData = z.infer<typeof eventTypesOutput>;

async function calendlyTypes(ctx: ToolContext): Promise<{ data: EventTypesData; summary: string }> {
  const { eventTypes, ...rest } = await ctx.backend.calendlyEventTypes(actingAs(ctx));
  const types = (eventTypes as Array<Record<string, unknown>> | undefined) ?? [];
  const enabled = rest['enabled'] === true;
  return {
    data: {
      ...rest,
      provider: 'calendly',
      enabled,
      reason: enabled ? null : typeof rest['reason'] === 'string' ? rest['reason'] : 'Calendly is not connected.',
      event_types: types,
    },
    summary: enabled ? `${plural(types.length, 'event type')}.` : 'Calendly is not connected.',
  };
}

const eventTypesInput = z.object({
  workspace_id: workspaceId,
  // Required, with no default on purpose: a scheduler step the editor adds is
  // born dcal while a step with no provider reads as calendly, so neither
  // default would be right for every caller. The caller names the provider of
  // the step it is filling.
  provider: z
    .enum(['calendly', 'dcal'])
    .describe(
      "Required. The scheduler provider of the step being filled: calendly (the workspace's connected Calendly account) or dcal. There is no default: new scheduler steps default to dcal, and a step with no provider reads as calendly.",
    ),
});

export const listEventTypes: ToolDef = {
  name: 'list_event_types',
  title: 'List scheduler event types',
  description: `The event types a scheduler step can embed (scheduler.url), for the provider named in the required provider argument (no default: name the step's scheduler.provider). calendly: the event types of the connected Calendly account, with their booking link, duration and questions; enabled false when Calendly is not connected. dcal: not readable over MCP. ${DCAL_NEEDS_SESSION} The answer is enabled false with that reason, and says whether this deployment has dCal at all. ${DASHBOARD_ONLY}`,
  write: false,
  workspace: 'required',
  annotations: READ_PROVIDER,
  input: eventTypesInput,
  output: eventTypesOutput,
  async run(args: z.infer<typeof eventTypesInput>, ctx) {
    if (args.provider === 'calendly') return calendlyTypes(ctx);
    // No call to dCal: there is no session to ask it with (see DCAL_NEEDS_SESSION).
    // The integrations list says whether dCal exists on this deployment at all.
    const v = await ctx.backend.listIntegrations(actingAs(ctx));
    const dcal = v['dcal'] as { createEventUrl?: unknown } | null | undefined;
    const createEventUrl = dcal && typeof dcal.createEventUrl === 'string' ? dcal.createEventUrl : null;
    const reason = createEventUrl ? DCAL_NEEDS_SESSION : 'This dForms deployment has no dCal configured.';
    return {
      data: { provider: 'dcal', enabled: false, reason, event_types: [], create_event_url: createEventUrl },
      summary: reason,
    };
  },
};

/** The Calendly-only name this tool had first, kept so clients that call it keep working. */
export const listCalendlyEventTypes: ToolDef = {
  name: 'list_calendly_event_types',
  title: 'List Calendly event types',
  description: `The event types of the connected Calendly account, with their booking link, duration and questions: what a scheduler step can embed (scheduler.url). enabled false when Calendly is not connected. The same as list_event_types with provider calendly, which also covers dCal. ${DASHBOARD_ONLY}`,
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
