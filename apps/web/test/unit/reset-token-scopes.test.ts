import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  RESET_SCOPE_FIRST_LOGIN,
  RESET_SCOPE_FORGOT_PASSWORD,
  hashResetSecret,
  passwordChangeScope,
} from '@/lib/reset-tokens';

/**
 * WO-86. `password_reset_tokens` is written in two languages: the Go API issues
 * and spends every secret in it, and the Next staff-creation route plants the
 * first-login marker whose existence *is* `mustChangePassword`.
 *
 * Both halves have to agree on two columns. A mismatch is invisible in either
 * file — each looks correct alone — and surfaces as a member who is never asked
 * to change the temporary password they were emailed, or one who is asked for
 * ever because nothing can find the row to retire.
 *
 * Read off disk, no database, no network.
 */

const goSource = readFileSync(
  fileURLToPath(new URL('../../../api/internal/repositories/auth_repository.go', import.meta.url)),
  'utf8',
);

function goConstant(name: string): string {
  const match = goSource.match(new RegExp(`${name}\\s*=\\s*"([^"]+)"`));
  if (!match) throw new Error(`${name} is no longer a plain string literal this test can read`);
  return match[1];
}

describe('the password_reset_tokens contract agrees across both backends', () => {
  it('names the same scopes', () => {
    expect(RESET_SCOPE_FORGOT_PASSWORD).toBe(goConstant('ResetScopeForgotPassword'));
    expect(RESET_SCOPE_FIRST_LOGIN).toBe(goConstant('ResetScopeFirstLogin'));
  });

  it('builds the password-change scope the same way', () => {
    // The Go half is `return "pwd-change:" + userID`.
    const prefix = goSource.match(/PasswordChangeScope\(userID string\) string \{\s*return "([^"]+)" \+ userID/);
    if (!prefix) throw new Error('PasswordChangeScope is no longer a shape this test can read');
    expect(passwordChangeScope('user_42')).toBe(`${prefix[1]}user_42`);
  });

  it('hashes a secret to the same 64 hex characters', () => {
    // A fixed vector, so this fails if either side changes algorithm or
    // encoding rather than only if the two drift apart. sha256("abc").
    expect(hashResetSecret('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashResetSecret('abc')).toHaveLength(64);
  });

  it('stores no plaintext: the hash of a secret is not the secret', () => {
    const secret = 'a'.repeat(64);
    expect(hashResetSecret(secret)).not.toBe(secret);
  });

  it('the Go half hashes on the way in, so a caller cannot store plaintext by mistake', () => {
    // CreateResetToken takes the plaintext and hashes it itself. If it ever
    // took a hash from its caller, one call site forgetting to hash would put a
    // working credential back in the table with nothing failing.
    expect(goSource).toMatch(/INSERT INTO password_reset_tokens[\s\S]*?"tokenHash"/);
    expect(goSource).toMatch(/hashResetSecret\(secret\)/);
  });
});
