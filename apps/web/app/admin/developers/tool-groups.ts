/**
 * The dForms MCP's tools, grouped the way the MCP page presents them ("What
 * you can do with the MCP"). Names only, no prose: the copy for each group is
 * in the message catalog (`admin.developers.connect.tools.groups`).
 *
 * Kept as plain data so the client page never imports `@quill/mcp` (the
 * server package). `tool-groups.spec.ts` holds it to the server's `CATALOG`:
 * every tool in exactly one group, none invented, so a new tool fails the
 * spec until it is placed here.
 */
export const TOOL_GROUPS = {
  forms: [
    'list_forms',
    'get_form',
    'get_form_guide',
    'create_form',
    'update_form',
    'publish_form',
    'revert_form',
    'discard_draft',
    'duplicate_form',
    'delete_form',
    'set_form_slug',
  ],
  responses: [
    'list_responses',
    'get_response',
    'get_response_file',
    'get_response_facets',
    'search_answers',
    'export_responses_csv',
    'delete_response',
    'delete_responses',
  ],
  analytics: ['get_form_analytics', 'get_form_summary'],
  folders: ['list_folders', 'create_folder', 'rename_folder', 'delete_folder', 'move_form'],
  brandKit: ['get_brand_kit', 'update_brand_kit', 'apply_brand_kit', 'revert_brand_kit'],
  linkPage: ['get_link_page', 'update_link_page'],
  notifications: [
    'list_notifications',
    'update_notification',
    'reset_notification',
    'list_form_notifications',
    'update_form_notification',
    'reset_form_notification',
  ],
  integrations: [
    'list_integrations',
    'set_destinations',
    'list_webhooks',
    'ping_webhook',
    'list_deliveries',
    'list_hubspot_properties',
    'list_calendly_event_types',
  ],
  account: ['whoami', 'list_my_workspaces', 'get_my_profile', 'get_workspace_link_code'],
} as const;

export type ToolGroup = keyof typeof TOOL_GROUPS;

/** The group order on the page. */
export const TOOL_GROUP_ORDER: readonly ToolGroup[] = [
  'forms',
  'responses',
  'analytics',
  'folders',
  'brandKit',
  'linkPage',
  'notifications',
  'integrations',
  'account',
];

/** PrimeIcons class for each group's tile. */
export const TOOL_GROUP_ICONS: Record<ToolGroup, string> = {
  forms: 'pi-file-edit',
  responses: 'pi-inbox',
  analytics: 'pi-chart-bar',
  folders: 'pi-folder',
  brandKit: 'pi-palette',
  linkPage: 'pi-link',
  notifications: 'pi-envelope',
  integrations: 'pi-share-alt',
  account: 'pi-users',
};

export const TOOL_COUNT = Object.values(TOOL_GROUPS).reduce((n, names) => n + names.length, 0);
