-- Rename `users."memberId"` to `users."accountNo"`.
--
-- The value, its format (`ACC-KH-33001`) and the advisory-locked allocator
-- behind it are all unchanged. Only the name changes: the identifier a member is
-- given is their account number, and calling it a "member ID" while printing it
-- under a heading that starts with ACC- was the last piece of the confusion
-- ADR-023 set out to remove.
--
-- Hand-written, and it has to be. `prisma migrate diff` cannot see a rename — it
-- sees one column gone and another arrived, and emits DROP COLUMN + ADD COLUMN,
-- which silently discards every member's number. The same trap that made the
-- address and enum migrations hand-written (see 20260819120000_block_s_schema).
--
-- ALTER ... RENAME carries the data, the NOT NULL-ness, the default and the
-- dependent index with it, so there is nothing to back-fill. The unique index is
-- renamed separately only so its name still describes the column it covers;
-- Postgres does not rename it automatically and Prisma's introspection compares
-- index names.
ALTER TABLE "users" RENAME COLUMN "memberId" TO "accountNo";

ALTER INDEX "users_memberId_key" RENAME TO "users_accountNo_key";
