import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * A script must not run because it was imported (2026-09-01: a checking loop
 * imported db-clear and emptied production). runAsScript makes the entry
 * point explicit.
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

/** Every destructive script is a dry run until --confirm (enumerated from source). */
describe('a destructive script prints its plan before it acts', () => {
  // The calls that remove something. `delete_folder` and `destroy` are
  // Cloudinary's; `deleteMany` is Prisma's.
  const DESTRUCTIVE = /\b(deleteMany\(|uploader\.destroy\(|delete_folder\(|delete_resources)/;

  for (const file of scriptFiles) {
    const source = readFileSync(join(SCRIPTS, file), 'utf8');
    if (!DESTRUCTIVE.test(source)) continue;

    it(`${file} is a dry run unless --confirm is passed`, () => {
      // The shared helper, or the same gate written out.
      const gated =
        source.includes('requireConfirmation(') ||
        /const confirmed = process\.argv\.includes\('--confirm'\)/.test(source);
      expect(
        gated,
        `${file} deletes something with no --confirm gate, so a developer who runs it to ` +
          'see what it would do finds out afterwards',
      ).toBe(true);
      // The dry run must actually return, not just print.
      expect(
        source,
        `${file} does not return from its dry run, so it falls through and deletes anyway`,
      ).toMatch(/if \(!confirmed\)[\s\S]{0,800}?return;/);
    });
  }
});

/** db:clear also refuses a remote database and requires --confirm. */
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
