import crypto from 'crypto';

/**
 * The `password_reset_tokens` contract, for the half of it that Next writes.
 *
 * The table is owned by the Go API — it issues and spends every secret in it —
 * but staff creation plants a first-login marker from here, so both languages
 * have to agree on the two columns that identify a row. They do not merely
 * happen to agree: `test/unit/reset-token-scopes.test.ts` reads the Go source
 * and fails if either side moves.
 *
 * The Go half is `apps/api/internal/repositories/auth_repository.go`.
 *
 * WO-86. `token` used to hold the raw secret and the purpose was a prefix on
 * it, matched with LIKE. Anything that could read one row could take over the
 * account it belonged to, so the secret is stored as SHA-256 and the purpose
 * moved into `scope` — a hash has no prefix to match.
 */

/** A "forgot password" link. */
export const RESET_SCOPE_FORGOT_PASSWORD = 'reset';

/**
 * An account that still has the temporary password it was created with.
 * Nothing ever presents one of these: its existence *is* `mustChangePassword`.
 */
export const RESET_SCOPE_FIRST_LOGIN = 'first-login';

/** The bucket for a signed-in member's emailed password-change code. */
export function passwordChangeScope(userId: string): string {
  return `pwd-change:${userId}`;
}

/** SHA-256, hex — byte-for-byte what `hashResetSecret` computes in Go. */
export function hashResetSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}
