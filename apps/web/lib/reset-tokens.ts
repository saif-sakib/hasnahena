import crypto from 'crypto';

/**
 * The password_reset_tokens contract for the half Next writes (staff
 * first-login markers). Must match auth_repository.go (reset-token-scopes.test.ts).
 * Secrets are SHA-256; the purpose is the `scope` column (WO-86).
 */

/** A "forgot password" link. */
export const RESET_SCOPE_FORGOT_PASSWORD = 'reset';

/** An account still on its temporary password; its existence IS mustChangePassword. */
export const RESET_SCOPE_FIRST_LOGIN = 'first-login';

/** The bucket for a signed-in member's emailed password-change code. */
export function passwordChangeScope(userId: string): string {
  return `pwd-change:${userId}`;
}

/** SHA-256, hex — byte-for-byte what `hashResetSecret` computes in Go. */
export function hashResetSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}
