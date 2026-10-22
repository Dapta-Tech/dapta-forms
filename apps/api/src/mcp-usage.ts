import { Logger } from '@nestjs/common';
import { getMe, type Db } from '@quill/db';
import { MCP_SERVER_VERSION, type McpToolCallEvent } from '@quill/mcp';
import type { AnalyticsEffects } from './analytics-effects';
import { isStaffEmail } from './staff';

/** The vendor's name for one tool call in its MCP analytics. */
export const MCP_TOOL_CALL_EVENT = '$mcp_tool_call';

/**
 * The server name on the event. Not the protocol's `serverInfo.name`
 * (`dforms`): it is cased like Dapta's own MCP (`Dapta`), which reports into
 * the same project, so the MCP dashboard splits the two by this property.
 */
export const MCP_ANALYTICS_SERVER_NAME = 'dForms';

/** How long a member's email is reused before it is read again. */
const IDENTITY_TTL_MS = 5 * 60_000;

/** At most this many members are remembered; the oldest go first. */
const IDENTITY_CACHE_MAX = 2_000;

interface CachedIdentity {
  email: string | null;
  expiresAt: number;
}

type Properties = Record<string, string | number | boolean | null>;

/**
 * Reports each MCP tool call to product analytics as one `$mcp_tool_call`, in
 * the vocabulary PostHog's MCP analytics reads (the same one Dapta's own MCP
 * server sends), so both MCPs land on the same screens, told apart by
 * `$mcp_server_name` (`dForms` vs `Dapta`) and `product`. The email as the
 * distinct id is what lets the dashboard's internal-users filter drop staff
 * traffic; `staff_access` says it explicitly as well.
 *
 * What it sends is fixed here and nowhere else: the tool's name, whether it
 * failed and with which code, how long it took, the protocol version, the
 * client's name, version and user agent, the server, how the caller signed in
 * and whether the call was staff's. Never the arguments (not even their hash),
 * the result, an error message, or a workspace or form name.
 *
 * Who it is about: the member's email, like every other server event, read
 * once per member and reused for a few minutes so a burst of calls does not
 * cost a query each. An MCP connection that acted in no workspace (whoami
 * before the person has one) is sent under the person's id with
 * `$process_person_profile: false`, so it never mints a person profile.
 *
 * `report` never rejects and the MCP server never awaits it: a slow or failing
 * database or vendor cannot slow or fail a tool call. With no
 * `PRODUCT_ANALYTICS_KEY` it returns before reading anything.
 */
export class McpUsageReporter {
  private readonly log = new Logger('McpUsage');
  private readonly identities = new Map<string, CachedIdentity>();

  constructor(
    private readonly db: Db,
    private readonly analytics: AnalyticsEffects,
    private readonly staffDomains: readonly string[],
    private readonly clock: () => number = Date.now,
  ) {}

  async report(event: McpToolCallEvent): Promise<void> {
    if (!this.analytics.enabled) return;
    try {
      const properties: Properties = {
        $mcp_tool_name: event.tool,
        // The vendor's SDK repeats the tool name here on a tool call; Dapta's MCP sends it too.
        $mcp_resource_name: event.tool,
        $mcp_is_error: !event.ok,
        $mcp_duration_ms: event.durationMs,
        $mcp_protocol_version: event.protocolVersion,
        $mcp_server_name: MCP_ANALYTICS_SERVER_NAME,
        $mcp_server_version: MCP_SERVER_VERSION,
        $mcp_source: 'posthog_mcp_analytics',
        product: 'forms',
        credential_type: event.credentialType,
      };
      if (!event.ok && event.errorCode) properties.$mcp_error_type = event.errorCode.toLowerCase();
      if (event.client.name) properties.$mcp_client_name = event.client.name;
      if (event.client.version) properties.$mcp_client_version = event.client.version;
      if (event.client.userAgent) properties.$mcp_client_user_agent = event.client.userAgent;
      if (event.client.vendor) properties.$mcp_vendor_client = event.client.vendor;

      let distinctId: string;
      let staff = event.staff;
      if (event.accountId && event.memberId) {
        const email = await this.emailOf(event.accountId, event.memberId);
        // No email on file: dropped, never sent under a made-up id that would
        // merge unrelated people (the rule captureForMember follows).
        if (!email) return;
        distinctId = email;
        staff = staff || isStaffEmail(email, this.staffDomains);
      } else if (event.personId) {
        distinctId = event.personId;
        properties.$process_person_profile = false;
      } else {
        return;
      }
      properties.staff_access = staff;

      await this.analytics.captureRaw(MCP_TOOL_CALL_EVENT, { distinctId, accountId: event.accountId, properties }, this.clock());
    } catch (err) {
      this.log.error(`failed to report MCP tool call: ${String(err)}`);
    }
  }

  private async emailOf(accountId: string, memberId: string): Promise<string | null> {
    const key = `${accountId}:${memberId}`;
    const now = this.clock();
    const hit = this.identities.get(key);
    if (hit && hit.expiresAt > now) return hit.email;
    const me = await getMe(this.db, accountId, memberId);
    const email = me?.email ?? null;
    this.identities.delete(key);
    if (this.identities.size >= IDENTITY_CACHE_MAX) {
      const oldest = this.identities.keys().next().value;
      if (oldest !== undefined) this.identities.delete(oldest);
    }
    this.identities.set(key, { email, expiresAt: now + IDENTITY_TTL_MS });
    return email;
  }
}
