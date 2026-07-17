#!/usr/bin/env bash
# Boots Dapta Forms for e2e QA on dedicated ports with an isolated SQLite DB.
#   web http://localhost:3400 · api http://localhost:4400 · db .data/qa.db
# Environment variables set here win over any root .env values (the env loader
# never overrides variables already present in the real environment), so this
# is safe to run on a machine whose .env points at a shared Postgres.
set -euo pipefail
cd "$(dirname "$0")/.."

export DATABASE_URL="file:./.data/qa.db"
export API_PORT=4400
export NEXT_PUBLIC_API_URL="http://localhost:4400"
export PUBLIC_APP_URL="http://localhost:3400"
export EMAIL_PROVIDER="log-only"
export AUTH_PROVIDER="local"

pnpm run build:packages
pnpm run db:migrate
pnpm run db:seed

cleanup() {
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "${WEB_PID:-}" ]] && kill "$WEB_PID" 2>/dev/null || true
}
trap cleanup EXIT

pnpm --filter @quill/api dev &
API_PID=$!
pnpm --filter @quill/web exec next dev -p 3400 &
WEB_PID=$!

wait
