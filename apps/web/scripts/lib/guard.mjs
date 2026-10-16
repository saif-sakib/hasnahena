/**
 * Guards for scripts that change a database. On 2026-09-01 a loop that merely
 * IMPORTED the scripts ran db-clear against production. Each cause is closed:
 *   1. importing ran it          -> runAsScript()
 *   2. no confirmation           -> requireConfirmation()
 *   3. against a remote database -> refuseRemoteTarget()
 */

import { pathToFileURL } from 'node:url';

/** True only when moduleUrl is the file node was asked to run. */
export function isEntrypoint(moduleUrl) {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return moduleUrl === pathToFileURL(invoked).href;
  } catch {
    return false;
  }
}

/** Run `main` only when this module is the entry point; importing runs nothing. */
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

/** Refuse a non-local database unless ALLOW_REMOTE_DATABASE is set deliberately. */
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

/** Dry run unless --confirm; names the target database either way. */
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
