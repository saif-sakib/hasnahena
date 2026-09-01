import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * ADR-044 — fields that no longer exist anywhere, still being read.
 *
 * `transactions."receiptNumber"`, `loans."loanNumber"` and the `accountId` on
 * both were dropped: the id **is** the receipt number and the loan number, and
 * the account is the member. The compiler caught every Prisma call that named
 * one, and none of the browser code, because an API payload arrives as `any` and
 * a screen's own `interface` is a claim about it rather than a check on it.
 *
 * So ten screens went on reading `tx.receiptNumber` and `loan.loanNumber` off
 * payloads that had stopped carrying them — rendering `undefined` in the receipt
 * column of the member's own transaction history and on the loan agreement PDF,
 * with a green typecheck and a green unit suite. That is the failure this file
 * exists for: not a wrong value, a **blank** one, on the two documents a member
 * is most likely to hold.
 *
 * A grep is the right shape here precisely because the type system cannot help.
 * The names are retired, so any occurrence in an app file is stale by
 * definition — there is no legitimate reader left to exclude.
 */

const WEB_ROOT = resolve(new URL('.', import.meta.url).pathname, '..', '..');

/** Directories whose files are shipped to the browser or run as a route. */
const SEARCHED = ['app', 'components'];

/**
 * The names, and what each one is now.
 *
 * `documents/` is excluded below rather than listed here: `buildReceipt` and
 * `buildLoanAgreement` take `receiptNumber` and `loanNumber` as **parameters**,
 * because those are the labels printed on the paper — "Receipt No", "Loan No".
 * A print label is allowed to say what the number is called; a payload read is
 * not, because there is no longer a field of that name to read.
 */
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
          // Two shapes, and deliberately not a third.
          //
          //   `tx.receiptNumber`        a read of a field that is not sent
          //   `receiptNumber: string;`  a payload interface claiming it is
          //
          // `receiptNumber: tx.id` is NOT flagged: that is an argument to
          // `buildReceipt`, whose parameter is the **label printed on the
          // paper** — "Receipt No". A document is allowed to say what a number
          // is called; a payload read is not, because there is no field of that
          // name left to read.
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
