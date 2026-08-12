# Quill web — deployment-agnostic production image (Next standalone, Node runtime).
#
# Build context = repository ROOT:
#   docker build -f apps/web/Dockerfile -t quill-web .
#
# Uses Next's `output: 'standalone'` (already set in next.config.mjs), which
# traces the monorepo and bundles the server + only the node_modules it needs —
# a naturally small image. Node runtime, no Vercel-only APIs: the same artifact
# self-hosts on EKS / any Node host AND stays one-click Vercel-deployable.
#
# NOTE — NEXT_PUBLIC_API_URL is INLINED AT BUILD TIME by Next (it reaches client
# components). So it is a build ARG, not a runtime env: dev and prd build
# separate images with their own API URL. Server-only code still reads it from
# the runtime env. (Future: a same-origin `/api` proxy would make one image
# env-portable — an app change, tracked in DEPLOY-INTERNAL.)

# ---- base: pnpm via corepack -------------------------------------------------
FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# ---- build: install, build packages, build Next (standalone) -----------------
FROM base AS build
WORKDIR /repo
# Baked into the client bundle — pass per environment at build time.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Brand + growth-loop link — also NEXT_PUBLIC (inlined at build). Vendor-neutral
# defaults keep the OSS build generic; Dapta's CI passes "Dapta Forms" + the
# platform URL. (Deploy-enabling change per ECR-CI-PLAN §3.)
ARG NEXT_PUBLIC_PRODUCT_NAME=Forms
ENV NEXT_PUBLIC_PRODUCT_NAME=$NEXT_PUBLIC_PRODUCT_NAME
ARG NEXT_PUBLIC_PLATFORM_URL=
ENV NEXT_PUBLIC_PLATFORM_URL=$NEXT_PUBLIC_PLATFORM_URL
ARG NEXT_PUBLIC_SIGNUP_URL=
ENV NEXT_PUBLIC_SIGNUP_URL=$NEXT_PUBLIC_SIGNUP_URL
# Where the badge and the post-submission CTA point. Unlike the two above this
# one carries a real default, because it is a fact about the PRODUCT rather than
# about a deployment. Nothing changes for a fork — the loop stays gated on
# NEXT_PUBLIC_SIGNUP_URL, so with that unset neither surface renders at all.
#
# It follows the badge's COPY, and the copy now reads "Powered by Dapta". This
# default was written when it read "Made with Dapta Forms" and pointed at the
# product's own site; the sentence changed and this did not, so a respondent
# clicking a badge that says Dapta was landing on daptaforms.ai.
#
# The APEX, with no `www.` prefix, and that is not a style choice — the two
# spellings behave in opposite ways and the wrong one silently destroys the loop:
#   apex, as written below   → 200, no redirect, query INTACT
#   the `www.` prefix        → 301 to the apex, and the query is DROPPED
# daptaforms.ai is the mirror image of that, which is where the old prefix came
# from; carrying the habit over is exactly the mistake to avoid. Everything the
# loop carries — utm_source=dapta-forms, utm_medium=badge | confirmation,
# utm_campaign, utm_content=<accountCode> — rides in that query, so a redirect
# that drops it makes every attributed signup look like direct traffic. Re-test
# with `curl -sLo /dev/null -w '%{url_effective}' -L` before changing this host.
#
# (Spelled out rather than shown as two example URLs on purpose: publish-gate's
# denylist bans every `*.dapta.ai` subdomain outside a short file allowlist that
# this Dockerfile is not on, so writing the bad host even in a comment fails CI.)
ARG NEXT_PUBLIC_LANDING_URL=https://dapta.ai
ENV NEXT_PUBLIC_LANDING_URL=$NEXT_PUBLIC_LANDING_URL
ARG NEXT_PUBLIC_HIDE_BADGE=
ENV NEXT_PUBLIC_HIDE_BADGE=$NEXT_PUBLIC_HIDE_BADGE
# Deployment's OWN product telemetry (PostHog) — also NEXT_PUBLIC (inlined at
# build). Empty default = analytics fully off, which is what a bare fork wants.
# Distinct from the per-form NEXT_PUBLIC_POSTHOG_* pixels customers configure.
ARG NEXT_PUBLIC_PRODUCT_ANALYTICS_KEY=
ENV NEXT_PUBLIC_PRODUCT_ANALYTICS_KEY=$NEXT_PUBLIC_PRODUCT_ANALYTICS_KEY
ARG NEXT_PUBLIC_PRODUCT_ANALYTICS_HOST=
ENV NEXT_PUBLIC_PRODUCT_ANALYTICS_HOST=$NEXT_PUBLIC_PRODUCT_ANALYTICS_HOST
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm build:packages
RUN pnpm --filter @quill/web build

# ---- run: standalone server, non-root ----------------------------------------
FROM base AS run
ENV NODE_ENV=production
# Server components read NEXT_PUBLIC_* from the RUNTIME env (inlining only
# covers client bundles) — re-declare in the run stage so SSR'd metadata (tab
# title, switcher) carries the brand too. Same values CI passes to build.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_PRODUCT_NAME=Forms
ENV NEXT_PUBLIC_PRODUCT_NAME=$NEXT_PUBLIC_PRODUCT_NAME
ARG NEXT_PUBLIC_PLATFORM_URL=
ENV NEXT_PUBLIC_PLATFORM_URL=$NEXT_PUBLIC_PLATFORM_URL
ARG NEXT_PUBLIC_SIGNUP_URL=
ENV NEXT_PUBLIC_SIGNUP_URL=$NEXT_PUBLIC_SIGNUP_URL
# Apex, no `www.` — see the note on the build stage's copy of this ARG. The two
# stages must not drift: the client bundle takes the BUILD stage's value and SSR
# takes this one, so a mismatch means the badge in the HTML and the badge after
# hydration point at different hosts.
ARG NEXT_PUBLIC_LANDING_URL=https://dapta.ai
ENV NEXT_PUBLIC_LANDING_URL=$NEXT_PUBLIC_LANDING_URL
ARG NEXT_PUBLIC_HIDE_BADGE=
ENV NEXT_PUBLIC_HIDE_BADGE=$NEXT_PUBLIC_HIDE_BADGE
ARG NEXT_PUBLIC_PRODUCT_ANALYTICS_KEY=
ENV NEXT_PUBLIC_PRODUCT_ANALYTICS_KEY=$NEXT_PUBLIC_PRODUCT_ANALYTICS_KEY
ARG NEXT_PUBLIC_PRODUCT_ANALYTICS_HOST=
ENV NEXT_PUBLIC_PRODUCT_ANALYTICS_HOST=$NEXT_PUBLIC_PRODUCT_ANALYTICS_HOST
WORKDIR /app
# Next standalone bundles the server + its minimal node_modules.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
