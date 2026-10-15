/**
 * API keys (0024): per-member limit, workspace scoping, soft revoke, the hash
 * lookup that resolves a key to its member, and the throttled last-use stamp.
 * In-memory SQLite locally; DATABASE_URL for the Postgres parity job.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createDb, sql, type Db } from "./client";
import { migrate } from "./migrate";
import {
  API_KEY_LIMIT_PER_MEMBER,
  findApiKeyPrincipal,
  getApiKeyById,
  insertApiKey,
  listApiKeys,
  revokeApiKey,
  touchApiKeyLastUsed,
} from "./api-keys";

let db: Db;
let accountId: string;
let otherAccountId: string;
let alice: string;
let bob: string;

async function insertAccount(): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at)
        VALUES (${id}, ${"k" + id.slice(0, 7)}, ${"Test"}, ${Date.now()})`,
  );
  return id;
}

async function insertMember(account: string, email: string, role = "member"): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO member (id, account_id, email, display_name, role, status, created_at)
        VALUES (${id}, ${account}, ${email}, ${email.split("@")[0]!}, ${role}, 'active', ${Date.now()})`,
  );
  return id;
}

let n = 0;
async function key(account: string, member: string, name = "agent", now?: number) {
  n += 1;
  return insertApiKey(
    db,
    {
      accountId: account,
      memberId: member,
      name,
      keyHash: `hash-${n}-${randomUUID()}`,
      prefix: `dforms_${n}${randomUUID().slice(0, 4)}`,
      last4: String(1000 + n).slice(-4),
    },
    now,
  );
}

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? "file::memory:");
  await migrate(db);
  accountId = await insertAccount();
  otherAccountId = await insertAccount();
  alice = await insertMember(accountId, "alice@example.com", "owner");
  bob = await insertMember(accountId, "bob@example.com");
});

afterEach(async () => {
  await db.close();
});

describe("insertApiKey", () => {
  it("stores the key and returns it without the hash", async () => {
    const r = await key(accountId, bob, "n8n", 1_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      accountId,
      memberId: bob,
      name: "n8n",
      createdAt: 1_000,
      lastUsedAt: null,
    });
    expect(JSON.stringify(r.value)).not.toContain("hash-");
  });

  it("refuses the eleventh active key of one member in one workspace, and only that", async () => {
    for (let i = 0; i < API_KEY_LIMIT_PER_MEMBER; i++) {
      expect((await key(accountId, bob)).ok).toBe(true);
    }
    expect(await key(accountId, bob)).toEqual({ ok: false, reason: "KEY_LIMIT" });
    // Another member of the same workspace has their own ten.
    expect((await key(accountId, alice)).ok).toBe(true);
    // A revoked key frees a slot.
    const [first] = await listApiKeys(db, accountId, bob);
    expect(await revokeApiKey(db, accountId, first!.id)).toBe(true);
    expect((await key(accountId, bob)).ok).toBe(true);
  });

  it("holds the limit when creates race (two requests at nine never both land)", async () => {
    const results = await Promise.all(
      Array.from({ length: API_KEY_LIMIT_PER_MEMBER + 5 }, () => key(accountId, bob)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(API_KEY_LIMIT_PER_MEMBER);
    expect(await listApiKeys(db, accountId, bob)).toHaveLength(API_KEY_LIMIT_PER_MEMBER);
  });
});

describe("listApiKeys", () => {
  it("lists a member's own keys, or the whole workspace, never revoked ones or another workspace's", async () => {
    const otherMember = await insertMember(otherAccountId, "carol@example.com");
    await key(accountId, alice, "a", 1);
    await key(accountId, bob, "b", 2);
    const revoked = await key(accountId, bob, "gone", 3);
    await key(otherAccountId, otherMember, "elsewhere", 4);
    if (!revoked.ok) throw new Error("setup");
    await revokeApiKey(db, accountId, revoked.value.id);

    const mine = await listApiKeys(db, accountId, bob);
    expect(mine.map((k) => k.name)).toEqual(["b"]);
    expect(mine[0]!.createdBy).toEqual({ memberId: bob, name: "bob", email: "bob@example.com" });

    const all = await listApiKeys(db, accountId);
    expect(all.map((k) => k.name)).toEqual(["b", "a"]);
  });
});

describe("revokeApiKey", () => {
  it("is scoped to the workspace and answers false for nothing to revoke", async () => {
    const r = await key(accountId, bob);
    if (!r.ok) throw new Error("setup");
    expect(await revokeApiKey(db, otherAccountId, r.value.id)).toBe(false);
    expect(await getApiKeyById(db, accountId, r.value.id)).not.toBeNull();
    expect(await revokeApiKey(db, accountId, r.value.id)).toBe(true);
    expect(await revokeApiKey(db, accountId, r.value.id)).toBe(false);
    expect(await getApiKeyById(db, accountId, r.value.id)).toBeNull();
  });
});

describe("findApiKeyPrincipal", () => {
  it("resolves the hash to the key's workspace and member with the CURRENT role", async () => {
    const hash = `h-${randomUUID()}`;
    const r = await insertApiKey(db, {
      accountId,
      memberId: bob,
      name: "x",
      keyHash: hash,
      prefix: `dforms_${randomUUID().slice(0, 5)}`,
      last4: "abcd",
    });
    if (!r.ok) throw new Error("setup");
    expect(await findApiKeyPrincipal(db, hash)).toMatchObject({
      keyId: r.value.id,
      accountId,
      memberId: bob,
      role: "member",
      memberStatus: "active",
    });

    await db.run(sql`UPDATE member SET role = 'admin' WHERE id = ${bob}`);
    expect((await findApiKeyPrincipal(db, hash))!.role).toBe("admin");

    await db.run(sql`UPDATE member SET status = 'disabled' WHERE id = ${bob}`);
    expect((await findApiKeyPrincipal(db, hash))!.memberStatus).toBe("disabled");

    await db.run(sql`DELETE FROM member WHERE id = ${bob}`);
    expect(await findApiKeyPrincipal(db, hash)).toBeNull();
  });

  it("is null for an unknown or revoked key", async () => {
    expect(await findApiKeyPrincipal(db, "nope")).toBeNull();
    const hash = `h-${randomUUID()}`;
    const r = await insertApiKey(db, {
      accountId,
      memberId: bob,
      name: "x",
      keyHash: hash,
      prefix: `dforms_${randomUUID().slice(0, 5)}`,
      last4: "abcd",
    });
    if (!r.ok) throw new Error("setup");
    await revokeApiKey(db, accountId, r.value.id);
    expect(await findApiKeyPrincipal(db, hash)).toBeNull();
  });
});

describe("touchApiKeyLastUsed", () => {
  it("stamps at most once per minute", async () => {
    const r = await key(accountId, bob);
    if (!r.ok) throw new Error("setup");
    const id = r.value.id;
    const at = async () => (await getApiKeyById(db, accountId, id))!.lastUsedAt;

    await touchApiKeyLastUsed(db, id, 100_000);
    expect(await at()).toBe(100_000);
    await touchApiKeyLastUsed(db, id, 130_000);
    expect(await at()).toBe(100_000);
    await touchApiKeyLastUsed(db, id, 160_000);
    expect(await at()).toBe(160_000);
  });
});
