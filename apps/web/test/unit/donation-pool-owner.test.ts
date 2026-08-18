import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * ADR-023. The donation pool is located by its owner's user id, and that id is
 * written down in two places in two languages: `pnpm db:seed` creates the row,
 * and the Go repository locks it.
 *
 * If they ever disagree, nothing fails until the foundation records its first
 * donation — and then it fails as `ErrDonationPoolMissing`, telling an admin to
 * run a seed that has, in fact, already run. That is the same failure DATA-05
 * cost a day on when the account did not exist at all; the difference is that a
 * mismatch would be invisible in both files, each of which looks correct alone.
 *
 * Cheap to check, so it is checked. No database and no network — both files are
 * read off disk.
 */

const seedSource = readFileSync(
  fileURLToPath(new URL('../../scripts/seed.mjs', import.meta.url)),
  'utf8',
);

const goSource = readFileSync(
  fileURLToPath(new URL('../../../api/internal/repositories/transaction_repository.go', import.meta.url)),
  'utf8',
);

const clearSource = readFileSync(
  fileURLToPath(new URL('../../scripts/db-clear-preserve-core.mjs', import.meta.url)),
  'utf8',
);

function jsConstant(source: string, name: string): string {
  const match = source.match(new RegExp(`const ${name}\\s*=\\s*'([^']+)'`));
  if (!match) throw new Error(`${name} is no longer a plain string literal this test can read`);
  return match[1];
}

function goConstant(source: string, name: string): string {
  const match = source.match(new RegExp(`${name}\\s*=\\s*"([^"]+)"`));
  if (!match) throw new Error(`${name} is no longer a plain string literal this test can read`);
  return match[1];
}

describe('the donation pool owner id agrees across the codebase', () => {
  it('the seed and the Go repository name the same owner', () => {
    expect(
      jsConstant(seedSource, 'DONATION_OWNER_ID'),
      'scripts/seed.mjs creates the pool; transaction_repository.go locks it. A mismatch ' +
        'surfaces only when someone records a donation, as "run pnpm db:seed" on a seeded database.',
    ).toBe(goConstant(goSource, 'DonationFundUserID'));
  });

  it('the clear script preserves the same owner', () => {
    // `pnpm db:clear` is meant to leave a *working* environment behind. If it
    // preserves a different id than the one the seed created, it deletes the
    // pool and the next donation fails.
    expect(jsConstant(clearSource, 'DONATION_OWNER_ID')).toBe(
      jsConstant(seedSource, 'DONATION_OWNER_ID'),
    );
  });

  it('reads real values rather than passing on two empty strings', () => {
    expect(jsConstant(seedSource, 'DONATION_OWNER_ID')).toMatch(/\S/);
    expect(goConstant(goSource, 'DonationFundUserID')).toMatch(/\S/);
  });
});
