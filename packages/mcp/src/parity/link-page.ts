import * as z from 'zod4';
import type { LinkPageView } from '../parity-backend';
import { READ, actingAs, workspaceId, type ToolDef } from '../tools';
import { CONFIRM_FIRST, attempt } from './shared';

/**
 * The workspace link page: one public page per workspace at `/{accountCode}`,
 * a column of buttons (the workspace's forms mixed with custom links), a row
 * of socials, a logo, a name and a bio. Any member may read and write it, as
 * over REST; its colors and type come from the brand kit.
 */

const PAGE_FORM_MISSING = {
  what: 'Form',
  hint: 'A form button takes an id from the forms get_link_page lists. An id from another workspace is reported the same way.',
};

const formRef = z.object({ id: z.string(), slug: z.string(), name: z.string(), title: z.string().nullable() });

const viewOutput = z.object({
  account_code: z.string().describe('The workspace code the page lives under.'),
  public_url: z
    .string()
    .nullable()
    .describe('The page address, to give to users exactly as returned; null when the deployment has no public address.'),
  live: z.boolean().describe('True when the page is saved with enabled: true, so public_url serves it. False: public_url answers 404.'),
  page: z
    .record(z.string(), z.unknown())
    .nullable()
    .describe('The stored page, ready to send back to update_link_page after changing it; null when the workspace has none.'),
  forms: z.array(formRef).describe('The workspace forms a form button can point at, by id.'),
  brand_kit: z.record(z.string(), z.unknown()).nullable().describe('The brand kit the page takes its colors, type and default logo from.'),
});

const viewOf = (v: LinkPageView) => ({
  account_code: v.accountCode,
  public_url: v.publicUrl,
  live: v.live,
  page: v.page,
  forms: v.forms,
  brand_kit: v.brandKit,
});

const where = (v: LinkPageView): string => v.publicUrl ?? `/${v.accountCode}`;

// --- get_link_page --------------------------------------------------------------

const getInput = z.object({ workspace_id: workspaceId });

export const getLinkPage: ToolDef = {
  name: 'get_link_page',
  title: 'Get the workspace link page',
  description:
    'The workspace public page (its link page at public_url): the stored page or null, whether it is live, the forms a button can point at and the brand kit it is styled with. Typically read before update_link_page, since that call replaces the whole page. Any member can use it.',
  write: false,
  workspace: 'required',
  annotations: READ,
  input: getInput,
  output: viewOutput,
  async run(_args: z.infer<typeof getInput>, ctx) {
    const v = await ctx.backend.getLinkPage(actingAs(ctx));
    const summary = !v.page
      ? `This workspace has no link page yet; ${where(v)} answers 404.`
      : v.live
        ? `The link page is live at ${where(v)}.`
        : `The link page is saved but not published; ${where(v)} answers 404.`;
    return { data: viewOf(v), summary };
  },
};

// --- update_link_page -----------------------------------------------------------

const optionalText = (max: number, what: string) => z.string().max(max).nullable().optional().describe(what);

const itemInput = z.discriminatedUnion('type', [
  z.object({ type: z.literal('form'), formId: z.string().min(1).max(64).describe('A form id from get_link_page forms.') }),
  z.object({
    type: z.literal('link'),
    label: z.string().min(1).max(80).describe('The button text.'),
    url: z.string().min(1).max(2048).describe('An http(s) URL.'),
  }),
]);

const pageInput = z.object({
  enabled: z.boolean().optional().describe('True publishes the page at public_url. False or absent keeps it unpublished, and public_url answers 404.'),
  name: optionalText(80, 'The heading. Blank, null or absent shows the workspace name.'),
  bio: optionalText(280, 'One line under the heading.'),
  logo: z
    .string()
    .max(90_000)
    .nullable()
    .optional()
    .describe('Absent: the brand kit logo. null: no logo. Else an http(s) image URL (an uploaded PNG, JPEG, WebP or GIF data URL read from get_link_page also goes back as is).'),
  items: z.array(itemInput).max(30).optional().describe('The buttons, in page order, at most 30: {type:"form", formId} or {type:"link", label, url}.'),
  socials: z
    .object({
      instagram: optionalText(512, 'A profile link or a handle like @brand.'),
      x: optionalText(512, 'A profile link or a handle like @brand.'),
      youtube: optionalText(512, 'A channel link or a handle like @brand.'),
      tiktok: optionalText(512, 'A profile link or a handle like @brand.'),
      whatsapp: optionalText(512, 'The number with its country code, starting with +, like +57 300 123 4567.'),
    })
    .optional()
    .describe('Social icons. A blank or null field shows no icon.'),
});

const updateInput = z.object({
  workspace_id: workspaceId,
  page: pageInput
    .nullable()
    .describe('The whole page, as get_link_page returned it with your changes; null deletes the page.'),
});

export const updateLinkPage: ToolDef = {
  name: 'update_link_page',
  title: 'Update the workspace link page',
  description: [
    'Replace the whole workspace link page: a field left out is no longer set. The page sent is usually what get_link_page returned, with only the requested change.',
    'Fields: enabled, name, bio, logo (absent: the brand kit logo; null: none; else an http(s) URL), items (ordered, at most 30: {type:"form", formId} or {type:"link", label, url}) and socials (instagram, x, youtube, tiktok, and whatsapp with its country code).',
    'WhatsApp is stored as digits and get_link_page returns it with its + again, so send it back as read.',
    'Colors and fonts come from the workspace brand kit: change them with update_brand_kit.',
    'With enabled false, public_url answers 404. page: null deletes the page and public_url answers 404 again.',
    CONFIRM_FIRST,
    'Any member can use it.',
  ].join(' '),
  write: true,
  workspace: 'required',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  input: updateInput,
  output: viewOutput,
  async run(args: z.infer<typeof updateInput>, ctx) {
    const page = args.page === null ? null : { version: 1, ...args.page };
    const v = await attempt(ctx.backend.updateLinkPage(actingAs(ctx), page), PAGE_FORM_MISSING);
    const summary =
      page === null
        ? `Deleted the link page; ${where(v)} answers 404 again.`
        : v.live
          ? `Saved the link page; it is live at ${where(v)}.`
          : `Saved the link page, unpublished; ${where(v)} answers 404 until enabled is true.`;
    return { data: viewOf(v), summary };
  },
};
