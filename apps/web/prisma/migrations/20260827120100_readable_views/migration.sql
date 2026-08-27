-- Read-only views, for reading the database by hand.
--
-- Why these exist
-- ---------------
-- Opening `users`, `transactions` or `loans` in the Neon console shows a wall
-- of `cmob97efh00003zynz0as5knq`. Every join is between two of those, so
-- answering "what did Saif deposit last week" by hand means copying ids between
-- three queries. The tables are right — a primary key that people read aloud is
-- a primary key that gets corrected, and `users.accountNo` is null until an
-- application is approved, so it cannot be one (ADR-023, ADR-029). The
-- *ergonomics* are what was missing, and a view is what fixes ergonomics
-- without touching a key.
--
-- These are the only place in this schema where readability outranks
-- normalisation, and they are safe to prefer it because nothing writes through
-- them and no application code reads them. They are for a human with a SQL
-- console.
--
-- Every one of them leads with the identifier a human actually has: an account
-- number, a receipt number, a loan number, a config key.
--
-- One consequence worth knowing: a view depends on the columns it names, so a
-- future migration that renames or drops one fails until the view is updated in
-- the same migration. That is the intended behaviour — it is the same reason
-- foreign keys are declared.

-- Everyone: members, workers and admins, with the balances and the office.
CREATE OR REPLACE VIEW v_people AS
SELECT
  COALESCE(u."accountNo", '(not yet issued)') AS account_no,
  u."nameEn"                                  AS name,
  u."nameBn"                                  AS name_bn,
  u.role::text                                AS role,
  u.status::text                              AS status,
  b.code                                      AS branch,
  COALESCE(a."savingsBalance", 0)             AS savings_taka,
  COALESCE(a."loanBalance", 0)                AS loan_taka,
  u.phone,
  u.email,
  u."createdAt"                               AS joined,
  u."approvedAt"                              AS approved,
  u.id                                        AS user_id
FROM users u
LEFT JOIN accounts a ON a."userId" = u.id
LEFT JOIN branches b ON b.id = u."assignedBranchId"
ORDER BY u.role, COALESCE(u."accountNo", 'zzz');

-- Every posting, named by its receipt rather than by its row.
CREATE OR REPLACE VIEW v_transactions AS
SELECT
  COALESCE(t."receiptNumber", '(none)') AS receipt,
  t."createdAt"                         AS posted,
  COALESCE(u."accountNo", '')           AS account_no,
  u."nameEn"                            AS member,
  t.type::text                          AS type,
  t.amount                              AS amount_taka,
  t.status::text                        AS status,
  t."savingsAfter"                      AS savings_after,
  t."loanAfter"                         AS loan_after,
  p."nameEn"                            AS processed_by,
  t."confirmedAt"                       AS confirmed,
  l."loanNumber"                        AS loan,
  t.description,
  t.id                                  AS transaction_id
FROM transactions t
JOIN users u       ON u.id = t."userId"
LEFT JOIN users p  ON p.id = t."processedBy"
LEFT JOIN loans l  ON l.id = t."loanId"
ORDER BY t."createdAt" DESC;

-- Lending, with both people spelled out. Zero interest, so there is no rate
-- column to show and there never will be (rule 3).
CREATE OR REPLACE VIEW v_loans AS
SELECT
  l."loanNumber"                AS loan_no,
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
  l.purpose,
  l.id                          AS loan_id
FROM loans l
JOIN users b       ON b.id = l."borrowerId"
LEFT JOIN users g  ON g.id = l."guarantorId"
LEFT JOIN users ap ON ap.id = l."approvedBy"
ORDER BY l."createdAt" DESC;

-- The audit trail, with the actor named.
--
-- `performedBy` is deliberately not a foreign key: a member with no postings is
-- deleted outright (ADR-033) and their audit rows must survive them, so this
-- join finds nobody for those and says so rather than hiding the row.
CREATE OR REPLACE VIEW v_audit AS
SELECT
  al."createdAt"                                    AS at,
  al.action,
  al."entityType"                                   AS entity,
  al."entityId"                                     AS entity_id,
  COALESCE(u."accountNo", u."nameEn", '(deleted or system)') AS performed_by,
  al.details,
  al."userIp"                                       AS ip
FROM audit_logs al
LEFT JOIN users u ON u.id = al."performedBy"
ORDER BY al."createdAt" DESC;

-- Members waiting on a decision, which is the list an admin most often wants to
-- read straight out of the database.
CREATE OR REPLACE VIEW v_pending_applications AS
SELECT
  u."nameEn"        AS name,
  u.phone,
  u.email,
  u."createdAt"     AS applied,
  u.status::text    AS status,
  u."rejectionReasonCode" AS rejected_because,
  u."rejectedAt"    AS rejected,
  u.id              AS user_id
FROM users u
WHERE u.role = 'MEMBER' AND u."accountNo" IS NULL
ORDER BY u."createdAt" DESC;
