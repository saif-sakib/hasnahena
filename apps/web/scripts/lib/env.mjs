// .env loading for the plain-node scripts. A variable already in the real
// environment always wins.

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

/** Populate process.env from the project's .env files, nearest first, until `required` are known. */
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
 * A URL safe for migrations: DIRECT_DATABASE_URL, else the Neon pooler host
 * with `-pooler` removed (migrate and pg_dump need a session).
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
