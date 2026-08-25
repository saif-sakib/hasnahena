import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  PENDING_APPROVAL_PASSWORD_HASH,
  REJECTED_APPLICATION_SQL,
  rejectedApplicationFilter,
} from '@/lib/rejected-application';

/**
 * One definition of "rejected application", spelled out in three places.
 *
 * It decides who owns an email address, a phone number and an NID. A live
 * member owns theirs exclusively; a rejected applicant owns nothing, which is
 * what lets them apply again with the same details (owner's ruling,
 * 2026-08-26).
 *
 * The three consumers, none of which would notice the others changing:
 *
 *   1. **The migration** — three partial unique indexes whose predicate is this
 *      condition. This is the one that actually enforces it.
 *   2. **This module** — Prisma queries in the Next app.
 *   3. **`RejectedApplicationSQL`** in the Go API — the login lookup.
 *
 * Getting them out of step is not a cosmetic problem in either direction:
 *
 *   - **An index predicate narrower than the query's** lets two live rows hold
 *     one email — two accounts, two savings balances, one person, which is
 *     exactly the duplicate WO-90 moved into the database to prevent.
 *   - **Wider**, and a genuine applicant is told their own email is taken by a
 *     row the application cannot see, with no way to find out why.
 *   - **A Go lookup that forgets it entirely** authenticates against a rejected
 *     row whose password hash nothing can match, so a real member's correct
 *     password is refused — and `LIMIT 1` makes which row wins arbitrary.
 */

const REPO = resolve(process.cwd(), '..', '..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');

const GO_AUTH_REPO = 'apps/api/internal/repositories/auth_repository.go';
const MIGRATIONS_DIR = 'apps/web/prisma/migrations';

/** Collapse whitespace so formatting differences are not reported as drift. */
const normalise = (sql: string) => sql.replace(/\s+/g, ' ').trim();

/**
 * Source with comments removed.
 *
 * A test that forbids a string has to search code, not prose — the first run of
 * the sweep check below failed on **its own explanation** of what the old
 * predicate was, which is the trap `requirements.test.ts` names: a detector that
 * fires on its own rule being written down trains people to delete the
 * documentation.
 */
const codeOf = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/^\s*--.*$/gm, ' ');

function migrationSql(): string {
  const dirs = readdirSync(join(REPO, MIGRATIONS_DIR))
    .filter((name) => /^\d{14}_/.test(name));
  return dirs
    .map((name) => {
      try {
        return read(`${MIGRATIONS_DIR}/${name}/migration.sql`);
      } catch {
        return '';
      }
    })
    .join('\n');
}

describe('the rejected-application predicate', () => {
  const expected = normalise(REJECTED_APPLICATION_SQL);

  it('is a predicate with all four conjuncts, not a status check', () => {
    // `status = 'INACTIVE'` alone also matches a **deactivated member**, who has
    // a real password hash and an approvedAt and must keep their identifiers
    // reserved — freeing those hands the next person given that phone number
    // somebody else's account history. An **erased** member (FR-23) keeps
    // approvedAt too. All four conjuncts are load-bearing.
    expect(expected).toContain("role = 'MEMBER'");
    expect(expected).toContain("status = 'INACTIVE'");
    expect(expected).toContain('"approvedAt" IS NULL');
    expect(expected).toContain(`"passwordHash" = '${PENDING_APPROVAL_PASSWORD_HASH}'`);
  });

  it('agrees with the Prisma filter used by the Next routes', () => {
    expect(rejectedApplicationFilter.role).toBe('MEMBER');
    expect(rejectedApplicationFilter.status).toBe('INACTIVE');
    expect(rejectedApplicationFilter.approvedAt).toBeNull();
    expect(rejectedApplicationFilter.passwordHash).toBe(PENDING_APPROVAL_PASSWORD_HASH);
  });

  it('is spelled identically in the Go API', () => {
    const go = read(GO_AUTH_REPO);
    const match = go.match(/const RejectedApplicationSQL = `([^`]*)`\s*\+\s*PendingApprovalPasswordHash\s*\+\s*`([^`]*)`/);
    expect(
      match,
      `RejectedApplicationSQL not found in ${GO_AUTH_REPO}. If it was renamed or ` +
        're-spelled, this census can no longer compare it and must be updated with it.',
    ).toBeTruthy();

    const goSql = normalise(`${match![1]}${PENDING_APPROVAL_PASSWORD_HASH}${match![2]}`);
    expect(
      goSql,
      'the Go predicate and the TypeScript one disagree. Two rows may share an email ' +
        'now, so whichever side is wrong either authenticates against a rejected row ' +
        'or refuses a live one.',
    ).toBe(expected);

    expect(
      go,
      `${GO_AUTH_REPO} declares the constant but no query uses it — the login lookup ` +
        'must exclude rejected rows or it can match one instead of the member.',
    ).toContain('AND NOT (` + RejectedApplicationSQL + `)');
  });

  it('is the predicate the partial unique indexes actually carry', () => {
    const sql = normalise(migrationSql());

    // The three indexes that enforce this. Named individually because an index
    // silently dropped from the migration is uniqueness silently switched off.
    for (const index of ['users_email_live_key', 'users_phone_live_key', 'users_nid_live_key']) {
      expect(sql, `${index} is not created by any migration`).toContain(index);
    }

    // Each one's WHERE clause has to contain the predicate. The SQL spells it
    // without the `role = 'MEMBER' AND ` prefix ordering being significant, so
    // compare on the four conjuncts rather than the whole string — the index
    // predicates are wrapped in `NOT (...)` and combined with other conditions.
    const occurrences = sql.split(expected).length - 1;
    expect(
      occurrences,
      'the migration does not spell the predicate the way lib/rejected-application.ts ' +
        'does. The indexes are what actually enforce uniqueness, so a difference here ' +
        'is the one that decides who can register.',
    ).toBeGreaterThanOrEqual(3);
  });

  it('is what the retention sweep selects on, not a leftover of the scramble', () => {
    // This one nearly shipped broken. `retention_repository.go` identified a
    // rejected application by `u.phone LIKE 'rejected-%'` — matching the
    // tombstone that rejection used to write over the applicant's number. When
    // the scramble was removed, that predicate matched **nothing, ever again**,
    // and the sweep would have gone on running, reporting success, and retaining
    // every rejected applicant's NID and addresses for ever.
    //
    // Nothing about it looks wrong from outside: the job runs on schedule, the
    // query is valid, the count is zero — which is also what a correct sweep
    // reports on a quiet week. The only defence is that all three questions —
    // who may re-apply, who owns an email, whose data expires — are answered by
    // one predicate.
    const sweep = codeOf(read('apps/api/internal/repositories/retention_repository.go'));
    expect(
      sweep,
      'the retention sweep no longer derives its predicate from RejectedApplicationSQL. ' +
        'A second spelling of "rejected application" can stop matching without failing ' +
        'anything — the sweep reports zero cleared either way',
    ).toContain('RejectedApplicationSQL');
    expect(
      sweep,
      "the sweep still selects on the phone tombstone, which rejection no longer writes",
    ).not.toContain("phone LIKE 'rejected-%'");
  });

  it('never lets the old scramble come back', () => {
    // Rejection used to overwrite the applicant's contact details so the
    // unique constraint would let them reapply:
    //
    //     email = CONCAT('rejected+', id, '@hasnahena.local')
    //
    // It freed the constraint by destroying the only way to tell the applicant
    // they had been rejected — in the same statement that decided it. The
    // partial indexes replace it. Re-introducing either half puts the entry
    // path back where it was, and neither would fail any other test.
    const sources = [
      codeOf(read('apps/web/app/api/v1/registrations/route.ts')),
      codeOf(read('apps/api/internal/repositories/admin_repository.go')),
    ];
    for (const source of sources) {
      expect(source).not.toContain("'rejected+'");
      expect(source).not.toContain("'rejected-'");
    }
  });
});
