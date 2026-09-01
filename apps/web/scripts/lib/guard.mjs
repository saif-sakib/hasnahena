/**
 * Guards for scripts that change a database.
 *
 * Every script in this directory ends in a bare `main()`, which means that
 * *importing* one runs it. That is not a theoretical hazard. On 2026-09-01 a
 * loop written to check the four database scripts still parsed —
 *
 *   for f in migrate.mjs seed.mjs go-live-purge.mjs db-clear-preserve-core.mjs; do
 *     node -e "await import('./scripts/$f')" >/dev/null 2>&1
 *   done
 *
 * — imported `db-clear-preserve-core.mjs` and deleted every member of the
 * foundation from the production database. The output was redirected away, so
 * the script's own "Database cleanup completed" banner and its before/after
 * counts were never seen; the loop reported "ok". Recovery was a Neon
 * point-in-time restore.
 *
 * Three things had to be true at once, and each one is closed below:
 *   1. importing the module ran it            -> runAsScript()
 *   2. it destroyed data with no confirmation -> requireConfirmation()
 *   3. it did so against a remote database    -> refuseRemoteTarget()
 */

import { pathToFileURL } from 'node:url';

/**
 * True only when `moduleUrl` is the file node was actually asked to run.
 *
 * `import.meta.url` is the module's own URL; `process.argv[1]` is the entry
 * point. They are equal exactly when this file is the script being executed,
 * and differ under `import`, under a test runner, and under a bundler.
 */
export function isEntrypoint(moduleUrl) {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return moduleUrl === pathToFileURL(invoked).href;
  } catch {
    return false;
  }
}

/**
 * Run `main` only when this module is the process's entry point.
 *
 * Replaces a bare `main().catch(...)`. Importing the module now yields its
 * exports and runs nothing, which is what the import in a checking loop, a
 * test, or an editor's module graph expects.
 */
export function runAsScript(moduleUrl, main, { label = 'script' } = {}) {
  if (!isEntrypoint(moduleUrl)) return;
  main().catch((error) => {
    console.error(`\n${label} failed:`, error.message);
    process.exit(1);
  });
}

/** Host and database of a connection string, with the credentials removed. */
export function describeTarget(url) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

/**
 * Refuse a database that is not on this machine.
 *
 * `db:clear` is a development convenience: its normal target is the Docker
 * Postgres on localhost. Nothing about it is meant for a managed host, and the
 * only time it has ever pointed at one it destroyed the foundation's data. A
 * developer who really does mean it can say so in the environment, which is a
 * deliberate act rather than an inherited `.env`.
 */
export function refuseRemoteTarget(url, { allowEnv = 'ALLOW_REMOTE_DATABASE' } = {}) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return;
  }
  const isLocal = ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(host);
  if (isLocal || process.env[allowEnv] === 'yes') return;

  console.error(`\nRefusing to run against ${describeTarget(url)}.`);
  console.error('That is not a local database, and this script deletes data.');
  console.error(`If you are certain, re-run with ${allowEnv}=yes in the environment.`);
  process.exit(1);
}

/**
 * A destructive script is a dry run unless `--confirm` is passed, and says
 * plainly which database it is about to change either way.
 *
 * Matches go-live-purge.mjs, which had this from the start and was therefore
 * harmless in the same loop that emptied the database next to it.
 */
export function requireConfirmation({ url, action }) {
  const confirmed = process.argv.includes('--confirm');
  console.log(`target:   ${describeTarget(url)}`);
  console.log(`action:   ${action}`);
  console.log(
    confirmed
      ? 'mode:     CONFIRMED — this will delete data'
      : 'mode:     dry run (pass --confirm to apply)',
  );
  console.log('');
  return confirmed;
}
