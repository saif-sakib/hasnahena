-- WO-86. `password_reset_tokens.token` held the raw secret from the email, and
-- the lookup matched it with `WHERE token = $1`. For the lifetime of a row, the
-- table was not a set of pointers to credentials — it *was* a set of working
-- credentials, readable from a backup, the Neon console, a support screenshot
-- or any SQL injection in either backend. `token_blacklist.tokenHash` has
-- stored `sha256(token)` for exactly this reason since SEC-01; reset tokens
-- never got the same treatment.
--
-- Two columns replace one:
--
--   scope      what the secret is for. It used to be a prefix on the secret
--              itself ("first-login-…", "pwd-change:<userId>:…") matched with
--              LIKE, and a hash has no prefix, so the purpose has to live in a
--              column of its own before the secret can be hashed.
--   tokenHash  sha256(secret), hex. The plaintext exists only in the email.
--
-- Existing rows
-- -------------
-- Split deliberately, because the two kinds of row are not the same thing.
--
--   Deleted: "reset" links and "pwd-change" codes. Both are live credentials
--   that have existed in plaintext in this table, and both are short-lived (30
--   and 10 minutes). Anything unexpired here was issued minutes ago; the member
--   re-requests and pays one email for it. Migrating them forward would carry a
--   possibly-already-leaked secret past the fix.
--
--   Migrated: "first-login" rows. These are markers, not credentials — nothing
--   ever presents one. Their existence is the whole of `mustChangePassword`
--   (see FindByIdentifier), so deleting them would silently switch off the
--   forced password change for every member already approved and not yet logged
--   in, which is a regression with no message anywhere. The stored plaintext is
--   hashed in place; no secret has to be recovered to do that.

DELETE FROM "password_reset_tokens" WHERE "token" NOT LIKE 'first-login-%';

ALTER TABLE "password_reset_tokens" ADD COLUMN "scope" TEXT;
ALTER TABLE "password_reset_tokens" ADD COLUMN "tokenHash" TEXT;

UPDATE "password_reset_tokens"
SET "scope" = 'first-login',
    -- substring from 13 drops the 12 characters of 'first-login-'.
    "tokenHash" = encode(sha256(substring("token" from 13)::bytea), 'hex');

ALTER TABLE "password_reset_tokens" ALTER COLUMN "scope" SET NOT NULL;
ALTER TABLE "password_reset_tokens" ALTER COLUMN "tokenHash" SET NOT NULL;

DROP INDEX IF EXISTS "password_reset_tokens_token_key";
ALTER TABLE "password_reset_tokens" DROP COLUMN "token";

-- Unique on the pair rather than on the hash alone: a "pwd-change" secret is a
-- 6-digit code, so two members can hold the same one at the same time and the
-- scope (which carries their user id) is what keeps the rows apart.
CREATE UNIQUE INDEX "password_reset_tokens_scope_tokenHash_key"
  ON "password_reset_tokens"("scope", "tokenHash");
