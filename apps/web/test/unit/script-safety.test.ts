import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * A script in `scripts/` must not do its work merely because it was imported.
 *
 * On 2026-09-01 a loop written to check the four database scripts still parsed
 * after a refactor —
 *
 *   for f in migrate.mjs seed.mjs go-live-purge.mjs db-clear-preserve-core.mjs; do
 *     node -e "await import('./scripts/$f')" >/dev/null 2>&1 && echo "$f ok"
 *   done
 *
 * — imported `db-clear-preserve-core.mjs`, whose last line was a bare `main()`,
 * and deleted every member of the foundation from the production database. The
 * `>/dev/null` hid the script's own "Database cleanup completed" banner and its
 * before/after counts, so the loop printed `ok` four times. Recovery was a Neon
 * point-in-time restore.
 *
 * The lesson is not "be careful with imports" — it is that a module which runs
 * on load has no safe way to be inspected, and inspecting things is what tools
 * and editors and test runners do. `runAsScript` makes the entry point explicit,
 * so an import yields the exports and nothing happens.
 */
const WEB_ROOT = resolve(new URL('.', import.meta.url).pathname, '..', '..');
const SCRIPTS = join(WEB_ROOT, 'scripts');

const scriptFiles = readdirSync(SCRIPTS).filter((f) => f.endsWith('.mjs'));

describe('no script in scripts/ runs on import', () => {
  it('finds the scripts to check', () => {
    // A rename that emptied this list would make every assertion below vacuous.
    expect(scriptFiles.length).toBeGreaterThanOrEqual(4);
    expect(scriptFiles).toContain('db-clear-preserve-core.mjs');
  });

  for (const file of scriptFiles) {
    it(`${file} guards its entry point`, () => {
      const source = readFileSync(join(SCRIPTS, file), 'utf8');

      // A bare `main()` at the start of a line is the shape that caused this.
      const bareInvocation = /^\s*(await\s+)?main\(\)/m.test(source);
      expect(
        bareInvocation,
        `${file} calls main() at module scope, so importing it runs it`,
      ).toBe(false);

      // Every script must either route through the guard or have no work to do
      // on load at all.
      const hasWork = /^(async\s+)?function main\b/m.test(source);
      if (hasWork) {
        expect(
          source.includes('runAsScript(import.meta.url'),
          `${file} defines main() but does not start it with runAsScript(import.meta.url, …)`,
        ).toBe(true);
      }
    });
  }
});

/**
 * The destructive script needs two guards beyond the entry point, because the
 * entry point alone would not have saved it: a developer running
 * `pnpm db:clear` with a production `.env` on the path is doing exactly what
 * the accident did, deliberately.
 */
describe('db:clear cannot quietly empty a real database', () => {
  const source = readFileSync(join(SCRIPTS, 'db-clear-preserve-core.mjs'), 'utf8');

  it('is a dry run unless --confirm is passed', () => {
    expect(source).toContain('requireConfirmation(');
    // The dry run has to actually return before the deletes, not merely print.
    expect(source).toMatch(/if \(!confirmed\)[\s\S]{0,200}return;/);
  });

  it('refuses a database that is not on this machine', () => {
    expect(source).toContain('refuseRemoteTarget(');
  });

  it('deletes users only inside the confirmed branch', () => {
    const confirmIndex = source.indexOf('requireConfirmation(');
    const deleteIndex = source.indexOf('user.deleteMany');
    expect(confirmIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeGreaterThan(-1);
    expect(
      deleteIndex,
      'the delete runs before the confirmation is checked',
    ).toBeGreaterThan(confirmIndex);
  });
});
