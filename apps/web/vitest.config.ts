import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// CI-04. Unit tests for the pure logic in `lib/` — no DOM, no database, no
// network. Component and page behaviour is Playwright's job (`pnpm test:e2e`);
// this suite exists for the functions that are cheap to test exhaustively and
// expensive to get wrong: money formatting, amount-in-words on generated
// documents, reference-number parsing, and the registration validators.
export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path alias in tsconfig.json. Without it every import in
    // the files under test fails to resolve.
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
    // Anything reaching for a browser API or a database belongs in Playwright or
    // the Go integration suite, not here — keep this suite fast enough that
    // there is never a reason to skip it.
    passWithNoTests: false,
  },
});
