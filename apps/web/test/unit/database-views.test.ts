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

/**
 * The **current** definition of each view.
 *
 * Read from every migration in order and keyed by view name, so the last
 * `CREATE OR REPLACE VIEW v_people` wins — which is exactly what the database
 * ends up with. Reading only the `_readable_views` migration was the first
 * version, and it is wrong the moment a later migration replaces a view: it
 * would report a column as missing that the view stopped naming, and, worse,
 * would keep passing for a view that a later migration broke.
 */
const VIEW_BODIES = new Map<string, string>();
for (const dir of readdirSync(MIGRATIONS).filter((d) => !d.endsWith('.toml')).sort()) {
  let sql: string;
  try {
    sql = readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
  } catch {
    continue;
  }
  for (const [whole, name] of sql.matchAll(/CREATE OR REPLACE VIEW (v_\w+) AS[\s\S]*?;/g)) {
    VIEW_BODIES.set(name, whole);
  }
}
const VIEWS_SQL = [...VIEW_BODIES.values()].join('\n');

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
    // rename would invalidate. The bare lowercase ones are checked separately
    // below — this test used to argue they did not need to be, on the grounds
    // that a rename would break every other query too. That was wrong, and
    // `branches.code` is how: nothing else selected it, so dropping it broke
    // exactly one thing, and that one thing is invisible to the compiler and to
    // `pnpm db:migrate:check`.
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

  it('name only lowercase columns that still exist either', () => {
    // `b.code`, `u.phone`, `a."savingsBalance"`. The unquoted half is the one
    // that got away: a column whose name is already lowercase needs no quotes,
    // so it does not appear in the check above, and `branches.code` was dropped
    // while `v_people` still selected it. That fails at `prisma migrate deploy`
    // — during a deployment, on the migration *after* the one that broke it.
    const referenced = new Set(
      [...VIEWS_SQL.matchAll(/\b[a-z]\.([a-z][a-z0-9_]*)\b/g)].map((m) => m[1]),
    );
    const mapped = new Set(
      [...SCHEMA.matchAll(/@map\("([^"]+)"\)/g)].map((m) => m[1]),
    );
    const missing = [...referenced].filter((name) => {
      if (mapped.has(name)) return false;
      return !new RegExp(`^\\s+${name}\\s`, 'm').test(SCHEMA);
    });

    expect(
      missing,
      `these view columns are no longer declared in schema.prisma — a view ` +
        `depends on the columns it names, so the migration that drops one has to ` +
        `CREATE OR REPLACE the view in the same file`,
    ).toEqual([]);
  });

  it('lead with the identifier a human has, under a name that says what it is', () => {
    // The whole point, restated for a schema where the keys ARE the identifiers.
    //
    // The rule used to be "the first column must not be `x.id`", because `x.id`
    // was a cuid and a view opening with one is the table again. Since ADR-044
    // it is `DEP-2026-000001` or `LOAN-2026-000012`, so the *column* is no
    // longer what distinguishes a readable view from a raw one — the **alias**
    // is. A first column of `t.id AS receipt` is exactly right; one of
    // `t.id AS transaction_id` is the table again under a new name.
    const READABLE_FIRST_ALIAS = /^(account_no|receipt|loan_no|key|at|name)$/;
    for (const [, name, body] of VIEWS_SQL.matchAll(
      /CREATE OR REPLACE VIEW (v_\w+) AS\s*SELECT\s*([\s\S]*?)\nFROM/g,
    )) {
      const firstColumn = body.trim().split('\n')[0];
      const alias = firstColumn.match(/\bAS\s+(\w+)/i)?.[1] ?? firstColumn.trim().replace(/,$/, '');
      expect(
        alias,
        `${name} opens with "${firstColumn.trim()}" — open with the account ` +
          `number, receipt number, loan number, config key, timestamp or name`,
      ).toMatch(READABLE_FIRST_ALIAS);
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
