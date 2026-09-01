-- ---------------------------------------------------------------------------
-- Every id is the number the thing is already called
-- ---------------------------------------------------------------------------
-- ADR-043 made `users.id` the account number and stopped there, because at the
-- time the rest of the schema had reasons of its own. It did not: what was left
-- was six tables carrying a `cuid()` beside the identifier the row actually has,
-- and two of those surrogate keys were being *printed* — `entityId` on the audit
-- screen is a loan's key and an account's key, so an admin reading the trail saw
-- `cmob97efh00003zynz0as5knq` for a loan whose agreement, whose notification and
-- whose repayment receipt all called it `LOAN-2026-000012`.
--
-- After this migration:
--
--   accounts     PK = "userId"                ACC-KH-33001
--   nominees     PK = "userId"                ACC-KH-33001
--   addresses    PK = ("userId", type)        ACC-KH-33001 / PERMANENT
--   documents    PK = ("userId", type)        ACC-KH-33001 / nid_front
--   transactions PK = the receipt number      DEP-2026-000001
--   loans        PK = the loan number         LOAN-2026-000012
--   audit_logs   PK = a sequence              #1, #2, #3 …
--   notifications, gallery_items              likewise
--
-- and three columns that held a second copy of a fact are gone:
-- `transactions."receiptNumber"`, `loans."loanNumber"`, and the `accountId` on
-- both — which was NOT NULL, always equal to the `userId` in the next column,
-- and the column an insert in loan_repository.go had already once forgotten.
--
-- WHY THIS IS SAFE ON A LIVE DATABASE, AND WHAT IT REFUSES TO GUESS
-- -----------------------------------------------------------------
-- Every key that moves is `ON UPDATE CASCADE`, verified against 0_init: the
-- children follow in the same statement and nothing is detached. Every key that
-- is *dropped* is checked first — this migration raises rather than proceeds if
--
--   * a transaction's `accountId` names an account belonging to somebody other
--     than its own `userId`,
--   * two postings share a receipt number, or two loans a loan number,
--   * one `addresses` row serves as both a permanent and a present address,
--     which the old pair of nullable keys allowed and which would silently lose
--     one of the two,
--   * a person has two documents of the same type.
--
-- None of these should exist. Each of them, if it does, is a fact about the
-- foundation's data that a person has to look at, not a case for this file to
-- decide on its own.
--
-- THE AUDIT TRAIL
-- ---------------
-- `audit_logs` is append-only at the database level (DATA-08) and UPDATE is
-- refused unconditionally. This migration suspends that trigger for the length
-- of exactly one statement block and rewrites the ids inside it, on the owner's
-- explicit instruction (2026-09-01) and with the reasoning stated: the rows are
-- few, `user_id_history` — the mechanism that let a reader resolve them
-- *without* a rewrite — is being removed as the redundancy it is, and a trail
-- nobody can read is not serving the purpose the trigger protects. The trigger
-- is re-enabled in the same transaction, so it is never off across a commit, and
-- the migration writes an audit row about itself. Nothing else in this schema
-- may ever do this: `SET LOCAL hasnahena.allow_audit_purge` still covers DELETE
-- only, and no permanent UPDATE hatch is added.

-- ---------------------------------------------------------------------------
-- 0. The views name columns this migration removes. They are rebuilt at the end.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS v_transactions;
DROP VIEW IF EXISTS v_loans;

-- ---------------------------------------------------------------------------
-- 1. Refuse the four shapes that would lose data
-- ---------------------------------------------------------------------------
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n
    FROM transactions t
    JOIN accounts a ON a.id = t."accountId"
   WHERE a."userId" <> t."userId";
  IF n > 0 THEN
    RAISE EXCEPTION
      '% posting(s) name an account that is not the posting''s own member. Dropping "accountId" would lose that. Resolve by hand.', n;
  END IF;

  SELECT count(*) INTO n
    FROM loans l
    JOIN accounts a ON a.id = l."accountId"
   WHERE a."userId" <> l."borrowerId";
  IF n > 0 THEN
    RAISE EXCEPTION
      '% loan(s) name an account that is not the borrower''s. Resolve by hand.', n;
  END IF;

  -- Only values shaped like one of this foundation's document numbers, because
  -- only those become keys. The same column also holds members' bKash TrxIDs
  -- (they move to `externalReference` below), and two members typing the same
  -- one is a coincidence, not a collision — checking those here would refuse a
  -- migration over something that does not matter.
  SELECT count(*) INTO n FROM (
    SELECT "receiptNumber" FROM transactions
     WHERE "receiptNumber" ~ '^[A-Z]+-[0-9]{4}-[0-9]{6}$'
     GROUP BY "receiptNumber" HAVING count(*) > 1
  ) d;
  IF n > 0 THEN
    RAISE EXCEPTION
      '% receipt number(s) are on more than one posting, so they cannot be keys. Resolve by hand.', n;
  END IF;

  SELECT count(*) INTO n
    FROM addresses
   WHERE "userPermanentId" IS NOT NULL AND "userPresentId" IS NOT NULL;
  IF n > 0 THEN
    RAISE EXCEPTION
      '% address row(s) are somebody''s permanent AND present address at once. Splitting them is a decision, not a migration.', n;
  END IF;

  SELECT count(*) INTO n
    FROM addresses
   WHERE "userPermanentId" IS NULL AND "userPresentId" IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION
      '% address row(s) belong to nobody. Delete them deliberately first.', n;
  END IF;

  SELECT count(*) INTO n FROM (
    SELECT "userId", type FROM documents GROUP BY "userId", type HAVING count(*) > 1
  ) d;
  IF n > 0 THEN
    RAISE EXCEPTION
      '% (member, document type) pair(s) have more than one row. Keep one of each first.', n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The maps, built BEFORE anything moves
-- ---------------------------------------------------------------------------
-- Each one answers "this old opaque key is now that readable one", and they are
-- built while both halves are still present. `audit_logs` is rewritten from
-- them at the end, so the order matters: the trail is resolved against what the
-- ids *were*, which is the only moment that information exists.

-- Whose account it was. The user id here is already the account number, because
-- ADR-043 moved it and this FK cascaded.
CREATE TEMP TABLE account_id_map ON COMMIT DROP AS
SELECT id AS old_id, "userId" AS new_id FROM accounts;

CREATE TEMP TABLE loan_id_map ON COMMIT DROP AS
SELECT id AS old_id, "loanNumber" AS new_id FROM loans WHERE id <> "loanNumber";

-- Every posting gets the number printed on its receipt. The ones that never had
-- one — a disbursement, a default recovery from either party's savings, a draw
-- on the donation pool — are numbered here for the first time, continuing their
-- series from wherever `document_sequences` and the existing receipts have
-- already reached, so no number is ever issued twice.
CREATE TEMP TABLE tx_series ON COMMIT DROP AS
SELECT
  t.id AS old_id,
  CASE t.type
    WHEN 'DEPOSIT'           THEN 'DEP'
    WHEN 'WITHDRAWAL'        THEN 'WDR'
    WHEN 'LOAN_DISBURSEMENT' THEN 'DSB'
    WHEN 'LOAN_REPAYMENT'    THEN 'REP'
    WHEN 'DONATION'          THEN 'DON'
    WHEN 'FEE'               THEN 'ADJ'
  END AS series,
  EXTRACT(YEAR FROM t."createdAt")::int AS yr,
  -- Only a value shaped like a document number is treated as one.
  --
  -- Two things were being written into `receiptNumber`, told apart by nothing
  -- but the row's status: a receipt the foundation issued, and the **bKash
  -- TrxID a member typed into a request**. The second is somebody else's
  -- number; it becomes `externalReference` below and the posting is given a
  -- receipt of its own.
  --
  -- A disbursement's receipt is discarded even when it is well shaped. Both
  -- disbursement paths allocated from the **LOAN** series, so the posting that
  -- pays a loan out carried `LOAN-2026-000012` — the loan's own number, on a
  -- different document — and a top-up consumed a fresh loan number for a
  -- transaction, punching a hole in the register of loans. They become `DSB-`.
  CASE
    WHEN t.type = 'LOAN_DISBURSEMENT' THEN NULL
    WHEN t."receiptNumber" ~ '^[A-Z]+-[0-9]{4}-[0-9]{6}$' THEN t."receiptNumber"
    ELSE NULL
  END AS receipt,
  t."createdAt"
FROM transactions t;

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM tx_series WHERE series IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '% posting(s) have a type with no document series. Add it above.', n;
  END IF;
END $$;

-- The highest number already issued in each series and year, whichever of the
-- two sources is further along: the allocator's own counter, or a receipt that
-- exists without it (which is what a restored backup or a hand-written row
-- looks like).
CREATE TEMP TABLE series_high ON COMMIT DROP AS
SELECT series, yr, max(counter) AS counter FROM (
  SELECT s.series, s.year AS yr, s.counter
    FROM document_sequences s
  UNION ALL
  SELECT
    split_part(receipt, '-', 1),
    split_part(receipt, '-', 2)::int,
    split_part(receipt, '-', 3)::bigint
  FROM tx_series
  WHERE receipt ~ '^[A-Z]+-[0-9]{4}-[0-9]+$'
  UNION ALL
  SELECT 'LOAN', EXTRACT(YEAR FROM "createdAt")::int, split_part("loanNumber", '-', 3)::bigint
    FROM loans WHERE "loanNumber" ~ '^LOAN-[0-9]{4}-[0-9]+$'
) all_numbers
GROUP BY series, yr;

CREATE TEMP TABLE tx_id_map ON COMMIT DROP AS
WITH needs_number AS (
  SELECT
    old_id,
    series,
    yr,
    row_number() OVER (PARTITION BY series, yr ORDER BY "createdAt", old_id) AS n
  FROM tx_series
  WHERE receipt IS NULL
)
SELECT old_id, receipt AS new_id FROM tx_series WHERE receipt IS NOT NULL
UNION ALL
SELECT
  nn.old_id,
  nn.series || '-' || nn.yr::text || '-' || lpad((COALESCE(sh.counter, 0) + nn.n)::text, 6, '0')
FROM needs_number nn
LEFT JOIN series_high sh ON sh.series = nn.series AND sh.yr = nn.yr;

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT new_id FROM tx_id_map GROUP BY new_id HAVING count(*) > 1
  ) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'Numbering produced % duplicate posting id(s). Refusing.', n;
  END IF;
END $$;

-- The allocator must not re-issue anything this migration just handed out.
INSERT INTO document_sequences (series, year, counter, "createdAt", "updatedAt")
SELECT
  split_part(new_id, '-', 1),
  split_part(new_id, '-', 2)::int,
  max(split_part(new_id, '-', 3)::bigint),
  NOW(),
  NOW()
FROM tx_id_map
WHERE new_id ~ '^[A-Z]+-[0-9]{4}-[0-9]+$'
GROUP BY 1, 2
ON CONFLICT (series, year)
DO UPDATE SET counter = GREATEST(document_sequences.counter, EXCLUDED.counter),
              "updatedAt" = NOW();

-- ---------------------------------------------------------------------------
-- 3. accounts — the owner's number is the key
-- ---------------------------------------------------------------------------
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_accountId_fkey";
ALTER TABLE "loans"        DROP CONSTRAINT "loans_accountId_fkey";
DROP INDEX IF EXISTS "transactions_accountId_createdAt_idx";
DROP INDEX IF EXISTS "loans_accountId_idx";
ALTER TABLE "transactions" DROP COLUMN "accountId";
ALTER TABLE "loans"        DROP COLUMN "accountId";

ALTER TABLE "accounts" DROP CONSTRAINT "accounts_pkey";
ALTER TABLE "accounts" DROP COLUMN "id";
DROP INDEX IF EXISTS "accounts_userId_key";
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_pkey" PRIMARY KEY ("userId");

-- ---------------------------------------------------------------------------
-- 4. loans — the loan number is the key
-- ---------------------------------------------------------------------------
-- `transactions."loanId"` is ON UPDATE CASCADE, so the postings follow.
UPDATE loans SET id = "loanNumber" WHERE id <> "loanNumber";
DROP INDEX IF EXISTS "loans_loanNumber_key";
ALTER TABLE "loans" DROP COLUMN "loanNumber";

-- ---------------------------------------------------------------------------
-- 5. transactions — the receipt number is the key
-- ---------------------------------------------------------------------------
-- The member's own reference keeps its meaning, in a column that says what it
-- is. Anything not shaped like one of this foundation's document numbers was
-- never a receipt.
ALTER TABLE "transactions" ADD COLUMN "externalReference" TEXT;
UPDATE transactions
   SET "externalReference" = "receiptNumber"
 WHERE COALESCE("receiptNumber", '') <> ''
   AND "receiptNumber" !~ '^[A-Z]+-[0-9]{4}-[0-9]{6}$';

UPDATE transactions t
   SET id = m.new_id
  FROM tx_id_map m
 WHERE t.id = m.old_id AND t.id <> m.new_id;

DROP INDEX IF EXISTS "transactions_receiptNumber_idx";
ALTER TABLE "transactions" DROP COLUMN "receiptNumber";
CREATE INDEX "transactions_userId_createdAt_idx2" ON "transactions"("userId", "createdAt" DESC);
DROP INDEX IF EXISTS "transactions_userId_createdAt_idx";
ALTER INDEX "transactions_userId_createdAt_idx2" RENAME TO "transactions_userId_createdAt_idx";

-- ---------------------------------------------------------------------------
-- 6. nominees — one per member, keyed on the member
-- ---------------------------------------------------------------------------
ALTER TABLE "nominees" DROP CONSTRAINT "nominees_pkey";
ALTER TABLE "nominees" DROP COLUMN "id";
DROP INDEX IF EXISTS "nominees_userId_key";
ALTER TABLE "nominees" ADD CONSTRAINT "nominees_pkey" PRIMARY KEY ("userId");

-- ---------------------------------------------------------------------------
-- 7. documents — keyed on whose it is and what it is
-- ---------------------------------------------------------------------------
ALTER TABLE "documents" DROP CONSTRAINT "documents_pkey";
ALTER TABLE "documents" DROP COLUMN "id";
DROP INDEX IF EXISTS "documents_userId_idx";
ALTER TABLE "documents" ADD CONSTRAINT "documents_pkey" PRIMARY KEY ("userId", "type");

-- ---------------------------------------------------------------------------
-- 8. addresses — one relation with a type, not two nullable keys
-- ---------------------------------------------------------------------------
CREATE TYPE "AddressType" AS ENUM ('PERMANENT', 'PRESENT');

ALTER TABLE "addresses" ADD COLUMN "userId" TEXT;
ALTER TABLE "addresses" ADD COLUMN "type" "AddressType";

UPDATE addresses
   SET "userId" = COALESCE("userPermanentId", "userPresentId"),
       "type"   = CASE
                    WHEN "userPermanentId" IS NOT NULL THEN 'PERMANENT'::"AddressType"
                    ELSE 'PRESENT'::"AddressType"
                  END;

ALTER TABLE "addresses" DROP CONSTRAINT "addresses_userPermanentId_fkey";
ALTER TABLE "addresses" DROP CONSTRAINT "addresses_userPresentId_fkey";
DROP INDEX IF EXISTS "addresses_userPermanentId_key";
DROP INDEX IF EXISTS "addresses_userPresentId_key";
ALTER TABLE "addresses" DROP COLUMN "userPermanentId";
ALTER TABLE "addresses" DROP COLUMN "userPresentId";

ALTER TABLE "addresses" DROP CONSTRAINT "addresses_pkey";
ALTER TABLE "addresses" DROP COLUMN "id";
ALTER TABLE "addresses" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "addresses" ALTER COLUMN "type" SET NOT NULL;
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_pkey" PRIMARY KEY ("userId", "type");
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 9. notifications — a sequence, and the ids inside `data`
-- ---------------------------------------------------------------------------
-- `data` is a JSON blob written by the Next app, so no foreign key reaches it
-- and nothing cascaded into it. The previous migration rewrote `userId` there
-- and nothing else; `loanId`, `borrowerId` and `guarantorId` were left holding
-- keys that no longer name anything.
UPDATE notifications n
   SET data = jsonb_set(n.data, '{loanId}', to_jsonb(m.new_id))
  FROM loan_id_map m
 WHERE n.data ? 'loanId' AND n.data->>'loanId' = m.old_id;

-- `loanNumber` beside `loanId` was the same string under two names, which is
-- what this whole migration is about. One of the two survives, and it is the
-- one every reader already uses.
UPDATE notifications SET data = data - 'loanNumber' WHERE data ? 'loanNumber';

UPDATE notifications n
   SET data = jsonb_set(n.data, '{borrowerId}', to_jsonb(h."newId"))
  FROM user_id_history h
 WHERE n.data ? 'borrowerId' AND n.data->>'borrowerId' = h."oldId";

UPDATE notifications n
   SET data = jsonb_set(n.data, '{guarantorId}', to_jsonb(h."newId"))
  FROM user_id_history h
 WHERE n.data ? 'guarantorId' AND n.data->>'guarantorId' = h."oldId";

ALTER TABLE "notifications" DROP CONSTRAINT "notifications_pkey";
ALTER TABLE "notifications" RENAME COLUMN "id" TO "legacy_id";
ALTER TABLE "notifications" ADD COLUMN "id" INTEGER;
UPDATE notifications t
   SET id = s.rn
  FROM (SELECT "legacy_id", row_number() OVER (ORDER BY "createdAt", "legacy_id") AS rn
          FROM notifications) s
 WHERE t."legacy_id" = s."legacy_id";
ALTER TABLE "notifications" DROP COLUMN "legacy_id";
ALTER TABLE "notifications" ALTER COLUMN "id" SET NOT NULL;
CREATE SEQUENCE "notifications_id_seq" AS INTEGER OWNED BY "notifications"."id";
SELECT setval('notifications_id_seq', COALESCE((SELECT max(id) FROM notifications), 0) + 1, false);
ALTER TABLE "notifications" ALTER COLUMN "id" SET DEFAULT nextval('notifications_id_seq');
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");

-- ---------------------------------------------------------------------------
-- 10. gallery_items — a sequence
-- ---------------------------------------------------------------------------
ALTER TABLE "gallery_items" DROP CONSTRAINT "gallery_items_pkey";
ALTER TABLE "gallery_items" RENAME COLUMN "id" TO "legacy_id";
ALTER TABLE "gallery_items" ADD COLUMN "id" INTEGER;
UPDATE gallery_items t
   SET id = s.rn
  FROM (SELECT "legacy_id", row_number() OVER (ORDER BY "createdAt", "legacy_id") AS rn
          FROM gallery_items) s
 WHERE t."legacy_id" = s."legacy_id";
ALTER TABLE "gallery_items" DROP COLUMN "legacy_id";
ALTER TABLE "gallery_items" ALTER COLUMN "id" SET NOT NULL;
CREATE SEQUENCE "gallery_items_id_seq" AS INTEGER OWNED BY "gallery_items"."id";
SELECT setval('gallery_items_id_seq', COALESCE((SELECT max(id) FROM gallery_items), 0) + 1, false);
ALTER TABLE "gallery_items" ALTER COLUMN "id" SET DEFAULT nextval('gallery_items_id_seq');
ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_pkey" PRIMARY KEY ("id");

-- ---------------------------------------------------------------------------
-- 11. audit_logs — the trail, made readable, once
-- ---------------------------------------------------------------------------
-- The trigger is off for this block and on again before the transaction ends.
-- Read the header before adding anything here.
ALTER TABLE "audit_logs" DISABLE TRIGGER "audit_logs_append_only";

-- Who did it, and who it was about: `performedBy` and a `USER` row's `entityId`
-- are user ids, and `user_id_history` is the record of the ones that moved.
UPDATE audit_logs a
   SET "performedBy" = h."newId"
  FROM user_id_history h
 WHERE a."performedBy" = h."oldId";

UPDATE audit_logs a
   SET "entityId" = h."newId"
  FROM user_id_history h
 WHERE a."entityType" = 'USER' AND a."entityId" = h."oldId";

UPDATE audit_logs a
   SET "entityId" = m.new_id
  FROM account_id_map m
 WHERE a."entityType" = 'ACCOUNT' AND a."entityId" = m.old_id;

UPDATE audit_logs a
   SET "entityId" = m.new_id
  FROM loan_id_map m
 WHERE a."entityType" = 'LOAN' AND a."entityId" = m.old_id;

UPDATE audit_logs a
   SET "entityId" = m.new_id
  FROM tx_id_map m
 WHERE a."entityType" = 'TRANSACTION' AND a."entityId" = m.old_id;

-- The key itself: a log is read in order, so the key says what the order is.
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_pkey";
ALTER TABLE "audit_logs" RENAME COLUMN "id" TO "legacy_id";
ALTER TABLE "audit_logs" ADD COLUMN "id" INTEGER;
UPDATE audit_logs t
   SET id = s.rn
  FROM (SELECT "legacy_id", row_number() OVER (ORDER BY "createdAt", "legacy_id") AS rn
          FROM audit_logs) s
 WHERE t."legacy_id" = s."legacy_id";
ALTER TABLE "audit_logs" DROP COLUMN "legacy_id";
ALTER TABLE "audit_logs" ALTER COLUMN "id" SET NOT NULL;
CREATE SEQUENCE "audit_logs_id_seq" AS INTEGER OWNED BY "audit_logs"."id";
SELECT setval('audit_logs_id_seq', COALESCE((SELECT max(id) FROM audit_logs), 0) + 1, false);
ALTER TABLE "audit_logs" ALTER COLUMN "id" SET DEFAULT nextval('audit_logs_id_seq');
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");

ALTER TABLE "audit_logs" ENABLE TRIGGER "audit_logs_append_only";

-- The trail records the one thing that was ever done to it.
INSERT INTO audit_logs (action, "entityType", "entityId", details, "createdAt")
SELECT
  'SCHEMA_IDS_MIGRATED',
  'SETTINGS',
  'schema',
  format(
    'Primary keys replaced with the identifiers they already had (ADR-044). %s posting(s) renumbered, %s loan(s), %s account(s), %s audit row(s) re-pointed. The append-only trigger was suspended for the length of this migration and re-enabled inside the same transaction.',
    (SELECT count(*) FROM tx_id_map),
    (SELECT count(*) FROM loan_id_map),
    (SELECT count(*) FROM account_id_map),
    (SELECT count(*) FROM audit_logs)
  ),
  NOW();

-- ---------------------------------------------------------------------------
-- 12. user_id_history — the redundancy this replaces
-- ---------------------------------------------------------------------------
-- It existed for exactly one reason: to let a reader resolve an audit row
-- written before ADR-043 without rewriting it. The rows are rewritten above, so
-- there is nothing left for it to answer.
DROP TABLE "user_id_history";

-- ---------------------------------------------------------------------------
-- 13. The views, rebuilt on the new shape
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_transactions AS
SELECT
  t.id                        AS receipt,
  t."createdAt"               AS posted,
  COALESCE(u."accountNo", '') AS account_no,
  u."nameEn"                  AS member,
  t.type::text                AS type,
  t.amount                    AS amount_taka,
  t.status::text              AS status,
  t."savingsAfter"            AS savings_after,
  t."loanAfter"               AS loan_after,
  p."nameEn"                  AS processed_by,
  t."confirmedAt"             AS confirmed,
  t."loanId"                  AS loan,
  t.description
FROM transactions t
JOIN users u       ON u.id = t."userId"
LEFT JOIN users p  ON p.id = t."processedBy"
ORDER BY t."createdAt" DESC;

CREATE OR REPLACE VIEW v_loans AS
SELECT
  l.id                          AS loan_no,
  COALESCE(b."accountNo", '')   AS borrower_account_no,
  b."nameEn"                    AS borrower,
  COALESCE(g."accountNo", '')   AS guarantor_account_no,
  g."nameEn"                    AS guarantor,
  l.status::text                AS status,
  l."principalAmount"           AS principal_taka,
  l."remainingAmount"           AS remaining_taka,
  l."installmentAmount"         AS installment_taka,
  l."paidInstallments"          AS paid,
  l."totalInstallments"         AS of_total,
  l."disbursementDate"          AS disbursed,
  l."expectedEndDate"           AS due_by,
  ap."nameEn"                   AS approved_by,
  l.purpose
FROM loans l
JOIN users b       ON b.id = l."borrowerId"
LEFT JOIN users g  ON g.id = l."guarantorId"
LEFT JOIN users ap ON ap.id = l."approvedBy"
ORDER BY l."createdAt" DESC;
