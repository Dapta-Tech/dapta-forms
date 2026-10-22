/**
 * Discard a form's pending draft, and count the steps each live config has.
 *
 * `discardDraft` drops the unpublished working copy so the editor (and the
 * next publish) start from the live config again. It never touches what the
 * public sees: the live config, the previous version kept for a revert and
 * the publish dates stay exactly as they were.
 *
 * `listLiveStepCounts` is how an agent learns that a form never published
 * anything: its live config has no steps, so its public link serves an empty
 * form.
 *
 * Runs on a scratch SQLite file, or on Postgres when DATABASE_URL is set.
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
  discardDraft,
  getFormById,
  listLiveStepCounts,
  publishForm,
  saveDraftConfig,
} from "./forms";

let db: Db;
let accountId: string;
let formId: string;
let sqliteDir: string | undefined;

const cfg = (...questions: string[]) => ({
  version: 1,
  steps: questions.map((question, i) => ({ key: `q${i}`, type: "text", question })),
});

const tick = () => new Promise((r) => setTimeout(r, 2));

beforeEach(async () => {
  const databaseUrl =
    process.env.DATABASE_URL ??
    `file:${join(await mkdtemp(join(tmpdir(), "quill-form-discard-")), "forms.db")}`;
  if (!process.env.DATABASE_URL)
    sqliteDir = join(databaseUrl.slice("file:".length), "..");
  db = await createDb(databaseUrl);
  await migrate(db);
  accountId = randomUUID();
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at)
        VALUES (${accountId}, ${`a${accountId.slice(0, 8)}`}, ${"Primary"}, ${Date.now()})`,
  );
  const created = await createForm(db, accountId, { name: "Discard", config: cfg("born") });
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

describe("discardDraft", () => {
  it("drops the draft and leaves the live config, the previous version and the dates alone", async () => {
    await tick();
    await saveDraftConfig(db, accountId, formId, cfg("published"));
    const published = await publishForm(db, accountId, formId);
    if (!published.ok) throw new Error(published.reason);
    await tick();
    const drafted = await saveDraftConfig(db, accountId, formId, cfg("unwanted"));
    if (!drafted.ok) throw new Error(drafted.reason);
    await tick();

    const out = await discardDraft(db, accountId, formId, drafted.value.updatedAt);
    if (!out.ok) throw new Error(out.reason);
    expect(out.discarded).toBe(true);
    expect(out.value.draftConfig).toBeNull();
    expect(out.value.config).toEqual(published.value.config);
    expect(out.value.publishedAt).toBe(published.value.publishedAt);
    expect(out.value.previousPublishedAt).toBe(published.value.previousPublishedAt);
    expect(out.value.updatedAt).toBeGreaterThan(drafted.value.updatedAt);
    const row = await getFormById(db, accountId, formId);
    expect(row!.draftConfig).toBeNull();
  });

  it("is a no-op with no draft pending", async () => {
    const before = await getFormById(db, accountId, formId);
    const out = await discardDraft(db, accountId, formId);
    if (!out.ok) throw new Error(out.reason);
    expect(out.discarded).toBe(false);
    expect(out.value.updatedAt).toBe(before!.updatedAt);
  });

  it("answers STALE when the form was saved after the stamp it was given, and keeps the draft", async () => {
    const drafted = await saveDraftConfig(db, accountId, formId, cfg("theirs"));
    if (!drafted.ok) throw new Error(drafted.reason);
    const out = await discardDraft(db, accountId, formId, drafted.value.updatedAt - 1);
    expect(out).toMatchObject({ ok: false, reason: "STALE" });
    expect((await getFormById(db, accountId, formId))!.draftConfig).not.toBeNull();
  });

  it("answers NOT_FOUND for a form of another account", async () => {
    await saveDraftConfig(db, accountId, formId, cfg("x"));
    expect(await discardDraft(db, randomUUID(), formId)).toMatchObject({ ok: false, reason: "NOT_FOUND" });
    expect((await getFormById(db, accountId, formId))!.draftConfig).not.toBeNull();
  });
});

describe("listLiveStepCounts", () => {
  it("counts the steps of every live config of the account, and zero for an empty or missing one", async () => {
    const empty = await createForm(db, accountId, { name: "Empty", config: { version: 1, steps: [] } });
    const bare = await createForm(db, accountId, { name: "Bare" });
    if (!empty.ok || !bare.ok) throw new Error("create failed");
    // A draft never counts: only what the public sees.
    await saveDraftConfig(db, accountId, empty.value.id, cfg("a", "b", "c"));
    const counts = await listLiveStepCounts(db, accountId);
    expect(counts.get(formId)).toBe(1);
    expect(counts.get(empty.value.id)).toBe(0);
    expect(counts.get(bare.value.id)).toBe(0);
    expect((await listLiveStepCounts(db, randomUUID())).size).toBe(0);
  });
});
