/**
 * Stand-in for the `server-only` package under vitest (see `vitest.config.ts`).
 *
 * `server-only` exists to make the BUILD fail when server code is imported into
 * a client bundle. It has no runtime behaviour, and it does not resolve outside
 * a Next build — so a client component that transitively reaches a server action
 * cannot be imported by a unit test without this. Deliberately empty.
 */
export {};
