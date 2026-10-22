import * as z from 'zod4';
import { READ, actingAs, workspaceId, type ToolDef } from '../tools';

/**
 * The reads of the identity routes beyond whoami: the member's public page,
 * and the workspace's code in public links. Both are changed in the dForms
 * dashboard only.
 */

const input = z.object({ workspace_id: workspaceId });
type Input = z.infer<typeof input>;

// --- get_my_profile -----------------------------------------------------------

export const getMyProfile: ToolDef = {
  name: 'get_my_profile',
  title: 'Get my public page',
  description:
    "The public page of the member this call acts as in this workspace: its handle and the page (null when they have none). Changing it is done in the dForms dashboard.",
  write: false,
  workspace: 'required',
  annotations: READ,
  input,
  output: z.object({
    handle: z.string().nullable(),
    profile: z.record(z.string(), z.unknown()).nullable().describe('The public page, or null when the member has none.'),
  }),
  async run(_args: Input, ctx) {
    const p = await ctx.backend.myProfile(actingAs(ctx));
    const profile = p.profile && typeof p.profile === 'object' && !Array.isArray(p.profile) ? (p.profile as Record<string, unknown>) : null;
    return {
      data: { handle: p.handle, profile },
      summary: profile ? `The public page of ${p.handle ?? 'this member'}.` : 'This member has no public page.',
    };
  },
};

// --- get_workspace_link_code --------------------------------------------------

export const getWorkspaceLinkCode: ToolDef = {
  name: 'get_workspace_link_code',
  title: 'Get the workspace link code',
  description:
    "The code every public form link of this workspace starts with: the custom one (vanity_slug) when the workspace claimed one, else its short code, and whether a custom one can still be claimed. Claiming one is done in the dForms dashboard. Never build a form link from it: use the public_url the form tools return.",
  write: false,
  workspace: 'required',
  annotations: READ,
  input,
  output: z.object({
    vanity_slug: z.string().nullable().describe('The custom code, or null when none was claimed.'),
    short_code: z.string().describe('The code links use when there is no custom one.'),
    can_claim: z.boolean(),
  }),
  async run(_args: Input, ctx) {
    const v = await ctx.backend.vanity(actingAs(ctx));
    return {
      data: { vanity_slug: v.vanitySlug, short_code: v.shortCode, can_claim: v.canClaim },
      summary: `Public links of this workspace start with "${v.vanitySlug ?? v.shortCode}".`,
    };
  },
};
