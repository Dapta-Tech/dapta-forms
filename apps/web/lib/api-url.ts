/**
 * Where server-side code reaches the Forms API.
 *
 * `NEXT_PUBLIC_*` is inlined at BUILD time into **every** bundle — the server
 * chunks too, not only the browser ones. A production `next build` leaves zero
 * `process.env.NEXT_PUBLIC_API_URL` reads behind, so the runtime ConfigMap value
 * can never win. That means one image built once cannot carry a per-environment
 * API host in `NEXT_PUBLIC_API_URL`: whatever host the build saw is frozen into
 * the server code of every environment that image is promoted to.
 *
 * `API_URL` has no `NEXT_PUBLIC_` prefix, so Next leaves it as a genuine runtime
 * `process.env` read and the per-environment ConfigMap wins — the same way
 * `AUTH_PROVIDER` and `IAM_BASE_URL` already work. It may point at the public
 * host or at the cluster-internal Service; server-to-server calls do not need
 * to leave the cluster.
 *
 * The `NEXT_PUBLIC_API_URL` fallback is deliberate: a fork, a `pnpm dev`, or a
 * Vercel deploy that only sets the public var keeps working with no change.
 */
export const serverApiUrl =
  process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
