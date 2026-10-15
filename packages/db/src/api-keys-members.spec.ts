/**
 * A key follows its member: taking a member out of a workspace (disabled,
 * removed, or dropped by the identity service's roster) revokes their keys in
 * the same operation, for good. Reactivating the member later does not bring
 * the old keys back. In-memory SQLite locally; DATABASE_URL for Postgres.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createDb, runAtomically, sql, type Db } from "./client";
import { migrate } from "./migrate";
import { insertApiKey, listApiKeys, revokeKeysOfInactiveMembersSql } from "./api-keys";
import { removeMember, setMemberStatus } from "./members";
import { projectMemberships, projectRoster } from "./workspaces";

let db: Db;
let accountId: string;
let owner: string;
let bob: string;
const accounts: string[] = [];

async function insertAccount(externalId: string | null = null): Promise<string> {
  const id = randomUUID();
  accounts.push(id);
  await db.run(
    sql`INSERT INTO account (id, code, name, external_id, synced_at, created_at)
        VALUES (${id}, ${"m" + id.slice(0, 7)}, ${"Test"}, ${externalId},
                ${externalId ? Date.now() : null}, ${Date.now()})`,
  );
  return id;
}

async function insertMember(
  account: string,
  email: string,
  role = "member",
  upstream: { externalId: string; workspaceUserId: string } | null = null,
): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO member (id, account_id, email, display_name, role, status, external_id,
          iam_workspace_user_id, created_at)
        VALUES (${id}, ${account}, ${email}, ${email.split("@")[0]!}, ${role}, 'active',
          ${upstream?.externalId ?? null}, ${upstream?.workspaceUserId ?? null}, ${Date.now() - 3_600_000})`,
  );
  return id;
}

let n = 0;
async function key(account: string, member: string): Promise<string> {
  n += 1;
  const r = await insertApiKey(db, {
    accountId: account,
    memberId: member,
    name: `key ${n}`,
    keyHash: `hash-${n}-${randomUUID()}`,
    prefix: `dforms_${n}${randomUUID().slice(0, 4)}`,
    last4: String(1000 + n).slice(-4),
  });
  if (!r.ok) throw new Error("key not created");
  return r.value.id;
}

/** Whether each key is revoked, by id. */
async function revoked(ids: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const id of ids) {
    const r = await db.get<{ revoked_at_ms: unknown }>(sql`SELECT revoked_at_ms FROM api_key WHERE id = ${id}`);
    out[id] = r?.revoked_at_ms != null;
  }
  return out;
}

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? "file::memory:");
  await migrate(db);
  accountId = await insertAccount();
  owner = await insertMember(accountId, "owner@example.com", "owner");
  bob = await insertMember(accountId, "bob@example.com");
});

afterEach(async () => {
  for (const id of accounts) {
    await db.run(sql`DELETE FROM api_key WHERE account_id = ${id}`);
    await db.run(sql`DELETE FROM member WHERE account_id = ${id}`);
    await db.run(sql`DELETE FROM account WHERE id = ${id}`);
  }
  accounts.length = 0;
  await db.close();
});

describe("setMemberStatus", () => {
  it("disabling revokes the member's keys and only theirs; reactivating does not revive them", async () => {
    const bobs = [await key(accountId, bob), await key(accountId, bob)];
    const owners = await key(accountId, owner);

    expect((await setMemberStatus(db, accountId, bob, "disabled")).ok).toBe(true);
    expect(await revoked([...bobs, owners])).toEqual({ [bobs[0]!]: true, [bobs[1]!]: true, [owners]: false });

    expect((await setMemberStatus(db, accountId, bob, "active")).ok).toBe(true);
    expect(await revoked(bobs)).toEqual({ [bobs[0]!]: true, [bobs[1]!]: true });
    expect((await listApiKeys(db, accountId)).map((k) => k.id)).toEqual([owners]);
  });

  it("a refused disable (the last owner) revokes nothing", async () => {
    const owners = await key(accountId, owner);
    expect((await setMemberStatus(db, accountId, owner, "disabled")).ok).toBe(false);
    expect(await revoked([owners])).toEqual({ [owners]: false });
  });
});

describe("runAtomically", () => {
  it("lands every statement or none: a failing one rolls the member change back with the revoke", async () => {
    const bobs = await key(accountId, bob);
    await expect(
      runAtomically(db, [
        sql`UPDATE member SET status = 'disabled' WHERE id = ${bob}`,
        revokeKeysOfInactiveMembersSql(accountId),
        sql`INSERT INTO member (id) VALUES (${bob})`,
      ]),
    ).rejects.toThrow();
    const row = await db.get<{ status: string }>(sql`SELECT status FROM member WHERE id = ${bob}`);
    expect(row?.status).toBe("active");
    expect(await revoked([bobs])).toEqual({ [bobs]: false });
  });
});

describe("removeMember", () => {
  it("revokes the removed member's keys", async () => {
    const bobs = await key(accountId, bob);
    const owners = await key(accountId, owner);
    expect((await removeMember(db, accountId, bob)).ok).toBe(true);
    expect(await revoked([bobs, owners])).toEqual({ [bobs]: true, [owners]: false });
  });
});

describe("listApiKeys", () => {
  it("never lists the keys of a member who is not active, even unrevoked", async () => {
    await key(accountId, bob);
    const owners = await key(accountId, owner);
    await db.run(sql`UPDATE member SET status = 'disabled' WHERE id = ${bob}`);
    expect((await listApiKeys(db, accountId)).map((k) => k.id)).toEqual([owners]);
    expect(await listApiKeys(db, accountId, bob)).toEqual([]);
  });
});

describe("the identity service's roster", () => {
  it("projectRoster revokes the keys of a member it marks inactive or no longer lists", async () => {
    const ws = `ws-${randomUUID()}`;
    const account = await insertAccount(ws);
    const keep = await insertMember(account, "keep@example.com", "owner", { externalId: `s-${randomUUID()}`, workspaceUserId: "wu-1" });
    const offExt = `s-${randomUUID()}`;
    const off = await insertMember(account, "off@example.com", "member", { externalId: offExt, workspaceUserId: "wu-2" });
    const gone = await insertMember(account, "gone@example.com", "member", { externalId: `s-${randomUUID()}`, workspaceUserId: "wu-3" });
    const keepKey = await key(account, keep);
    const offKey = await key(account, off);
    const goneKey = await key(account, gone);
    const keepExt = (await db.get<{ external_id: string }>(sql`SELECT external_id FROM member WHERE id = ${keep}`))!.external_id;

    await projectRoster(db, account, [
      { externalId: keepExt, email: "keep@example.com", displayName: "keep", role: "owner", active: true, workspaceUserId: "wu-1" },
      { externalId: offExt, email: "off@example.com", displayName: "off", role: "member", active: false, workspaceUserId: "wu-2" },
    ]);
    expect(await revoked([keepKey, offKey, goneKey])).toEqual({ [keepKey]: false, [offKey]: true, [goneKey]: true });

    // Upstream turns them back on: the old key stays revoked.
    await projectRoster(db, account, [
      { externalId: keepExt, email: "keep@example.com", displayName: "keep", role: "owner", active: true, workspaceUserId: "wu-1" },
      { externalId: offExt, email: "off@example.com", displayName: "off", role: "member", active: true, workspaceUserId: "wu-2" },
    ]);
    expect(await revoked([offKey])).toEqual({ [offKey]: true });
  });

  it("projectMemberships revokes the keys of a membership upstream marks inactive or stops naming", async () => {
    const sub = `sub-${randomUUID()}`;
    const identity = { externalId: sub, email: `${sub}@example.com`, displayName: "Sub" };
    const [a, b] = [`ws-${randomUUID()}`, `ws-${randomUUID()}`];
    const membership = (workspaceId: string, active: boolean) => ({
      workspaceId,
      workspaceName: workspaceId,
      iamAccountId: "acct",
      workspaceUserId: `wu-${workspaceId}`,
      role: "member" as const,
      active,
    });
    const born = Date.now() - 3_600_000;
    const first = await projectMemberships(db, identity, [membership(a, true), membership(b, true)], { now: born });
    accounts.push(...first.accountIds);
    const [accA, accB] = first.accountIds as [string, string];
    const memberIn = async (acc: string) =>
      (await db.get<{ id: string }>(sql`SELECT id FROM member WHERE account_id = ${acc} AND external_id = ${sub}`))!.id;
    const keyA = await key(accA, await memberIn(accA));
    const keyB = await key(accB, await memberIn(accB));

    // A is marked inactive; B is no longer named at all.
    await projectMemberships(db, identity, [membership(a, false)]);
    expect(await revoked([keyA, keyB])).toEqual({ [keyA]: true, [keyB]: true });
  });
});
