/**
 * The person directory port: who an MCP connection's token names, in the
 * terms members are keyed by.
 *
 * The identity provider's token names a person by its own subject (`sub`).
 * Members name a person by the identity service's user id (`member.external_id`)
 * and, for invitations, by email. The directory translates the first into
 * the second. It only answers WHO; which workspaces that person may act in is
 * always read from dForms' own members, on every request.
 *
 * With MCP OAuth off there is no directory. With it on, the directory is the
 * identity-service adapter (`person-directory.iam.ts`), and its settings are
 * checked when the API boots: a login is never served that could not map a
 * single person.
 */
import { Logger } from '@nestjs/common';
import { mcpOAuth, type ServerEnv } from '@quill/config/env';
import { DoorRefusal, DoorThrottled, DoorUnavailable, type RateLimiter } from '@quill/mcp';
import { createIamPersonDirectory, iamDirectoryConfig, type IamDirectoryConfig } from './person-directory.iam';

/** A person, as members know them. */
export interface Person {
  /** The id members carry as `external_id`: the identity service's user id. */
  id: string;
  /** The person's email, the key invitations bind by; null when the directory has none. */
  email: string | null;
}

/**
 * A workspace as the identity service knows it, for staff of the deployment:
 * they find any workspace by name and enter it through a staff access grant.
 */
export interface EstateWorkspace {
  /** The identity service's workspace id: what `account.external_id` holds. */
  id: string;
  name: string;
  /** The account (billing) the workspace hangs from, and its name. */
  accountId: string | null;
  accountName: string | null;
}

export interface PersonDirectory {
  /**
   * The person a verified token's subject names, or null when the directory
   * knows nobody by it. Throws `PersonRefused` when it knows the subject but
   * will not name one person for it (it matches several, or the person is
   * blocked); any other throw means the directory cannot be read.
   */
  personOf(subject: string): Promise<Person | null>;
  /**
   * Staff only: one live workspace by its id, or null (none has it, deleted,
   * inactive, or not a well-formed id). Without it staff reach their own
   * workspaces only.
   */
  workspaceOf?(workspaceId: string): Promise<EstateWorkspace | null>;
  /**
   * Staff only: live workspaces whose name, or whose account's name, contains
   * `needle` (lowercase letters and digits only, compared the same way),
   * newest first, at most `limit`. Never the full list.
   */
  searchWorkspaces?(needle: string, limit: number): Promise<EstateWorkspace[]>;
  /**
   * Staff only: whether `personId` (a `Person.id`) holds a live membership of
   * its own in the workspace, so it is entered as that member and never
   * turned into a staff access grant.
   */
  holdsMembership?(workspaceId: string, personId: string): Promise<boolean>;
  /** Release what the directory holds (the identity database pool). The API calls it when it shuts down. */
  close?(): Promise<void>;
}

/**
 * The directory knows a token's subject but will not name a person for it,
 * with a message the person can act on. Signing in again would not change it.
 */
export class PersonRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersonRefused';
  }
}

/**
 * The configured directory, or null when MCP OAuth is off or its settings
 * (`IAM_DB_*`) are missing or malformed. The directory is optional
 * (docs/adr/0004): without it the API still boots, and MCP sign-ins map
 * through the link a web login records alone, so a missing secret never
 * keeps the API from starting. That case is logged once, as a warning naming
 * what is wrong (never a value). Nothing connects here either: the directory
 * reads on its first lookup, so the API boots, and keeps serving API keys,
 * while the identity database is down.
 */
export function createPersonDirectory(
  env: ServerEnv,
  warn: (line: string) => void = (line) => new Logger('PersonDirectory').warn(line),
): PersonDirectory | null {
  if (!mcpOAuth(env)) return null;
  let config: IamDirectoryConfig;
  try {
    config = iamDirectoryConfig(env);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    warn(`Person directory off, MCP sign-ins map through web logins only: ${reason}`);
    return null;
  }
  if (config.tls && !config.ca) {
    warn("The identity database's TLS certificate is not verified: set IAM_DB_SSL_CA to its CA to verify it and its host name.");
  }
  return createIamPersonDirectory(config);
}

/** A subject's lookups ran past their budget (see `cachePersonDirectory`). */
export class PersonLookupThrottled extends Error {
  constructor(readonly retryAfterMs: number) {
    super('Too many person lookups for this subject.');
    this.name = 'PersonLookupThrottled';
  }
}

export interface PersonCacheOptions {
  /** Taken from, keyed by subject, before every lookup the cache cannot answer. */
  limiter: RateLimiter;
  /** How long a person is kept (default 60 s). */
  personTtlMs?: number;
  /** How long nobody, or a refusal, is kept (default 10 s): short, so a person who just signed up is seen soon. */
  nobodyTtlMs?: number;
  /** At most this many subjects are kept (default 10,000); the oldest go first. */
  maxEntries?: number;
  now?: () => number;
}

type Cached = { until: number; person: Person | null } | { until: number; refused: PersonRefused };

/**
 * `directory` behind a per-pod cache, so a flood of requests with one valid
 * token does not reach the identity database per request: a person is kept a
 * minute, nobody and a refusal a few seconds, and an outage never (the next
 * request asks again). Concurrent lookups of one subject share one call. Every
 * lookup the cache cannot answer first takes a token keyed by the subject
 * (the token's verified `sub`, so nobody can mint new ones), and past that
 * budget the lookup is `PersonLookupThrottled` (a 429) without reaching the
 * directory.
 *
 * What it keeps is WHO a subject is, and for staff which live workspace an id
 * names (`workspaceOf`, kept the same way). Which workspaces that person may
 * act in is still read from dForms' own members on every request, so removing
 * a member takes effect on the next call; a person the identity service
 * blocks, or whose email leaves a staff domain, is seen within a minute.
 */
export function cachePersonDirectory(directory: PersonDirectory, options: PersonCacheOptions): PersonDirectory {
  const personTtl = options.personTtlMs ?? 60_000;
  const nobodyTtl = options.nobodyTtlMs ?? 10_000;
  const maxEntries = options.maxEntries ?? 10_000;
  const now = options.now ?? Date.now;
  const entries = new Map<string, Cached>();
  const inFlight = new Map<string, Promise<Person | null>>();

  const remember = (subject: string, entry: Cached) => {
    entries.delete(subject);
    entries.set(subject, entry);
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value as string);
  };

  async function lookUp(subject: string): Promise<Person | null> {
    const { allowed, retryAfterMs } = options.limiter.take(`person:${subject}`);
    if (!allowed) throw new PersonLookupThrottled(retryAfterMs);
    try {
      const person = await directory.personOf(subject);
      remember(subject, { until: now() + (person ? personTtl : nobodyTtl), person });
      return person;
    } catch (error) {
      if (error instanceof PersonRefused) remember(subject, { until: now() + nobodyTtl, refused: error });
      throw error;
    }
  }

  // Staff lookups of one workspace: kept like a person (a workspace for a
  // minute, none for a few seconds, an outage never), so a staff
  // conversation in a customer's workspace reads the identity database about
  // it once a minute, not once a call.
  const workspaces = new Map<string, { until: number; workspace: EstateWorkspace | null }>();
  const workspacesInFlight = new Map<string, Promise<EstateWorkspace | null>>();
  const workspaceOf = directory.workspaceOf?.bind(directory);

  return {
    async personOf(subject) {
      const hit = entries.get(subject);
      if (hit && hit.until > now()) {
        if ('refused' in hit) throw hit.refused;
        return hit.person;
      }
      if (hit) entries.delete(subject);
      let pending = inFlight.get(subject);
      if (!pending) {
        pending = lookUp(subject).finally(() => inFlight.delete(subject));
        inFlight.set(subject, pending);
      }
      return pending;
    },
    ...(workspaceOf
      ? {
          async workspaceOf(workspaceId: string) {
            const hit = workspaces.get(workspaceId);
            if (hit && hit.until > now()) return hit.workspace;
            if (hit) workspaces.delete(workspaceId);
            let pending = workspacesInFlight.get(workspaceId);
            if (!pending) {
              pending = workspaceOf(workspaceId)
                .then((workspace) => {
                  workspaces.delete(workspaceId);
                  workspaces.set(workspaceId, { until: now() + (workspace ? personTtl : nobodyTtl), workspace });
                  while (workspaces.size > maxEntries) workspaces.delete(workspaces.keys().next().value as string);
                  return workspace;
                })
                .finally(() => workspacesInFlight.delete(workspaceId));
              workspacesInFlight.set(workspaceId, pending);
            }
            return pending;
          },
        }
      : {}),
    // A search is a staff action with a short needle and a small limit; each
    // one is its own question, so it is not kept.
    ...(directory.searchWorkspaces ? { searchWorkspaces: directory.searchWorkspaces.bind(directory) } : {}),
    // Asked only before a grant is minted, once per person and workspace.
    ...(directory.holdsMembership ? { holdsMembership: directory.holdsMembership.bind(directory) } : {}),
  };
}

const directoryLog = new Logger('PersonDirectory');

/**
 * `directory.personOf(subject)` in the MCP door's terms: a person or nobody as
 * is; a `PersonRefused` as a 403 with its message; a `PersonLookupThrottled`
 * as a 429 with its delay; and a directory that cannot
 * be read as a 503 that says to retry, so an outage is neither a silent 500
 * nor a way in. The cause is logged by class and code only, never with the
 * stack or the subject.
 */
export async function lookUpPerson(
  directory: PersonDirectory,
  subject: string,
  log: (line: string) => void = (line) => directoryLog.error(line),
): Promise<Person | null> {
  try {
    return await directory.personOf(subject);
  } catch (error) {
    if (error instanceof PersonRefused) throw new DoorRefusal(error.message);
    if (error instanceof PersonLookupThrottled) throw new DoorThrottled(error.retryAfterMs);
    const name = error instanceof Error ? error.name : typeof error;
    const code = (error as { code?: unknown } | null)?.code;
    log(`person directory unreadable: ${name}${typeof code === 'string' ? ` ${code}` : ''}`);
    throw new DoorUnavailable('dForms cannot check this sign-in right now. Try again in a minute.');
  }
}
