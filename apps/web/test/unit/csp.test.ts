import { describe, it, expect } from 'vitest';

import { buildCsp, isSessionRoute } from '@/lib/csp';

/**
 * WO-76. The policy is a string, and a string is easy to get subtly wrong in
 * ways no page visibly fails on: a directive spelled slightly off is silently
 * ignored, a trailing slash turns an origin into a path prefix, and one
 * unparseable source makes a browser discard the *entire* policy — which looks
 * exactly like having no CSP, and is.
 *
 * The browser half is `e2e/csp.spec.ts`, which is the only thing that can catch
 * a policy that parses perfectly and blocks the application's own scripts.
 */

const directive = (policy: string, name: string): string => {
  const found = policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  return found ? found.slice(name.length).trim() : '';
};

const has = (policy: string, name: string): boolean =>
  policy.split(';').some((part) => part.trim() === name || part.trim().startsWith(`${name} `));

describe('the strict policy, for pages that carry a session', () => {
  const policy = buildCsp({ nonce: 'abc123', apiOrigin: 'https://api.example.com' });

  it('refuses inline scripts', () => {
    // The single assertion this file exists for. `'unsafe-inline'` in
    // script-src is the difference between a CSP that stops an XSS and one that
    // decorates the response headers.
    expect(directive(policy, 'script-src')).not.toContain("'unsafe-inline'");
  });

  it('carries the nonce it was given', () => {
    expect(directive(policy, 'script-src')).toContain("'nonce-abc123'");
  });

  it("carries 'strict-dynamic', or every content-hashed chunk would need naming", () => {
    expect(directive(policy, 'script-src')).toContain("'strict-dynamic'");
  });

  it('cannot be framed, and says so in both dialects', () => {
    expect(directive(policy, 'frame-ancestors')).toBe("'none'");
    expect(directive(policy, 'frame-src')).toBe("'none'");
  });

  it('pins the things an injected tag would otherwise repoint', () => {
    // An injected <base> silently rewrites every relative URL on the page,
    // including the ones the app posts to; form-action stops a form being
    // aimed somewhere else.
    expect(directive(policy, 'base-uri')).toBe("'self'");
    expect(directive(policy, 'form-action')).toBe("'self'");
    expect(directive(policy, 'object-src')).toBe("'none'");
  });

  it('lets the browser reach the Go API and nothing else it was not told about', () => {
    const connect = directive(policy, 'connect-src');
    expect(connect).toContain("'self'");
    expect(connect).toContain('https://api.example.com');
    expect(connect, 'dev-only websocket leaked into a production policy').not.toContain('ws:');
  });

  it('allows the upload previews and Cloudinary, and no other image host', () => {
    const img = directive(policy, 'img-src');
    expect(img).toContain('data:');
    expect(img).toContain('blob:');
    expect(img).toContain('https://res.cloudinary.com');
    expect(img).not.toContain('*');
  });

  it('names no Sentry host, because the reports are tunnelled same-origin', () => {
    // next.config.js sets tunnelRoute: '/monitoring'. A Sentry ingest host here
    // would be dead configuration that looks load-bearing.
    expect(policy).not.toContain('sentry.io');
    expect(policy).not.toContain('ingest');
  });

  it('has every directive it claims to have', () => {
    for (const name of [
      'default-src',
      'script-src',
      'style-src',
      'font-src',
      'img-src',
      'connect-src',
      'frame-src',
      'frame-ancestors',
      'object-src',
      'base-uri',
      'form-action',
      'upgrade-insecure-requests',
    ]) {
      expect(has(policy, name), `${name} is missing from the policy`).toBe(true);
    }
  });
});

describe('the content policy, for pages that are prerendered', () => {
  const policy = buildCsp({ apiOrigin: 'https://api.example.com' });

  it('tolerates inline scripts, because a prerendered page has no nonce', () => {
    // Stated as an assertion rather than left implicit: this is a deliberate,
    // documented weakening (see lib/csp.ts), and if it ever becomes possible to
    // remove it this test is what will fail and say so.
    expect(directive(policy, 'script-src')).toContain("'unsafe-inline'");
    expect(directive(policy, 'script-src')).not.toContain('nonce-');
  });

  it('is otherwise exactly as strict as the session policy', () => {
    // The weakening is confined to one directive. Everything that limits where
    // a page can send data, be framed, or post a form is identical — which is
    // what keeps the second tier worth having.
    const strict = buildCsp({ nonce: 'abc123', apiOrigin: 'https://api.example.com' });
    for (const name of [
      'default-src',
      'style-src',
      'font-src',
      'img-src',
      'connect-src',
      'frame-src',
      'frame-ancestors',
      'object-src',
      'base-uri',
      'form-action',
    ]) {
      expect(directive(policy, name), `${name} differs between the tiers`).toBe(
        directive(strict, name),
      );
    }
  });
});

describe('the API origin', () => {
  it('is reduced to an origin, never a path prefix', () => {
    // `https://api.example.com/` as a CSP source is a path match, not an
    // origin match — a different and usually wrong policy.
    const policy = buildCsp({ apiOrigin: 'https://api.example.com/v1/' });
    expect(directive(policy, 'connect-src')).toContain('https://api.example.com');
    expect(directive(policy, 'connect-src')).not.toContain('/v1');
  });

  it('is dropped rather than emitted malformed', () => {
    // A browser discards the whole policy on a parse error, so one unset or
    // mistyped env var must not be able to disable every directive above.
    const policy = buildCsp({ apiOrigin: 'not a url' });
    expect(directive(policy, 'connect-src')).toBe("'self'");
    expect(has(policy, 'frame-ancestors')).toBe(true);
  });

  it('is dropped when unset', () => {
    expect(directive(buildCsp({}), 'connect-src')).toBe("'self'");
  });
});

describe('report-only mode', () => {
  it('drops upgrade-insecure-requests, which does nothing there', () => {
    // Not cosmetic. Chromium writes "'upgrade-insecure-requests' is ignored
    // when delivered in a report-only policy" to the console on every single
    // page load, and the browser spec collects violations by reading the
    // console — so leaving it in would have meant either a permanently noisy
    // console or a matcher with a special case that could hide a real
    // violation later.
    expect(has(buildCsp({ reportOnly: true }), 'upgrade-insecure-requests')).toBe(false);
    expect(has(buildCsp({}), 'upgrade-insecure-requests')).toBe(true);
  });

  it('changes nothing else', () => {
    const reportOnly = buildCsp({ nonce: 'abc123', reportOnly: true });
    const enforcing = buildCsp({ nonce: 'abc123' });
    expect(reportOnly).toBe(enforcing.replace('; upgrade-insecure-requests', ''));
  });
});

describe('development', () => {
  it("adds 'unsafe-eval' and the hot-reload socket, and only in development", () => {
    // React uses eval in development to rebuild server-side stacks in the
    // browser. Neither of these may ever reach production.
    const dev = buildCsp({ nonce: 'abc123', isDev: true });
    expect(directive(dev, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(dev, 'connect-src')).toContain('ws:');

    const prod = buildCsp({ nonce: 'abc123' });
    expect(directive(prod, 'script-src')).not.toContain("'unsafe-eval'");
  });
});

describe('which routes get which policy', () => {
  /**
   * The routing decision, not the policy. Getting it wrong in one direction
   * serves a nonce policy to a prerendered page, which stops hydrating the day
   * enforcement is switched on; in the other it serves the weaker policy to the
   * dashboard, which is where the money is.
   *
   * `scripts/assert-static-routes.mjs` enforces the other side of this pairing:
   * every route named here must actually be dynamic in the build output.
   */
  it.each([
    ['/en/dashboard/member', true],
    ['/bn/dashboard/admin/settings', true],
    ['/en/dashboard', true],
    ['/en/login', true],
    ['/bn/register', true],
    ['/en/forgot-password', true],
    ['/en/reset-password', true],
    ['/en/about', false],
    ['/bn/gallery', false],
    ['/en', false],
    ['/', false],
    // Not a locale prefix, so not a route this app serves — and it must not be
    // mistaken for one by a regex anchored loosely.
    ['/fr/dashboard/member', false],
    ['/dashboard/member', false],
    // The prefix appearing later in the path is not the dashboard.
    ['/en/about/dashboard', false],
  ])('%s → session policy: %s', (pathname, expected) => {
    expect(isSessionRoute(pathname)).toBe(expected);
  });
});
