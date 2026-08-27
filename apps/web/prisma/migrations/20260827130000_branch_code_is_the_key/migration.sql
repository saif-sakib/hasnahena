-- ---------------------------------------------------------------------------
-- The branch's code IS its primary key
-- ---------------------------------------------------------------------------
-- `branches` carried both a `cuid()` id and a unique `code`. Two columns, each
-- uniquely identifying a branch, each required — which is the definition of the
-- redundancy this table was audited for. The code is the one a human uses: it is
-- typed into the admin form, printed beside the office name, and read aloud. The
-- cuid was never used for anything except being the target of one foreign key.
--
-- So the code becomes the key. `users.assignedBranchId` then reads `KH` instead
-- of `cmob97efh00003zynz0as5knq`, in the column an operator is most likely to be
-- squinting at in a database console.
--
-- **This is safe to do here and would not be safe for `users`.** A branch has
-- exactly one inbound foreign key, there are a handful of rows, and no branch id
-- has ever been written into an audit row, a document, a Cloudinary folder or a
-- JWT. A member's id has all four, which is why `users.id` stays a cuid and the
-- `v_*` views exist instead.
--
-- The FK is `ON UPDATE CASCADE` (`20260819120000_block_s_schema`), so changing
-- the parent key rewrites every child reference in the same statement. Nothing
-- has to be detached and reattached, and there is no window in which a member
-- points at an office that does not exist.

-- Guard first. `code` is unique and NOT NULL, so a collision is only possible if
-- a code equals a *different* branch's existing cuid — impossible in practice and
-- catastrophic if assumed. Fail the migration rather than merge two offices.
DO $$
DECLARE clashes int;
BEGIN
  SELECT count(*) INTO clashes
  FROM branches a JOIN branches b ON a.code = b.id AND a.id <> b.id;
  IF clashes > 0 THEN
    RAISE EXCEPTION 'A branch code collides with another branch id; resolve by hand before migrating';
  END IF;
END $$;

UPDATE branches SET id = code WHERE id <> code;

-- `v_people` names `b.code`, and a view depends on the columns it names — the
-- drop below fails while it does. Replaced first, with the same output column
-- name and type, which is what lets CREATE OR REPLACE stand in for a drop and a
-- rebuild. (`pnpm db:migrate:check` cannot see this: Prisma's `migrate diff`
-- does not model views at all, which is why `test/unit/database-views.test.ts`
-- reads them instead — ADR-037.)
CREATE OR REPLACE VIEW v_people AS
SELECT
  COALESCE(u."accountNo", '(not yet issued)') AS account_no,
  u."nameEn"                                  AS name,
  u."nameBn"                                  AS name_bn,
  u.role::text                                AS role,
  u.status::text                              AS status,
  b.id                                        AS branch,
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

-- Drops `branches_code_key` with it: the uniqueness is now the primary key's.
ALTER TABLE "branches" DROP COLUMN "code";
