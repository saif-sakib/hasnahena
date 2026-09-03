# ADR-031 — A password reset is one transaction, and the table behind it holds no secrets

**Status:** accepted · WO-85, WO-86, WO-87 (2026-08-24).

Three defects shared one cause: `password_reset_tokens` and the password write
were treated as bookkeeping rather than as the credential path they are.

**1. The reset did not revoke anything.** Token revocation is built, wired and
enforced on both backends — `services.IsUserTokensRevoked` and
`apps/web/lib/auth-revocation.ts` — and it was called from the *logged-in*
password change and not from the forgot-password reset. That is the wrong way
round. The logged-in change is made by someone who still controls the account;
the reset is the path a member reaches **because they cannot get in**, which
includes "somebody else is using my account". A member whose password was stolen
did the only thing available to them and left the attacker signed in for up to 24
hours, with nothing telling them it had not worked.

**2. The table was a set of working credentials.** `token` held the raw secret
from the email and the lookup was `WHERE token = $1`. Anything that could read
one row — a backup, the Neon console, a support screenshot, an injection
anywhere in either backend — could take over the account. `token_blacklist` has
stored `sha256(token)` since SEC-01 and says why in the schema comment; reset
tokens simply never got the same treatment.

**3. One reset could set two accounts' passwords.**
`UPDATE users SET "passwordHash" = $1 WHERE email = $2 OR phone = $3`, with no
row-count check. When the email on a token belonged to one row and the phone to
another — reachable through a rejection tombstone, an admin phone edit, or any
contact change — it reset a stranger's password to the requester's. Zero rows
returned `nil`, so the API answered "password reset" to a member whose password
had not changed.

**Decision.**

1. **One method, one transaction.** `UserRepository.CompletePasswordReset` spends
   the link, writes the hash, retires the first-login marker and writes the
   revocation marker, or none of them happens. The password write is scoped to
   `id` and must affect exactly one row; spending the link requires exactly one
   row with `"usedAt" IS NULL`, which is what makes it single-use under
   concurrency rather than only in the happy path.
2. **The secret is hashed on the way in.** `CreateResetToken` takes the plaintext
   and hashes it itself, so no call site can store a secret by forgetting to.
   SHA-256, not bcrypt: the forgot-password secret is 32 bytes from
   `crypto/rand`, the lookup is *by* the hash, and a per-row salt would make that
   a table scan.
3. **The purpose moved to a `scope` column.** A hash has no prefix, so
   `first-login-…` and `pwd-change:<userId>:…` could not survive as conventions
   on the secret. Uniqueness is `(scope, tokenHash)` rather than the hash alone,
   because a `pwd-change` secret is six digits and two members can hold the same
   one.
4. **The revoke-all *write* lives in `repositories`.** It has to run inside a
   password's transaction, `services` imports `repositories` and not the reverse,
   and two copies of one INSERT is the shape that disagrees eventually. The read
   side stays in `SecurityService`.
5. **The marker's lifetime is derived from `JWT_EXPIRY_SECONDS`.** It was
   `INTERVAL '24 hours'`, which is exactly that variable's default and was safe
   only by coincidence. Raising the variable past 86400 would have brought
   revoked tokens back to life, silently, on both backends at once.

**Consequences.**

- The migration deletes `reset` and `pwd-change` rows and **migrates**
  `first-login` rows in place. WO-86 said to delete everything on the grounds
  that plaintext cannot be recovered from a hash; nothing needs recovering —
  hashing runs forward from the column — and deleting the first-login markers
  would have switched off `mustChangePassword` for every already-approved member
  with no message anywhere.
- Both languages write this table, so `apps/web/lib/reset-tokens.ts` holds the
  Next half and `test/unit/reset-token-scopes.test.ts` reads the Go source and
  fails if either side moves.
- Retiring the first-login marker belongs to the reset now. It used to happen as
  a side effect of `ForgotPassword` deleting every row for the address, so asking
  for a link and never clicking it cleared the forced password change.

---

[← all decisions](../decisions.md)
