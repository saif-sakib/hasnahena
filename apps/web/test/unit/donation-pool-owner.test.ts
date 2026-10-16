import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The donation pool owner id must match in seed.mjs, the Go repository and
 * db:clear (ADR-023) — a mismatch fails only at the first donation.
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
    // db:clear must preserve the same id.
    expect(jsConstant(clearSource, 'DONATION_OWNER_ID')).toBe(
      jsConstant(seedSource, 'DONATION_OWNER_ID'),
    );
  });

  it('reads real values rather than passing on two empty strings', () => {
    expect(jsConstant(seedSource, 'DONATION_OWNER_ID')).toMatch(/\S/);
    expect(goConstant(goSource, 'DonationFundUserID')).toMatch(/\S/);
  });
});
