/**
 * The person directory as the API boots it and as the MCP door reads it: off
 * with MCP OAuth off; with it on, the identity-service adapter, whose settings
 * are checked at boot; and a lookup's outcome in the door's terms.
 */
import { describe, expect, it } from 'vitest';
import { DoorRefusal, DoorThrottled, DoorUnavailable } from '@quill/mcp';
import { loadServerEnv } from '@quill/config/env';
import {
  cachePersonDirectory,
  createPersonDirectory,
  lookUpPerson,
  PersonRefused,
  type EstateWorkspace,
  type Person,
  type PersonDirectory,
} from './person-directory';
import { TokenBucketRateLimiter } from './rate-limit';
import { iamDirectoryConfig } from './person-directory.iam';

const OAUTH = {
  MCP_OAUTH_PROVIDER: 'workos',
  WORKOS_AUTHKIT_DOMAIN: 'https://auth.example.test',
  MCP_PUBLIC_URL: 'https://mcp.example.test/mcp',
};
const IAM = {
  IAM_DB_HOST: 'iam-db.example.test',
  IAM_DB_NAME: 'identity',
  IAM_DB_SCHEMA: 'identity_ms',
  IAM_DB_USER: 'reader',
  IAM_DB_PASS: 'spec-password',
};
const env = (over: Record<string, string | undefined> = {}) => loadServerEnv({ ...OAUTH, ...IAM, ...over } as NodeJS.ProcessEnv);

describe('booting the person directory', () => {
  it('is absent with MCP OAuth off, whatever identity database settings are present', () => {
    expect(createPersonDirectory(loadServerEnv({ ...IAM } as NodeJS.ProcessEnv))).toBeNull();
    expect(createPersonDirectory(loadServerEnv({}))).toBeNull();
  });

  it('reads the identity database with MCP OAuth on, over TLS, on the default port', () => {
    expect(iamDirectoryConfig(env())).toEqual({
      host: 'iam-db.example.test',
      port: 5432,
      database: 'identity',
      schema: 'identity_ms',
      user: 'reader',
      password: 'spec-password',
      tls: true,
      ca: null,
    });
    expect(createPersonDirectory(env())).not.toBeNull();
  });

  it('takes another port, and plain text only on a loopback host', () => {
    expect(iamDirectoryConfig(env({ IAM_DB_PORT: '6543' }))).toMatchObject({ port: 6543, tls: true });
    expect(iamDirectoryConfig(env({ IAM_DB_HOST: '127.0.0.1' }))).toMatchObject({ tls: false });
    expect(iamDirectoryConfig(env({ IAM_DB_HOST: 'localhost' }))).toMatchObject({ tls: false });
  });

  it('refuses to boot naming every value that is missing or blank', () => {
    const boot = () => createPersonDirectory(env({ IAM_DB_HOST: undefined, IAM_DB_PASS: ' ' }));
    expect(boot).toThrow(/Refusing to boot/);
    expect(boot).toThrow(/IAM_DB_HOST, IAM_DB_PASS/);
    expect(() => createPersonDirectory(loadServerEnv({ ...OAUTH } as NodeJS.ProcessEnv))).toThrow(
      /IAM_DB_HOST, IAM_DB_NAME, IAM_DB_SCHEMA, IAM_DB_USER, IAM_DB_PASS/,
    );
  });

  it.each([
    ['a schema that is not a plain identifier', { IAM_DB_SCHEMA: 'identity; drop' }, /IAM_DB_SCHEMA/],
    ['a port that is not a port', { IAM_DB_PORT: '70000' }, /IAM_DB_PORT/],
    ['a port that is not a number', { IAM_DB_PORT: 'five' }, /IAM_DB_PORT/],
    ['a host with a scheme', { IAM_DB_HOST: 'postgres://iam-db.example.test' }, /IAM_DB_HOST/],
  ])('refuses to boot with %s', (_name, over, message) => {
    expect(() => createPersonDirectory(env(over))).toThrow(/Refusing to boot/);
    expect(() => createPersonDirectory(env(over))).toThrow(message);
  });
});

describe('a lookup, in the door\'s terms', () => {
  const directory = (personOf: PersonDirectory['personOf']): PersonDirectory => ({ personOf });

  it('passes a person, or nobody, through', async () => {
    const person = { id: 'p1', email: 'p1@example.com' };
    expect(await lookUpPerson(directory(async () => person), 'user_1')).toEqual(person);
    expect(await lookUpPerson(directory(async () => null), 'user_1')).toBeNull();
  });

  it('turns a refusal into a 403 with its message', async () => {
    const error = await lookUpPerson(directory(async () => Promise.reject(new PersonRefused('Contact support.'))), 'user_1').catch((e) => e);
    expect(error).toBeInstanceOf(DoorRefusal);
    expect((error as Error).message).toBe('Contact support.');
  });

  it('turns a directory that cannot be read into a 503 that says to retry, without its internals', async () => {
    const error = await lookUpPerson(
      directory(async () => Promise.reject(new Error('connect ECONNREFUSED 10.1.2.3:5432'))),
      'user_1',
      () => {},
    ).catch((e) => e);
    expect(error).toBeInstanceOf(DoorUnavailable);
    expect((error as Error).message).toMatch(/try again/i);
    expect((error as Error).message).not.toContain('10.1.2.3');
  });
});

describe('the per-pod cache in front of the directory', () => {
  const ADA: Person = { id: 'p-ada', email: 'ada@example.com' };

  /** A directory over `table` that counts its lookups; `fail` makes it unreadable. */
  function counting(table: Record<string, Person | PersonRefused> = { user_ada: ADA }) {
    const state = { lookups: 0, fail: false, gate: null as Promise<void> | null };
    const directory: PersonDirectory = {
      async personOf(subject) {
        state.lookups += 1;
        if (state.gate) await state.gate;
        if (state.fail) throw new Error('connect ECONNREFUSED');
        const found = table[subject];
        if (found instanceof PersonRefused) throw found;
        return found ?? null;
      },
    };
    return { state, directory };
  }

  function clock() {
    let t = 1_000_000;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  }

  const roomy = () => new TokenBucketRateLimiter(1_000, 1_000);

  it('answers a flood for one subject from one lookup, concurrent requests included', async () => {
    const { state, directory } = counting();
    let release!: () => void;
    state.gate = new Promise<void>((r) => (release = r));
    const cached = cachePersonDirectory(directory, { limiter: roomy() });
    const burst = Array.from({ length: 50 }, () => cached.personOf('user_ada'));
    release();
    expect(await Promise.all(burst)).toEqual(Array.from({ length: 50 }, () => ADA));
    for (let i = 0; i < 200; i += 1) expect(await cached.personOf('user_ada')).toEqual(ADA);
    expect(state.lookups).toBe(1);
  });

  it('keeps a person for a minute, and nobody or a refusal only briefly', async () => {
    const blocked = new PersonRefused('This account is inactive or blocked.');
    const { state, directory } = counting({ user_ada: ADA, user_blocked: blocked });
    const c = clock();
    const cached = cachePersonDirectory(directory, { limiter: roomy(), now: c.now });
    await cached.personOf('user_ada');
    expect(await cached.personOf('user_nobody')).toBeNull();
    await expect(cached.personOf('user_blocked')).rejects.toBe(blocked);
    expect(state.lookups).toBe(3);

    c.advance(5_000);
    expect(await cached.personOf('user_nobody')).toBeNull();
    await expect(cached.personOf('user_blocked')).rejects.toBeInstanceOf(PersonRefused);
    expect(state.lookups).toBe(3);

    c.advance(10_000);
    await cached.personOf('user_nobody');
    await expect(cached.personOf('user_blocked')).rejects.toBeInstanceOf(PersonRefused);
    await cached.personOf('user_ada');
    expect(state.lookups).toBe(5);

    c.advance(46_000);
    await cached.personOf('user_ada');
    expect(state.lookups).toBe(6);
  });

  it('never keeps an outage: the next request asks the directory again', async () => {
    const { state, directory } = counting();
    const cached = cachePersonDirectory(directory, { limiter: roomy() });
    state.fail = true;
    await expect(cached.personOf('user_ada')).rejects.toThrow();
    state.fail = false;
    expect(await cached.personOf('user_ada')).toEqual(ADA);
    expect(state.lookups).toBe(2);
  });

  it('takes a token per subject before every lookup, and answers past the budget with a 429', async () => {
    const { state, directory } = counting();
    const c = clock();
    const cached = cachePersonDirectory(directory, { limiter: new TokenBucketRateLimiter(2, 0.001, c.now), now: c.now });
    expect(await cached.personOf('user_x')).toBeNull();
    c.advance(11_000);
    expect(await cached.personOf('user_x')).toBeNull();
    c.advance(11_000);
    const error = await lookUpPerson(cached, 'user_x').catch((e) => e);
    expect(error).toBeInstanceOf(DoorThrottled);
    expect((error as DoorThrottled).retryAfterMs).toBeGreaterThan(0);
    expect(state.lookups).toBe(2);
    // Another subject has a bucket of its own.
    expect(await cached.personOf('user_ada')).toEqual(ADA);
  });

  it('holds a bounded number of subjects, dropping the oldest first', async () => {
    const { state, directory } = counting();
    const cached = cachePersonDirectory(directory, { limiter: roomy(), maxEntries: 3 });
    for (const s of ['user_ada', 's1', 's2', 's3']) await cached.personOf(s);
    expect(state.lookups).toBe(4);
    await cached.personOf('s3');
    expect(state.lookups).toBe(4);
    await cached.personOf('user_ada');
    expect(state.lookups).toBe(5);
  });
});

describe('the cache, for staff workspace lookups', () => {
  const INITECH: EstateWorkspace = { id: 'ws-initech', name: 'Initech', accountId: 'acc-1', accountName: 'Initech Corp' };

  function estate() {
    const state = { byId: 0, searches: 0, fail: false };
    const directory: PersonDirectory = {
      personOf: async () => null,
      async workspaceOf(id) {
        state.byId += 1;
        if (state.fail) throw new Error('connect ECONNREFUSED');
        return id === INITECH.id ? INITECH : null;
      },
      async searchWorkspaces() {
        state.searches += 1;
        return [INITECH];
      },
    };
    return { state, directory };
  }

  it('keeps a workspace for a minute, none briefly and an outage never; searches are never kept', async () => {
    let t = 1_000_000;
    const { state, directory } = estate();
    const cached = cachePersonDirectory(directory, { limiter: new TokenBucketRateLimiter(1_000, 1_000), now: () => t });
    expect(await Promise.all([cached.workspaceOf!('ws-initech'), cached.workspaceOf!('ws-initech')])).toEqual([INITECH, INITECH]);
    expect(await cached.workspaceOf!('ws-gone')).toBeNull();
    expect(state.byId).toBe(2);
    t += 30_000;
    expect(await cached.workspaceOf!('ws-initech')).toEqual(INITECH);
    expect(await cached.workspaceOf!('ws-gone')).toBeNull();
    expect(state.byId).toBe(3);
    t += 31_000;
    await cached.workspaceOf!('ws-initech');
    expect(state.byId).toBe(4);
    state.fail = true;
    await expect(cached.workspaceOf!('ws-new')).rejects.toThrow();
    state.fail = false;
    expect(await cached.workspaceOf!('ws-new')).toBeNull();
    expect(state.byId).toBe(6);

    await cached.searchWorkspaces!('initech', 20);
    await cached.searchWorkspaces!('initech', 20);
    expect(state.searches).toBe(2);
  });

  it('offers no staff lookups when the directory has none', () => {
    const cached = cachePersonDirectory({ personOf: async () => null }, { limiter: new TokenBucketRateLimiter(1, 1) });
    expect(cached.workspaceOf).toBeUndefined();
    expect(cached.searchWorkspaces).toBeUndefined();
  });
});
