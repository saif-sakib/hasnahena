#!/usr/bin/env bash
#
# TEST-01 — an ephemeral test stack in one command.
#
#   scripts/test-stack.sh up          # database only — enough for integration tests
#   scripts/test-stack.sh up --serve  # database + Go API + Next, for e2e
#   scripts/test-stack.sh env         # print the exports the suites need
#   scripts/test-stack.sh down        # remove everything (destroys the volume)
#
# Namespaced and non-default (container `hn-test`, port 55433) so it can never
# be mistaken for a development database — the suites truncate tables.

set -euo pipefail

CONTAINER="${HN_TEST_CONTAINER:-hn-test}"
PGPORT="${HN_TEST_PGPORT:-55433}"
DBNAME="hasnahena_test"
API_PORT="${HN_TEST_API_PORT:-8099}"
WEB_PORT="${HN_TEST_WEB_PORT:-3099}"
PGURL="postgresql://postgres:postgres@localhost:${PGPORT}/${DBNAME}"

# Deterministic and obviously fake; never read from the developer's .env.
JWT_SECRET="test-secret-at-least-thirty-two-characters"

# The seeded admin; `env` exports these so e2e specs can sign in.
ADMIN_EMAIL="admin@hasnahena.test"
ADMIN_PASSWORD="test-password-123456"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNDIR="${ROOT}/.test-stack"

say() { printf '\033[36m▸\033[0m %s\n' "$*"; }
die() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

require() { command -v "$1" >/dev/null 2>&1 || die "$1 is required but not installed"; }

start_db() {
  require docker
  if docker inspect "$CONTAINER" >/dev/null 2>&1; then
    say "reusing container ${CONTAINER}"
    docker start "$CONTAINER" >/dev/null 2>&1 || true
  else
    say "starting postgres:17 on ${PGPORT}"
    docker run -d --name "$CONTAINER" \
      -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB="$DBNAME" \
      -p "${PGPORT}:5432" postgres:17 >/dev/null
  fi

  say "waiting for postgres"
  for _ in $(seq 1 60); do
    docker exec "$CONTAINER" pg_isready -U postgres -q && return 0
    sleep 1
  done
  die "postgres did not become ready in 60s"
}

migrate_and_seed() {
  say "applying migrations"
  # Migrations, not `db push` (ADR-014) — the schema that actually deploys.
  DATABASE_URL="$PGURL" pnpm --dir "$ROOT" db:migrate >/dev/null

  say "seeding config and an admin"
  DATABASE_URL="$PGURL" \
  SEED_ADMIN_EMAIL="$ADMIN_EMAIL" \
  SEED_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    pnpm --dir "$ROOT" db:seed
}

serve() {
  mkdir -p "$RUNDIR"

  say "starting Go API on ${API_PORT}"
  # RATE_LIMIT_REQUESTS is raised: the whole browser suite comes from one
  # address and would otherwise get 429s and empty pages partway through.
  # Built, not `go run`: `go run` execs a child the pid file and pkill miss, so a
  # stale API kept answering (docs/traps.md); a compile error also fails here.
  say "building the API"
  ( cd "$ROOT/apps/api" && go build -o "$RUNDIR/api-bin" ./cmd/server ) \
    || die "the Go API did not compile"

  DATABASE_URL="$PGURL" JWT_SECRET="$JWT_SECRET" API_PORT="$API_PORT" \
  CORS_ORIGINS="http://localhost:${WEB_PORT}" \
  RATE_LIMIT_REQUESTS="${HN_TEST_RATE_LIMIT:-100000}" \
  "$RUNDIR/api-bin" > "$RUNDIR/api.log" 2>&1 &
  echo $! > "$RUNDIR/api.pid"

  # TEST_DATABASE_URL decides the web app's database — Next re-applies
  # apps/web/.env over DATABASE_URL (see apps/web/lib/prisma.ts).
  say "starting Next on ${WEB_PORT}"
  ( cd "$ROOT/apps/web" && \
    DATABASE_URL="$PGURL" TEST_DATABASE_URL="$PGURL" JWT_SECRET="$JWT_SECRET" \
    NEXT_PUBLIC_API_URL="http://localhost:${API_PORT}" \
    NEXT_DIST_DIR=".next-test" \
    npx next dev -p "$WEB_PORT" > "$RUNDIR/web.log" 2>&1 & echo $! > "$RUNDIR/web.pid" )

  for name in "API:http://localhost:${API_PORT}/v1/health" "web:http://localhost:${WEB_PORT}/en"; do
    label="${name%%:*}"; url="${name#*:}"
    say "waiting for ${label}"
    ok=0
    for _ in $(seq 1 90); do
      if curl -fsS -o /dev/null "$url" 2>/dev/null; then ok=1; break; fi
      sleep 1
    done
    [ "$ok" = 1 ] || die "${label} did not come up — see ${RUNDIR}/*.log"
  done
}

stop_servers() {
  for pidfile in "$RUNDIR"/api.pid "$RUNDIR"/web.pid; do
    [ -f "$pidfile" ] || continue
    pid="$(cat "$pidfile")"
    # Kill the process group: `go run` and `next dev` both fork children that
    # keep the port bound if only the parent is signalled.
    kill -- "-${pid}" 2>/dev/null || kill "$pid" 2>/dev/null || true
    rm -f "$pidfile"
  done
  pkill -f "next dev -p ${WEB_PORT}" 2>/dev/null || true
  pkill -f "${RUNDIR}/api-bin" 2>/dev/null || true
  pkill -f "cmd/server/main.go" 2>/dev/null || true

  # Last resort: free the ports whoever holds them — a survivor makes the next run pass falsely.
  for port in "$API_PORT" "$WEB_PORT"; do
    for pid in $(ss -lptnH "sport = :${port}" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u); do
      say "port ${port} still held by pid ${pid} — stopping it"
      kill "$pid" 2>/dev/null || true
    done
  done
}

print_env() {
  cat <<EOF
export DATABASE_URL="${PGURL}"
export TEST_DATABASE_URL="${PGURL}"
export JWT_SECRET="${JWT_SECRET}"
export NEXT_PUBLIC_API_URL="http://localhost:${API_PORT}"
export E2E_BASE_URL="http://localhost:${WEB_PORT}"
export E2E_ADMIN_IDENTIFIER="${ADMIN_EMAIL}"
export E2E_ADMIN_PASSWORD="${ADMIN_PASSWORD}"
EOF
}

case "${1:-up}" in
  up)
    start_db
    migrate_and_seed
    if [ "${2:-}" = "--serve" ]; then serve; fi
    echo
    say "ready. Run the suites with:"
    echo
    print_env
    echo
    say "then: pnpm test:integration   |   pnpm test:e2e"
    say "tear down with: scripts/test-stack.sh down"
    ;;
  env)
    print_env
    ;;
  down)
    stop_servers
    say "removing ${CONTAINER}"
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    rm -rf "$RUNDIR"
    say "done"
    ;;
  *)
    die "usage: $0 {up [--serve] | env | down}"
    ;;
esac
