#!/usr/bin/env bash
#
# Dumps the database to a single encrypted file.
#
#   DIRECT_DATABASE_URL=postgresql://... BACKUP_PASSPHRASE=... scripts/backup.sh [outdir]
#
# BACKUP_DATABASE_URL is accepted as the same thing, because that is the name
# the GitHub secret has. One value, two names, and being handed the wrong one is
# the expected mistake — the workflow maps `secrets.BACKUP_DATABASE_URL` onto
# `DIRECT_DATABASE_URL`, so anyone copying the command out of the workflow and
# running it locally has the other half of the pair in their hand.
#
# Two things about this script are deliberate and easy to get wrong:
#
#   1. It must use the DIRECT Neon endpoint, not the `-pooler` one. pg_dump
#      issues session-level SET statements that PgBouncer's transaction pooling
#      silently drops, and the dump either fails or — worse — succeeds oddly.
#   2. The dump is encrypted before it touches any storage. It contains every
#      member's name, phone, NID number and bcrypt hash. An unencrypted copy in
#      a CI artifact store is a data breach waiting for someone to notice.
#
# Output: <outdir>/hasnahena-<UTC timestamp>.dump.gpg
#
# The dump is custom format (-Fc), so pg_restore can restore selectively and in
# parallel. Restore it with scripts/restore-check.sh.

set -euo pipefail

# Exports PG_DUMP as an absolute path to the NEWEST client on this machine.
# /usr/bin/pg_dump is pg_wrapper on Debian and Ubuntu and answers with whatever
# major postgresql-common calls the default, which is how this script once
# reported "pg_dump version: 16.14" against a 17.11 server on a runner that had
# a newer client installed. See scripts/lib/pg-client.sh.
. "$(dirname "${BASH_SOURCE[0]}")/lib/pg-client.sh"

OUT_DIR="${1:-backups}"

DIRECT_DATABASE_URL="${DIRECT_DATABASE_URL:-${BACKUP_DATABASE_URL:-}}"

if [[ -z "$DIRECT_DATABASE_URL" ]]; then
  echo "backup: set DIRECT_DATABASE_URL (or BACKUP_DATABASE_URL — same value, and the name of the GitHub secret)" >&2
  echo "backup: it must be the direct Neon endpoint (no '-pooler' in the host); a pooled one is accepted and converted" >&2
  exit 1
fi

if [[ -z "${BACKUP_PASSPHRASE:-}" ]]; then
  echo "backup: BACKUP_PASSPHRASE is not set — refusing to write an unencrypted dump" >&2
  exit 1
fi

# Neon serves the same database on two hostnames: `-pooler` (PgBouncer, which
# drops the session state pg_dump depends on) and the direct one. Being handed
# the pooled URL is the expected mistake — it is the string in every dashboard
# and every other env var — so derive the direct host rather than failing and
# leaving the schedule with no backup at all.
if [[ "$DIRECT_DATABASE_URL" == *"-pooler"* ]]; then
  echo "backup: given a pooler endpoint; using the direct host instead" >&2
  DIRECT_DATABASE_URL="${DIRECT_DATABASE_URL//-pooler/}"
fi

if [[ -z "${PG_DUMP:-}" ]]; then
  echo "backup: no pg_dump found — install a PostgreSQL client" >&2
  exit 1
fi

# Checked before the dump so the log names the problem and the remedy, rather
# than pg_dump's own "aborting because of server version mismatch" 40 minutes
# into a nightly run. Neon upgrades Postgres on its own schedule, so this WILL
# drift again; when it does, this is the line that says what to install.
pg_require_client_at_least "$PG_DUMP" "$DIRECT_DATABASE_URL"

mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="$OUT_DIR/hasnahena-$STAMP.dump"

echo "backup: dumping at $STAMP (UTC)"
echo "backup: using $PG_DUMP ($("$PG_DUMP" --version))"

# --no-owner / --no-acl: Neon roles do not exist in a scratch restore target,
# and a restore that fails on GRANT statements is a restore that did not happen.
"$PG_DUMP" \
  --dbname="$DIRECT_DATABASE_URL" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-acl \
  --file="$ARCHIVE"

RAW_BYTES="$(stat -c %s "$ARCHIVE")"
echo "backup: dump is $RAW_BYTES bytes"

# A dump this small means the database was empty or the connection lied to us.
# Better a failed backup job than a green one covering an empty file.
if [[ "$RAW_BYTES" -lt 4096 ]]; then
  echo "backup: dump is implausibly small ($RAW_BYTES bytes) — failing" >&2
  rm -f "$ARCHIVE"
  exit 1
fi

gpg --batch --yes --symmetric \
  --cipher-algo AES256 \
  --pinentry-mode loopback \
  --passphrase-fd 0 \
  --output "$ARCHIVE.gpg" \
  "$ARCHIVE" <<<"$BACKUP_PASSPHRASE"

rm -f "$ARCHIVE"

echo "backup: wrote $ARCHIVE.gpg ($(stat -c %s "$ARCHIVE.gpg") bytes)"
