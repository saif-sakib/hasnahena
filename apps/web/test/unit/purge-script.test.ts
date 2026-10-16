import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { NEXT_STAFF_NO_SQL, STAFF_NO_ADVISORY_LOCK_SQL, formatStaffNo } from '@/lib/account-no';

/**
 * The plain-node scripts restate things they cannot import (the staff series,
 * the sole-branch rule); this checks the copies rather than trusting them.
 */
const WEB_ROOT = resolve(new URL('.', import.meta.url).pathname, '..', '..');
const PURGE = readFileSync(join(WEB_ROOT, 'scripts', 'go-live-purge.mjs'), 'utf8');
// One copy for all scripts.
const SCRIPT_ACCOUNT_NO = readFileSync(join(WEB_ROOT, 'scripts', 'lib', 'account-no.mjs'), 'utf8');

describe('the purge script agrees with lib/account-no.ts', () => {
  it('uses the same advisory lock', () => {
    // A different lock id would let the script and the application allocate the
    // same number concurrently — the exact collision the lock exists to stop.
    expect(SCRIPT_ACCOUNT_NO).toContain(STAFF_NO_ADVISORY_LOCK_SQL);
  });

  it('selects the next sequence with the same predicate', () => {
    // Compared with whitespace collapsed: the two are formatted for their own
    // files and the SQL is what has to match, not the indentation.
    const normalise = (sql: string) => sql.replace(/\s+/g, ' ').trim();
    const copied = /const NEXT_STAFF_NO_SQL = `([\s\S]*?)`;/.exec(SCRIPT_ACCOUNT_NO)?.[1];
    expect(copied, 'NEXT_STAFF_NO_SQL is not a template literal this test can read').toBeTruthy();
    expect(normalise(copied as string)).toBe(normalise(NEXT_STAFF_NO_SQL));
  });

  it('formats a number the same way', () => {
    // Re-derived from the script's own source rather than assumed, so a change
    // to the padding in either file fails here.
    const padding = /padStart\((\d+), '0'\)/.exec(SCRIPT_ACCOUNT_NO)?.[1];
    expect(padding).toBe('4');
    expect(formatStaffNo(1)).toBe('STF-0001');
  });

  it('declines to guess a branch when there is more than one', () => {
    // take: 2 tells "the only office" from "the first of several".
    expect(PURGE).toMatch(/take:\s*2/);
    expect(PURGE).toMatch(/active\.length === 1/);
  });
});

describe('the purge scrubs a reused admin row rather than only re-roling it', () => {
  /** Every member-shaped field is cleared on reused admin rows (a seeded NID would block a real member). */
  it('clears every member-shaped field', () => {
    for (const field of [
      'nidNumber: null',
      'dateOfBirth: null',
      'bloodGroup: null',
      'profession: null',
      'formNumber: null',
      'avatarUrl: null',
    ]) {
      expect(PURGE, `${field} is no longer scrubbed`).toContain(field);
    }
  });

  it('does not renumber somebody who already has a number in the series', () => {
    // Re-running keeps an existing number (it names their image folder).
    expect(PURGE).toMatch(/parseStaffSequence\(accountNo\) === null/);
  });

  it('never touches the email or the phone, and moves the id only with the number', () => {
    // Email and phone are the two things a person logs in with. A cutover that
    // changed them would be a new account wearing an old one's history.
    const updateBlock = /tx\.user\.update\(\{[\s\S]*?\n {10}\}\);/.exec(PURGE)?.[0] ?? '';
    expect(updateBlock.length).toBeGreaterThan(200);
    expect(updateBlock).not.toMatch(/^\s+email:/m);
    expect(updateBlock).not.toMatch(/^\s+phone:/m);

    // The id IS the account number (ADR-043), written as `id: accountNo`.
    expect(updateBlock).toMatch(/^\s+id: accountNo,$/m);
    expect(updateBlock).toMatch(/^\s+accountNo,$/m);
  });

  it('leaves the password alone unless --reset-passwords is asked for', () => {
    // Passwords are kept by default.
    expect(PURGE).toContain("!process.argv.includes('--reset-passwords')");

    expect(PURGE).toMatch(/keepPasswords \? \{\} : \{ passwordHash/);
    expect(PURGE).toMatch(/for \(const c of keepPasswords \? \[\] : credentials\)/);
  });

  it('deletes nothing under --admins-only', () => {
    // The mode to reach for against a database somebody is using, which a
    // cutover purge never is.
    expect(PURGE).toMatch(/if \(adminsOnly\) return;/);
  });
});

describe('the purge takes the image host with it', () => {
  /** The deleted people's Cloudinary folders, named from the rows (never the admins'). */
  it('collects the folders of the people it is about to delete', () => {
    expect(PURGE).toContain('const doomed');
    // Read before the delete, because afterwards there is nothing left to ask.
    expect(PURGE.indexOf('const doomed')).toBeLessThan(PURGE.indexOf('await prisma.$transaction'));
    // Named, not listed: a prefix delete of `people/` would take both admins'
    // avatars with it.
    expect(PURGE).toContain('function foldersFor');
    expect(PURGE).toContain('`people/${u.accountNo || u.id}`');
    expect(PURGE).toContain('`applications/${u.formNumber}`');
  });

  it('excludes the survivors from that list by the same rule the delete uses', () => {
    const doomed = PURGE.slice(PURGE.indexOf('const doomed'), PURGE.indexOf('await prisma.$transaction'));
    expect(doomed).toContain('ADMINS.map((a) => a.email)');
    expect(doomed).toContain('DONATION_OWNER_ID');
  });

  it('prints the folders rather than saying nothing when Cloudinary is unconfigured', () => {
    // Without credentials the folders are printed, never silently skipped.
    expect(PURGE).toContain('function cloudinaryConfigured');
    expect(PURGE).toContain('Delete them by hand in the Cloudinary console');
  });
});
