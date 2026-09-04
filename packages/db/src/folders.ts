/**
 * Form folders (see 0021): flat, one level, named only. A folder is unique per
 * account without regard to case; a form is filed in at most one. Deleting a
 * folder unfiles its forms and never deletes them. Moving a form never touches
 * its `updated_at`: filing is organisation, not authoring.
 */
import { randomUUID } from "node:crypto";
import { sql, type Db } from "./client";
import type { CrudResult } from "./crud";

export interface FormFolder {
  id: string;
  accountId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

interface DatabaseError {
  code?: string;
  constraint?: string;
  constraint_name?: string;
  message?: string;
  cause?: unknown;
  driverError?: unknown;
}

/** True only for the (account_id, lower(name)) unique index, on either engine. */
function isFolderNameUniqueViolation(error: unknown): boolean {
  const e =
    error && typeof error === "object" ? (error as DatabaseError) : undefined;
  if (!e) return false;
  if (
    e.code === "23505" &&
    (e.constraint === "form_folder_account_name_uq" ||
      e.constraint_name === "form_folder_account_name_uq")
  )
    return true;
  // SQLite names an EXPRESSION index by the index, not by its columns.
  return (
    e.code === "SQLITE_CONSTRAINT_UNIQUE" &&
    typeof e.message === "string" &&
    e.message.includes("form_folder_account_name_uq")
  );
}

function isFolderNameConflict(error: unknown): boolean {
  const e =
    error && typeof error === "object" ? (error as DatabaseError) : undefined;
  return (
    isFolderNameUniqueViolation(error) ||
    isFolderNameUniqueViolation(e?.cause) ||
    isFolderNameUniqueViolation(e?.driverError)
  );
}

function mapFolder(r: Record<string, unknown>): FormFolder {
  return {
    id: String(r.id),
    accountId: String(r.account_id),
    name: String(r.name),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

/** The account's folders, alphabetically without regard to case. */
export async function listFolders(
  db: Db,
  accountId: string,
): Promise<FormFolder[]> {
  const rows = await db.all<Record<string, unknown>>(
    sql`SELECT id, account_id, name, created_at, updated_at FROM form_folder
        WHERE account_id = ${accountId} ORDER BY lower(name) ASC, created_at ASC`,
  );
  return rows.map(mapFolder);
}

export async function getFolderById(
  db: Db,
  accountId: string,
  id: string,
): Promise<FormFolder | null> {
  const row = await db.get<Record<string, unknown>>(
    sql`SELECT id, account_id, name, created_at, updated_at FROM form_folder
        WHERE account_id = ${accountId} AND id = ${id} LIMIT 1`,
  );
  return row ? mapFolder(row) : null;
}

/** Another folder of the account already using `name` (case-insensitively), excluding `exceptId`. */
async function nameTaken(
  db: Db,
  accountId: string,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const row = await db.get<{ id: string }>(
    sql`SELECT id FROM form_folder
        WHERE account_id = ${accountId} AND lower(name) = lower(${name})
          ${exceptId ? sql`AND id <> ${exceptId}` : sql``}
        LIMIT 1`,
  );
  return Boolean(row);
}

/**
 * Create a folder. The pre-check gives the common case a clean NAME_TAKEN; the
 * unique index (and the catch below) closes the race two writers could open.
 */
export async function createFolder(
  db: Db,
  accountId: string,
  rawName: string,
): Promise<CrudResult<FormFolder>> {
  const name = rawName.trim();
  if (!name)
    return { ok: false, reason: "CONFLICT", message: "A name is required." };
  if (await nameTaken(db, accountId, name))
    return { ok: false, reason: "NAME_TAKEN" };
  const id = randomUUID();
  const now = Date.now();
  try {
    await db.run(
      sql`INSERT INTO form_folder (id, account_id, name, created_at, updated_at)
          VALUES (${id}, ${accountId}, ${name}, ${now}, ${now})`,
    );
  } catch (error) {
    if (isFolderNameConflict(error)) return { ok: false, reason: "NAME_TAKEN" };
    throw error;
  }
  const created = await getFolderById(db, accountId, id);
  return created
    ? { ok: true, value: created }
    : { ok: false, reason: "CONFLICT" };
}

export async function renameFolder(
  db: Db,
  accountId: string,
  id: string,
  rawName: string,
): Promise<CrudResult<FormFolder>> {
  const name = rawName.trim();
  if (!name)
    return { ok: false, reason: "CONFLICT", message: "A name is required." };
  const existing = await getFolderById(db, accountId, id);
  if (!existing) return { ok: false, reason: "NOT_FOUND" };
  if (await nameTaken(db, accountId, name, id))
    return { ok: false, reason: "NAME_TAKEN" };
  try {
    await db.run(
      sql`UPDATE form_folder SET name = ${name}, updated_at = ${Date.now()}
          WHERE account_id = ${accountId} AND id = ${id}`,
    );
  } catch (error) {
    if (isFolderNameConflict(error)) return { ok: false, reason: "NAME_TAKEN" };
    throw error;
  }
  const renamed = await getFolderById(db, accountId, id);
  return renamed
    ? { ok: true, value: renamed }
    : { ok: false, reason: "NOT_FOUND" };
}

/**
 * Delete a folder: its forms are unfiled first (explicitly, so the result does
 * not depend on the engine enforcing the foreign key), then the row goes.
 * Returns whether a folder was actually deleted; a repeat is false, not an error.
 */
export async function deleteFolder(
  db: Db,
  accountId: string,
  id: string,
): Promise<boolean> {
  const existing = await getFolderById(db, accountId, id);
  if (!existing) return false;
  await db.run(
    sql`UPDATE form SET folder_id = NULL WHERE account_id = ${accountId} AND folder_id = ${id}`,
  );
  await db.run(
    sql`DELETE FROM form_folder WHERE account_id = ${accountId} AND id = ${id}`,
  );
  return true;
}

/**
 * File a form in a folder of the same account, or unfile it with null.
 * `updated_at` is deliberately untouched: the form did not change, its
 * shelf did.
 */
export async function setFormFolder(
  db: Db,
  accountId: string,
  formId: string,
  folderId: string | null,
): Promise<CrudResult<{ id: string; folderId: string | null }>> {
  const form = await db.get<{ id: string }>(
    sql`SELECT id FROM form WHERE account_id = ${accountId} AND id = ${formId} LIMIT 1`,
  );
  if (!form) return { ok: false, reason: "NOT_FOUND" };
  if (folderId != null && !(await getFolderById(db, accountId, folderId)))
    return { ok: false, reason: "NOT_FOUND" };
  await db.run(
    sql`UPDATE form SET folder_id = ${folderId} WHERE account_id = ${accountId} AND id = ${formId}`,
  );
  return { ok: true, value: { id: formId, folderId } };
}
