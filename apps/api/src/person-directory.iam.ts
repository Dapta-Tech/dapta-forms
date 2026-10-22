/**
 * The identity-service adapter of the person directory port: reads, never
 * writes, the identity service's own database to translate the identity
 * provider's subject into the identity service's user id, the id members carry
 * as `external_id`. The only place that knows that database's layout.
 *
 * The rules are the ones the sibling MCP server applies to the same people:
 *   1. the live user row whose provider id is the subject;
 *   2. only if there is none, the live users any session links to the subject
 *      (accounts migrated without the id on their row). Not one to one: a
 *      browser shared by two people links one subject to both, so more than
 *      one person is refused, never resolved to the newest session;
 *   3. neither: nobody (null). A deleted user is nobody; an inactive or
 *      blocked one is refused.
 * Every query casts the parameter, never the column, so the indexes on the
 * provider id columns serve it.
 *
 * For staff of the deployment it also reads the identity service's live
 * workspaces (`workspaces`, with the name of the `accounts` row each hangs
 * from): one by id, a search by name, and whether a person holds a live
 * membership (`workspace_users`) in one. Live = not deleted and not marked
 * inactive. Which person is staff is decided by the API, never here.
 *
 * Settings come from the environment (`IAM_DB_*`, see `iamDirectoryConfig`);
 * no host, database, schema or role of the hosted deployment is written here.
 */
import { existsSync, readFileSync } from 'node:fs';
import postgres from 'postgres';
import type { ServerEnv } from '@quill/config/env';
import { SEARCH_FOLD_FROM, SEARCH_FOLD_TO, foldSearchText } from '@quill/mcp';
import { PersonRefused, type EstateWorkspace, type Person, type PersonDirectory } from './person-directory';

/** Where the identity service's database is, and the read-only role to read it as. */
export interface IamDirectoryConfig {
  host: string;
  port: number;
  database: string;
  /** The schema that holds `users`, `sessions`, `workspaces` and `accounts`. */
  schema: string;
  user: string;
  password: string;
  /** TLS on the connection. Off only for a database on a loopback host without a CA. */
  tls: boolean;
  /**
   * The CA that signs the database's certificate (PEM), from `IAM_DB_SSL_CA`.
   * Set: the certificate is verified against it, and so is the host name it
   * was issued for (verify-full). Null: encrypted, but not verified.
   */
  ca: string | null;
}

type IamDirectoryEnv = Pick<
  ServerEnv,
  'IAM_DB_HOST' | 'IAM_DB_PORT' | 'IAM_DB_NAME' | 'IAM_DB_SCHEMA' | 'IAM_DB_USER' | 'IAM_DB_PASS' | 'IAM_DB_SSL_CA'
>;

const REQUIRED = ['IAM_DB_HOST', 'IAM_DB_NAME', 'IAM_DB_SCHEMA', 'IAM_DB_USER', 'IAM_DB_PASS'] as const;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);
/** A plain Postgres identifier: what the schema name is quoted as, and nothing else. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;
/** A host name, an IPv4 address or an IPv6 one (bare or bracketed): no scheme, port, path or credentials. */
const HOST = /^(\[[0-9A-Fa-f:.]+\]|[0-9A-Fa-f]*:[0-9A-Fa-f.]*:[0-9A-Fa-f:.]*|[A-Za-z0-9.-]+)$/;

const PEM_CERTIFICATE = '-----BEGIN CERTIFICATE-----';

/**
 * `IAM_DB_SSL_CA` as a PEM: the value itself when it is one (newlines may be
 * escaped as `\n`, for a one-line variable), else a path to a file that holds
 * one, read now. Null when unset; "Refusing to boot" when it is neither.
 */
function caOf(raw: string | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  if (value.includes(PEM_CERTIFICATE)) return value.replace(/\\n/g, '\n');
  let file: string | null = null;
  try {
    file = existsSync(value) ? readFileSync(value, 'utf8') : null;
  } catch {
    file = null;
  }
  if (file === null) {
    throw new Error('Refusing to boot: IAM_DB_SSL_CA must be a PEM certificate or the path of a readable file that holds one.');
  }
  if (!file.includes(PEM_CERTIFICATE)) {
    throw new Error('Refusing to boot: IAM_DB_SSL_CA names a file that holds no PEM certificate.');
  }
  return file;
}

/**
 * The identity database settings, checked: every value present (the port
 * defaults to 5432), the schema a plain identifier, the port a port, the CA a
 * certificate. Throws "Refusing to boot" naming what is wrong, so a directory
 * that could never read is not served. TLS is on unless the host is a
 * loopback host; with a CA it is always on, and verified.
 */
export function iamDirectoryConfig(env: IamDirectoryEnv): IamDirectoryConfig {
  const value = (name: (typeof REQUIRED)[number]) => (env[name] ?? '').trim();
  const missing = REQUIRED.filter((name) => !value(name));
  if (missing.length > 0) {
    throw new Error(
      `Refusing to boot: MCP_OAUTH_PROVIDER is set, so the person directory needs ${missing.join(', ')} (read-only access to the identity database).`,
    );
  }
  const rawHost = value('IAM_DB_HOST');
  if (!HOST.test(rawHost)) {
    throw new Error(`Refusing to boot: IAM_DB_HOST must be a bare host name or address, got ${JSON.stringify(rawHost)}.`);
  }
  const host = rawHost.replace(/^\[(.*)\]$/, '$1');
  const schema = value('IAM_DB_SCHEMA');
  if (!IDENTIFIER.test(schema)) {
    throw new Error(`Refusing to boot: IAM_DB_SCHEMA must be a plain schema name (letters, digits, _), got ${JSON.stringify(schema)}.`);
  }
  const ca = caOf(env.IAM_DB_SSL_CA);
  const rawPort = (env.IAM_DB_PORT ?? '').trim();
  const port = rawPort ? Number(rawPort) : 5432;
  if (!/^\d+$/.test(rawPort || '5432') || port < 1 || port > 65_535) {
    throw new Error(`Refusing to boot: IAM_DB_PORT must be a port number, got ${JSON.stringify(rawPort)}.`);
  }
  return {
    host,
    port,
    database: value('IAM_DB_NAME'),
    schema,
    user: value('IAM_DB_USER'),
    // The password is used as given: a secret may legitimately end in a space.
    password: env.IAM_DB_PASS ?? '',
    tls: ca !== null || !LOOPBACK.has(host.toLowerCase()),
    ca,
  };
}

/** Bounds of the adapter, defaults for production; specs shorten them. */
export interface IamDirectoryOptions {
  /** At most this many connections at once (default 4): one lookup per MCP request, index-backed. */
  maxConnections?: number;
  /** A query unanswered after this long fails the lookup (default 5 s), so a stuck database never holds a request. */
  queryTimeoutMs?: number;
}

export interface IamPersonDirectory extends PersonDirectory {
  workspaceOf(workspaceId: string): Promise<EstateWorkspace | null>;
  searchWorkspaces(needle: string, limit: number): Promise<EstateWorkspace[]>;
  holdsMembership(workspaceId: string, personId: string): Promise<boolean>;
  /** Close the pool (specs, and the API's shutdown). */
  close(): Promise<void>;
}

interface UserRow {
  id: string;
  email: string | null;
  is_active: boolean | null;
  blocked: boolean;
}

const COLUMNS = 'u.id::text AS id, u.email, u.is_active, (u.blocked_at IS NOT NULL) AS blocked';

interface WorkspaceRow {
  id: string;
  name: string | null;
  account_id: string | null;
  account_name: string | null;
}

const WORKSPACE_COLUMNS = 'w.id::text AS id, w.name, w.account_id::text AS account_id, a.name AS account_name';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/**
 * A normalized search (see `normalizeWorkspaceSearch`): no ASCII character but
 * a lowercase letter or a digit, at least 3 characters. So no LIKE wildcard,
 * and never an empty needle that would match everything.
 */
// eslint-disable-next-line no-control-regex
const NEEDLE = /^[^\x00-\x2f\x3a-\x60\x7b-\x7f]{3,100}$/;
/**
 * The names are normalized the same way in SQL: lowercased, folded with the
 * same table the needle was (`translate`, so `JOSÉ` and `José` read `jose`
 * even under collation `C`, where `lower` leaves `É` alone, and with no
 * extension such as `unaccent`, which the identity database does not have),
 * then every ASCII character that is not a letter or a digit is dropped, and
 * any combining mark (a decomposed accent). Listed by code point, not as
 * `[:alnum:]`, so it does not depend on the database's locale.
 */
const ASCII_NON_ALNUM_OR_MARK = '[\\x01-\\x2f\\x3a-\\x60\\x7b-\\x7f\\u0300-\\u036f]';
/**
 * One past the 20 a search shows (`STAFF_SEARCH_MAX_RESULTS`), so the tool can
 * tell a list that was cut from one that ended there.
 */
const MAX_SEARCH_RESULTS = 21;

function workspaceOf(row: WorkspaceRow): EstateWorkspace {
  return { id: row.id, name: row.name ?? 'Workspace', accountId: row.account_id, accountName: row.account_name };
}

/** How the adapter's connections show in `pg_stat_activity`. */
const APPLICATION_NAME = 'dforms-person-directory';

export function createIamPersonDirectory(config: IamDirectoryConfig, options: IamDirectoryOptions = {}): IamPersonDirectory {
  const queryTimeoutMs = options.queryTimeoutMs ?? 5_000;
  // Lazy: nothing connects until the first lookup, so the API boots (and keeps
  // serving API keys) while the identity database is down.
  const sql = postgres({
    host: config.host,
    port: config.port,
    database: config.database,
    username: config.user,
    password: config.password,
    // With a CA: verify-full, the certificate against the CA and the host it
    // was issued for (Node's default identity check, with the host as the
    // server name). Without one, 'require' encrypts and never falls back to
    // plain text, but checks no certificate; the API says so once at boot.
    ssl: config.ca ? { ca: config.ca, rejectUnauthorized: true } : config.tls ? 'require' : false,
    max: options.maxConnections ?? 4,
    connect_timeout: 5,
    idle_timeout: 60,
    max_lifetime: 30 * 60,
    connection: { application_name: APPLICATION_NAME },
    onnotice: () => {},
  });
  const schema = sql(config.schema);

  /** `query`, failed and cancelled on the server once it runs past the timeout. */
  async function timed<T extends readonly object[]>(query: postgres.PendingQuery<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void Promise.resolve(query.cancel()).catch(() => {});
        reject(new Error(`The identity database did not answer within ${queryTimeoutMs} ms.`));
      }, queryTimeoutMs);
    });
    try {
      return await Promise.race([query, late]);
    } finally {
      clearTimeout(timer);
    }
  }

  const byUser = (subject: string) => sql<UserRow[]>`
    SELECT ${sql.unsafe(COLUMNS)}
    FROM ${schema}.users u
    WHERE u.workos_user_id = ${subject}::text
      AND u.deleted_at IS NULL
    LIMIT 2`;
  const bySession = (subject: string) => sql<UserRow[]>`
    SELECT DISTINCT ${sql.unsafe(COLUMNS)}
    FROM ${schema}.sessions s
    JOIN ${schema}.users u ON u.id = s.user_id
    WHERE s.workos_user_id = ${subject}::text
      AND u.deleted_at IS NULL
    LIMIT 2`;

  // Staff lookups. Neither is scoped to a person: the API asks them only for
  // a person who is staff of the deployment on that request.
  const workspaceById = (id: string) => sql<WorkspaceRow[]>`
    SELECT ${sql.unsafe(WORKSPACE_COLUMNS)}
    FROM ${schema}.workspaces w
    LEFT JOIN ${schema}.accounts a ON a.id = w.account_id
    WHERE w.id = ${id}::uuid
      AND w.deleted_at IS NULL
      AND w.is_active IS NOT FALSE
    LIMIT 1`;
  // No index serves this: it scans the live workspaces. It is staff only,
  // with a needle of at least 3 letters or digits and a small LIMIT.
  const workspacesMatching = (needle: string, limit: number) => sql<WorkspaceRow[]>`
    SELECT ${sql.unsafe(WORKSPACE_COLUMNS)}
    FROM ${schema}.workspaces w
    LEFT JOIN ${schema}.accounts a ON a.id = w.account_id
    WHERE w.deleted_at IS NULL
      AND w.is_active IS NOT FALSE
      AND (regexp_replace(translate(lower(w.name), ${SEARCH_FOLD_FROM}::text, ${SEARCH_FOLD_TO}::text), ${ASCII_NON_ALNUM_OR_MARK}, '', 'g')
            LIKE '%' || ${needle}::text || '%'
        OR regexp_replace(translate(lower(coalesce(a.name, '')), ${SEARCH_FOLD_FROM}::text, ${SEARCH_FOLD_TO}::text), ${ASCII_NON_ALNUM_OR_MARK}, '', 'g')
            LIKE '%' || ${needle}::text || '%')
    ORDER BY w.created_at DESC
    LIMIT ${limit}::int`;
  const membership = (workspaceId: string, userId: string) => sql<{ one: number }[]>`
    SELECT 1 AS one
    FROM ${schema}.workspace_users wu
    WHERE wu.workspace_id = ${workspaceId}::uuid
      AND wu.user_id = ${userId}::uuid
      AND wu.is_active = true
      AND wu.deleted_at IS NULL
    LIMIT 1`;

  return {
    async holdsMembership(workspaceId, personId) {
      const ws = workspaceId.trim().toLowerCase();
      const user = personId.trim().toLowerCase();
      if (!UUID.test(ws) || !UUID.test(user)) return false;
      return (await timed(membership(ws, user))).length > 0;
    },
    async workspaceOf(workspaceId) {
      const id = workspaceId.trim().toLowerCase();
      // A malformed id would fail the cast: it names no workspace.
      if (!UUID.test(id)) return null;
      const [row] = await timed(workspaceById(id));
      return row ? workspaceOf(row) : null;
    },
    async searchWorkspaces(needle, limit) {
      // The needle arrives normalized; anything else (a LIKE wildcard, an
      // empty string that would match everything) is refused here too.
      if (!NEEDLE.test(needle)) return [];
      // Folded here too (idempotent), so a needle with an accent still meets
      // the folded names.
      const folded = foldSearchText(needle);
      if (!NEEDLE.test(folded)) return [];
      const bounded = Math.max(1, Math.min(MAX_SEARCH_RESULTS, Math.floor(limit)));
      return (await timed(workspacesMatching(folded, bounded))).map(workspaceOf);
    },
    async personOf(subject) {
      let rows = await timed(byUser(subject));
      if (rows.length === 0) rows = await timed(bySession(subject));
      // More than one person: refuse, never pick (the newest session could
      // be someone else who signed in on the same browser).
      if (rows.length > 1) {
        throw new PersonRefused(
          'This sign-in matches more than one account, so dForms will not guess which one it is. Contact support; do not retry.',
        );
      }
      const [row] = rows;
      if (!row) return null;
      if (!row.is_active || row.blocked) {
        throw new PersonRefused('This account is inactive or blocked. Contact support; do not retry.');
      }
      return { id: row.id, email: row.email } satisfies Person;
    },
    close: () => sql.end({ timeout: 5 }),
  };
}
