import * as z from 'zod4';
import type { NotificationPatch, NotificationView } from '../parity-backend';
import { READ, actingAs, workspaceId, type ToolDef } from '../tools';
import { CONFIRM_FIRST, DESTRUCTIVE, FORM_MISSING, attempt, emailKeyArg, formIdArg, type Missing } from './shared';

/**
 * The two emails a response sends: the notice to the team and the receipt to
 * the person who answered. Each has a workspace setting and, per form, an
 * optional override. Owners and admins only, as in the dashboard.
 */

const OWNERS = 'Owners and admins only.';

const TOKENS =
  'Subject and body are plain text with {{token}} markers: {{formName}}, {{respondentName}}, {{respondentEmail}}, {{score}}, {{outcomeLabel}}, {{formLink}}, {{answers}}. Any other marker is saved but reaches the inbox as written; warnings lists it.';

const NO_FORM: Missing = FORM_MISSING;
const WORKSPACE: Missing = { what: 'Notification', hint: 'email_key is submission_received or submission_confirmed.' };

const view = z.record(z.string(), z.unknown());

const patchShape = {
  enabled: z.boolean().optional().describe('Whether the email is sent.'),
  subject: z.string().max(500).nullable().optional().describe('The subject, with {{token}} markers. null puts the default back.'),
  body: z.string().max(20_000).nullable().optional().describe('The body as plain text, with {{token}} markers. null puts the default back.'),
  recipients: z
    .array(z.string().max(320))
    .max(50)
    .nullable()
    .optional()
    .describe('Who gets the notice to the team. Not accepted on submission_confirmed, which goes to the person who answered.'),
};

function patchOf(args: NotificationPatch): NotificationPatch {
  return {
    ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
    ...(args.subject !== undefined ? { subject: args.subject } : {}),
    ...(args.body !== undefined ? { body: args.body } : {}),
    ...(args.recipients !== undefined ? { recipients: args.recipients } : {}),
  };
}

const settings = (views: NotificationView[]) => views as Array<Record<string, unknown>>;

/** The tokens the emails fill in, when the setting read back does not list them. */
const KNOWN_TOKENS = ['formName', 'respondentName', 'respondentEmail', 'score', 'outcomeLabel', 'formLink', 'answers'];
/** A `{{token}}` marker, as the emails read it (spaces inside the braces allowed). */
const TOKEN_MARKER = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

const warningsOut = z
  .array(z.string())
  .optional()
  .describe('What was saved but will not work as written (a {{token}} the emails do not know stays literal in the email), for the user to know.');

/**
 * A warning for each `{{token}}` in the subject or body sent that the emails
 * do not fill in: it is saved (as over the REST API), but reaches the inbox
 * literally. The valid tokens are the ones the saved setting lists.
 */
export function unknownTokenWarnings(patch: NotificationPatch, view: NotificationView): string[] {
  const listed = (view as { tokens?: unknown }).tokens;
  const valid = Array.isArray(listed) && listed.every((t) => typeof t === 'string') ? (listed as string[]) : KNOWN_TOKENS;
  const unknown = new Set<string>();
  for (const text of [patch.subject, patch.body]) {
    if (typeof text !== 'string') continue;
    for (const match of text.matchAll(TOKEN_MARKER)) if (!valid.includes(match[1]!)) unknown.add(match[1]!);
  }
  if (unknown.size === 0) return [];
  const names = [...unknown].map((t) => `{{${t}}}`).join(', ');
  return [
    `${names} ${unknown.size === 1 ? 'is not a token' : 'are not tokens'} the emails fill in, so ${unknown.size === 1 ? 'it reaches' : 'they reach'} the inbox as written. Valid tokens: ${valid.map((t) => `{{${t}}}`).join(', ')}.`,
  ];
}

// --- list_notifications -------------------------------------------------------

const listInput = z.object({ workspace_id: workspaceId });

export const listNotifications: ToolDef = {
  name: 'list_notifications',
  title: 'List the notification emails',
  description: `The workspace setting of both response emails: whether each is sent, its subject and body (null = the default copy, shown under defaults in English and Spanish), the team recipients, and the tokens the copy may use. ${OWNERS}`,
  write: false,
  workspace: 'required',
  annotations: READ,
  input: listInput,
  output: z.object({ settings: z.array(view) }),
  async run(_args: z.infer<typeof listInput>, ctx) {
    const views = await ctx.backend.listNotifications(actingAs(ctx));
    return { data: { settings: settings(views) }, summary: 'The workspace notification emails.' };
  },
};

// --- update_notification ------------------------------------------------------

const updateInput = z.object({ workspace_id: workspaceId, email_key: emailKeyArg, ...patchShape });

export const updateNotification: ToolDef = {
  name: 'update_notification',
  title: 'Edit a notification email',
  description: `Change the workspace setting of one response email: only the fields you pass change, and the copy they replace is lost. ${TOKENS} Forms with their own override (list_form_notifications) keep it. ${CONFIRM_FIRST} ${OWNERS}`,
  write: true,
  workspace: 'required',
  annotations: DESTRUCTIVE,
  input: updateInput,
  output: z.object({ setting: view, warnings: warningsOut }),
  async run(args: z.infer<typeof updateInput>, ctx) {
    const patch = patchOf(args);
    const v = await attempt(ctx.backend.updateNotification(actingAs(ctx), args.email_key, patch), WORKSPACE);
    const warnings = unknownTokenWarnings(patch, v);
    return {
      data: { setting: v, ...(warnings.length ? { warnings } : {}) },
      summary: `Saved the ${args.email_key} email of the workspace.${warnings.length ? ` ${warnings.join(' ')}` : ''}`,
    };
  },
};

// --- reset_notification -------------------------------------------------------

const resetInput = z.object({ workspace_id: workspaceId, email_key: emailKeyArg });

export const resetNotification: ToolDef = {
  name: 'reset_notification',
  title: 'Reset a notification email',
  description: [
    'Put the default subject and body back on one workspace email. Whether it is sent, and its recipients, stay as they are. The custom copy is lost.',
    CONFIRM_FIRST,
    OWNERS,
  ].join(' '),
  write: true,
  workspace: 'required',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  input: resetInput,
  output: z.object({ setting: view }),
  async run(args: z.infer<typeof resetInput>, ctx) {
    const v = await attempt(ctx.backend.resetNotification(actingAs(ctx), args.email_key), WORKSPACE);
    return { data: { setting: v }, summary: `The ${args.email_key} email of the workspace uses the default copy again.` };
  },
};

// --- list_form_notifications --------------------------------------------------

const listFormInput = z.object({ workspace_id: workspaceId, form_id: formIdArg });

export const listFormNotifications: ToolDef = {
  name: 'list_form_notifications',
  title: "List a form's notification emails",
  description: `Both response emails of one form: the workspace setting it inherits (account) and its own override (override, null when it has none). Per field the form wins, then the workspace, then the default; an override's enabled wins outright. ${OWNERS}`,
  write: false,
  workspace: 'required',
  annotations: READ,
  input: listFormInput,
  output: z.object({ form_id: z.string(), settings: z.array(view) }),
  async run(args: z.infer<typeof listFormInput>, ctx) {
    const views = await attempt(ctx.backend.listFormNotifications(actingAs(ctx), args.form_id), NO_FORM);
    return { data: { form_id: args.form_id, settings: settings(views) }, summary: `The notification emails of form ${args.form_id}.`, affected: [args.form_id] };
  },
};

// --- update_form_notification -------------------------------------------------

const updateFormInput = z.object({ workspace_id: workspaceId, form_id: formIdArg, email_key: emailKeyArg, ...patchShape });

export const updateFormNotification: ToolDef = {
  name: 'update_form_notification',
  title: "Edit a form's notification email",
  description: `Create or change this form's own override of one response email (an upsert: the copy it replaces is lost); the workspace setting is left alone. ${TOKENS} ${CONFIRM_FIRST} ${OWNERS}`,
  write: true,
  workspace: 'required',
  annotations: DESTRUCTIVE,
  input: updateFormInput,
  output: z.object({ form_id: z.string(), setting: view, warnings: warningsOut }),
  async run(args: z.infer<typeof updateFormInput>, ctx) {
    const patch = patchOf(args);
    const v = await attempt(ctx.backend.updateFormNotification(actingAs(ctx), args.form_id, args.email_key, patch), NO_FORM);
    const warnings = unknownTokenWarnings(patch, v);
    return {
      data: { form_id: args.form_id, setting: v, ...(warnings.length ? { warnings } : {}) },
      summary: `Saved the ${args.email_key} email of form ${args.form_id}.${warnings.length ? ` ${warnings.join(' ')}` : ''}`,
      affected: [args.form_id],
    };
  },
};

// --- reset_form_notification --------------------------------------------------

const resetFormInput = z.object({ workspace_id: workspaceId, form_id: formIdArg, email_key: emailKeyArg });

export const resetFormNotification: ToolDef = {
  name: 'reset_form_notification',
  title: "Remove a form's email override",
  description: [
    "Delete this form's own override of one response email, so the form follows the workspace setting again. The override's copy is lost.",
    CONFIRM_FIRST,
    OWNERS,
  ].join(' '),
  write: true,
  workspace: 'required',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  input: resetFormInput,
  output: z.object({ form_id: z.string(), setting: view }),
  async run(args: z.infer<typeof resetFormInput>, ctx) {
    const v = await attempt(ctx.backend.resetFormNotification(actingAs(ctx), args.form_id, args.email_key), NO_FORM);
    return {
      data: { form_id: args.form_id, setting: v },
      summary: `Form ${args.form_id} follows the workspace ${args.email_key} email again.`,
      affected: [args.form_id],
    };
  },
};
