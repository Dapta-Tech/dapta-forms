/**
 * The editor's optimistic lock. Two editors open on one form used to be
 * last-writer-wins: each autosave sent its whole snapshot, and whichever
 * landed last silently discarded the other's edits. With a stamp, a write
 * lands only if the row still carries the `updated_at` the writer last saw;
 * otherwise it is refused as STALE and the row is left exactly as it was.
 * Without a stamp nothing changes: a client built before the stamp existed
 * keeps saving.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { createDb, type Db } from "./client";
import { migrate } from "./migrate";
import {
  createForm,
  getFormById,
  publishForm,
  saveDraftConfig,
  updateForm,
} from "./forms";

let db: Db;
let accountId: string;
let formId: string;
let sqliteDir: string | undefined;

const cfg = (question: string) => ({
  version: 1,
  steps: [{ key: "q", type: "text", question }],
});

beforeEach(async () => {
  const databaseUrl =
    process.env.DATABASE_URL ??
    `file:${join(await mkdtemp(join(tmpdir(), "quill-form-stale-")), "forms.db")}`;
  if (!process.env.DATABASE_URL)
    sqliteDir = join(databaseUrl.slice("file:".length), "..");
  db = await createDb(databaseUrl);
  await migrate(db);
  accountId = randomUUID();
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at)
        VALUES (${accountId}, ${`a${accountId.slice(0, 8)}`}, ${"Primary"}, ${Date.now()})`,
  );
  const created = await createForm(db, accountId, {
    name: "Stale",
    config: cfg("v0"),
  });
  if (!created.ok) throw new Error(created.reason);
  formId = created.value.id;
});

afterEach(async () => {
  await db.run(sql`DELETE FROM form WHERE account_id = ${accountId}`);
  await db.run(sql`DELETE FROM account WHERE id = ${accountId}`);
  await db.close();
  if (sqliteDir) await rm(sqliteDir, { recursive: true, force: true });
  sqliteDir = undefined;
});

/** Two editors: A loads, B loads, B saves, then A tries to save with its old stamp. */
async function twoEditors(): Promise<{ stampA: number; stampB: number }> {
  const loaded = (await getFormById(db, accountId, formId))!;
  const stampA = loaded.updatedAt;
  await new Promise((r) => setTimeout(r, 2)); // a distinct millisecond for B's write
  const b = await saveDraftConfig(db, accountId, formId, cfg("from B"), stampA);
  if (!b.ok) throw new Error(b.reason);
  return { stampA, stampB: b.value.updatedAt };
}

describe("saveDraftConfig with expectedUpdatedAt", () => {
  it("lands when the stamp matches and hands back the new one", async () => {
    const loaded = (await getFormById(db, accountId, formId))!;
    const res = await saveDraftConfig(
      db,
      accountId,
      formId,
      cfg("v1"),
      loaded.updatedAt,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.draftConfig).toEqual(cfg("v1"));
    expect(res.value.updatedAt).toBeGreaterThanOrEqual(loaded.updatedAt);
  });

  it("refuses a stale stamp as STALE and leaves the row untouched", async () => {
    const { stampA, stampB } = await twoEditors();
    expect(stampB).not.toBe(stampA);

    const res = await saveDraftConfig(
      db,
      accountId,
      formId,
      cfg("from A, late"),
      stampA,
    );
    expect(res).toMatchObject({ ok: false, reason: "STALE" });

    const row = (await getFormById(db, accountId, formId))!;
    expect(row.draftConfig).toEqual(cfg("from B")); // B's edit survived
    expect(row.updatedAt).toBe(stampB); // and the stamp did not move
  });

  it("keeps the old behavior for a caller that sends no stamp", async () => {
    await twoEditors();
    const res = await saveDraftConfig(db, accountId, formId, cfg("unguarded"));
    expect(res.ok).toBe(true);
    expect((await getFormById(db, accountId, formId))!.draftConfig).toEqual(
      cfg("unguarded"),
    );
  });

  it("still answers NOT_FOUND before STALE for a form that does not exist", async () => {
    const res = await saveDraftConfig(db, accountId, randomUUID(), cfg("x"), 1);
    expect(res).toMatchObject({ ok: false, reason: "NOT_FOUND" });
  });
});

describe("updateForm (metadata) with expectedUpdatedAt", () => {
  it("refuses a stale rename and keeps the name", async () => {
    const { stampA } = await twoEditors();
    const res = await updateForm(
      db,
      accountId,
      formId,
      { name: "Renamed late" },
      stampA,
    );
    expect(res).toMatchObject({ ok: false, reason: "STALE" });
    expect((await getFormById(db, accountId, formId))!.name).toBe("Stale");
  });

  it("a patch with nothing to write never goes stale (no UPDATE runs)", async () => {
    const { stampA } = await twoEditors();
    const res = await updateForm(db, accountId, formId, {}, stampA);
    expect(res.ok).toBe(true);
  });
});

describe("publishForm with expectedUpdatedAt", () => {
  it("refuses to publish a draft written after the publisher last looked", async () => {
    const { stampA } = await twoEditors();
    const res = await publishForm(db, accountId, formId, stampA);
    expect(res).toMatchObject({ ok: false, reason: "STALE" });
    const row = (await getFormById(db, accountId, formId))!;
    expect(row.draftConfig).toEqual(cfg("from B")); // still a pending draft
    expect(row.publishedAt).toBeNull();
  });

  it("publishes with the current stamp", async () => {
    const { stampB } = await twoEditors();
    const res = await publishForm(db, accountId, formId, stampB);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.published).toBe(true);
    expect(res.value.config).toEqual(cfg("from B"));
    expect(res.value.draftConfig).toBeNull();
  });

  it("a stale stamp is refused even when no draft is pending", async () => {
    const loaded = (await getFormById(db, accountId, formId))!;
    await new Promise((r) => setTimeout(r, 2));
    await updateForm(db, accountId, formId, { name: "Touched" }); // stamp moves, no draft
    const res = await publishForm(db, accountId, formId, loaded.updatedAt);
    expect(res).toMatchObject({ ok: false, reason: "STALE" });
  });
});
