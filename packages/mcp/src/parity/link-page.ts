import * as z from 'zod4';
import { BackendError } from '../backend';
import type { LinkPageList, LinkPageView } from '../parity-backend';
import { ToolFailure } from '../support';
import { READ, actingAs, workspaceId, type ToolDef } from '../tools';
import { CONFIRM_FIRST, DESTRUCTIVE, WRITE, attempt, plural } from './shared';

/**
 * The workspace link pages: up to 20 public pages per workspace, the default
 * one at `/{accountCode}` and the others at `/{accountCode}/p/{slug}`. Each is
 * a column of buttons (the workspace's forms mixed with custom links), a row
 * of socials, a logo, a name and a bio. Any member may read and write them,
 * as over REST; their type comes from the brand kit, and each page may set
 * its own colors.
 *
 * `get_link_page` and `update_link_page` act on the default page unless they
 * are given a `page_id`, so an agent written for one page per workspace keeps
 * working unchanged.
 */

const PAGE_FORM_MISSING = {
  what: 'Form',
  hint: 'A form button takes an id from the forms get_link_page lists. An id from another workspace is reported the same way.',
};

const PAGE_MISSING = {
  what: 'Link page',
  hint: 'Check the page_id with list_link_pages. An id from another workspace is reported the same way.',
};

/** A 404 for the PAGE (the backend says `PAGE_NOT_FOUND`) is named as such; any other 404 as `missing`. */
async function attemptPage<T>(work: Promise<T>, missing = PAGE_MISSING): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof BackendError && error.code === 'PAGE_NOT_FOUND') {
      throw new ToolFailure('NOT_FOUND', `${PAGE_MISSING.what} not found in this workspace.`, PAGE_MISSING.hint);
    }
    return attempt(Promise.reject(error), missing, {
      SLUG_TAKEN: 'Pick another slug: list_link_pages shows the ones in use.',
      PAGE_LIMIT: 'A workspace keeps up to 20 pages: delete_link_page one first.',
      DEFAULT_PAGE: 'Make another page the default first: update_link_page with page_id and make_default true.',
      PAGE_NOT_PUBLISHED: 'Publish the page first (page.enabled true), then make it the default.',
    });
  }
}

const pageIdArg = z.string().min(1).max(64).describe('The page id, from list_link_pages.');
const pageIdOptional = pageIdArg
  .optional()
  .describe('The page id, from list_link_pages. Absent: the default page, the one at /{accountCode}.');
const nameArg = z.string().max(80).describe('An internal name to tell pages apart ("Expo 2026"). Visitors never see it.');
const slugArg = z
  .string()
  .min(3)
  .max(30)
  .describe('The address after /p/: 3 to 30 lowercase letters, numbers or single hyphens, unique in the workspace.');

const formRef = z.object({ id: z.string(), slug: z.string(), name: z.string(), title: z.string().nullable() });

const viewOutput = z.object({
  page_id: z.string().nullable().describe('The page id; null when the workspace has no page yet.'),
  slug: z.string().nullable().describe('The page slug; the default page is served at /{accountCode} whatever its slug.'),
  name: z.string().nullable().describe('The internal name; blank when nobody named it.'),
  is_default: z.boolean().describe('True for the page at /{accountCode}.'),
  account_code: z.string().describe('The workspace code the pages live under.'),
  public_url: z
    .string()
    .nullable()
    .describe('The page address, to give to users exactly as returned; null when the deployment has no public address.'),
  live: z.boolean().describe('True when the page is saved with enabled: true, so public_url serves it. False: public_url answers 404.'),
  page: z
    .record(z.string(), z.unknown())
    .nullable()
    .describe('The stored page, ready to send back to update_link_page after changing it; null when there is none.'),
  forms: z.array(formRef).describe('The workspace forms a form button can point at, by id.'),
  brand_kit: z.record(z.string(), z.unknown()).nullable().describe('The brand kit the page takes its type, default colors and default logo from.'),
});

const viewOf = (v: LinkPageView) => ({
  page_id: v.id,
  slug: v.slug,
  name: v.name,
  is_default: v.isDefault,
  account_code: v.accountCode,
  public_url: v.publicUrl,
  live: v.live,
  page: v.page,
  forms: v.forms,
  brand_kit: v.brandKit,
});

const where = (v: LinkPageView): string =>
  v.publicUrl ?? (v.isDefault || !v.slug ? `/${v.accountCode}` : `/${v.accountCode}/p/${v.slug}`);

// --- get_link_page --------------------------------------------------------------

const getInput = z.object({ workspace_id: workspaceId, page_id: pageIdOptional });

export const getLinkPage: ToolDef = {
  name: 'get_link_page',
  title: 'Get a workspace link page',
  description:
    'One of the workspace public pages: the default one (at /{accountCode}) unless page_id names another. Answers the stored page or null, whether it is live at public_url, the forms a button can point at and the brand kit it is styled with. Typically read before update_link_page, since that call replaces the whole page. Any member can use it.',
  write: false,
  workspace: 'required',
  annotations: READ,
  input: getInput,
  output: viewOutput,
  async run(args: z.infer<typeof getInput>, ctx) {
    const v = await attemptPage(ctx.backend.getLinkPage(actingAs(ctx), args.page_id));
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
const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
  .nullable()
  .optional();

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
  colors: z
    .object({ primaryColor: hexColor, background: hexColor, foreground: hexColor })
    .optional()
    .describe('This page\'s own colors as hex (#3DDC84). An absent one takes the brand kit\'s.'),
});

const updateInput = z.object({
  workspace_id: workspaceId,
  page_id: pageIdOptional,
  page: pageInput
    .nullable()
    .optional()
    .describe('The whole page content, as get_link_page returned it with your changes. Without page_id, null deletes the default page (only when it is the workspace\'s only page). With page_id, absent keeps the content as it is.'),
  name: nameArg.optional(),
  slug: slugArg.optional().describe('A new address after /p/. The old one keeps redirecting to it. Needs page_id.'),
  make_default: z
    .literal(true)
    .optional()
    .describe('true makes this page the one at /{accountCode}. Needs page_id, and the page must be published (enabled true).'),
});

export const updateLinkPage: ToolDef = {
  name: 'update_link_page',
  title: 'Update a workspace link page',
  description: [
    'Change a workspace link page: the default one unless page_id names another.',
    'page replaces the whole content: a field left out is no longer set. The page sent is usually what get_link_page returned, with only the requested change.',
    'Fields: enabled, name, bio, logo (absent: the brand kit logo; null: none; else an http(s) URL), items (ordered, at most 30: {type:"form", formId} or {type:"link", label, url}), socials (instagram, x, youtube, tiktok, and whatsapp with its country code) and colors (primaryColor, background, foreground as hex; absent: the brand kit\'s).',
    'WhatsApp is stored as digits and get_link_page returns it with its + again, so send it back as read.',
    'Fonts come from the workspace brand kit: change them with update_brand_kit.',
    'With page_id, name, slug (the old address keeps redirecting) and make_default can change too.',
    'With enabled false, public_url answers 404. Without page_id, page: null deletes the default page when it is the only one; delete other pages with delete_link_page.',
    CONFIRM_FIRST,
    'Any member can use it.',
  ].join(' '),
  write: true,
  workspace: 'required',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  input: updateInput,
  output: viewOutput,
  async run(args: z.infer<typeof updateInput>, ctx) {
    const page = args.page == null ? (args.page as null | undefined) : { version: 1, ...args.page };
    if (!args.page_id) {
      if (args.name !== undefined || args.slug !== undefined || args.make_default) {
        throw new ToolFailure('BAD_REQUEST', 'name, slug and make_default need a page_id.', 'Read the page ids with list_link_pages.');
      }
      if (page === undefined) {
        throw new ToolFailure('BAD_REQUEST', 'Send page: the whole default page, or null to delete it.', 'Read it first with get_link_page.');
      }
    } else if (page === null) {
      throw new ToolFailure('BAD_REQUEST', 'With page_id, page cannot be null.', 'Delete a page with delete_link_page.');
    }
    const target = args.page_id
      ? {
          pageId: args.page_id,
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.slug !== undefined ? { slug: args.slug } : {}),
          ...(args.make_default ? { makeDefault: true } : {}),
        }
      : undefined;
    const v = await attemptPage(ctx.backend.updateLinkPage(actingAs(ctx), page, target), PAGE_FORM_MISSING);
    const summary =
      page === null
        ? `Deleted the link page; ${where(v)} answers 404 again.`
        : v.live
          ? `Saved the link page; it is live at ${where(v)}.`
          : `Saved the link page, unpublished; ${where(v)} answers 404 until enabled is true.`;
    return { data: viewOf(v), summary };
  },
};

// --- list_link_pages ------------------------------------------------------------

const listInput = z.object({ workspace_id: workspaceId });

const listOutput = z.object({
  account_code: z.string(),
  max: z.number().describe('How many pages a workspace may keep.'),
  pages: z.array(
    z.object({
      page_id: z.string(),
      slug: z.string(),
      name: z.string(),
      is_default: z.boolean(),
      live: z.boolean(),
      buttons: z.number(),
      public_url: z.string().nullable(),
      updated_at: z.number(),
    }),
  ),
});

const listOf = (l: LinkPageList) => ({
  account_code: l.accountCode,
  max: l.max,
  pages: l.pages.map((p) => ({
    page_id: p.id,
    slug: p.slug,
    name: p.name,
    is_default: p.isDefault,
    live: p.live,
    buttons: p.buttons,
    public_url: p.publicUrl,
    updated_at: p.updatedAt,
  })),
});

export const listLinkPages: ToolDef = {
  name: 'list_link_pages',
  title: 'List the workspace link pages',
  description:
    'Every public page of the workspace, the default (at /{accountCode}) first: its page_id, slug, internal name, whether it is live, how many buttons it holds and its public_url. Read it to find the page_id the other link page tools take. Any member can use it.',
  write: false,
  workspace: 'required',
  annotations: READ,
  input: listInput,
  output: listOutput,
  async run(_args: z.infer<typeof listInput>, ctx) {
    const l = await ctx.backend.listLinkPages(actingAs(ctx));
    return { data: listOf(l), summary: `${plural(l.pages.length, 'link page')} (at most ${l.max}).` };
  },
};

// --- create_link_page -----------------------------------------------------------

const createInput = z.object({
  workspace_id: workspaceId,
  name: nameArg.optional(),
  slug: slugArg.optional().describe('The address after /p/. Absent: one is made from the name.'),
  page: pageInput.optional().describe('The page content. Absent: the page starts empty and unpublished.'),
});

export const createLinkPage: ToolDef = {
  name: 'create_link_page',
  title: 'Create a workspace link page',
  description:
    'Add a public page to the workspace (at most 20), for an event, a channel or a country. It lives at /{accountCode}/p/{slug}, except the workspace\'s first page, which becomes the default at /{accountCode}. page takes the same fields as update_link_page; absent, the page starts empty and unpublished. Any member can use it.',
  write: true,
  workspace: 'required',
  // Open world: the new page can go live on a public address.
  annotations: { ...WRITE, openWorldHint: true },
  input: createInput,
  output: viewOutput,
  async run(args: z.infer<typeof createInput>, ctx) {
    const v = await attemptPage(
      ctx.backend.createLinkPage(actingAs(ctx), {
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.slug !== undefined ? { slug: args.slug } : {}),
        ...(args.page ? { page: { version: 1, ...args.page } } : {}),
      }),
      PAGE_FORM_MISSING,
    );
    const summary = v.live ? `Created the link page; it is live at ${where(v)}.` : `Created the link page, unpublished; ${where(v)} answers 404 until enabled is true.`;
    return { data: viewOf(v), summary };
  },
};

// --- duplicate_link_page --------------------------------------------------------

const duplicateInput = z.object({
  workspace_id: workspaceId,
  page_id: pageIdArg,
  name: nameArg.optional().describe('The copy\'s internal name. Absent: the original\'s.'),
  slug: slugArg.optional().describe('The copy\'s address after /p/. Absent: the original\'s with -2, -3 and so on.'),
});

export const duplicateLinkPage: ToolDef = {
  name: 'duplicate_link_page',
  title: 'Duplicate a workspace link page',
  description:
    'Copy a page under a new slug, unpublished and never the default, so it can be edited (for the next event, say) before update_link_page publishes it. Any member can use it.',
  write: true,
  workspace: 'required',
  annotations: WRITE,
  input: duplicateInput,
  output: viewOutput,
  async run(args: z.infer<typeof duplicateInput>, ctx) {
    const v = await attemptPage(
      ctx.backend.duplicateLinkPage(actingAs(ctx), args.page_id, {
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.slug !== undefined ? { slug: args.slug } : {}),
      }),
    );
    return { data: viewOf(v), summary: `Copied the page to ${where(v)}, unpublished.` };
  },
};

// --- delete_link_page -----------------------------------------------------------

const deleteInput = z.object({ workspace_id: workspaceId, page_id: pageIdArg });

export const deleteLinkPage: ToolDef = {
  name: 'delete_link_page',
  title: 'Delete a workspace link page',
  description: [
    'Delete a page: its address answers 404 from then on, printed QR codes included.',
    'The default page cannot be deleted: make another page the default first (update_link_page with make_default).',
    CONFIRM_FIRST,
    'Any member can use it.',
  ].join(' '),
  write: true,
  workspace: 'required',
  // Open world: a public address stops answering.
  annotations: { ...DESTRUCTIVE, openWorldHint: true },
  input: deleteInput,
  output: z.object({ deleted: z.object({ page_id: z.string(), slug: z.string() }) }),
  async run(args: z.infer<typeof deleteInput>, ctx) {
    const out = await attemptPage(ctx.backend.deleteLinkPage(actingAs(ctx), args.page_id));
    return { data: { deleted: { page_id: out.id, slug: out.slug } }, summary: `Deleted the link page ${out.slug}.` };
  },
};
