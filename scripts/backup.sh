#!/usr/bin/env bash
#
# Dumps the database to a single encrypted file.
#
#   DIRECT_DATABASE_URL=postgresql://... BACKUP_PASSPHRASE=... scripts/backup.sh [outdir]
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

OUT_DIR="${1:-backups}"

if [[ -z "${DIRECT_DATABASE_URL:-}" ]]; then
  echo "backup: DIRECT_DATABASE_URL is not set" >&2
  echo "backup: this must be the direct Neon endpoint (no '-pooler' in the host)" >&2
  exit 1
fi

if [[ -z "${BACKUP_PASSPHRASE:-}" ]]; then
  echo "backup: BACKUP_PASSPHRASE is not set — refusing to write an unencrypted dump" >&2
  exit 1
fi

if [[ "$DIRECT_DATABASE_URL" == *"-pooler"* ]]; then
  echo "backup: DIRECT_DATABASE_URL points at a pooler endpoint; pg_dump needs the direct one" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="$OUT_DIR/hasnahena-$STAMP.dump"

echo "backup: dumping at $STAMP (UTC)"

# --no-owner / --no-acl: Neon roles do not exist in a scratch restore target,
# and a restore that fails on GRANT statements is a restore that did not happen.
pg_dump \
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
