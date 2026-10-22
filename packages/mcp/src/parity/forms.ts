import * as z from 'zod4';
import { actingAs, formSummary, summaryOf, workspaceId, type ToolDef } from '../tools';
import { CONFIRM_FIRST, DESTRUCTIVE, FORM_MISSING, WRITE, WRITE_IDEMPOTENT, attempt, formIdArg } from './shared';

/** The form routes beyond create, read, edit, publish and revert: the link, a copy, a folder, a delete. */

const linkOf = (url: string | null): string =>
  url ? `Public link: ${url}` : 'This deployment has no public address configured, so there is no link to share.';

// --- set_form_slug ------------------------------------------------------------

const setFormSlugInput = z.object({
  workspace_id: workspaceId,
  form_id: formIdArg,
  slug: z
    .string()
    .min(1)
    .max(80)
    .describe('The new last segment of the public link: lowercase letters, numbers and hyphens, up to 80 characters.'),
});

export const setFormSlug: ToolDef = {
  name: 'set_form_slug',
  title: 'Change a form link',
  description:
    'Change the last segment of a form\'s public link. The old link keeps working and leads to the new one, forever, so links already shared do not break. Returns the new public_url to give the user. SLUG_TAKEN: another form of this workspace holds it (now or before); pick another.',
  write: true,
  workspace: 'required',
  annotations: WRITE_IDEMPOTENT,
  input: setFormSlugInput,
  output: z.object({ form: formSummary }),
  async run(args: z.infer<typeof setFormSlugInput>, ctx) {
    const f = await attempt(ctx.backend.setFormSlug(actingAs(ctx), args.form_id, args.slug), FORM_MISSING);
    return {
      data: { form: summaryOf(f) },
      summary: `"${f.name}" now answers at the slug "${f.slug}". ${linkOf(f.publicUrl)}`,
      affected: [f.id],
    };
  },
};

// --- duplicate_form -----------------------------------------------------------

const duplicateFormInput = z.object({ workspace_id: workspaceId, form_id: formIdArg });

export const duplicateForm: ToolDef = {
  name: 'duplicate_form',
  title: 'Duplicate a form',
  description:
    'Copy a form, with its live config, into a new form named "<name> (copy)", in the same folder, with its own link and no responses. The copy is live at once. Not idempotent: if the call fails or times out, call list_forms and look for the copy before trying again.',
  write: true,
  workspace: 'required',
  annotations: WRITE,
  input: duplicateFormInput,
  output: z.object({ form: formSummary }),
  async run(args: z.infer<typeof duplicateFormInput>, ctx) {
    const f = await attempt(ctx.backend.duplicateForm(actingAs(ctx), args.form_id), FORM_MISSING);
    return {
      data: { form: summaryOf(f) },
      summary: `Created "${f.name}" (${f.id}), a copy of ${args.form_id}. ${linkOf(f.publicUrl)}`,
      affected: [args.form_id, f.id],
    };
  },
};

// --- move_form ----------------------------------------------------------------

const moveFormInput = z.object({
  workspace_id: workspaceId,
  form_id: formIdArg,
  folder_id: z
    .string()
    .min(1)
    .max(64)
    .nullable()
    .describe('The folder to file the form in, from list_folders, or null to take it out of its folder.'),
});

export const moveForm: ToolDef = {
  name: 'move_form',
  title: 'Move a form to a folder',
  description:
    'File a form in a folder of the workspace, or take it out of its folder with folder_id null. Only the dashboard\'s organisation changes: the form, its link and its responses stay as they are.',
  write: true,
  workspace: 'required',
  annotations: WRITE_IDEMPOTENT,
  input: moveFormInput,
  output: z.object({ form_id: z.string(), folder_id: z.string().nullable() }),
  async run(args: z.infer<typeof moveFormInput>, ctx) {
    const out = await attempt(ctx.backend.moveForm(actingAs(ctx), args.form_id, args.folder_id), {
      what: 'Form or folder',
      hint: 'Check the form id with list_forms and the folder id with list_folders.',
    });
    return {
      data: { form_id: out.id, folder_id: out.folderId },
      summary: out.folderId ? `Filed form ${out.id} in folder ${out.folderId}.` : `Form ${out.id} is in no folder now.`,
      affected: [out.id],
    };
  },
};

// --- delete_form --------------------------------------------------------------

const deleteFormInput = z.object({ workspace_id: workspaceId, form_id: formIdArg });

export const deleteForm: ToolDef = {
  name: 'delete_form',
  title: 'Delete a form',
  description: [
    'Delete a form for good, with every response and its funnel data. Its public link stops answering. There is no undo and no trash.',
    CONFIRM_FIRST,
    'Name the form (get_form) when you ask. NOT_FOUND after a timeout usually means the delete went through.',
  ].join(' '),
  write: true,
  workspace: 'required',
  annotations: DESTRUCTIVE,
  input: deleteFormInput,
  output: z.object({ deleted: z.object({ id: z.string(), name: z.string() }) }),
  async run(args: z.infer<typeof deleteFormInput>, ctx) {
    const gone = await attempt(ctx.backend.deleteForm(actingAs(ctx), args.form_id), FORM_MISSING);
    return {
      data: { deleted: gone },
      summary: `Deleted the form "${gone.name}" (${gone.id}) and its responses.`,
      affected: [gone.id],
    };
  },
};
