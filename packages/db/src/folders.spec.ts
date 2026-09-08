/**
 * Form folders (migration 0021): flat, one level, one folder per form, a name
 * unique per account without regard to case. Deleting a folder unfiles its
 * forms and never deletes them. In-memory SQLite locally; DATABASE_URL for the
 * Postgres parity job (the expression index is the part worth proving there).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createDb, sql, type Db } from "./client";
import { migrate } from "./migrate";
import { createForm, duplicateForm, getFormById, listForms } from "./forms";
import {
  createFolder,
  deleteFolder,
  getFolderById,
  listFolders,
  renameFolder,
  setFormFolder,
} from "./folders";

let db: Db;
let accountId: string;
let otherAccountId: string;

async function insertAccount(): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at)
        VALUES (${id}, ${"t" + id.slice(0, 7)}, ${"Test"}, ${Date.now()})`,
  );
  return id;
}

async function form(name: string, folderId?: string | null): Promise<string> {
  const r = await createForm(db, accountId, {
    name,
    ...(folderId ? { folderId } : {}),
  });
  if (!r.ok) throw new Error(r.reason);
  return r.value.id;
}

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? "file::memory:");
  await migrate(db);
  accountId = await insertAccount();
  otherAccountId = await insertAccount();
});

afterEach(async () => {
  for (const id of [accountId, otherAccountId]) {
    await db.run(sql`DELETE FROM form WHERE account_id = ${id}`);
    await db.run(sql`DELETE FROM form_folder WHERE account_id = ${id}`);
    await db.run(sql`DELETE FROM account WHERE id = ${id}`);
  }
  await db.close();
});

describe("folders", () => {
  it("lists alphabetically without regard to case", async () => {
    await createFolder(db, accountId, "sales");
    await createFolder(db, accountId, "Archive");
    await createFolder(db, accountId, "marketing");
    expect((await listFolders(db, accountId)).map((f) => f.name)).toEqual([
      "Archive",
      "marketing",
      "sales",
    ]);
  });

  it("a name is unique per account without regard to case, and free in another account", async () => {
    const first = await createFolder(db, accountId, "Sales");
    expect(first.ok).toBe(true);
    const dup = await createFolder(db, accountId, " sales ");
    expect(dup).toEqual({ ok: false, reason: "NAME_TAKEN" });
    expect((await createFolder(db, otherAccountId, "sales")).ok).toBe(true);
  });

  it("renames, refusing another folder’s name and allowing a case change of its own", async () => {
    const a = await createFolder(db, accountId, "Sales");
    await createFolder(db, accountId, "Marketing");
    if (!a.ok) throw new Error("setup");
    expect(await renameFolder(db, accountId, a.value.id, "marketing")).toEqual({
      ok: false,
      reason: "NAME_TAKEN",
    });
    const renamed = await renameFolder(db, accountId, a.value.id, "SALES");
    expect(renamed.ok && renamed.value.name).toBe("SALES");
    expect(await renameFolder(db, otherAccountId, a.value.id, "x")).toEqual({
      ok: false,
      reason: "NOT_FOUND",
    });
  });

  it("a form moves into a folder, out of it, and shows its folder in the list", async () => {
    const f = await createFolder(db, accountId, "Sales");
    if (!f.ok) throw new Error("setup");
    const id = await form("Quiz");
    expect(await setFormFolder(db, accountId, id, f.value.id)).toEqual({
      ok: true,
      value: { id, folderId: f.value.id },
    });
    expect(
      (await listForms(db, accountId)).find((x) => x.id === id)?.folderId,
    ).toBe(f.value.id);
    expect((await getFormById(db, accountId, id))?.folderId).toBe(f.value.id);
    expect(await setFormFolder(db, accountId, id, null)).toEqual({
      ok: true,
      value: { id, folderId: null },
    });
    expect(
      (await listForms(db, accountId)).find((x) => x.id === id)?.folderId,
    ).toBeNull();
  });

  it("moving does not touch updated_at, and refuses a folder or form of another account", async () => {
    const f = await createFolder(db, accountId, "Sales");
    const foreign = await createFolder(db, otherAccountId, "Theirs");
    if (!f.ok || !foreign.ok) throw new Error("setup");
    const id = await form("Quiz");
    const before = (await getFormById(db, accountId, id))!.updatedAt;
    await setFormFolder(db, accountId, id, f.value.id);
    expect((await getFormById(db, accountId, id))!.updatedAt).toBe(before);
    expect(await setFormFolder(db, accountId, id, foreign.value.id)).toEqual({
      ok: false,
      reason: "NOT_FOUND",
    });
    expect(await setFormFolder(db, otherAccountId, id, null)).toEqual({
      ok: false,
      reason: "NOT_FOUND",
    });
  });

  it("deleting a folder unfiles its forms and keeps them; a second delete is a no-op", async () => {
    const f = await createFolder(db, accountId, "Sales");
    if (!f.ok) throw new Error("setup");
    const id = await form("Quiz", f.value.id);
    expect((await getFormById(db, accountId, id))?.folderId).toBe(f.value.id);
    expect(await deleteFolder(db, accountId, f.value.id)).toBe(true);
    expect((await getFormById(db, accountId, id))?.folderId).toBeNull();
    expect(await getFolderById(db, accountId, f.value.id)).toBeNull();
    expect(await deleteFolder(db, accountId, f.value.id)).toBe(false);
    expect(await deleteFolder(db, otherAccountId, f.value.id)).toBe(false);
  });

  it("a form is created inside a folder, and a duplicate inherits it", async () => {
    const f = await createFolder(db, accountId, "Sales");
    if (!f.ok) throw new Error("setup");
    const id = await form("Quiz", f.value.id);
    const copy = await duplicateForm(db, accountId, id);
    expect(copy.ok && copy.value.folderId).toBe(f.value.id);
    // A folder of another account cannot be named at creation either.
    const foreign = await createFolder(db, otherAccountId, "Theirs");
    if (!foreign.ok) throw new Error("setup");
    expect(
      await createForm(db, accountId, {
        name: "X",
        folderId: foreign.value.id,
      }),
    ).toMatchObject({
      ok: false,
      reason: "NOT_FOUND",
    });
  });
});
