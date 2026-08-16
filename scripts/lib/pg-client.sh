#!/usr/bin/env bash
#
# Resolves the newest PostgreSQL client binaries present on this machine and
# exports PG_DUMP, PG_RESTORE and PSQL pointing at them by absolute path.
#
# Source it, do not run it:
#     . "$(dirname "$0")/lib/pg-client.sh"
#
# Why this exists
# ---------------
# On Debian and Ubuntu, /usr/bin/pg_dump is NOT the program. It is pg_wrapper, a
# Perl script that picks a real binary from the *configured cluster*, and only
# falls back to "newest installed" when there is no cluster at all. GitHub's
# ubuntu-latest image ships a PostgreSQL 16 **server** with a live cluster, so
# installing postgresql-client-18 alongside it changes nothing: the wrapper
# still resolves to 16 with an 18 binary sitting in /usr/lib/postgresql/18/bin.
#
# This is worth stating precisely because the obvious guess — "the newer package
# just did not take" — is wrong, and leads to reinstalling clients forever. On a
# machine with no cluster the same commands do pick the newest, which is exactly
# why this cannot be reproduced by installing two clients in a bare container.
#
# pg_dump refuses to dump a server newer than itself, so the nightly backup died
# with:
#
#     pg_dump: error: aborting because of server version mismatch
#     pg_dump: detail: server version: 17.11; pg_dump version: 16.14
#
# on a runner that had a new-enough client installed the whole time. Selecting
# the binary by explicit path is the only reliable fix. Putting that selection
# HERE rather than in the workflow means it also holds for the CI restore drill
# and for anyone running these scripts by hand — the workflow is not the only
# caller, and it was the only place the previous fix lived.
#
# Any of PG_DUMP / PG_RESTORE / PSQL already set in the environment wins, so a
# caller on an unusual layout can override without editing this file.

# shellcheck shell=bash

_pg_major() {
  # "pg_dump (PostgreSQL) 17.5 (Ubuntu 17.5-1.pgdg24.04+1)" -> 17
  "$1" --version 2>/dev/null | grep -oE '[0-9]+' | head -1
}

_pg_pick() {
  local prog="$1" best="" best_major=0 candidate major on_path

  # Versioned install directories: Debian/Ubuntu, RHEL/Fedora, Homebrew. Globs
  # that match nothing stay literal (no nullglob is set, deliberately — this
  # file is sourced and must not change the caller's shell options), which the
  # -x test below rejects.
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

# Fails with the version numbers and the remedy, instead of letting pg_dump emit
# "aborting because of server version mismatch" and leaving whoever reads the
# log at 2am to work out which side to change.
#
#   pg_require_client_at_least <client-binary> <database-url>
#
# A server that cannot be reached is not this function's problem — the dump
# itself will report the connection error far better. Silence and return in that
# case rather than masking it.
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
