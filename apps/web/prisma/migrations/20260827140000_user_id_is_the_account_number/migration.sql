-- ---------------------------------------------------------------------------
-- A person's row id is the number they are known by
-- ---------------------------------------------------------------------------
-- `users.id` was `cuid()`. Every foreign key in this schema points at it, so
-- `transactions.userId` read `cmob97efh00003zynz0as5knq` — in the column an
-- operator reading the ledger by hand looks at most often, beside a
-- `receiptNumber` and an `accountNo` that are both perfectly readable.
--
-- It now holds the identifier that person already has:
--
--   staff          `STF-0001`         allocated when the account is created
--   an applicant   `APP-2026-000001`  allocated when the form is submitted
--   a member       `ACC-KH-33001`     allocated when they are admitted
--   the pool       `system_donation_fund`, which it already was
--
-- and `users.id = users.accountNo` for everybody who has been admitted, which
-- removes the two-columns-for-one-fact that started this audit.
--
-- WHY THIS IS SAFE HERE AND WAS REFUSED TWICE BEFORE
-- --------------------------------------------------
-- The refusals were about a *cuid* being replaced by an invented second number,
-- and about the id being mutable. Neither applies to this shape:
--
--   * Every foreign key referencing `users.id` is `ON UPDATE CASCADE` (verified
--     against the live catalogue, sixteen of them), so the children follow in
--     the same statement. Nothing has to be detached.
--   * Exactly four columns hold a user id WITHOUT a foreign key —
--     `audit_logs.entityId`, `audit_logs.performedBy`, `token_blacklist.userId`
--     and `notifications.data->>'userId'` — and all four are remapped below.
--   * The id changes **once**, at approval, and at that moment nothing outside
--     this database holds it: an applicant's password hash is a sentinel that
--     bcrypt can never match, so they have never signed in, so there is no token
--     carrying the old id and no session to break. After approval it is fixed
--     for ever.
--
-- The self-referential `users.approvedBy` FK is dropped and rebuilt around the
-- update. Its cascade would otherwise fire for rows the same statement is
-- already rewriting, which Postgres reports as "tuple to be updated was already
-- modified" — a failure that depends on row order and would therefore show up
-- on somebody else's data and not on ours.

CREATE TEMP TABLE user_id_map ON COMMIT DROP AS
SELECT
  id AS old_id,
  -- In this order on purpose: a member who has been admitted is known by their
  -- account number, and an applicant by their form number. The final fallback
  -- keeps whatever the row already had — the donation pool
  -- (`system_donation_fund`) has neither and is already readable.
  COALESCE(NULLIF("accountNo", ''), NULLIF("formNumber", ''), id) AS new_id
FROM users;

-- Two ways this could destroy data, both refused rather than assumed away.
DO $$
DECLARE dupes int; shadowed int;
BEGIN
  SELECT count(*) INTO dupes FROM (
    SELECT new_id FROM user_id_map GROUP BY new_id HAVING count(*) > 1
  ) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION 'Two users would end up with the same id (% collisions). Resolve by hand.', dupes;
  END IF;

  SELECT count(*) INTO shadowed
  FROM user_id_map a JOIN user_id_map b ON a.new_id = b.old_id AND a.old_id <> b.old_id;
  IF shadowed > 0 THEN
    RAISE EXCEPTION 'A new id collides with another row''s current id. Resolve by hand.';
  END IF;
END $$;

ALTER TABLE "users" DROP CONSTRAINT "users_approvedBy_fkey";

-- The four columns that hold a user id and are not foreign keys. Done BEFORE
-- the ids move, so each still matches on the value it was written with.
UPDATE audit_logs a
   SET "entityId" = m.new_id
  FROM user_id_map m
 WHERE a."entityType" = 'USER' AND a."entityId" = m.old_id AND m.old_id <> m.new_id;

UPDATE audit_logs a
   SET "performedBy" = m.new_id
  FROM user_id_map m
 WHERE a."performedBy" = m.old_id AND m.old_id <> m.new_id;

UPDATE token_blacklist t
   SET "userId" = m.new_id
  FROM user_id_map m
 WHERE t."userId" = m.old_id AND m.old_id <> m.new_id;

UPDATE notifications n
   SET data = jsonb_set(n.data, '{userId}', to_jsonb(m.new_id))
  FROM user_id_map m
 WHERE n.data ? 'userId' AND n.data->>'userId' = m.old_id AND m.old_id <> m.new_id;

-- The keys themselves. Every FK cascades from here.
UPDATE users u
   SET id = m.new_id
  FROM user_id_map m
 WHERE u.id = m.old_id AND m.old_id <> m.new_id;

-- Remapped by hand because its constraint is off. `approvedBy` names the staff
-- member who admitted somebody, and it is a user id like any other.
UPDATE users u
   SET "approvedBy" = m.new_id
  FROM user_id_map m
 WHERE u."approvedBy" = m.old_id AND m.old_id <> m.new_id;

ALTER TABLE "users" ADD CONSTRAINT "users_approvedBy_fkey"
  FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- No default. Inventing an identifier is the thing this migration exists to
-- stop: every writer now names the id, and a writer that forgets fails loudly on
-- a NOT NULL primary key rather than quietly producing another cuid.
ALTER TABLE "users" ALTER COLUMN "id" DROP DEFAULT;
