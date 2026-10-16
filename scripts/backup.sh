#!/usr/bin/env bash
#
# Dumps the database to one encrypted file (custom format; restore with
# scripts/restore-check.sh).
#
#   DIRECT_DATABASE_URL=postgresql://... BACKUP_PASSPHRASE=... scripts/backup.sh [outdir]
#   → <outdir>/hasnahena-<UTC timestamp>.dump.gpg
#
# BACKUP_DATABASE_URL is accepted too (the GitHub secret's name). Uses the
# DIRECT endpoint (pg_dump needs session state) and encrypts before anything
# touches storage — the dump holds names, NIDs and password hashes.

set -euo pipefail

# The newest pg_dump by absolute path (see lib/pg-client.sh).
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

# Derive the direct host from a -pooler URL rather than fail the backup.
if [[ "$DIRECT_DATABASE_URL" == *"-pooler"* ]]; then
  echo "backup: given a pooler endpoint; using the direct host instead" >&2
  DIRECT_DATABASE_URL="${DIRECT_DATABASE_URL//-pooler/}"
fi

if [[ -z "${PG_DUMP:-}" ]]; then
  echo "backup: no pg_dump found — install a PostgreSQL client" >&2
  exit 1
fi

# Version check up front; Neon upgrades on its own schedule.
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
