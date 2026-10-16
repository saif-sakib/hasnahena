#!/usr/bin/env bash
#
# Restores an encrypted dump into a scratch database and proves it intact:
# pg_restore succeeds, every table exists, row counts match the catalog, and
# the money invariants hold. A backup nobody has restored is a rumour.
#
#   BACKUP_PASSPHRASE=... scripts/restore-check.sh <archive.dump.gpg> <scratch-db-url>
#
# The scratch URL is TRUNCATED and rewritten. Never point it at anything real.

set -euo pipefail

# Newest client by path: pg_restore rejects an archive newer than itself.
. "$(dirname "${BASH_SOURCE[0]}")/lib/pg-client.sh"

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

if [[ -z "${PG_RESTORE:-}" || -z "${PSQL:-}" ]]; then
  echo "restore: pg_restore or psql not found — install a PostgreSQL client" >&2
  exit 1
fi
echo "restore: using $PG_RESTORE ($("$PG_RESTORE" --version))"

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
"$PSQL" "$SCRATCH_URL" --quiet --set ON_ERROR_STOP=1 \
  -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'

echo "restore: restoring"
# --no-owner: the dump's role does not exist here. Exit code is checked below
# rather than by set -e, because pg_restore warns on things that are fine.
"$PG_RESTORE" \
  --dbname="$SCRATCH_URL" \
  --no-owner \
  --no-acl \
  --exit-on-error \
  --jobs=4 \
  "$PLAIN"

ELAPSED=$(( $(date -u +%s) - START ))
echo "restore: completed in ${ELAPSED}s"

echo
# Only the `public` schema (a Neon branch also carries Neon's own auth tables).
echo "restore: row counts"
"$PSQL" "$SCRATCH_URL" --quiet --set ON_ERROR_STOP=1 -P pager=off <<'SQL'
SELECT schemaname AS schema, relname AS table, n_live_tup AS approx_rows
FROM pg_stat_user_tables
ORDER BY schemaname, relname;
SQL

echo
echo "restore: integrity checks"
"$PSQL" "$SCRATCH_URL" --quiet --set ON_ERROR_STOP=1 -P pager=off <<'SQL'
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

  -- A posting belongs to a person, and the account is keyed on that person
  -- (ADR-044). There is no accountId column any more: it was NOT NULL, always
  -- equal to the userId beside it, and this check outlived it by one migration.
  SELECT count(*) INTO bad FROM transactions t
  LEFT JOIN accounts a ON a."userId" = t."userId"
  WHERE a."userId" IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION '% posting(s) whose owner has no account', bad;
  END IF;

  SELECT count(*) INTO bad FROM documents d
  LEFT JOIN users u ON u.id = d."userId"
  WHERE u.id IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION '% document(s) reference a missing person', bad;
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
