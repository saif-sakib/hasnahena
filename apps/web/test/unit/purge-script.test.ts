import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { NEXT_STAFF_NO_SQL, STAFF_NO_ADVISORY_LOCK_SQL, formatStaffNo } from '@/lib/account-no';

/**
 * The cutover purge restates things it cannot import.
 *
 * `scripts/*.mjs` run under plain `node`, not under Next: there is no TypeScript
 * loader and no `@/` alias resolution, which is why every script in that
 * directory imports nothing but `./lib/env.mjs`. So `go-live-purge.mjs` carries
 * its own copy of the staff account-number series and of the sole-active-branch
 * rule — a duplication this repository otherwise refuses.
 *
 * A copy that is checked is a different thing from a copy that is trusted. If
 * the series ever moves and the script does not, the cutover allocates numbers
 * from a scheme nothing else uses, on the one run where nobody gets a second
 * chance.
 */
const WEB_ROOT = resolve(new URL('.', import.meta.url).pathname, '..', '..');
const PURGE = readFileSync(join(WEB_ROOT, 'scripts', 'go-live-purge.mjs'), 'utf8');

describe('the purge script agrees with lib/account-no.ts', () => {
  it('uses the same advisory lock', () => {
    // A different lock id would let the script and the application allocate the
    // same number concurrently — the exact collision the lock exists to stop.
    expect(PURGE).toContain(STAFF_NO_ADVISORY_LOCK_SQL);
  });

  it('selects the next sequence with the same predicate', () => {
    // Compared with whitespace collapsed: the two are formatted for their own
    // files and the SQL is what has to match, not the indentation.
    const normalise = (sql: string) => sql.replace(/\s+/g, ' ').trim();
    const copied = /const NEXT_STAFF_NO_SQL = `([\s\S]*?)`;/.exec(PURGE)?.[1];
    expect(copied, 'NEXT_STAFF_NO_SQL is not a template literal this test can read').toBeTruthy();
    expect(normalise(copied as string)).toBe(normalise(NEXT_STAFF_NO_SQL));
  });

  it('formats a number the same way', () => {
    // Re-derived from the script's own source rather than assumed, so a change
    // to the padding in either file fails here.
    const padding = /padStart\((\d+), '0'\)/.exec(PURGE)?.[1];
    expect(padding).toBe('4');
    expect(formatStaffNo(1)).toBe('STF-0001');
  });

  it('declines to guess a branch when there is more than one', () => {
    // `take: 2` is the whole mechanism: `findFirst` cannot tell "the only
    // office" from "the first of several", and those are the two cases this
    // separates: `findFirst` cannot tell "the only office" from "the first of
    // several", and a member filed under the wrong branch is found when a
    // per-branch report does not add up.
    expect(PURGE).toMatch(/take:\s*2/);
    expect(PURGE).toMatch(/active\.length === 1/);
  });
});

describe('the purge scrubs a reused admin row rather than only re-roling it', () => {
  /**
   * The first version reset the password and the role and left everything else
   * as it was, and both launch accounts carried an old seed's test data:
   * `HN-A-001`, an invented NID of `9876543210987`, a made-up 1985 birthday,
   * and parents called `Admin Father` and `Admin Mother`.
   *
   * The NID is the one that would have hurt. That column is uniquely indexed on
   * live rows, so a fabricated value sitting on an admin account is a real
   * member refused at registration one day — "that NID is already in use" —
   * with nothing on any screen able to explain why.
   */
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
    // The account number is also the name of that person's folder on the image
    // host, so a second number orphans their photograph. Re-running the purge
    // has to be a no-op for an already-clean row.
    expect(PURGE).toMatch(/parseStaffSequence\(accountNo\) === null/);
  });

  it('never touches the row id, the email or the phone', () => {
    // Identity that other rows may reference, and the two things a person logs
    // in with. A cutover that changed them would be a new account wearing an old
    // one's history.
    const updateBlock = /tx\.user\.update\(\{[\s\S]*?\n {10}\}\);/.exec(PURGE)?.[0] ?? '';
    expect(updateBlock.length).toBeGreaterThan(200);
    expect(updateBlock).not.toMatch(/^\s+email:/m);
    expect(updateBlock).not.toMatch(/^\s+phone:/m);
    expect(updateBlock).not.toMatch(/^\s+id:/m);
  });

  it('leaves the password alone under --keep-passwords', () => {
    // Both admins have already signed in and chosen their own. Re-running the
    // scrub must not cost somebody the password they are using, and a
    // first-login marker planted over one they set themselves would demand they
    // change it again for no reason.
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
  /**
   * Deleting the rows is half of an erasure.
   *
   * Every member this script deletes has a folder on Cloudinary — their avatar
   * and, since they were admitted, the four identity documents filed beside it
   * — and each of those is served from a URL that needs no login. A cutover that
   * empties the database and leaves a hundred test members' NID scans online has
   * not cleared the test data. It has only stopped being able to find it.
   *
   * The one thing this must never do is delete the surviving admins' files, so
   * the folders are **named from the rows being deleted** rather than found by
   * listing the host.
   */
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
    // The script's only hard requirement is a database URL, deliberately. When
    // the image credentials are absent the folders have to be *named* — silence
    // is the one outcome that is not allowed, because it reads exactly like
    // having deleted them.
    expect(PURGE).toContain('function cloudinaryConfigured');
    expect(PURGE).toContain('Delete them by hand in the Cloudinary console');
  });
});
