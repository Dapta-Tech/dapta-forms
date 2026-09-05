"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { adminApi, ApiError, type Folder } from "@/lib/admin-api";

/** Every surface that lists forms by folder. */
function revalidateForms(): void {
  revalidatePath("/admin/forms");
  revalidatePath("/admin");
}

export type FolderWriteState =
  | { ok: true; folder: Folder }
  | { ok: false; code: "NAME_TAKEN" | "INVALID" | "FAILED" };

function failure(e: unknown): FolderWriteState {
  unstable_rethrow(e);
  if (e instanceof ApiError && e.status === 409)
    return { ok: false, code: "NAME_TAKEN" };
  if (e instanceof ApiError && e.status === 400)
    return { ok: false, code: "INVALID" };
  return { ok: false, code: "FAILED" };
}

export async function createFolderAction(
  name: string,
): Promise<FolderWriteState> {
  try {
    const folder = await adminApi.createFolder(name.trim());
    revalidateForms();
    return { ok: true, folder };
  } catch (e) {
    return failure(e);
  }
}

export async function renameFolderAction(
  id: string,
  name: string,
): Promise<FolderWriteState> {
  try {
    const folder = await adminApi.renameFolder(id, name.trim());
    revalidateForms();
    return { ok: true, folder };
  } catch (e) {
    return failure(e);
  }
}

/** Delete a folder: its forms are unfiled, never deleted. */
export async function deleteFolderAction(id: string): Promise<{ ok: boolean }> {
  try {
    await adminApi.deleteFolder(id);
    revalidateForms();
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false };
  }
}

/** File a form in a folder (null unfiles). */
export async function moveFormAction(
  formId: string,
  folderId: string | null,
): Promise<{ ok: boolean }> {
  try {
    await adminApi.setFormFolder(formId, folderId);
    revalidateForms();
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false };
  }
}
