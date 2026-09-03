/**
 * Migration 0019 appends the `{{answers}}` token to every CUSTOM owner-notice
 * body that lacks it, so accounts that edited their template before the token
 * existed still get the answers in the email. Exercised by running the script
 * directly against a migrated database (in-memory SQLite locally, the shared
 * Postgres in parity mode), because the migrator has already applied it by the
 * time the rows exist. Must be idempotent: a second run changes nothing.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, type Db } from "./client";
import { migrate } from "./migrate";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = "0019_owner_email_answers_token.sql";

let db: Db;
/** One account per row: the account scope allows a single row per email key. */
const accounts: string[] = [];

async function insertAccount(): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at)
        VALUES (${id}, ${"t" + id.slice(0, 7)}, ${"Test"}, ${Date.now()})`,
  );
  accounts.push(id);
  return id;
}

async function insertSetting(
  emailKey: string,
  body: string | null,
  formId: string | null = null,
): Promise<string> {
  const id = randomUUID();
  const accountId = await insertAccount();
  await db.run(
    sql`INSERT INTO notification_setting
          (id, account_id, email_key, form_id, enabled, subject, body, created_at, updated_at)
        VALUES (${id}, ${accountId}, ${emailKey}, ${formId}, 1, ${null}, ${body}, 1, 1)`,
  );
  return id;
}

async function bodyOf(id: string): Promise<string | null> {
  const r = await db.get<{ body: string | null }>(
    sql`SELECT body FROM notification_setting WHERE id = ${id}`,
  );
  return r?.body ?? null;
}

async function runScript(): Promise<void> {
  await db.execRaw(
    readFileSync(join(HERE, "..", "migrations", db.dialect, FILE), "utf8"),
  );
}

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? "file::memory:");
  await migrate(db);
});

afterEach(async () => {
  // Postgres parity mode shares a database: leave no rows behind.
  for (const accountId of accounts.splice(0)) {
    await db.run(
      sql`DELETE FROM notification_setting WHERE account_id = ${accountId}`,
    );
    await db.run(sql`DELETE FROM account WHERE id = ${accountId}`);
  }
  await db.close();
});

describe(FILE, () => {
  it("appends {{answers}} to a custom owner body that lacks it, account and form rows alike", async () => {
    const account = await insertSetting(
      "submission_received",
      "Lead on {{formName}}\nScore {{score}}",
    );
    const form = await insertSetting(
      "submission_received",
      "Form copy",
      randomUUID(),
    );
    await runScript();
    expect(await bodyOf(account)).toBe(
      "Lead on {{formName}}\nScore {{score}}\n\n{{answers}}",
    );
    expect(await bodyOf(form)).toBe("Form copy\n\n{{answers}}");
  });

  it("leaves alone bodies that already carry the token (spaced or not), NULL bodies and the respondent email", async () => {
    const has = await insertSetting("submission_received", "A\n{{answers}}");
    const spaced = await insertSetting(
      "submission_received",
      "A\n{{ answers }}",
    );
    const stock = await insertSetting("submission_received", null);
    const confirmed = await insertSetting(
      "submission_confirmed",
      "Thanks {{formName}}",
    );
    await runScript();
    expect(await bodyOf(has)).toBe("A\n{{answers}}");
    expect(await bodyOf(spaced)).toBe("A\n{{ answers }}");
    expect(await bodyOf(stock)).toBeNull();
    expect(await bodyOf(confirmed)).toBe("Thanks {{formName}}");
  });

  it("is idempotent: a second run changes nothing", async () => {
    const id = await insertSetting("submission_received", "Custom");
    await runScript();
    const once = await bodyOf(id);
    await runScript();
    expect(await bodyOf(id)).toBe(once);
    expect(once).toBe("Custom\n\n{{answers}}");
  });
});
