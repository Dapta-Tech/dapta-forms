import type { ToolDef } from '../tools';
import { applyBrandKit, getBrandKit, revertBrandKit, updateBrandKit } from './branding';
import { pingWebhook, setDestinations } from './destinations';
import { createFolder, deleteFolder, listFolders, renameFolder } from './folders';
import { deleteForm, duplicateForm, moveForm, setFormSlug } from './forms';
import { getMyProfile, getWorkspaceLinkCode } from './identity';
import { createLinkPage, deleteLinkPage, duplicateLinkPage, getLinkPage, listLinkPages, updateLinkPage } from './link-page';
import { getFormSummary, getResponseFacets, searchAnswers } from './insights';
import { listCalendlyEventTypes, listHubspotProperties, listIntegrations, listWebhooks } from './integrations';
import {
  listFormNotifications,
  listNotifications,
  resetFormNotification,
  resetNotification,
  updateFormNotification,
  updateNotification,
} from './notifications';
import { deleteResponse, deleteResponses, exportResponsesCsv, getResponse, getResponseFile, listDeliveries } from './responses';

/**
 * The tools for every route of the public API reference beyond the first
 * eleven, area by area in the reference's order. The server registers them
 * after `TOOLS` (see `catalog.ts`).
 */
export const PARITY_TOOLS: readonly ToolDef[] = [
  // Forms
  setFormSlug,
  duplicateForm,
  moveForm,
  deleteForm,
  // Folders
  listFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  // Destinations
  setDestinations,
  pingWebhook,
  // Responses
  getResponse,
  getResponseFile,
  exportResponsesCsv,
  deleteResponses,
  deleteResponse,
  listDeliveries,
  // Analytics
  getFormSummary,
  getResponseFacets,
  searchAnswers,
  // Brand kit
  getBrandKit,
  updateBrandKit,
  applyBrandKit,
  revertBrandKit,
  // Link pages
  listLinkPages,
  getLinkPage,
  createLinkPage,
  updateLinkPage,
  duplicateLinkPage,
  deleteLinkPage,
  // Notifications
  listNotifications,
  updateNotification,
  resetNotification,
  listFormNotifications,
  updateFormNotification,
  resetFormNotification,
  // Integrations, read only
  listIntegrations,
  listWebhooks,
  listHubspotProperties,
  listCalendlyEventTypes,
  // Identity
  getMyProfile,
  getWorkspaceLinkCode,
];

/**
 * Which tool serves each route of the public API reference (`API_REFERENCE`
 * in `@quill/shared`, the routes the API docs page documents), written
 * exactly as the reference names them. The API's parity spec walks the
 * reference and fails when a route has neither a tool here nor an entry in
 * `API_ROUTE_EXCLUSIONS`, so a route added to the docs cannot be left out of
 * the MCP without anyone noticing.
 */
export const API_ROUTE_TOOLS: Readonly<Record<string, string>> = {
  'GET /v1/forms': 'list_forms',
  'POST /v1/forms': 'create_form',
  'GET /v1/forms/:id': 'get_form',
  'PUT /v1/forms/:id': 'update_form',
  'POST /v1/forms/:id/publish': 'publish_form',
  'POST /v1/forms/:id/revert': 'revert_form',
  'POST /v1/forms/:id/discard-draft': 'discard_draft',
  'PUT /v1/forms/:id/slug': 'set_form_slug',
  'POST /v1/forms/:id/duplicate': 'duplicate_form',
  'PATCH /v1/forms/:id/folder': 'move_form',
  'DELETE /v1/forms/:id': 'delete_form',

  'GET /v1/folders': 'list_folders',
  'POST /v1/folders': 'create_folder',
  'PATCH /v1/folders/:id': 'rename_folder',
  'DELETE /v1/folders/:id': 'delete_folder',

  'PUT /v1/forms/:id/destinations': 'set_destinations',
  'POST /v1/forms/:id/destinations/webhook/ping': 'ping_webhook',

  'GET /v1/forms/:id/submissions': 'list_responses',
  'GET /v1/forms/:id/submissions/:submissionId': 'get_response',
  'GET /v1/forms/:id/submissions/:submissionId/files/:stepKey': 'get_response_file',
  'GET /v1/forms/:id/submissions.csv': 'export_responses_csv',
  'POST /v1/forms/:id/submissions/bulk-delete': 'delete_responses',
  'DELETE /v1/submissions/:id': 'delete_response',
  'GET /v1/forms/:id/deliveries': 'list_deliveries',

  'GET /v1/forms/:id/analytics': 'get_form_analytics',
  'GET /v1/forms/:id/summary': 'get_form_summary',
  'GET /v1/forms/:id/submissions-facets': 'get_response_facets',
  'GET /v1/forms/:id/summary/:stepKey/answers': 'search_answers',

  'GET /v1/branding': 'get_brand_kit',
  'PUT /v1/branding': 'update_brand_kit',
  'POST /v1/branding/apply': 'apply_brand_kit',
  'POST /v1/branding/revert': 'revert_brand_kit',

  'GET /v1/link-page': 'get_link_page',
  'PUT /v1/link-page': 'update_link_page',
  'GET /v1/link-pages': 'list_link_pages',
  'POST /v1/link-pages': 'create_link_page',
  'GET /v1/link-pages/:id': 'get_link_page',
  'PUT /v1/link-pages/:id': 'update_link_page',
  'POST /v1/link-pages/:id/duplicate': 'duplicate_link_page',
  'DELETE /v1/link-pages/:id': 'delete_link_page',

  'GET /v1/notifications': 'list_notifications',
  'PUT /v1/notifications/:emailKey': 'update_notification',
  'POST /v1/notifications/:emailKey/reset': 'reset_notification',
  'GET /v1/forms/:id/notifications': 'list_form_notifications',
  'PUT /v1/forms/:id/notifications/:emailKey': 'update_form_notification',
  'POST /v1/forms/:id/notifications/:emailKey/reset': 'reset_form_notification',

  'GET /v1/integrations': 'list_integrations',
  'GET /v1/integrations/webhooks': 'list_webhooks',
  'GET /v1/integrations/hubspot/properties': 'list_hubspot_properties',
  'GET /v1/integrations/calendly/event-types': 'list_calendly_event_types',

  'GET /v1/me': 'whoami',
  'GET /v1/me/profile': 'get_my_profile',
  'GET /v1/vanity': 'get_workspace_link_code',
};

/**
 * Routes of the reference the MCP leaves out on purpose, each with the
 * reason. Empty: every documented route has a tool. `GET /v1/forms/:id/summary`
 * is not a duplicate of get_form_analytics (that one is the session funnel;
 * the summary counts answers per question), so it has its own tool.
 */
export const API_ROUTE_EXCLUSIONS: Readonly<Record<string, string>> = {};
