/**
 * `form.created_via` (0024): written by `createForm` and `duplicateForm` from
 * what the caller passes, NULL when it passes nothing (seeding, and every form
 * from before the column).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createDb, sql, type Db } from "./client";
import { migrate } from "./migrate";
import { createForm, duplicateForm } from "./forms";

let db: Db;
let accountId: string;

const via = async (id: string) =>
  (await db.get<{ created_via: string | null }>(sql`SELECT created_via FROM form WHERE id = ${id}`))!
    .created_via;

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? "file::memory:");
  await migrate(db);
  accountId = randomUUID();
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at)
        VALUES (${accountId}, ${"v" + accountId.slice(0, 7)}, ${"Test"}, ${Date.now()})`,
  );
});

afterEach(async () => {
  await db.close();
});

describe("form.created_via", () => {
  it("stores what createForm is given, and NULL when it is given nothing", async () => {
    const api = await createForm(db, accountId, { name: "By key", createdVia: "api" });
    const web = await createForm(db, accountId, { name: "By hand", createdVia: "web" });
    const seeded = await createForm(db, accountId, { name: "Seeded" });
    if (!api.ok || !web.ok || !seeded.ok) throw new Error("setup");
    expect(await via(api.value.id)).toBe("api");
    expect(await via(web.value.id)).toBe("web");
    expect(await via(seeded.value.id)).toBeNull();
  });

  it("a copy is born the way it was DUPLICATED, not the way the original was", async () => {
    const original = await createForm(db, accountId, { name: "Original", createdVia: "web" });
    if (!original.ok) throw new Error("setup");
    const copy = await duplicateForm(db, accountId, original.value.id, null, "api");
    if (!copy.ok) throw new Error("setup");
    expect(await via(copy.value.id)).toBe("api");
    expect(await via(original.value.id)).toBe("web");
  });
});
