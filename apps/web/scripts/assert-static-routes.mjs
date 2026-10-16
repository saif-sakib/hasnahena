#!/usr/bin/env node
/**
 * WO-73: assert the marketing pages are prerendered, from what `next build`
 * emitted (.next/prerender-manifest.json) — staticness is a conclusion of the
 * whole import graph, which no source test can reach. Run after `pnpm build`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runAsScript } from './lib/guard.mjs';

const MANIFEST = fileURLToPath(new URL('../.next/prerender-manifest.json', import.meta.url));

/** Routes that must be prerendered, per locale (auth pages are legitimately dynamic). */
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
 * Both locales PREFIXED: next-intl rewrites `/faq` to `/en/faq`, so manifest
 * keys keep the prefix even though English URLs do not.
 */
const LOCALES = ['en', 'bn'];

/** Must NOT be prerendered: dashboards (per member) and auth pages (nonce CSP). */
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
