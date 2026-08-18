#!/usr/bin/env node

// Thin wrapper around `prisma migrate` that points it at a direct connection.
//
// The reason this exists rather than a plain package.json script: DATABASE_URL
// is a Neon *pooler* endpoint. `prisma migrate` takes a session-level advisory
// lock to serialise concurrent deploys, and PgBouncer in transaction mode does
// not keep a session long enough to hold one. The failure is a hang or an
// opaque P1002, not a message that says "you used the wrong host".
//
//   pnpm db:migrate           apply pending migrations (production, CI)
//   pnpm db:migrate:dev       create a migration from schema.prisma changes
//   pnpm db:migrate:status    what is applied and what is not
//   pnpm db:migrate:check     does the migrated database match schema.prisma?
//   pnpm db:migrate:baseline  one-time, for a database built by `db push`

import { spawnSync } from 'node:child_process';
import { resolveDirectDatabaseUrl, redactUrl } from './lib/env.mjs';

const MODES = {
  deploy: ['migrate', 'deploy'],
  dev: ['migrate', 'dev'],
  status: ['migrate', 'status'],
  // Records 0_init as already applied without executing it. Every existing
  // database was built by `prisma db push` and already has these tables;
  // running the migration would fail on the first CREATE TABLE. This marks
  // history as caught-up so future migrations apply normally.
  baseline: ['migrate', 'resolve', '--applied', '0_init'],
  // WO-54. Compares the *migrated database* against schema.prisma and exits 2
  // when they differ.
  //
  // Nothing else checks this. An edit to schema.prisma with no generated
  // migration is one keystroke away, and the two then disagree until a column
  // is missing in production — which surfaces as a runtime error on a money
  // path, at the worst possible moment. This is the guard that makes ADR-014
  // true: `db push` is retired so the migrations are the truth, and that only
  // holds if something checks.
  //
  // The `audit_logs` immutability trigger (DATA-08) lives in a migration and is
  // not modelled by Prisma. Verified 2026-08-18 against a freshly migrated
  // database: `migrate diff` does not report it, because it compares the
  // objects Prisma models rather than the whole catalogue.
  drift: ['migrate', 'diff'],
};

const mode = process.argv[2];
const base = MODES[mode];

if (!base) {
  console.error(`usage: node scripts/migrate.mjs <${Object.keys(MODES).join('|')}>`);
  process.exit(1);
}

const url = resolveDirectDatabaseUrl();
console.log(`migrate ${mode}: ${redactUrl(url)}`);

// `migrate diff` takes its source and target as flags rather than reading the
// datasource, so it is the one mode that has to be told the URL explicitly.
const modeArgs =
  mode === 'drift'
    ? ['--from-url', url, '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code']
    : [];

const result = spawnSync('pnpm', ['exec', 'prisma', ...base, ...modeArgs, ...process.argv.slice(3)], {
  stdio: 'inherit',
  // Prisma reads the datasource from DATABASE_URL; overriding it here is what
  // swaps the pooled host for the direct one without touching schema.prisma.
  env: { ...process.env, DATABASE_URL: url },
});

process.exit(result.status ?? 1);
