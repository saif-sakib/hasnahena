import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * WO-71: every enum label the Go SQL names must exist in schema.prisma — a
 * stale label is a runtime query error no compiler sees (it once rendered every
 * member's balance as 0). Both sides re-derived from source.
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

/** Go source with comments removed (search code, not prose). */
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
   * A comparison list must belong to a single enum: `IN ('APPROVED','ACTIVE')`
   * mixes RequestStatus and LoanStatus, which no column can be. Narrow on
   * purpose — a broader version cried wolf.
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

        // Only lists whose every member is SOME enum's label.
        const enumsFor = (label: string) =>
          [...ENUMS.entries()].filter(([, labels]) => labels.has(label)).map(([name]) => name);
        const perMember = members.map((label) => ({ label, enums: enumsFor(label) }));
        if (perMember.some((x) => x.enums.length === 0)) continue;

        // No single enum contains them all → the query is nonsense.
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
