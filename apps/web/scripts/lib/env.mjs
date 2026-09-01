// Shared .env loading for the standalone scripts in this directory.
//
// These scripts run under plain `node`, not under Next, so nothing has loaded
// .env for them. Next's own loader is not importable here, and pulling in
// dotenv for four scripts is not worth a dependency.
//
// Precedence is deliberate: a variable already in the real environment always
// wins, so `DATABASE_URL=... pnpm db:seed` overrides the file without editing
// it. That is what makes it safe to point a script at a scratch database.

import fs from 'node:fs';
import path from 'node:path';

function normalizeEnvValue(raw) {
  if (!raw) {
    return raw;
  }

  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }

  const inlineCommentIndex = raw.indexOf(' #');
  if (inlineCommentIndex >= 0) {
    return raw.slice(0, inlineCommentIndex).trim();
  }

  return raw;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const withoutExport = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trim()
      : trimmed;

    const eqIndex = withoutExport.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }

    const key = withoutExport.slice(0, eqIndex).trim();
    if (!key || process.env[key]) {
      continue;
    }

    process.env[key] = normalizeEnvValue(withoutExport.slice(eqIndex + 1).trim());
  }
}

/**
 * Populates process.env from the project's .env files, nearest first.
 *
 * Stops as soon as every name in `required` is known, or after exhausting the
 * candidates. Pass nothing to load them all.
 *
 * This used to be `loadDatabaseEnv` and hard-coded `DATABASE_URL`, which made it
 * useless to any script needing something else: `seo:indexnow` refused to run
 * for want of `NEXT_PUBLIC_SITE_URL` while that variable sat in the very
 * `apps/web/.env` this function reads, three lines from `DATABASE_URL`. A loader
 * that knows the name of one variable is a loader for one script.
 */
export function loadEnv(...required) {
  const isSatisfied = () => required.length > 0 && required.every((name) => process.env[name]);
  if (isSatisfied()) {
    return;
  }

  const cwd = process.cwd();
  const envPaths = [
    path.join(cwd, '.env'),
    path.join(cwd, '.env.local'),
    path.join(cwd, '..', '..', '.env'),
    path.join(cwd, '..', '..', '.env.local'),
  ];

  for (const filePath of envPaths) {
    loadEnvFile(filePath);
    if (isSatisfied()) {
      return;
    }
  }
}

/** The four database scripts' entry point, unchanged in behaviour. */
export function loadDatabaseEnv() {
  loadEnv('DATABASE_URL');
}

/**
 * Returns a connection URL safe to run schema migrations against.
 *
 * Neon serves two hostnames for every database: a pooled one (`-pooler`, which
 * is PgBouncer in transaction mode) and a direct one. `prisma migrate` takes a
 * session-level advisory lock and `pg_dump` issues session SET statements —
 * neither survives transaction pooling, and the failures are confusing rather
 * than obvious. So: prefer an explicit DIRECT_DATABASE_URL, otherwise derive
 * the direct host and say out loud that we did.
 */
export function resolveDirectDatabaseUrl({ quiet = false } = {}) {
  loadDatabaseEnv();

  const explicit = process.env.DIRECT_DATABASE_URL;
  if (explicit) {
    return explicit;
  }

  const pooled = process.env.DATABASE_URL;
  if (!pooled) {
    throw new Error('DATABASE_URL is not set. Set it in the shell or in .env.local.');
  }

  if (!pooled.includes('-pooler')) {
    return pooled;
  }

  const direct = pooled.replace('-pooler', '');
  if (!quiet) {
    console.warn(
      'DATABASE_URL points at a Neon pooler endpoint, which cannot run migrations.\n' +
        'Using the direct endpoint instead. Set DIRECT_DATABASE_URL to silence this.'
    );
  }
  return direct;
}

/** Hides credentials before a connection string reaches a log line. */
export function redactUrl(url) {
  return url.replace(/\/\/[^@/]*@/, '//***@');
}
