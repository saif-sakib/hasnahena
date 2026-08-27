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
//   pnpm db:migrate:adopt     rebuild the history table for a database whose
//                             schema is already current

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  // Marks **every** migration as applied, without running any of them.
  //
  // For one situation, and it is not a rare one: `_prisma_migrations` has been
  // emptied — by hand in a database console, by a restore that missed it, by
  // copying a database without it — while the schema itself is fully up to date.
  // Prisma has no memory of the migrations then, so `migrate deploy` tries to
  // replay them from the beginning and fails on the first `CREATE TABLE`, with
  // an error about a table that already exists rather than about the history it
  // actually lost.
  //
  // `baseline` above solves the same shape of problem for `0_init` alone, which
  // was the one-time move off `db push`. This is its general form.
  //
  // **It changes no data and no schema** — every `migrate resolve --applied` is
  // a row inserted into `_prisma_migrations`. So the precondition is the whole
  // risk: the database must already *be* at the latest schema. Run
  // `pnpm db:migrate:check` first, which is the thing that can tell you, and
  // this mode runs it for you and refuses if it disagrees.
  adopt: null,
};

const mode = process.argv[2];
// `in`, not truthiness: `adopt` has no fixed argument list — it is handled
// below — and a `null` entry read as "unknown mode" is a usage error printed
// for a mode that exists.
if (!(mode in MODES)) {
  console.error(`usage: node scripts/migrate.mjs <${Object.keys(MODES).join('|')}>`);
  process.exit(1);
}
const base = MODES[mode];

const url = resolveDirectDatabaseUrl();
console.log(`migrate ${mode}: ${redactUrl(url)}`);

if (mode === 'adopt') {
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'migrations');
  const names = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  // The precondition, checked rather than trusted. Marking migrations applied
  // against a schema that is *behind* leaves a database Prisma believes is
  // current and that is missing columns — the exact failure this mode exists to
  // repair, made permanent and invisible.
  const drift = spawnSync(
    'pnpm',
    ['exec', 'prisma', 'migrate', 'diff', '--from-url', url,
     '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'],
    { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } },
  );
  if (drift.status !== 0) {
    console.error('');
    console.error('This database does not match schema.prisma, so its history cannot');
    console.error('simply be marked as caught up — some of these migrations really do');
    console.error('still need to run. Restore _prisma_migrations from a backup, or ask');
    console.error('for help before going further. Nothing was changed.');
    process.exit(2);
  }

  for (const name of names) {
    const step = spawnSync(
      'pnpm',
      ['exec', 'prisma', 'migrate', 'resolve', '--applied', name],
      { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } },
    );
    if (step.status !== 0) {
      console.error(`Stopped at ${name}. Migrations before it are recorded; re-run to continue.`);
      process.exit(step.status ?? 1);
    }
  }
  console.log(`\nRecorded ${names.length} migration(s) as applied. Nothing was executed.`);
  process.exit(0);
}

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
