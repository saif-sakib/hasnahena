-- Renumber all member IDs to ACC-KH-33001, ACC-KH-33002, ...
-- Run once against your Postgres database before or after deploying the code change.

BEGIN;

WITH numbered AS (
  SELECT
    u.id,
    ROW_NUMBER() OVER (ORDER BY u."createdAt" ASC, u.id ASC) AS seq
  FROM users u
  WHERE u.role = 'MEMBER'
)
UPDATE users u
SET
  "memberId" = 'ACC-KH-33' || LPAD(n.seq::text, 3, '0'),
  "formNumber" = 'FORM-ACC-KH-33' || LPAD(n.seq::text, 3, '0'),
  "updatedAt" = NOW()
FROM numbered n
WHERE u.id = n.id;

UPDATE accounts a
SET
  "accountNumber" = u."memberId",
  "updatedAt" = NOW()
FROM users u
WHERE a."userId" = u.id
  AND u.role = 'MEMBER'
  AND u."memberId" IS NOT NULL
  AND u."memberId" <> '';

COMMIT;
