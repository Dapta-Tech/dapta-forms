/**
 * Revert to the previously published version. Publishing keeps the config it
 * replaces (`previous_config`, with the moment it went live in
 * `previous_published_at_ms`), and `revertForm` swaps the two: the previous
 * version goes live and the one it replaced becomes the previous, so a second
 * revert undoes the first. Destinations are edited live on their own screen,
 * so a revert keeps the ones the form has NOW; a pending draft is not touched.
 *
 * Runs on a scratch SQLite file, or on Postgres when DATABASE_URL is set: the
 * swap is one UPDATE whose right-hand sides read the row as it was, and both
 * dialects have to agree on that.
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
  parseJsonColumn,
  publishForm,
  saveDraftConfig,
  updateFormDestinations,
} from "./forms";
import { revertForm } from "./form-revert";

let db: Db;
let accountId: string;
let formId: string;
let createdAt: number;
let sqliteDir: string | undefined;

const cfg = (question: string) => ({
  version: 1,
  steps: [{ key: "q", type: "text", question }],
});

const HOOK = {
  id: "hook-1",
  type: "webhook",
  enabled: true,
  settings: { url: "https://hooks.example.com/in" },
};

const tick = () => new Promise((r) => setTimeout(r, 2));

beforeEach(async () => {
  const databaseUrl =
    process.env.DATABASE_URL ??
    `file:${join(await mkdtemp(join(tmpdir(), "quill-form-revert-")), "forms.db")}`;
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
    name: "Revert",
    config: cfg("born"),
  });
  if (!created.ok) throw new Error(created.reason);
  formId = created.value.id;
  createdAt = created.value.createdAt;
});

afterEach(async () => {
  await db.run(sql`DELETE FROM form WHERE account_id = ${accountId}`);
  await db.run(sql`DELETE FROM account WHERE id = ${accountId}`);
  await db.close();
  if (sqliteDir) await rm(sqliteDir, { recursive: true, force: true });
  sqliteDir = undefined;
});

/** Stage `question` as the draft and publish it. Returns the published row. */
async function publish(question: string) {
  await tick(); // a distinct millisecond per publish, so the dates can be told apart
  const saved = await saveDraftConfig(db, accountId, formId, cfg(question));
  if (!saved.ok) throw new Error(saved.reason);
  const out = await publishForm(db, accountId, formId);
  if (!out.ok) throw new Error(out.reason);
  return out.value;
}

/** The stored previous version, read straight off the row. */
async function previousConfig(): Promise<unknown> {
  const row = await db.get<{ previous_config: unknown }>(
    sql`SELECT previous_config FROM form WHERE id = ${formId}`,
  );
  return parseJsonColumn(row?.previous_config, null);
}

/**
 * `db`, but the first `races` UPDATEs revertForm sends are each preceded by
 * another write that moves the row's stamp. revertForm alternates a read and
 * its guarded UPDATE, so every second `get` is the UPDATE.
 */
function racing(races: number): Db {
  let gets = 0;
  let raced = 0;
  return Object.assign(Object.create(db) as Db, {
    get: async (query: Parameters<Db["get"]>[0]) => {
      gets += 1;
      if (gets % 2 === 0 && raced < races) {
        raced += 1;
        await db.run(
          sql`UPDATE form SET updated_at = updated_at + 1 WHERE id = ${formId}`,
        );
      }
      return db.get(query);
    },
  });
}

describe("publishForm keeps the version it replaces", () => {
  it("a form never published has nothing to revert to", async () => {
    const form = (await getFormById(db, accountId, formId))!;
    expect(form.previousPublishedAt).toBeNull();
    expect(await previousConfig()).toBeNull();
  });

  it("the first publish keeps the config the form was born with, dated at its creation", async () => {
    const a = await publish("A");
    expect(a.config).toEqual(cfg("A"));
    expect(await previousConfig()).toEqual(cfg("born"));
    expect(a.previousPublishedAt).toBe(createdAt);
  });

  it("a later publish keeps the previous publish, dated when it went live", async () => {
    const a = await publish("A");
    const b = await publish("B");
    expect(b.config).toEqual(cfg("B"));
    expect(await previousConfig()).toEqual(cfg("A"));
    expect(b.previousPublishedAt).toBe(a.publishedAt);
  });

  it("a publish with no draft pending changes nothing", async () => {
    await publish("A");
    const before = await getFormById(db, accountId, formId);
    const out = await publishForm(db, accountId, formId);
    if (!out.ok) throw new Error(out.reason);
    expect(out.published).toBe(false);
    expect(await previousConfig()).toEqual(cfg("born"));
    expect(out.value.previousPublishedAt).toBe(before!.previousPublishedAt);
  });
});

describe("revertForm", () => {
  it("publish A, publish B, revert: A is live and B is the previous; revert again: B is live", async () => {
    const a = await publish("A");
    const b = await publish("B");

    const first = await revertForm(db, accountId, formId);
    if (!first.ok) throw new Error(first.reason);
    expect(first.value.config).toEqual(cfg("A"));
    expect(await previousConfig()).toEqual(cfg("B"));
    // The dates travel with their versions.
    expect(first.value.publishedAt).toBe(a.publishedAt);
    expect(first.value.previousPublishedAt).toBe(b.publishedAt);

    const second = await revertForm(db, accountId, formId);
    if (!second.ok) throw new Error(second.reason);
    expect(second.value.config).toEqual(cfg("B"));
    expect(await previousConfig()).toEqual(cfg("A"));
    expect(second.value.publishedAt).toBe(b.publishedAt);
    expect(second.value.previousPublishedAt).toBe(a.publishedAt);
  });

  it("keeps the destinations the form has now, including one added after the previous publish", async () => {
    await publish("A");
    // A webhook configured after A went live, then B published on top.
    const hooked = await updateFormDestinations(db, accountId, formId, [HOOK]);
    if (!hooked.ok) throw new Error(hooked.reason);
    await publish("B");

    const out = await revertForm(db, accountId, formId);
    if (!out.ok) throw new Error(out.reason);
    expect(out.value.config).toEqual({ ...cfg("A"), destinations: [HOOK] });
  });

  it("drops destinations the previous version had but the form no longer has", async () => {
    const hooked = await updateFormDestinations(db, accountId, formId, [HOOK]);
    if (!hooked.ok) throw new Error(hooked.reason);
    await publish("A");
    const cleared = await updateFormDestinations(db, accountId, formId, []);
    if (!cleared.ok) throw new Error(cleared.reason);

    const out = await revertForm(db, accountId, formId);
    if (!out.ok) throw new Error(out.reason);
    expect(out.value.config).toEqual({ ...cfg("born"), destinations: [] });
  });

  it("leaves a pending draft exactly as it was", async () => {
    await publish("A");
    await publish("B");
    const drafted = await saveDraftConfig(db, accountId, formId, cfg("draft"));
    if (!drafted.ok) throw new Error(drafted.reason);

    const out = await revertForm(db, accountId, formId);
    if (!out.ok) throw new Error(out.reason);
    expect(out.value.config).toEqual(cfg("A"));
    expect(out.value.draftConfig).toEqual(cfg("draft"));
  });

  it("moves the row's stamp, since the live config changed", async () => {
    await publish("A");
    const before = (await getFormById(db, accountId, formId))!;
    await tick();
    const out = await revertForm(db, accountId, formId);
    if (!out.ok) throw new Error(out.reason);
    expect(out.value.updatedAt).toBeGreaterThan(before.updatedAt);
  });

  it("answers NOTHING_TO_REVERT on a form that was never published, and writes nothing", async () => {
    const before = (await getFormById(db, accountId, formId))!;
    const out = await revertForm(db, accountId, formId);
    expect(out).toMatchObject({ ok: false, reason: "NOTHING_TO_REVERT" });
    expect(await getFormById(db, accountId, formId)).toEqual(before);
  });

  it("retries when another write lands between its read and its write", async () => {
    await publish("A");
    // A write (a draft save in another tab) lands right after the first read.
    const out = await revertForm(racing(1), accountId, formId);
    if (!out.ok) throw new Error(out.reason);
    expect(out.value.config).toEqual(cfg("born"));
    expect(await previousConfig()).toEqual(cfg("A"));
  });

  it("answers STALE and writes nothing when every attempt is raced", async () => {
    await publish("A");
    const out = await revertForm(racing(Infinity), accountId, formId);
    expect(out).toMatchObject({ ok: false, reason: "STALE" });
    expect((await getFormById(db, accountId, formId))!.config).toEqual(cfg("A"));
    expect(await previousConfig()).toEqual(cfg("born"));
  });

  it("answers NOT_FOUND for another account's form", async () => {
    await publish("A");
    const out = await revertForm(db, randomUUID(), formId);
    expect(out).toMatchObject({ ok: false, reason: "NOT_FOUND" });
    expect((await getFormById(db, accountId, formId))!.config).toEqual(cfg("A"));
  });
});
