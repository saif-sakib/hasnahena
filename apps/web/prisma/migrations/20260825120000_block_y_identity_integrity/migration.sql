-- Block Y — identity and deletion integrity. WO-90 and WO-92.
--
-- Two constraints the application had been enforcing by convention, moved into
-- the database. Both are cheap now and expensive later: the first gets harder
-- the more rows exist to reconcile, the second gets harder the more deletion
-- paths there are to remember.

-- ---------------------------------------------------------------------------
-- WO-90 — one contact is one account, whatever case it is typed in
-- ---------------------------------------------------------------------------
-- `email String? @unique` is a plain Postgres unique index, so `Saif@x.com` and
-- `saif@x.com` are two rows. Both application write paths lowercase first
-- (`registrations/route.ts`, `admin/workers/route.ts`), so nothing creates a
-- collision *today* — but that is a convention doing a constraint's job. A seed
-- script, a support fix applied by hand, or the next creation path someone adds
-- re-opens it, and the resulting duplicate is permanent and invisible: two
-- accounts, two savings balances, one person.
--
-- Normalise first, then constrain. If two rows differ only in case, the UPDATE
-- below fails on the existing `users_email_key` and this migration stops — which
-- is the correct outcome. Merging two members' accounts is a decision with money
-- in it, and it is not one a migration may make on its own.
UPDATE "users" SET "email" = lower("email") WHERE "email" IS NOT NULL AND "email" <> lower("email");

-- NULL emails are exempt, as they are under the existing unique index: a member
-- with no email address is normal here, and several may exist at once.
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" (lower("email"));

-- IMPORTANT: `prisma migrate diff` cannot see an expression index — it compares
-- the objects Prisma can model, and Prisma cannot express `lower(email)`. So
-- `pnpm db:migrate:check` will not report this as drift and a future
-- `--from-empty` baseline would drop it silently. That list is now: the
-- audit_logs immutability trigger, the money CHECK constraints, and this.
-- It is documented on the field in schema.prisma for the same reason.

-- ---------------------------------------------------------------------------
-- WO-92 — notifications.targetUserId becomes a real foreign key
-- ---------------------------------------------------------------------------
-- Every other user-owned table declares `onDelete: Cascade`. This column was a
-- bare `String?` with no relation, cleaned up by hand in exactly one place (the
-- worker DELETE) and left behind by every other deletion path.
--
-- Orphans are the small half. A notification is read *by target id*, so an id
-- that names nobody is waste, and an id that is re-used or mis-assigned delivers
-- one member's balance and loan detail to another member's bell icon.
--
-- Any orphan already in the table would block the constraint, and an orphan is
-- by definition a notification with nobody to read it.
DELETE FROM "notifications" n
WHERE n."targetUserId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = n."targetUserId");

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_targetUserId_fkey"
  FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- No new index: `@@index([targetUserId, isRead])` already leads with the column,
-- which is what `foreign-key-indexes.test.ts` requires and what Postgres needs
-- to validate the key without scanning the child table on every parent write.
