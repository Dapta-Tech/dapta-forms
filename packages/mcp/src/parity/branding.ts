import * as z from 'zod4';
import type { BrandKitView } from '../parity-backend';
import { READ, actingAs, workspaceId, type ToolDef } from '../tools';
import { CONFIRM_FIRST, WRITE_IDEMPOTENT, attempt, plural } from './shared';

/** The workspace brand kit: the look new forms start with, and that can be applied to existing ones. */

const FORMS_MISSING = { what: 'Form', hint: 'Check the ids with list_forms.' };

const kitOutput = z.object({
  kit: z.record(z.string(), z.unknown()).nullable().describe('The brand kit, or null when the workspace has none yet.'),
  updated_at: z.number().nullable(),
});

const kitOf = (v: BrandKitView) => ({ kit: v.config, updated_at: v.updatedAt });

const formIds = z.array(z.string().min(1).max(64)).min(1).max(500).describe('The forms, 1 to 500 ids from list_forms.');

// --- get_brand_kit ------------------------------------------------------------

const getInput = z.object({ workspace_id: workspaceId });

export const getBrandKit: ToolDef = {
  name: 'get_brand_kit',
  title: 'Get the brand kit',
  description:
    "The workspace brand kit: logo, client logos, colours, typeface, corner radius and button style. New forms start with it; apply_brand_kit puts it on existing ones.",
  write: false,
  workspace: 'required',
  annotations: READ,
  input: getInput,
  output: kitOutput,
  async run(_args: z.infer<typeof getInput>, ctx) {
    const v = await ctx.backend.getBrandKit(actingAs(ctx));
    return { data: kitOf(v), summary: v.config ? 'The workspace brand kit.' : 'This workspace has no brand kit yet.' };
  },
};

// --- update_brand_kit ---------------------------------------------------------

const updateInput = z.object({
  workspace_id: workspaceId,
  kit: z
    .record(z.string(), z.unknown())
    .describe(
      'The whole kit, as get_brand_kit returns it (when it returns null, start from {}). Fields: logo (an image URL, or null; use https, since an http image is blocked on the https form page), clientLogos (up to 24), primaryColor, background (setting it fixes forms to a light or dark look) and foreground (CSS colors or null), fontFamily (figtree, poppins, inter, dm-sans, space-grotesk, manrope, work-sans, fraunces or playfair), customFont, radius (sharp, soft or round), buttonStyle (solid, outline or soft).',
    ),
});

export const updateBrandKit: ToolDef = {
  name: 'update_brand_kit',
  title: 'Update the brand kit',
  description:
    'Replace the workspace brand kit: a field left out is no longer set by the kit. Start from get_brand_kit, change only what was asked and send the whole kit. To clear a field, leave it out (logo, primaryColor, background, foreground and customFont also take null); to clear the whole kit, send {}: it then sets nothing. The kit itself is never deleted, as over the REST API. Existing forms keep their look until apply_brand_kit. Owners and admins only.',
  write: true,
  workspace: 'required',
  annotations: WRITE_IDEMPOTENT,
  input: updateInput,
  output: kitOutput,
  async run(args: z.infer<typeof updateInput>, ctx) {
    const v = await ctx.backend.updateBrandKit(actingAs(ctx), args.kit);
    return { data: kitOf(v), summary: 'Saved the brand kit. Existing forms keep their look until apply_brand_kit.' };
  },
};

// --- apply_brand_kit ----------------------------------------------------------

const applyInput = z.object({ workspace_id: workspaceId, form_ids: formIds });

export const applyBrandKit: ToolDef = {
  name: 'apply_brand_kit',
  title: 'Apply the brand kit to forms',
  description: [
    'Put the brand kit on these forms, live at once, published or not: their own logo, colours and type are replaced by the kit, and their themePreset (the editor\'s note of the last preset picked) is cleared, because it no longer describes their colours.',
    'revert_brand_kit brings back the look each form had before.',
    CONFIRM_FIRST,
    'Owners and admins only.',
  ].join(' '),
  write: true,
  workspace: 'required',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  input: applyInput,
  output: z.object({ applied: z.array(z.string()).describe('The forms the kit was applied to. Ids of other workspaces are skipped, and nothing applies without a kit.') }),
  async run(args: z.infer<typeof applyInput>, ctx) {
    const out = await attempt(ctx.backend.applyBrandKit(actingAs(ctx), args.form_ids), FORMS_MISSING);
    return {
      data: out,
      summary: out.applied.length
        ? `Applied the brand kit to ${plural(out.applied.length, 'form')}.`
        : 'No form changed: the workspace has no brand kit yet (update_brand_kit), or none of these ids is a form of it.',
      affected: out.applied,
    };
  },
};

// --- revert_brand_kit ---------------------------------------------------------

const revertInput = z.object({ workspace_id: workspaceId, form_ids: formIds });

export const revertBrandKit: ToolDef = {
  name: 'revert_brand_kit',
  title: 'Undo the brand kit on forms',
  description: [
    'Give these forms back the look they had before apply_brand_kit (their themePreset included), live at once.',
    CONFIRM_FIRST,
    'Owners and admins only.',
  ].join(' '),
  write: true,
  workspace: 'required',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  input: revertInput,
  output: z.object({ reverted: z.array(z.string()).describe('The forms put back. A form the kit was never applied to is skipped.') }),
  async run(args: z.infer<typeof revertInput>, ctx) {
    const out = await attempt(ctx.backend.revertBrandKit(actingAs(ctx), args.form_ids), FORMS_MISSING);
    return { data: out, summary: `Put ${plural(out.reverted.length, 'form')} back on their look before the brand kit.`, affected: out.reverted };
  },
};
