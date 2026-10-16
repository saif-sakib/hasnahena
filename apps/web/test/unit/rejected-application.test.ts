import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  PENDING_APPROVAL_PASSWORD_HASH,
  REJECTED_APPLICATION_SQL,
  rejectedApplicationFilter,
} from '@/lib/rejected-application';

/**
 * One definition of "rejected application", in three places that must agree:
 * the migration's partial unique indexes, lib/rejected-application.ts, and
 * RejectedApplicationSQL in the Go API. Narrower index → duplicate live
 * accounts; wider → a genuine applicant told their email is taken; a Go lookup
 * without it → a real member's correct password refused.
 */

const REPO = resolve(process.cwd(), '..', '..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');

const GO_AUTH_REPO = 'apps/api/internal/repositories/auth_repository.go';
const MIGRATIONS_DIR = 'apps/web/prisma/migrations';

/** Collapse whitespace so formatting differences are not reported as drift. */
const normalise = (sql: string) => sql.replace(/\s+/g, ' ').trim();

/** Source with comments removed (search code, not prose). */
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
    // All four conjuncts matter: INACTIVE alone matches deactivated and erased members.
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

    // Compare on the conjuncts; index predicates wrap them in NOT (...).
    const occurrences = sql.split(expected).length - 1;
    expect(
      occurrences,
      'the migration does not spell the predicate the way lib/rejected-application.ts ' +
        'does. The indexes are what actually enforce uniqueness, so a difference here ' +
        'is the one that decides who can register.',
    ).toBeGreaterThanOrEqual(3);
  });

  it('is what the retention sweep selects on, not a leftover of the scramble', () => {
    // The retention sweep must use the same predicate (an old tombstone match
    // would have silently swept nothing, forever).
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

  it('is applied by every lookup that filters on a contact detail', () => {
    // EVERY lookup by email/phone/NID in app/ and lib/ must carry
    // liveIdentityFilter (a missing one once stopped a refused applicant being hired).
    const roots = ['apps/web/app', 'apps/web/lib'];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(REPO, dir))) {
        if (entry === 'node_modules' || entry === '.next') continue;
        const rel = `${dir}/${entry}`;
        if (statSync(join(REPO, rel)).isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(rel);
      }
    };
    for (const root of roots) walk(root);

    /** A prisma.user.find* call whose `where` mentions a contact detail (brace-balanced). */
    const offenders: string[] = [];
    for (const rel of files) {
      const source = codeOf(read(rel));
      const pattern = /prisma\.user\.(findFirst|findUnique|findMany|count)\s*\(/g;
      for (const match of source.matchAll(pattern)) {
        const start = match.index! + match[0].length - 1;
        let depth = 0;
        let end = start;
        for (; end < source.length; end += 1) {
          if (source[end] === '(') depth += 1;
          else if (source[end] === ')') {
            depth -= 1;
            if (depth === 0) break;
          }
        }
        const call = source.slice(start, end + 1);
        // Only lookups BY a contact detail — the part before `select:`.
        const whereHalf = call.split(/\bselect\s*:/)[0];
        const looksUpContact = /\b(email|phone|nidNumber)\s*:/.test(whereHalf);
        if (!looksUpContact) continue;
        if (call.includes('liveIdentityFilter') || call.includes('rejectedApplicationFilter')) continue;
        // A lookup by primary key cannot match the wrong person.
        if (/\bwhere\s*:\s*\{\s*id\s*:/.test(call)) continue;
        offenders.push(`${rel}: ${call.replace(/\s+/g, ' ').slice(0, 110)}`);
      }
    }

    expect(
      offenders,
      'These look a user up by email, phone or NID without excluding rejected ' +
        'applications. Uniqueness is scoped to LIVE rows, so a refused applicant ' +
        'owns none of those values — a lookup that forgets it either refuses a ' +
        'genuine person their own details, or authenticates against a row whose ' +
        'password hash nothing can match. Add `...liveIdentityFilter` to the ' +
        'where clause:\n  ' + offenders.join('\n  '),
    ).toEqual([]);
  });

  it('is looking at real lookups, not passing on an empty list', () => {
    // The parser above is doing real work only if it finds the calls that
    // *are* correctly filtered. Two of them live in the registration route.
    const registrations = codeOf(read('apps/web/app/api/v1/registrations/route.ts'));
    expect((registrations.match(/liveIdentityFilter/g) ?? []).length).toBeGreaterThanOrEqual(2);
    const workers = codeOf(read('apps/web/app/api/v1/admin/workers/route.ts'));
    expect(
      workers,
      'staff creation no longer excludes rejected applications — a refused ' +
        'applicant cannot then be hired as a field worker',
    ).toContain('liveIdentityFilter');
  });

  it('never lets the old scramble come back', () => {
    // The old contact-scrambling at rejection must not come back.
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
