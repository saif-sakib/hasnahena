#!/usr/bin/env node
/**
 * WO-73. Asserts that the marketing pages are prerendered, by reading what
 * `next build` actually emitted.
 *
 * Why a build artifact and not a unit test
 * ---------------------------------------
 * "Is this route static?" is not a property of the source. It is the conclusion
 * Next draws after following every import in the page, its layout, and every
 * component either renders — one `cookies()`, `headers()` or uncached database
 * read anywhere in that graph and the whole route goes back to being
 * server-rendered on demand. No test that reads the source can know that, and a
 * test that greps for `export const revalidate` would pass on exactly the
 * regression this exists to catch.
 *
 * `next build` already computes the answer and writes it to
 * `.next/prerender-manifest.json`. This reads that file.
 *
 * Run it after `pnpm build`. CI does.
 *
 * The failure it prevents is silent and expensive: someone adds an innocuous
 * `await prisma.something.findMany()` to a marketing page or to `<Header>`, ten
 * routes quietly become dynamic again, and every visit to `/en/privacy` opens a
 * Neon connection from a Vercel function — which was the state of this
 * repository until 2026-08-19, when 50 of 52 routes were `ƒ`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runAsScript } from './lib/guard.mjs';

const MANIFEST = fileURLToPath(new URL('../.next/prerender-manifest.json', import.meta.url));

/**
 * Routes that must be prerendered, per locale.
 *
 * Deliberately a list rather than "everything outside dashboard/": the auth
 * pages (`/login`, `/register`, `/forgot-password`, `/reset-password`) read a
 * token or a query parameter and are legitimately dynamic, and a rule that
 * swept them in would be turned off the first time it fired.
 */
const MUST_BE_STATIC = [
  '',
  '/about',
  '/activities',
  '/contact',
  '/donate',
  '/faq',
  '/gallery',
  '/privacy',
  '/support',
  '/terms',
];

/**
 * Both locales, both **prefixed** — and that is correct even though English URLs
 * lost their prefix in WO-95.
 *
 * `localePrefix: 'as-needed'` is a routing rule, not a file-system one: the app
 * still lives under `app/[locale]/`, `generateStaticParams` still yields `en`
 * and `bn`, and next-intl *rewrites* `/faq` to `/en/faq` in the middleware. So
 * the prerender manifest keys are unchanged, and rewriting this list to match
 * the public URLs would make it look for routes the build never emits — every
 * English page would be reported missing.
 */
const LOCALES = ['en', 'bn'];

/**
 * Routes that must NOT be prerendered.
 *
 * The dashboards because a member's page is not shareable. The auth pages
 * because WO-76's strict CSP carries a per-request nonce, and Next can only
 * stamp that onto its script tags while rendering a request — a prerendered
 * login page would be served a policy that blocks its own hydration the day
 * `CSP_ENFORCE` is switched on, and nothing before that day would say so.
 */
const MUST_BE_DYNAMIC = [
  '/dashboard/member',
  '/dashboard/worker',
  '/dashboard/admin',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
];

function main() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch (error) {
    console.error(
      `Could not read ${MANIFEST}\n` +
        'Run `pnpm build` first — this script checks the build output, not the source.\n' +
        String(error),
    );
    process.exit(2);
  }

  const prerendered = new Set(Object.keys(manifest.routes || {}));

  const missing = [];
  for (const locale of LOCALES) {
    for (const path of MUST_BE_STATIC) {
      const route = `/${locale}${path}`;
      if (!prerendered.has(route)) missing.push(route);
    }
  }

  const leaked = [];
  for (const locale of LOCALES) {
    for (const path of MUST_BE_DYNAMIC) {
      const route = `/${locale}${path}`;
      if (prerendered.has(route)) leaked.push(route);
    }
  }

  if (missing.length === 0 && leaked.length === 0) {
    console.log(
      `✓ ${MUST_BE_STATIC.length * LOCALES.length} marketing routes prerendered; ` +
        'no dashboard route is.',
    );
    return;
  }

  if (missing.length > 0) {
    console.error(
      '✗ These routes are server-rendered on demand and must not be:\n' +
        missing.map((r) => `    ${r}`).join('\n') +
        '\n\n  Each one now opens a database connection on every visit. The usual\n' +
        '  cause is an uncached read added to the page, to its layout, or to a\n' +
        '  component it renders — use getPublicSettings()/getPublicGalleryItems()\n' +
        '  in lib/, which are cached and tagged.',
    );
  }
  if (leaked.length > 0) {
    console.error(
      '\n✗ These routes are prerendered and must not be:\n' +
        leaked.map((r) => `    ${r}`).join('\n') +
        '\n\n  A dashboard route prerendered shows one member\'s money to whoever\n' +
        "  asks for the page next. An auth route prerendered gets a CSP whose\n" +
        '  nonce was never stamped onto its scripts, and stops working the day\n' +
        '  CSP_ENFORCE is set.',
    );
  }
  process.exit(1);
}

runAsScript(import.meta.url, async () => main(), { label: 'assert-static-routes' });
