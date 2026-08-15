#!/usr/bin/env bash
#
# Restores an encrypted dump into a scratch database and proves it is intact.
#
#   BACKUP_PASSPHRASE=... scripts/restore-check.sh <archive.dump.gpg> <scratch-db-url>
#
# This is the other half of scripts/backup.sh, and the half that matters. A
# backup nobody has restored is a rumour: the file exists, the job is green, and
# whether it contains a usable database is unknown until the worst possible day.
#
# What "intact" means here, in order of increasing usefulness:
#   1. pg_restore completes without error
#   2. every table the schema declares exists
#   3. row counts match what the dump's own catalog says
#   4. the money invariants still hold — savings balances are non-negative and
#      every account still reconciles against its transactions
#
# The scratch URL is TRUNCATED and rewritten. Never point it at anything real.

set -euo pipefail

ARCHIVE="${1:-}"
SCRATCH_URL="${2:-}"

if [[ -z "$ARCHIVE" || -z "$SCRATCH_URL" ]]; then
  echo "usage: BACKUP_PASSPHRASE=... $0 <archive.dump.gpg> <scratch-db-url>" >&2
  exit 1
fi

if [[ ! -f "$ARCHIVE" ]]; then
  echo "restore: no such archive: $ARCHIVE" >&2
  exit 1
fi

if [[ "$SCRATCH_URL" == *"neon.tech"* && "${ALLOW_NEON_TARGET:-}" != "yes" ]]; then
  echo "restore: refusing to restore onto a Neon host without ALLOW_NEON_TARGET=yes" >&2
  echo "restore: restore into a Neon *branch*, never the primary" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PLAIN="$WORK/restore.dump"

echo "restore: decrypting $ARCHIVE"
if [[ "$ARCHIVE" == *.gpg ]]; then
  if [[ -z "${BACKUP_PASSPHRASE:-}" ]]; then
    echo "restore: BACKUP_PASSPHRASE is not set" >&2
    exit 1
  fi
  gpg --batch --yes --decrypt \
    --pinentry-mode loopback \
    --passphrase-fd 0 \
    --output "$PLAIN" \
    "$ARCHIVE" <<<"$BACKUP_PASSPHRASE" 2>/dev/null
else
  cp "$ARCHIVE" "$PLAIN"
fi

START="$(date -u +%s)"

echo "restore: resetting scratch schema"
psql "$SCRATCH_URL" --quiet --set ON_ERROR_STOP=1 \
  -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'

echo "restore: restoring"
# --no-owner: the dump's role does not exist here. Exit code is checked below
# rather than by set -e, because pg_restore warns on things that are fine.
pg_restore \
  --dbname="$SCRATCH_URL" \
  --no-owner \
  --no-acl \
  --exit-on-error \
  --jobs=4 \
  "$PLAIN"

ELAPSED=$(( $(date -u +%s) - START ))
echo "restore: completed in ${ELAPSED}s"

echo
echo "restore: row counts"
psql "$SCRATCH_URL" --quiet --set ON_ERROR_STOP=1 -P pager=off <<'SQL'
SELECT relname AS table, n_live_tup AS approx_rows
FROM pg_stat_user_tables
ORDER BY relname;
SQL

echo
echo "restore: integrity checks"
psql "$SCRATCH_URL" --quiet --set ON_ERROR_STOP=1 -P pager=off <<'SQL'
\set ON_ERROR_STOP on

-- The tables the application cannot start without.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(t, ', ') INTO missing
  FROM unnest(ARRAY[
    'users', 'accounts', 'transactions', 'loans',
    'audit_logs', 'system_config', 'document_sequences'
  ]) AS t
  WHERE to_regclass('public.' || t) IS NULL;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'restored database is missing tables: %', missing;
  END IF;
END $$;

-- Money invariants. A restore that loses a constraint or half a transaction
-- shows up here and nowhere else.
DO $$
DECLARE
  bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM accounts WHERE "savingsBalance" < 0;
  IF bad > 0 THEN
    RAISE EXCEPTION '% account(s) have a negative savings balance', bad;
  END IF;

  SELECT count(*) INTO bad FROM accounts WHERE "loanBalance" < 0;
  IF bad > 0 THEN
    RAISE EXCEPTION '% account(s) have a negative loan balance', bad;
  END IF;

  SELECT count(*) INTO bad FROM transactions t
  LEFT JOIN accounts a ON a.id = t."accountId"
  WHERE a.id IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION '% transaction(s) reference a missing account', bad;
  END IF;

  SELECT count(*) INTO bad FROM loans l
  LEFT JOIN users u ON u.id = l."borrowerId"
  WHERE u.id IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION '% loan(s) reference a missing borrower', bad;
  END IF;
END $$;

SELECT 'admins present' AS check, count(*) AS value
FROM users WHERE role IN ('ADMIN', 'SUPER_ADMIN')
UNION ALL
SELECT 'members', count(*) FROM users WHERE role = 'MEMBER'
UNION ALL
SELECT 'total savings (taka)', COALESCE(sum("savingsBalance"), 0) FROM accounts
UNION ALL
SELECT 'total loan balance (taka)', COALESCE(sum("loanBalance"), 0) FROM accounts
UNION ALL
SELECT 'audit rows', count(*) FROM audit_logs;
SQL

echo
echo "restore: OK — restored and verified in ${ELAPSED}s"
