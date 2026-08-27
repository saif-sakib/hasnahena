import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The `v_*` views, and the columns they promise not to lose.
 *
 * The views exist so the database can be read by hand: every join in this schema
 * is between two cuids, so answering "what did this member deposit last week" in
 * a SQL console meant copying ids between three queries. They are the one place
 * where readability outranks normalisation, and that is affordable only because
 * nothing writes through them and no application code reads them.
 *
 * A view is *not* checked by the compiler and not checked by
 * `pnpm db:migrate:check` — Prisma's `migrate diff` does not model views at all,
 * which is exactly why adding them cost no drift and exactly why nothing would
 * notice them rotting. A column renamed in `schema.prisma` fails the next
 * migration against a database that has these views, at deploy time, which is
 * the wrong moment to find out. This finds out at `pnpm test:unit`.
 */
const WEB_ROOT = resolve(new URL('.', import.meta.url).pathname, '..', '..');
const SCHEMA = readFileSync(join(WEB_ROOT, 'prisma', 'schema.prisma'), 'utf8');

const MIGRATIONS = join(WEB_ROOT, 'prisma', 'migrations');
const VIEWS_SQL = readdirSync(MIGRATIONS)
  .filter((d) => d.includes('readable_views'))
  .map((d) => readFileSync(join(MIGRATIONS, d, 'migration.sql'), 'utf8'))
  .join('\n');

describe('the readable views', () => {
  it('are actually defined', () => {
    expect(VIEWS_SQL, 'the readable_views migration has gone missing').toContain(
      'CREATE OR REPLACE VIEW',
    );
  });

  it('name only columns that still exist in schema.prisma', () => {
    // Every column this schema declares is quoted camelCase in SQL, because
    // Prisma maps the model field name straight through (CONTRIBUTING.md). So
    // the quoted identifiers in the view bodies are exactly the set that a
    // rename would invalidate — and a bare lowercase column (`phone`, `role`,
    // `details`) cannot be checked this way and does not need to be, since
    // Postgres folds it and a rename of one would fail every other query too.
    const quoted = new Set(
      [...VIEWS_SQL.matchAll(/"([a-z][A-Za-z0-9]*)"/g)].map((m) => m[1]),
    );
    // Two kinds of quoted name are legitimate without being a field name: a
    // table's `@@map` target, and a column renamed away from its field name with
    // `@map` (`AuditLog.userId @map("performedBy")` is the one that exists).
    const mapped = new Set([
      ...[...SCHEMA.matchAll(/@@map\("([^"]+)"\)/g)].map((m) => m[1]),
      ...[...SCHEMA.matchAll(/@map\("([^"]+)"\)/g)].map((m) => m[1]),
    ]);

    const missing = [...quoted].filter((name) => {
      if (mapped.has(name)) return false;
      // A field declaration is the name at the start of a line inside a model.
      return !new RegExp(`^\\s+${name}\\s`, 'm').test(SCHEMA);
    });

    expect(
      missing,
      `these view columns are no longer in schema.prisma — update ` +
        `prisma/migrations/*_readable_views/migration.sql in the same migration ` +
        `that renamed them, or the next deploy fails on a view that cannot be built`,
    ).toEqual([]);
  });

  it('lead with the identifier a human has, not with a row id', () => {
    // The whole point. A view whose first column is a cuid is the table again.
    for (const [, name, body] of VIEWS_SQL.matchAll(
      /CREATE OR REPLACE VIEW (v_\w+) AS\s*SELECT\s*([\s\S]*?)\nFROM/g,
    )) {
      const firstColumn = body.trim().split('\n')[0];
      expect(
        firstColumn,
        `${name} opens with a raw id; open with the account number, receipt ` +
          `number, loan number or name instead`,
      ).not.toMatch(/^\s*\w+\.id\b/);
    }
  });
});

describe('loan eligibility is derived, never stored', () => {
  /**
   * `accounts.maxLoanAmount` was inserted as 0 and never updated by anything,
   * while two production queries selected it — one of them behind the "Loan
   * Eligibility / Max loan limit" tile on every member's home screen. So a
   * member with 50,000 taka saved was told on their first screen that they could
   * borrow nothing, while the loans page two clicks away computed the real
   * figure from the same savings balance and showed it.
   *
   * `isLoanEligible` was never read at all, which is how the two creation paths
   * came to disagree about it — the Next registration route wrote `false`, the
   * Go approval path wrote `true`, for the same member, minutes apart.
   */
  it('has no eligibility column on the Account model', () => {
    const model = /model Account \{[\s\S]*?\n\}/.exec(SCHEMA)?.[0] ?? '';
    expect(model.length).toBeGreaterThan(100);
    expect(model, 'a stored maximum goes stale the next time somebody deposits').not.toMatch(
      /^\s+maxLoanAmount\s/m,
    );
    expect(model, 'a stored flag is a second opinion nothing reconciles').not.toMatch(
      /^\s+isLoanEligible\s/m,
    );
  });

  it('is answered by money.MaxLoanAmount on both screens that show it', () => {
    // The member dashboard and the admin approvals list. Both used to select the
    // column; both now call the same function the loans page always did.
    const apiRoot = resolve(WEB_ROOT, '..', 'api', 'internal', 'repositories');
    for (const file of ['member_repository.go', 'admin_repository.go']) {
      const source = readFileSync(join(apiRoot, file), 'utf8');
      // The SQL form specifically — table-qualified. `member_repository.go`
      // legitimately puts a `maxLoanAmount` key in the JSON it returns; what
      // must not come back is a *column* by that name being selected.
      expect(source, `${file} selects a stored maximum again`).not.toMatch(
        /\."maxLoanAmount"|"maxLoanAmount"\s*(?:,|\))/,
      );
      expect(source, `${file} no longer derives the maximum`).toContain('money.MaxLoanAmount(');
    }
  });
});
