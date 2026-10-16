import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The browser suite and the API must use the SAME database: @next/env re-applies
 * apps/web/.env over an inherited DATABASE_URL, so the web half once used the
 * developer's own database. TEST_DATABASE_URL (defined in no .env) fixes it.
 */

const ROOT = resolve(new URL('.', import.meta.url).pathname, '..', '..', '..', '..');
const read = (file: string) => readFileSync(resolve(ROOT, file), 'utf8');

describe('the test stack and the web app agree on which database is under test', () => {
  it('the stack hands the web server TEST_DATABASE_URL, not only DATABASE_URL', () => {
    const script = read('scripts/test-stack.sh');
    const serve = script.slice(script.indexOf('starting Next on'));
    const invocation = serve.slice(0, serve.indexOf('web.pid') + 'web.pid'.length);

    expect(
      invocation,
      'test-stack.sh starts `next dev` without TEST_DATABASE_URL. DATABASE_URL ' +
        'alone is not enough: Next overwrites it from apps/web/.env, so the web ' +
        "app runs against the developer's own database while the Go API runs " +
        'against the test one, and the browser suite proves nothing about either.',
    ).toContain('TEST_DATABASE_URL=');
  });

  it('the Prisma client prefers TEST_DATABASE_URL outside production', () => {
    const source = read('apps/web/lib/prisma.ts');

    expect(
      source,
      'lib/prisma.ts no longer reads TEST_DATABASE_URL, so passing it in the ' +
        'test stack does nothing at all',
    ).toContain('TEST_DATABASE_URL');

    expect(
      source,
      'lib/prisma.ts hands the url to PrismaClient. Reading the variable and ' +
        'not using it is the shape this test exists to refuse.',
    ).toMatch(/datasources:\s*\{\s*db:\s*\{\s*url/);
  });

  it('and never in production, whatever the host environment holds', () => {
    // Never honoured in production.
    const source = read('apps/web/lib/prisma.ts');

    expect(source).toMatch(/NODE_ENV\s*===\s*'production'\)\s*return undefined/);
  });
});
