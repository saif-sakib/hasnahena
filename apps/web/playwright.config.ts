import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end config.
 *
 * These specs need a running stack *and* seeded data — they log in as a real
 * member and move real money through the request → process → confirm loop. They
 * are deliberately not part of `pnpm typecheck` or `pnpm lint`; run them with
 * `pnpm test:e2e` against a local database you are willing to write to. Never
 * point BASE_URL at production.
 */
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  // One worker: the specs share a database and a fixed set of seeded accounts,
  // so parallel runs would fight over the same balances.
  workers: 1,
  fullyParallel: false,
  // Fail the run if a spec was accidentally committed with .only.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Video costs an ffmpeg process per test — around 30% of a core — and the
    // screenshot plus trace already say what failed. `PWVIDEO=1` turns it back
    // on for a spec that needs to be watched.
    video: process.env.PWVIDEO ? 'retain-on-failure' : 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Only start a server if one is not already running, so `pnpm dev` in another
  // terminal is respected.
  webServer: {
    command: 'pnpm --filter @hasnahena/web dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
