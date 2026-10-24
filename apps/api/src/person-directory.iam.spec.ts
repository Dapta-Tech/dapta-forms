/**
 * The identity-service person directory against a real Postgres: a minimal
 * `users` + `sessions` (+ `workspaces` and `accounts`, for the staff lookups)
 * schema created here, in a schema of its own, and the
 * adapter reading it the way it reads the identity service's database.
 *
 * Runs when DATABASE_URL is a Postgres URL (the Postgres CI job, or
 * `DATABASE_URL=postgres://quill:quill@localhost:5432/quill`); skipped on the
 * SQLite run, which has no Postgres to read.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import postgres from 'postgres';
import { isPostgresUrl } from '@quill/config/env';
import { normalizeWorkspaceSearch as normalize } from '@quill/mcp';
import { PersonRefused } from './person-directory';
import { createIamPersonDirectory, type IamDirectoryConfig, type IamPersonDirectory } from './person-directory.iam';

const url = process.env.DATABASE_URL ?? '';
const onPostgres = isPostgresUrl(url);

describe.skipIf(!onPostgres)('the identity-service person directory, on Postgres', () => {
  const schema = `iam_spec_${randomUUID().slice(0, 8)}`;
  let admin: postgres.Sql;
  let config: IamDirectoryConfig;
  const open: IamPersonDirectory[] = [];

  function directory(over: Partial<IamDirectoryConfig> = {}, opts?: Parameters<typeof createIamPersonDirectory>[1]) {
    const d = createIamPersonDirectory({ ...config, ...over }, opts);
    open.push(d);
    return d;
  }

  async function user(fields: { workosUserId?: string | null; email?: string; isActive?: boolean; blocked?: boolean; deleted?: boolean } = {}) {
    const id = randomUUID();
    const email = fields.email ?? `${id.slice(0, 8)}@example.com`;
    await admin.unsafe(
      `INSERT INTO ${schema}.users (id, email, workos_user_id, is_active, blocked_at, deleted_at)
       VALUES ($1, $2, $3, $4, ${fields.blocked ? 'now()' : 'NULL'}, ${fields.deleted ? 'now()' : 'NULL'})`,
      [id, email, fields.workosUserId ?? null, fields.isActive ?? true],
    );
    return { id, email };
  }

  async function session(userId: string, workosUserId: string) {
    await admin.unsafe(`INSERT INTO ${schema}.sessions (id, user_id, workos_user_id) VALUES ($1, $2, $3)`, [
      randomUUID(),
      userId,
      workosUserId,
    ]);
  }

  const subject = () => `user_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

  beforeAll(async () => {
    admin = postgres(url, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.unsafe(`
      CREATE TABLE ${schema}.users (
        id uuid PRIMARY KEY,
        email text NOT NULL,
        workos_user_id text,
        is_active boolean NOT NULL DEFAULT true,
        blocked_at timestamptz,
        deleted_at timestamptz
      );
      CREATE TABLE ${schema}.sessions (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES ${schema}.users (id),
        workos_user_id text
      );
      CREATE TABLE ${schema}.accounts (
        id uuid PRIMARY KEY,
        name text COLLATE "C"
      );
      CREATE TABLE ${schema}.workspaces (
        id uuid PRIMARY KEY,
        name text COLLATE "C" NOT NULL,
        account_id uuid REFERENCES ${schema}.accounts (id),
        is_active boolean,
        created_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE TABLE ${schema}.workspace_users (
        id uuid PRIMARY KEY,
        workspace_id uuid NOT NULL REFERENCES ${schema}.workspaces (id),
        user_id uuid NOT NULL REFERENCES ${schema}.users (id),
        type text NOT NULL DEFAULT 'MEMBER',
        is_active boolean NOT NULL DEFAULT true,
        deleted_at timestamptz
      );
    `);
    const u = new URL(url);
    config = {
      host: u.hostname,
      port: Number(u.port || 5432),
      database: decodeURIComponent(u.pathname.slice(1)),
      schema,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      tls: false,
      ca: null,
    };
  });

  afterAll(async () => {
    await Promise.all(open.map((d) => d.close()));
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.end();
  });

  it('finds a person by the user row that carries the subject', async () => {
    const sub = subject();
    const u = await user({ workosUserId: sub });
    expect(await directory().personOf(sub)).toEqual({ id: u.id, email: u.email });
  });

  it('falls back to the sessions when no user row carries the subject', async () => {
    const sub = subject();
    const u = await user({ workosUserId: null });
    await session(u.id, sub);
    await session(u.id, sub);
    expect(await directory().personOf(sub)).toEqual({ id: u.id, email: u.email });
  });

  it('prefers the user row over a session that names someone else', async () => {
    const sub = subject();
    const owner = await user({ workosUserId: sub });
    const other = await user();
    await session(other.id, sub);
    expect(await directory().personOf(sub)).toEqual({ id: owner.id, email: owner.email });
  });

  it('knows nobody by an unknown subject, or by a deleted user in either table', async () => {
    const d = directory();
    expect(await d.personOf(subject())).toBeNull();
    const gone = subject();
    await user({ workosUserId: gone, deleted: true });
    expect(await d.personOf(gone)).toBeNull();
    const goneBySession = subject();
    const deleted = await user({ deleted: true });
    await session(deleted.id, goneBySession);
    expect(await d.personOf(goneBySession)).toBeNull();
  });

  it('refuses, never picks, when the sessions link the subject to two people', async () => {
    const sub = subject();
    const a = await user();
    const b = await user();
    await session(a.id, sub);
    await session(b.id, sub);
    await expect(directory().personOf(sub)).rejects.toThrow(PersonRefused);
    await expect(directory().personOf(sub)).rejects.toThrow(/more than one account/);
  });

  it('refuses when two user rows carry the subject', async () => {
    const sub = subject();
    await user({ workosUserId: sub });
    await user({ workosUserId: sub });
    await expect(directory().personOf(sub)).rejects.toThrow(PersonRefused);
  });

  it('refuses an inactive or blocked person, found either way', async () => {
    const d = directory();
    const inactive = subject();
    await user({ workosUserId: inactive, isActive: false });
    await expect(d.personOf(inactive)).rejects.toThrow(/inactive or blocked/);
    const blocked = subject();
    const b = await user({ blocked: true });
    await session(b.id, blocked);
    await expect(d.personOf(blocked)).rejects.toThrow(PersonRefused);
  });

  it('throws, never answers nobody, when the database cannot be reached', async () => {
    const error = await directory({ host: '127.0.0.1', port: await closedPort() }).personOf(subject()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PersonRefused);
  });

  it('never falls back to plain text when TLS is on and the server does not offer it', async () => {
    // The spec database speaks no TLS, so a directory that insists on it cannot read it.
    const sub = subject();
    await user({ workosUserId: sub });
    await expect(directory({ tls: true }).personOf(sub)).rejects.toThrow();
  });

  it('gives up on a query that does not answer in time', async () => {
    const slow = `${schema}_slow`;
    await admin.unsafe(`CREATE SCHEMA ${slow}`);
    await admin.unsafe(`CREATE VIEW ${slow}.users AS SELECT u.* FROM ${schema}.users u WHERE (SELECT pg_sleep(3)::text) IS NOT NULL`);
    try {
      const started = Date.now();
      await expect(directory({ schema: slow }, { queryTimeoutMs: 200 }).personOf(subject())).rejects.toThrow(/did not answer/);
      expect(Date.now() - started).toBeLessThan(2500);
    } finally {
      await admin.unsafe(`DROP SCHEMA ${slow} CASCADE`);
    }
  });

  /** A workspace (and its account, when `account` is named) in the identity database. */
  async function workspace(name: string, fields: { account?: string; isActive?: boolean | null; deleted?: boolean; age?: number } = {}) {
    const id = randomUUID();
    let accountId: string | null = null;
    if (fields.account !== undefined) {
      accountId = randomUUID();
      await admin.unsafe(`INSERT INTO ${schema}.accounts (id, name) VALUES ($1, $2)`, [accountId, fields.account]);
    }
    await admin.unsafe(
      `INSERT INTO ${schema}.workspaces (id, name, account_id, is_active, created_at, deleted_at)
       VALUES ($1, $2, $3, $4, now() - ($5 || ' minutes')::interval, ${fields.deleted ? 'now()' : 'NULL'})`,
      [id, name, accountId, fields.isActive === undefined ? true : fields.isActive, String(fields.age ?? 0)],
    );
    return { id, accountId };
  }

  it('reads one live workspace by id, with its account, and nothing for a deleted, inactive or malformed one', async () => {
    const d = directory();
    const tag = randomUUID().slice(0, 6);
    const live = await workspace(`Initech ${tag}`, { account: 'Initech Corp' });
    expect(await d.workspaceOf(live.id)).toEqual({ id: live.id, name: `Initech ${tag}`, accountId: live.accountId, accountName: 'Initech Corp' });
    expect(await d.workspaceOf(live.id.toUpperCase())).toMatchObject({ id: live.id });
    const unset = await workspace(`Unset ${tag}`, { isActive: null });
    expect(await d.workspaceOf(unset.id)).toMatchObject({ id: unset.id, accountId: null, accountName: null });
    expect(await d.workspaceOf((await workspace(`Gone ${tag}`, { deleted: true })).id)).toBeNull();
    expect(await d.workspaceOf((await workspace(`Off ${tag}`, { isActive: false })).id)).toBeNull();
    expect(await d.workspaceOf(randomUUID())).toBeNull();
    for (const bad of ['', 'not-a-uuid', `${live.id}'; --`]) expect(await d.workspaceOf(bad)).toBeNull();
  });

  it('searches live workspaces by workspace or account name, ignoring case and punctuation, newest first, within the limit', async () => {
    const d = directory();
    const tag = randomUUID().replace(/-/g, '').slice(0, 8);
    const older = await workspace(`Call Center ${tag}`, { age: 10 });
    const newer = await workspace(`CALL-center ${tag}'s workspace`, { age: 1 });
    const byAccount = await workspace(`Sales ${tag}`, { account: `Call-Center ${tag} Holdings`, age: 5 });
    await workspace(`Call Center ${tag} deleted`, { deleted: true });
    await workspace(`Call Center ${tag} off`, { isActive: false });
    const found = await d.searchWorkspaces(`callcenter${tag}`, 20);
    expect(found.map((w) => w.id)).toEqual([newer.id, byAccount.id, older.id]);
    expect(found[1]).toMatchObject({ accountName: `Call-Center ${tag} Holdings` });
    expect(await d.searchWorkspaces(`callcenter${tag}`, 1)).toHaveLength(1);
    // Never more than 21 (the 20 a search shows, and one to tell it was cut), whatever the caller asks.
    for (let i = 0; i < 22; i += 1) await workspace(`Bulk ${tag} ${i}`);
    expect(await d.searchWorkspaces(`bulk${tag}`, 500)).toHaveLength(21);
  });

  it('folds accents and case on both sides, even under collation C where lower() leaves É alone', async () => {
    const d = directory();
    const tag = randomUUID().replace(/-/g, '').slice(0, 6);
    const ws = await workspace(`Peñalosa & Hijos ${tag}`);
    for (const needle of [`penalosahijos${tag}`, `peñalosahijos${tag}`]) {
      expect((await d.searchWorkspaces(needle, 20)).map((w) => w.id)).toEqual([ws.id]);
    }
    const upper = await workspace(`JOSÉ ${tag}`);
    const lower = await workspace(`Agencia ${tag}`, { account: `José María ${tag}`, age: 1 });
    const decomposed = await workspace(`Jose\u0301 Ltd ${tag}`, { age: 2 });
    const found = (await d.searchWorkspaces(`jose`, 20)).map((w) => w.id);
    for (const id of [upper.id, lower.id, decomposed.id]) expect(found).toContain(id);
    const greek = await workspace(`ΑΘΉΝΑ ${tag}`);
    expect((await d.searchWorkspaces(normalize(`αθηνα ${tag}`), 20)).map((w) => w.id)).toEqual([greek.id]);
  });

  it('says whether a person holds a live membership in a workspace', async () => {
    const d = directory();
    const ws = await workspace(`Members ${randomUUID().slice(0, 6)}`);
    const member = await user();
    const removed = await user();
    const deleted = await user();
    const stranger = await user();
    const seat = (userId: string, fields: { isActive?: boolean; deleted?: boolean } = {}) =>
      admin.unsafe(
        `INSERT INTO ${schema}.workspace_users (id, workspace_id, user_id, is_active, deleted_at) VALUES ($1, $2, $3, $4, ${fields.deleted ? 'now()' : 'NULL'})`,
        [randomUUID(), ws.id, userId, fields.isActive ?? true],
      );
    await seat(member.id);
    await seat(removed.id, { isActive: false });
    await seat(deleted.id, { deleted: true });
    expect(await d.holdsMembership(ws.id, member.id)).toBe(true);
    expect(await d.holdsMembership(ws.id.toUpperCase(), member.id)).toBe(true);
    for (const u of [removed, deleted, stranger]) expect(await d.holdsMembership(ws.id, u.id)).toBe(false);
    expect(await d.holdsMembership('not-a-uuid', member.id)).toBe(false);
    expect(await d.holdsMembership(ws.id, 'not-a-uuid')).toBe(false);
  });

  it('refuses a search that is not a normalized needle of 3 letters or digits, without reading anything', async () => {
    const d = directory();
    await workspace(`Anything ${randomUUID().slice(0, 4)}`);
    for (const needle of ['', 'ab', '%%%', 'a_b', '%', 'abc%', 'ab c']) expect(await d.searchWorkspaces(needle, 20)).toEqual([]);
  });

  it('keeps its pool small however many lookups arrive at once', async () => {
    await Promise.all(open.splice(0).map((d) => d.close()));
    const d = directory();
    const sub = subject();
    await user({ workosUserId: sub });
    await Promise.all(Array.from({ length: 24 }, () => d.personOf(sub)));
    const [row] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = 'dforms-person-directory'`;
    expect(row!.n).toBeGreaterThan(0);
    expect(row!.n).toBeLessThanOrEqual(4);
  });
});

/** A loopback port nothing listens on. */
async function closedPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}
