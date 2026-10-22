import * as z from 'zod4';
import type { FolderItem } from '../parity-backend';
import { READ, actingAs, iso, workspaceId, type ToolDef } from '../tools';
import { CONFIRM_FIRST, DESTRUCTIVE, WRITE, WRITE_IDEMPOTENT, attempt, folderIdArg, plural, type Missing } from './shared';

/** The workspace's folders: the dashboard's shelves for forms. */

const FOLDER_MISSING: Missing = {
  what: 'Folder',
  hint: 'Check the id with list_folders. An id from another workspace is reported the same way.',
};

const NAME_HINTS = { NAME_TAKEN: 'Another folder of this workspace has that name (case does not count). Pick another, or use that folder.' };

const folderName = z.string().min(1).max(80).describe('The folder name, 1 to 80 characters, unique in the workspace.');

const folder = z.object({ id: z.string(), name: z.string(), created_at: z.string().nullable(), updated_at: z.string().nullable() });

const folderOf = (f: FolderItem) => ({ id: f.id, name: f.name, created_at: iso(f.createdAt), updated_at: iso(f.updatedAt) });

// --- list_folders -------------------------------------------------------------

const listFoldersInput = z.object({ workspace_id: workspaceId });

export const listFolders: ToolDef = {
  name: 'list_folders',
  title: 'List folders',
  description: "The workspace's folders, alphabetically. Each form's folder_id (list_forms) points at one of them.",
  write: false,
  workspace: 'required',
  annotations: READ,
  input: listFoldersInput,
  output: z.object({ folders: z.array(folder) }),
  async run(_args: z.infer<typeof listFoldersInput>, ctx) {
    const folders = await ctx.backend.listFolders(actingAs(ctx));
    return {
      data: { folders: folders.map(folderOf) },
      summary: folders.length ? `${plural(folders.length, 'folder')}: ${folders.map((f) => f.name).join(', ')}.` : 'No folders yet.',
    };
  },
};

// --- create_folder ------------------------------------------------------------

const createFolderInput = z.object({ workspace_id: workspaceId, name: folderName });

export const createFolder: ToolDef = {
  name: 'create_folder',
  title: 'Create a folder',
  description: 'Create a folder to file forms in (move_form). NAME_TAKEN when the workspace already has a folder with that name.',
  write: true,
  workspace: 'required',
  annotations: WRITE,
  input: createFolderInput,
  output: z.object({ folder }),
  async run(args: z.infer<typeof createFolderInput>, ctx) {
    const f = await attempt(ctx.backend.createFolder(actingAs(ctx), args.name), FOLDER_MISSING, NAME_HINTS);
    return { data: { folder: folderOf(f) }, summary: `Created the folder "${f.name}" (${f.id}).` };
  },
};

// --- rename_folder ------------------------------------------------------------

const renameFolderInput = z.object({ workspace_id: workspaceId, folder_id: folderIdArg, name: folderName });

export const renameFolder: ToolDef = {
  name: 'rename_folder',
  title: 'Rename a folder',
  description: 'Rename a folder. Its forms stay in it. NAME_TAKEN when another folder already has that name.',
  write: true,
  workspace: 'required',
  annotations: WRITE_IDEMPOTENT,
  input: renameFolderInput,
  output: z.object({ folder }),
  async run(args: z.infer<typeof renameFolderInput>, ctx) {
    const f = await attempt(ctx.backend.renameFolder(actingAs(ctx), args.folder_id, args.name), FOLDER_MISSING, NAME_HINTS);
    return { data: { folder: folderOf(f) }, summary: `Renamed folder ${f.id} to "${f.name}".` };
  },
};

// --- delete_folder ------------------------------------------------------------

const deleteFolderInput = z.object({ workspace_id: workspaceId, folder_id: folderIdArg });

export const deleteFolder: ToolDef = {
  name: 'delete_folder',
  title: 'Delete a folder',
  description: [
    'Delete a folder. Its forms are never deleted: they are taken out of it and stay live, with their responses.',
    CONFIRM_FIRST,
  ].join(' '),
  write: true,
  workspace: 'required',
  annotations: DESTRUCTIVE,
  input: deleteFolderInput,
  output: z.object({ deleted: folder }),
  async run(args: z.infer<typeof deleteFolderInput>, ctx) {
    const f = await attempt(ctx.backend.deleteFolder(actingAs(ctx), args.folder_id), FOLDER_MISSING);
    return { data: { deleted: folderOf(f) }, summary: `Deleted the folder "${f.name}". Its forms are in no folder now.` };
  },
};
