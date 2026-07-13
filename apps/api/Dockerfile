# Quill API — deployment-agnostic production image (Node runtime).
#
# Build context = repository ROOT:
#   docker build -f apps/api/Dockerfile -t quill-api .
#
# Small, pnpm-workspace-aware, non-root. Uses `pnpm deploy` to emit a pruned,
# production-only bundle (only @quill/api + its runtime workspace deps — no dev
# deps, no other apps, no unrelated package source) instead of shipping the
# whole monorepo in the runtime layer.
#
# Deployment-agnostic: the same artifact runs on EKS, a bare Node host, or
# docker-compose. Point DATABASE_URL at managed Postgres in prod; leave it
# unset for SQLite. Database MIGRATIONS are NOT run here — they are a separate,
# gated release step (see deploy/DEPLOY-INTERNAL.md § migration-safety), so
# scaling to N replicas never races N migrators.

# ---- base: pnpm via corepack -------------------------------------------------
FROM node:22-trixie-slim@sha256:4228fca437e45714a3ebd1d4ecd1dcc583cf79f5a940aa025e286b472d93b67c AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# ---- build: install, build packages, emit a pruned production bundle ---------
FROM base AS build
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
# Build the workspace packages the API imports (@quill/engine, @quill/db, …) to
# their dist/ outputs, then produce a self-contained production bundle.
RUN pnpm build:packages
# --legacy: pnpm v10 refuses `deploy` without inject-workspace-packages; we build
# workspace deps to dist/ ourselves, so the legacy copy-based deploy is correct.
RUN pnpm --filter @quill/api deploy --legacy --prod /prod/api
# Zero-infra default: with no DATABASE_URL the API opens SQLite at ./.data under
# its own cwd (/app). Distroless has no shell to mkdir at runtime and its
# nonroot user (uid 65532) cannot create directories in the root-owned /app —
# so pre-create the data dir here, owned by that user. `docker run` with no env
# must boot (clone-and-run contract). For persistence across containers, mount
# a volume at /app/.data or point DATABASE_URL at Postgres/an absolute path.
RUN mkdir -p /prod/api/.data && chown 65532:65532 /prod/api/.data

# ---- run: minimal runtime, only the pruned bundle, non-root ------------------
FROM gcr.io/distroless/nodejs22-debian12:nonroot@sha256:13593b7570658e8477de39e2f4a1dd25db2f836d68a0ba771251572d23bb4f8e AS run
ENV NODE_ENV=production
# Distroless has no shell or package manager and defaults to its non-root user.
# Kubernetes may enforce a different non-root uid; application files are
# root-owned but world-readable. The ONLY writable runtime path is /app/.data
# (owned by the default nonroot uid 65532 for the SQLite zero-infra default —
# created in the build stage; COPY --from preserves ownership).
WORKDIR /app
COPY --from=build /prod/api ./
EXPOSE 4000
ENV API_PORT=4000
# Start the API only. tsx is a runtime dependency of @quill/api; the bundle
# carries the compiled workspace deps under node_modules. The distroless Node
# entrypoint executes the JavaScript CLI directly, without `/usr/bin/env`, a
# shell, or a package manager.
# --tsconfig tsconfig.runtime.json: the dev tsconfig's extends chain
# (@quill/config) doesn't resolve inside the pruned bundle and tsx would drop
# the whole config (losing experimentalDecorators → Nest crash at boot).
CMD ["node_modules/tsx/dist/cli.mjs", "--tsconfig", "tsconfig.runtime.json", "src/main.ts"]
