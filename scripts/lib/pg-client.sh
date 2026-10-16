#!/usr/bin/env bash
#
# Exports PG_DUMP, PG_RESTORE and PSQL as absolute paths to the NEWEST client
# installed. Source it:  . "$(dirname "$0")/lib/pg-client.sh"
#
# On Debian/Ubuntu /usr/bin/pg_dump is pg_wrapper, which resolves to the
# CONFIGURED cluster (16 on ubuntu-latest) even with a newer client installed —
# and pg_dump refuses a newer server. Pre-set PG_DUMP/PG_RESTORE/PSQL win.
# shellcheck shell=bash

_pg_major() {
  # "pg_dump (PostgreSQL) 17.5 (Ubuntu 17.5-1.pgdg24.04+1)" -> 17
  "$1" --version 2>/dev/null | grep -oE '[0-9]+' | head -1
}

_pg_pick() {
  local prog="$1" best="" best_major=0 candidate major on_path

  # Debian/Ubuntu, RHEL/Fedora and Homebrew layouts; unmatched globs stay literal
  # (no nullglob — this file is sourced) and fail the -x test.
  for candidate in \
    /usr/lib/postgresql/*/bin/"$prog" \
    /usr/pgsql-*/bin/"$prog" \
    /opt/homebrew/opt/postgresql@*/bin/"$prog" \
    /usr/local/opt/postgresql@*/bin/"$prog"
  do
    [ -x "$candidate" ] || continue
    major="$(_pg_major "$candidate")"
    [ -n "$major" ] || continue
    if [ "$major" -gt "$best_major" ]; then
      best_major="$major"
      best="$candidate"
    fi
  done

  # Whatever is on PATH is a candidate too: it may be newer than anything above,
  # and on a machine with no versioned directories at all it is the only one.
  on_path="$(command -v "$prog" 2>/dev/null || true)"
  if [ -n "$on_path" ]; then
    major="$(_pg_major "$on_path")"
    if [ -n "$major" ] && [ "$major" -gt "$best_major" ]; then
      best_major="$major"
      best="$on_path"
    fi
  fi

  [ -n "$best" ] || return 1
  printf '%s' "$best"
}

PG_DUMP="${PG_DUMP:-$(_pg_pick pg_dump || true)}"
PG_RESTORE="${PG_RESTORE:-$(_pg_pick pg_restore || true)}"
PSQL="${PSQL:-$(_pg_pick psql || true)}"
export PG_DUMP PG_RESTORE PSQL

# Fail with versions and the remedy before pg_dump's own cryptic mismatch.
# An unreachable server is left for the dump itself to report.
#
#   pg_require_client_at_least <client-binary> <database-url>
pg_require_client_at_least() {
  local bin="$1" url="$2" client_major server_version server_major

  [ -n "${PSQL:-}" ] || return 0

  server_version="$("$PSQL" "$url" -tAc 'SHOW server_version;' 2>/dev/null | head -1)"
  [ -n "$server_version" ] || return 0

  client_major="$(_pg_major "$bin")"
  server_major="${server_version%%.*}"

  case "$client_major$server_major" in
    *[!0-9]*|'') return 0 ;;
  esac

  if [ "$client_major" -lt "$server_major" ]; then
    echo "backup: PostgreSQL client $client_major cannot handle a server $server_major database." >&2
    echo "backup:   client: $bin ($("$bin" --version))" >&2
    echo "backup:   server: $server_version" >&2
    echo "backup: install postgresql-client-$server_major, or set PG_DUMP/PG_RESTORE/PSQL" >&2
    echo "backup: to binaries from $server_major or newer. In CI this is" >&2
    echo "backup: .github/actions/postgres-client." >&2
    return 1
  fi
  return 0
}
