/**
 * The workspace timezone column (migration 0020): read, set, clear, and the
 * write-once claim the dashboard uses to seed it from the first admin's
 * browser. In-memory SQLite locally; DATABASE_URL for the Postgres parity job.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createDb, sql, type Db } from "./client";
import { migrate } from "./migrate";
import {
  claimAccountTimezone,
  getAccountTimezone,
  setAccountTimezone,
} from "./workspaces";
import { getMe } from "./forms";

let db: Db;
let accountId: string;
let memberId: string;

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? "file::memory:");
  await migrate(db);
  accountId = randomUUID();
  memberId = randomUUID();
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at)
        VALUES (${accountId}, ${"t" + accountId.slice(0, 7)}, ${"Test"}, ${Date.now()})`,
  );
  await db.run(
    sql`INSERT INTO member (id, account_id, email, role, status, created_at)
        VALUES (${memberId}, ${accountId}, ${"o@x.com"}, ${"owner"}, ${"active"}, ${Date.now()})`,
  );
});

afterEach(async () => {
  await db.run(sql`DELETE FROM member WHERE account_id = ${accountId}`);
  await db.run(sql`DELETE FROM account WHERE id = ${accountId}`);
  await db.close();
});

describe("account timezone", () => {
  it("starts unset, sets, and clears back to null", async () => {
    expect(await getAccountTimezone(db, accountId)).toBeNull();
    await setAccountTimezone(db, accountId, "America/Bogota");
    expect(await getAccountTimezone(db, accountId)).toBe("America/Bogota");
    await setAccountTimezone(db, accountId, null);
    expect(await getAccountTimezone(db, accountId)).toBeNull();
  });

  it("claims only while unset: the first browser wins, later ones do not overwrite", async () => {
    expect(await claimAccountTimezone(db, accountId, "America/Bogota")).toBe(
      true,
    );
    expect(await claimAccountTimezone(db, accountId, "Europe/Madrid")).toBe(
      false,
    );
    expect(await getAccountTimezone(db, accountId)).toBe("America/Bogota");
  });

  it("rides along on /me", async () => {
    await setAccountTimezone(db, accountId, "Asia/Tokyo");
    expect((await getMe(db, accountId, memberId))?.timezone).toBe("Asia/Tokyo");
  });
});
