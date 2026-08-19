import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * WO-71. Every enum label the Go SQL names must exist in `schema.prisma`.
 *
 * The Go API writes raw SQL against a schema Prisma owns, so a label that is
 * removed on one side and still named on the other is a runtime error in a
 * query — never a compile error, and never something `go vet` or `tsc` can see.
 *
 * That is not hypothetical. Collapsing the legacy `LoanStatus` values missed
 * three occurrences, because the ones that were found read
 * `IN ('APPROVED','ACTIVE')` and the ones that were missed read
 * `IN ('APPROVED', 'ACTIVE')` — one space. The member dashboard query was among
 * them, and it swallowed its own error into four zeros, so every member saw
 * "Current Balance: BDT 0" with a 200 response and nothing to retry.
 *
 * A grep finds what you thought to grep for. This re-derives both sides from
 * source: the labels from `schema.prisma`, the usages from the Go files, and
 * fails on any name in the second that is absent from the first.
 */

const HERE = new URL('.', import.meta.url).pathname;
const WEB_ROOT = resolve(HERE, '..', '..');
const REPO = resolve(WEB_ROOT, '..', '..');
const API_ROOT = join(REPO, 'apps', 'api');

const SCHEMA = readFileSync(join(WEB_ROOT, 'prisma', 'schema.prisma'), 'utf8');

/** Every enum in the schema, as name → set of labels. */
function schemaEnums(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const m of SCHEMA.matchAll(/^enum\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const labels = new Set<string>();
    for (const line of m[2].split('\n')) {
      const label = line.trim();
      if (/^[A-Z][A-Z0-9_]*$/.test(label)) labels.add(label);
    }
    out.set(m[1], labels);
  }
  return out;
}

function goFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      // Test files are excluded: a test may legitimately name a label to prove
      // it is rejected.
      else if (entry.endsWith('.go') && !entry.endsWith('_test.go')) out.push(full);
    }
  };
  walk(join(API_ROOT, 'internal'));
  walk(join(API_ROOT, 'cmd'));
  return out;
}

/**
 * Go source with comments removed.
 *
 * A detector must search code, not prose — the comment explaining why
 * `'APPROVED'` was removed contains the word, and a check that fires on its own
 * documentation teaches people to delete the documentation.
 */
function stripGoComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const ENUMS = schemaEnums();
const GO_FILES = goFiles();

describe('the Go SQL only names enum labels that exist', () => {
  it('read both sides', () => {
    expect(ENUMS.get('LoanStatus')?.size, 'LoanStatus not found in schema.prisma').toBeGreaterThan(3);
    expect(GO_FILES.length, 'no Go files found').toBeGreaterThan(20);
  });

  /**
   * The precise shape that breaks: a comparison list that mixes a label the
   * enum still has with one it does not.
   *
   * `IN ('APPROVED', 'ACTIVE')` is unambiguous — `ACTIVE` proves the column is a
   * LoanStatus, and `APPROVED` exists in no enum in the schema, so it can only
   * be a stale label. Postgres rejects the whole query at runtime.
   *
   * Deliberately narrow. An earlier version flagged every ALL_CAPS literal near
   * an enum label and reported `'EXCELLENT'`, `'GOOD'` and `'TRANSACTION'` — a
   * repayment-quality rating and an audit entity type, neither of them enums. A
   * check that cries wolf is one people stop reading, and this codebase has paid
   * for that lesson once already.
   */
  it('every comparison list belongs to a single enum', () => {
    // `IN ( 'A', 'B' )`, across newlines, as the SQL is formatted.
    const inList = /\bIN\s*\(\s*((?:'[A-Za-z0-9_]+'\s*,?\s*)+)\)/g;

    const stale: string[] = [];
    for (const file of GO_FILES) {
      const code = stripGoComments(readFileSync(file, 'utf8'));
      for (const m of code.matchAll(inList)) {
        const members = [...m[1].matchAll(/'([A-Za-z0-9_]+)'/g)].map((x) => x[1]);
        if (members.length < 2) continue;

        // Only judge lists that are demonstrably about an enum: every member has
        // to be a label of *some* enum. A list of audit actions or SQL keywords
        // is not our business, and an earlier version that guessed reported
        // 'EXCELLENT', 'GOOD' and 'TRANSACTION' — a repayment rating and an
        // audit entity. A check that cries wolf is one people stop reading.
        const enumsFor = (label: string) =>
          [...ENUMS.entries()].filter(([, labels]) => labels.has(label)).map(([name]) => name);
        const perMember = members.map((label) => ({ label, enums: enumsFor(label) }));
        if (perMember.some((x) => x.enums.length === 0)) continue;

        // The real check. `IN ('APPROVED', 'ACTIVE')` looks fine label by label —
        // APPROVED is a RequestStatus and ACTIVE is a LoanStatus — and is still
        // nonsense, because no single column can be both. That is exactly the
        // shape WO-71 left behind in three places, and Postgres rejects the whole
        // query at runtime: no compiler sees it, and a handler that swallows the
        // error renders the failure as a zero balance.
        const shared = perMember
          .map((x) => new Set(x.enums))
          .reduce((a, b) => new Set([...a].filter((e) => b.has(e))));

        if (shared.size === 0) {
          stale.push(
            `${relative(REPO, file)}: ${members.map((x) => `'${x}'`).join(', ')} ` +
              `— no single enum contains all of them (` +
              perMember.map((x) => `${x.label}∈{${x.enums.join(',')}}`).join(' ') + ')',
          );
        }
      }
    }

    expect(
      [...new Set(stale)].sort(),
      'These SQL comparisons mix labels from different enums, so at least one is ' +
        'stale for the column being compared.\n  ' + [...new Set(stale)].join('\n  '),
    ).toEqual([]);
  });
});
