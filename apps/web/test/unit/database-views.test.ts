import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The `v_*` views (human SQL reading only) and the columns they name — invisible
 * to the compiler and db:migrate:check, so a rename would fail at deploy time.
 */
const WEB_ROOT = resolve(new URL('.', import.meta.url).pathname, '..', '..');
const SCHEMA = readFileSync(join(WEB_ROOT, 'prisma', 'schema.prisma'), 'utf8');

const MIGRATIONS = join(WEB_ROOT, 'prisma', 'migrations');

/** The CURRENT definition of each view: the last CREATE OR REPLACE across migrations. */
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
    // Quoted camelCase identifiers are exactly what a field rename invalidates.
    const quoted = new Set(
      [...VIEWS_SQL.matchAll(/"([a-z][A-Za-z0-9]*)"/g)].map((m) => m[1]),
    );
    // Legitimate non-field names: @@map tables and @map columns.
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
    // Unquoted lowercase columns too (dropping branches.code broke v_people).
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
    // The first column's ALIAS says it is readable (keys are identifiers since ADR-044).
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
  /** No stored eligibility column — it was written 0 and never updated. */
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
      // The SQL column form only (a JSON key of that name is fine).
      expect(source, `${file} selects a stored maximum again`).not.toMatch(
        /\."maxLoanAmount"|"maxLoanAmount"\s*(?:,|\))/,
      );
      expect(source, `${file} no longer derives the maximum`).toContain('money.MaxLoanAmount(');
    }
  });
});
