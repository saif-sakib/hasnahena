-- Phase 1, T-07 — identity uniqueness is scoped to LIVE rows, and a rejected
-- applicant stops being erased in order to free it.
--
-- Owner's ruling, 2026-08-26: "Unique among live members only. Also check for
-- the email and phone number for the same thing. If rejected then with the same
-- email he should be able to reapply if there is not any live member."
--
-- ---------------------------------------------------------------------------
-- What was wrong
-- ---------------------------------------------------------------------------
-- `email` and `phone` were unconditionally unique, so a rejected applicant kept
-- their address reserved for ever. The workaround was to overwrite it at the
-- moment of rejection:
--
--     email = CONCAT('rejected+', id, '@hasnahena.local')
--     phone = CONCAT('rejected-', id)
--
-- That freed the constraint and destroyed the only way of telling the applicant
-- they had been rejected — in the same statement that decided it. The
-- foundation was left holding an application it had turned down and no address
-- to explain it to. Nothing else in the entry path told them either, so a
-- rejected applicant waited for an answer that could never arrive.
--
-- Scoping uniqueness to live rows gets the constraint out of the way without
-- erasing anything, which is what makes the rejection email possible.
--
-- `nidNumber` was not unique at all — the one document proving two applicants
-- are different people, and two members could hold the same one.
--
-- ---------------------------------------------------------------------------
-- The predicate
-- ---------------------------------------------------------------------------
-- A row owns its identifiers unless it is a rejected application:
--
--     role = 'MEMBER' AND status = 'INACTIVE' AND "approvedAt" IS NULL
--       AND "passwordHash" = '__PENDING_APPROVAL_NO_LOGIN__'
--
-- All four conjuncts are load-bearing. `INACTIVE` alone would also match a
-- **deactivated member**, who has a real password hash and an `approvedAt` and
-- must keep their identifiers reserved — freeing those would hand the next
-- person to use that phone number somebody else's account history. An **erased**
-- member (FR-23) keeps `approvedAt` too, and carries an `erased-<id>` phone
-- tombstone besides.
--
-- The same predicate is spelled out in `apps/web/lib/rejected-application.ts`
-- and in `RejectedApplicationSQL` in the Go API. `rejected-application.test.ts`
-- reads all three and fails when they drift: an index predicate narrower than
-- the query's is a duplicate nobody refused, and wider is a genuine applicant
-- told their own email is taken.
--
-- IMPORTANT: like the `lower(email)` index this replaces and the `audit_logs`
-- trigger, **`prisma migrate diff` cannot see a partial index**. It compares the
-- objects Prisma can model, and Prisma can model neither the predicate nor the
-- expression. So `pnpm db:migrate:check` will not report these as drift and a
-- `--from-empty` baseline would drop them silently. The list of such objects is
-- kept in docs/data-model.md.

-- ---------------------------------------------------------------------------
-- 1. Restore any applicant whose details were scrambled by the old behaviour
-- ---------------------------------------------------------------------------
-- Deliberately NOT attempted. `rejected+<id>@hasnahena.local` does not contain
-- the address it replaced — the original was overwritten in place and never
-- recorded anywhere, including the audit row, which stores only the reason.
-- Those applicants are unreachable and this migration cannot change that; it
-- can only stop it happening to the next one.

-- ---------------------------------------------------------------------------
-- 2. Refuse to run if the data would violate the new constraints
-- ---------------------------------------------------------------------------
-- Creating a unique index over duplicate rows fails with a message naming the
-- index and nothing else. These checks fail earlier and say what to fix, for
-- the same reason the WO-90 migration normalised case before constraining:
-- merging two members is a decision with money in it, not one a migration may
-- take on its own.
DO $$
DECLARE
  duplicate_count integer;
  sample text;
BEGIN
  SELECT count(*), min(lower(email)) INTO duplicate_count, sample
  FROM (
    SELECT lower(email) AS email
    FROM users
    WHERE email IS NOT NULL
      AND NOT (role = 'MEMBER' AND status = 'INACTIVE' AND "approvedAt" IS NULL
               AND "passwordHash" = '__PENDING_APPROVAL_NO_LOGIN__')
    GROUP BY lower(email)
    HAVING count(*) > 1
  ) d;
  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'live email uniqueness: % address(es) are held by more than one live row (e.g. %). Merge or erase before migrating.', duplicate_count, sample;
  END IF;

  SELECT count(*), min(phone) INTO duplicate_count, sample
  FROM (
    SELECT phone
    FROM users
    WHERE NOT (role = 'MEMBER' AND status = 'INACTIVE' AND "approvedAt" IS NULL
               AND "passwordHash" = '__PENDING_APPROVAL_NO_LOGIN__')
    GROUP BY phone
    HAVING count(*) > 1
  ) d;
  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'live phone uniqueness: % number(s) are held by more than one live row (e.g. %). Merge or erase before migrating.', duplicate_count, sample;
  END IF;

  -- NID has never been constrained, so this is the one that may genuinely find
  -- something. It reports rather than repairs: two members sharing an NID is
  -- either one person with two accounts or a typo, and both need a human.
  SELECT count(*), min("nidNumber") INTO duplicate_count, sample
  FROM (
    SELECT "nidNumber"
    FROM users
    WHERE "nidNumber" IS NOT NULL AND btrim("nidNumber") <> ''
      AND NOT (role = 'MEMBER' AND status = 'INACTIVE' AND "approvedAt" IS NULL
               AND "passwordHash" = '__PENDING_APPROVAL_NO_LOGIN__')
    GROUP BY "nidNumber"
    HAVING count(*) > 1
  ) d;
  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'live NID uniqueness: % NID(s) are held by more than one live row (e.g. %). One person with two accounts, or a mistyped digit — both need deciding before migrating.', duplicate_count, sample;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Replace the unconditional indexes with live-scoped ones
-- ---------------------------------------------------------------------------
-- `users_email_key` and `users_phone_key` are Prisma's, from `@unique`. Those
-- attributes are removed from schema.prisma in the same commit, so the schema
-- and the database still agree afterwards.
DROP INDEX IF EXISTS "users_email_key";
DROP INDEX IF EXISTS "users_email_lower_key";
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_email_key";

DROP INDEX IF EXISTS "users_phone_key";
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_phone_key";

-- Case-insensitive, as `users_email_lower_key` was (WO-90): `Saif@x.com` and
-- `saif@x.com` are one person, and both write paths lowercase already — this is
-- the constraint that stops the next write path from forgetting.
CREATE UNIQUE INDEX "users_email_live_key" ON "users" (lower("email"))
WHERE "email" IS NOT NULL
  AND NOT (role = 'MEMBER' AND status = 'INACTIVE' AND "approvedAt" IS NULL
           AND "passwordHash" = '__PENDING_APPROVAL_NO_LOGIN__');

CREATE UNIQUE INDEX "users_phone_live_key" ON "users" ("phone")
WHERE NOT (role = 'MEMBER' AND status = 'INACTIVE' AND "approvedAt" IS NULL
           AND "passwordHash" = '__PENDING_APPROVAL_NO_LOGIN__');

-- Blank NIDs are exempt as well as NULL ones: `normalizeOptionalString` in the
-- registration route can write an empty string, and several members legitimately
-- have no NID recorded.
CREATE UNIQUE INDEX "users_nid_live_key" ON "users" ("nidNumber")
WHERE "nidNumber" IS NOT NULL AND btrim("nidNumber") <> ''
  AND NOT (role = 'MEMBER' AND status = 'INACTIVE' AND "approvedAt" IS NULL
           AND "passwordHash" = '__PENDING_APPROVAL_NO_LOGIN__');

-- ---------------------------------------------------------------------------
-- 4. A non-unique lookup index for the rows the partial indexes exclude
-- ---------------------------------------------------------------------------
-- Login, the availability check and re-registration all look up by email or
-- phone and now have to *exclude* rejected rows. The partial unique indexes
-- above cannot serve those lookups for the excluded rows, and re-registration
-- reads exactly those.
CREATE INDEX IF NOT EXISTS "users_email_lookup_idx" ON "users" (lower("email"));
-- Named the way Prisma names an `@@index([phone])`, because it is declared as
-- one in schema.prisma. Prisma *can* model a plain single-column index, so a
-- differently-named one is reported as drift by `pnpm db:migrate:check` on
-- every run — unlike the expression and partial indexes above, which it
-- cannot see at all.
CREATE INDEX IF NOT EXISTS "users_phone_idx" ON "users" ("phone");

-- ---------------------------------------------------------------------------
-- 5. The rejection reason, kept where it can be shown and re-sent
-- ---------------------------------------------------------------------------
-- The reason existed only in `audit_logs.details`, which is append-only and not
-- readable by any screen — and the admin UI sent an empty string anyway, so
-- FR-05's "with reason" was never met on the reject side. These columns let the
-- approvals screen show a rejected application with its reason, and let the
-- rejection email quote it.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "rejectionReasonCode" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "rejectionReasonNote" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMP(3);

-- The retention sweep (ADR-033) clears a rejected applicant's identity after
-- `security.rejectedRetentionDays`. The decision is permanent; the free-text
-- note is not, because an admin may have typed identifying detail into it.
-- `retention_repository.go` clears it alongside the NID and the addresses.

-- ---------------------------------------------------------------------------
-- 6. The language the applicant applied in
-- ---------------------------------------------------------------------------
-- The approval email's language was the *admin's* dashboard locale, passed up
-- from the approvals screen. A Bengali applicant approved by an admin working
-- in English received their temporary password in English. The applicant's own
-- language was known when they filled in the form and was discarded.
--
-- Nullable: every existing member predates this and falls back to the old
-- behaviour rather than being guessed at.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferredLocale" TEXT;
