#!/usr/bin/env bash
#
# TEST-01 — an ephemeral stack for tests, in one command.
#
# Exercising a single endpoint used to mean starting Postgres by hand, running
# migrations, seeding, minting a JWT with a throwaway script and remembering to
# tear it all down. That cost is why the 86 HTTP endpoints have no tests: not
# because anyone decided not to write them.
#
#   scripts/test-stack.sh up          # database only — enough for integration tests
#   scripts/test-stack.sh up --serve  # database + Go API + Next, for e2e
#   scripts/test-stack.sh env         # print the exports the suites need
#   scripts/test-stack.sh down        # remove everything
#
# Everything is namespaced and non-default (container `hn-test`, port 55433) so
# it cannot collide with a development database — and cannot be mistaken for one.
# `down` destroys the volume. That is the point: these suites truncate tables
# between tests, so the database must be one nobody minds losing.

set -euo pipefail

CONTAINER="${HN_TEST_CONTAINER:-hn-test}"
PGPORT="${HN_TEST_PGPORT:-55433}"
DBNAME="hasnahena_test"
API_PORT="${HN_TEST_API_PORT:-8099}"
WEB_PORT="${HN_TEST_WEB_PORT:-3099}"
PGURL="postgresql://postgres:postgres@localhost:${PGPORT}/${DBNAME}"

# Deterministic and obviously fake. Never read from the developer's .env, so a
# misconfigured run cannot reach a real database or sign a token a real
# deployment would accept.
JWT_SECRET="test-secret-at-least-thirty-two-characters"

# The admin this stack seeds, in one place — because two specs sign in as it and
# they used to have to be told its credentials by hand. `test-stack.sh env` now
# exports them, so `eval "$(scripts/test-stack.sh env)" && pnpm test:e2e` is
# enough: without them `public-content.spec.ts` fails with "Set
# E2E_ADMIN_IDENTIFIER and E2E_ADMIN_PASSWORD", which reads like a broken spec
# and is a rig that did not finish introducing itself.
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
  # Migrations, not `db push` (ADR-014). These suites must run against the
  # schema that actually deploys, including the column defaults Prisma strips —
  # that difference is what catches the `@updatedAt` class of bug.
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
  # RATE_LIMIT_REQUESTS is raised far above the production default of 60/min.
  #
  # The whole browser suite comes from one address, and a single spec logs in and
  # then loads a dashboard that fetches four endpoints. Forty specs comfortably
  # exceed sixty requests a minute, so the limiter starts answering 429 partway
  # through a run and the *later* pages render empty — which looks exactly like
  # flakiness and is order-dependent, so it reproduces only in a full run.
  #
  # Found the hard way: an admin-member-list spec that passed three times alone
  # and failed inside the suite, with 91 rejections sitting in api.log. The
  # tempting fix was a retry, which would have hidden it permanently.
  # Built, not `go run`. Two reasons, both learned here.
  #
  # `go run` compiles to a temp binary and execs it as a CHILD, so the pid
  # recorded below was the `go run` wrapper's and the fallback `pkill -f
  # cmd/server/main.go` did not match the child either — its command line is
  # /tmp/go-buildNNN/b001/exe/main. `down` therefore reported success while the
  # API kept port ${API_PORT} bound, and the next `up --serve` polled /v1/health,
  # got an answer from the OLD binary and moved on. That is the stale-process
  # trap in docs/traps.md, and it is what made a full green browser run
  # prove nothing about the code just written.
  #
  # Building also turns a compile error into a compiler message here, instead of
  # a connection refused ninety seconds later. CI does the same, for the same
  # reason.
  say "building the API"
  ( cd "$ROOT/apps/api" && go build -o "$RUNDIR/api-bin" ./cmd/server ) \
    || die "the Go API did not compile"

  DATABASE_URL="$PGURL" JWT_SECRET="$JWT_SECRET" API_PORT="$API_PORT" \
  CORS_ORIGINS="http://localhost:${WEB_PORT}" \
  RATE_LIMIT_REQUESTS="${HN_TEST_RATE_LIMIT:-100000}" \
  "$RUNDIR/api-bin" > "$RUNDIR/api.log" 2>&1 &
  echo $! > "$RUNDIR/api.pid"

  # TEST_DATABASE_URL as well as DATABASE_URL, and it is the one that decides.
  # Next re-applies `apps/web/.env` over the inherited environment before any of
  # our code runs (@next/env), so `DATABASE_URL` handed in here loses to a file
  # on disk: the API ran on the test database while the web app quietly ran on
  # the developer's Neon dev one, in the same browser suite. Nothing in this
  # repo's .env files defines TEST_DATABASE_URL, so nothing can override it —
  # see the note in apps/web/lib/prisma.ts.
  say "starting Next on ${WEB_PORT}"
  ( cd "$ROOT/apps/web" && \
    DATABASE_URL="$PGURL" TEST_DATABASE_URL="$PGURL" JWT_SECRET="$JWT_SECRET" \
    NEXT_PUBLIC_API_URL="http://localhost:${API_PORT}" \
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

  # Last resort: whatever still holds the ports, whoever started it.
  #
  # The pid files and the pattern matches above both assume this script started
  # the process. Neither is true after a crashed run, a killed terminal, or a
  # server someone started by hand — and a survivor is worse than a failure to
  # start, because the next run connects to it and passes. Ports, not names, are
  # the thing that actually has to be free.
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
