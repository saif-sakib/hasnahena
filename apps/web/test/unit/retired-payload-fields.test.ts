import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * ADR-044 retired receiptNumber / loanNumber / accountId — payloads arrive as
 * `any`, so a stale read renders a blank, not a type error. Any occurrence in
 * an app file is stale by definition.
 */

const WEB_ROOT = resolve(new URL('.', import.meta.url).pathname, '..', '..');

/** Directories whose files are shipped to the browser or run as a route. */
const SEARCHED = ['app', 'components'];

/** Retired names → what replaced them. documents/ is excluded: print labels may name the number. */
const RETIRED: Record<string, string> = {
  receiptNumber: 'the id IS the receipt number',
  loanNumber: 'the id IS the loan number',
  accountId: 'a posting names the member, not an account row',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !full.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

const files = SEARCHED.flatMap((dir) => walk(join(WEB_ROOT, dir)));

describe('retired payload fields', () => {
  it('found the files at all', () => {
    // A walk that returns nothing passes every assertion below while checking
    // none of them — the shape that let the audit-action census go blind.
    expect(files.length).toBeGreaterThan(50);
  });

  for (const [field, replacement] of Object.entries(RETIRED)) {
    it(`no screen reads .${field} — ${replacement}`, () => {
      const offenders: string[] = [];
      for (const file of files) {
        const source = readFileSync(file, 'utf8');
        for (const [index, line] of source.split('\n').entries()) {
          // Flag `.field` reads and `field: type;` interface claims — not
          // `receiptNumber: tx.id` (a print-label argument).
          const read = new RegExp(`\\.${field}\\b`);
          const declared = new RegExp(`\\b${field}\\??:\\s*(string|number|boolean)\\b`);
          if (read.test(line) || declared.test(line)) {
            offenders.push(`${relative(WEB_ROOT, file)}:${index + 1}  ${line.trim()}`);
          }
        }
      }
      expect(
        offenders,
        `these read a field that no longer exists on any payload — ${replacement} ` +
          `(ADR-044). The symptom is a blank value on a screen or a document, not an error.`,
      ).toEqual([]);
    });
  }
});
