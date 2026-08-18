import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * WO-64. The support proxy forwards an allow-list, and an allow-list is a copy
 * of something — which means it can be a stale copy.
 *
 * The failure this prevents is quiet and confusing: someone adds a support
 * route to the Go API, the browser calls it through `lib/api.ts` (which rewrites
 * everything under `/v1/dashboard/support` to the proxy), and it 404s in
 * production with nothing in either log explaining why, because the 404 is the
 * proxy's own and never reached Go.
 *
 * So the list is checked against the router rather than trusted. No database
 * and no network: both files are read off disk.
 */

const proxySource = readFileSync(
  fileURLToPath(new URL('../../app/api/v1/dashboard/support/[...path]/route.ts', import.meta.url)),
  'utf8',
);

const mainGoSource = readFileSync(
  fileURLToPath(new URL('../../../api/cmd/server/main.go', import.meta.url)),
  'utf8',
);

/** `dashboard.Get("/support/threads", ...)` → `GET threads`. */
function routesMountedByTheApi(): Set<string> {
  const mounted = new Set<string>();
  const pattern = /dashboard\.(Get|Post|Put|Patch|Delete)\(\s*"\/support\/([^"]+)"/g;
  for (const match of mainGoSource.matchAll(pattern)) {
    mounted.add(`${match[1].toUpperCase()} ${match[2]}`);
  }
  return mounted;
}

/** The UPSTREAM_ROUTES literal → the same `METHOD path` shape. */
function routesAllowedByTheProxy(): Set<string> {
  const block = proxySource.match(/const UPSTREAM_ROUTES[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!block) throw new Error('UPSTREAM_ROUTES is no longer a literal this test can read');

  const allowed = new Set<string>();
  const entry = /^\s*'?([A-Za-z0-9/_-]+)'?:\s*\[([^\]]*)\]/gm;
  for (const match of block[1].matchAll(entry)) {
    const path = match[1];
    for (const method of match[2].matchAll(/'([A-Z]+)'/g)) {
      allowed.add(`${method[1]} ${path}`);
    }
  }
  return allowed;
}

describe('the support proxy allow-list matches the Go router', () => {
  it('reads both files (a silent zero here would make every assertion vacuous)', () => {
    expect(routesMountedByTheApi().size).toBeGreaterThan(0);
    expect(routesAllowedByTheProxy().size).toBeGreaterThan(0);
  });

  it('forwards every support route the API mounts', () => {
    const missing = [...routesMountedByTheApi()].filter((route) => !routesAllowedByTheProxy().has(route));
    expect(
      missing,
      `These support routes exist in apps/api/cmd/server/main.go but the proxy will 404 them. ` +
        `Add them to UPSTREAM_ROUTES in app/api/v1/dashboard/support/[...path]/route.ts.`,
    ).toEqual([]);
  });

  it('forwards nothing the API does not mount', () => {
    const extra = [...routesAllowedByTheProxy()].filter((route) => !routesMountedByTheApi().has(route));
    expect(
      extra,
      `The proxy forwards these, but no such support route exists in the Go router. ` +
        `A path that resolves to nothing upstream is a door with no room behind it.`,
    ).toEqual([]);
  });
});
