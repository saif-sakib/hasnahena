#!/usr/bin/env node

// `prisma migrate` against the DIRECT (non-pooler) URL: migrate needs a
// session advisory lock that PgBouncer transaction mode cannot hold.
//
//   pnpm db:migrate           apply pending migrations (production, CI)
//   pnpm db:migrate:dev       create a migration from schema.prisma changes
//   pnpm db:migrate:status    what is applied and what is not
//   pnpm db:migrate:check     does the migrated database match schema.prisma?
//   pnpm db:migrate:baseline  one-time, for a database built by `db push`
//   pnpm db:migrate:adopt     rebuild the history table for a current schema

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDirectDatabaseUrl, redactUrl } from './lib/env.mjs';
import { isEntrypoint } from './lib/guard.mjs';

// A script, not a module: importing it is an error, never an action.
if (!isEntrypoint(import.meta.url)) {
  throw new Error('migrate.mjs is a script — run it with node, do not import it');
}

const MODES = {
  deploy: ['migrate', 'deploy'],
  dev: ['migrate', 'dev'],
  status: ['migrate', 'status'],
  // Marks 0_init applied without running it (databases built by `db push`).
  baseline: ['migrate', 'resolve', '--applied', '0_init'],
  // WO-54: diff the migrated database against schema.prisma; exit 2 on drift.
  // Blind to the audit_logs trigger and CHECK constraints (not Prisma-modelled).
  drift: ['migrate', 'diff'],
  // Mark EVERY migration applied, running none — for an emptied
  // `_prisma_migrations` on a current schema (runbook §5b). Changes no data;
  // refuses unless db:migrate:check passes first.
  adopt: null,
};

const mode = process.argv[2];
// `in`, not truthiness: `adopt` is null but valid.
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

  // The precondition is checked, never trusted.
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
