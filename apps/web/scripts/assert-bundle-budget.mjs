#!/usr/bin/env node
/**
 * WO-83: first-load JS per route against bundle-budget.json, from the build's
 * own route-bundle-stats.json. A route missing from the baseline fails.
 *
 *   node scripts/assert-bundle-budget.mjs            # check (CI)
 *   node scripts/assert-bundle-budget.mjs --update   # re-record the baseline
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATS = resolve(WEB_ROOT, '.next/diagnostics/route-bundle-stats.json');
const BASELINE = resolve(WEB_ROOT, 'bundle-budget.json');

/** Allowed growth per route. */
const DEFAULT_TOLERANCE = 0.1;

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;
const pct = (ratio) => `${(ratio * 100).toFixed(1)}%`;

function readStats() {
  if (!existsSync(STATS)) {
    console.error(
      `✗ ${STATS} is missing.\n` +
        `  Run \`pnpm build\` first — this script reads what the build emitted, not the source.`,
    );
    process.exit(1);
  }
  const stats = JSON.parse(readFileSync(STATS, 'utf8'));
  if (!Array.isArray(stats) || stats.length === 0) {
    console.error('✗ route-bundle-stats.json is empty. A guard that measures nothing passes forever.');
    process.exit(1);
  }
  return new Map(stats.map((row) => [row.route, row.firstLoadUncompressedJsBytes]));
}

const measured = readStats();
const update = process.argv.includes('--update');

if (update) {
  const routes = Object.fromEntries([...measured.entries()].sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(
    BASELINE,
    `${JSON.stringify({ tolerance: DEFAULT_TOLERANCE, routes }, null, 2)}\n`,
  );
  console.log(`✓ recorded ${measured.size} routes in bundle-budget.json`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(`✗ ${BASELINE} is missing. Create it with \`--update\`.`);
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const tolerance = typeof baseline.tolerance === 'number' ? baseline.tolerance : DEFAULT_TOLERANCE;
const recorded = baseline.routes ?? {};

const grown = [];
const unrecorded = [];
const vanished = [];
const shrunk = [];

for (const [route, bytes] of measured) {
  const before = recorded[route];
  if (before === undefined) {
    unrecorded.push({ route, bytes });
    continue;
  }
  const change = (bytes - before) / before;
  if (change > tolerance) grown.push({ route, before, bytes, change });
  else if (change < -tolerance) shrunk.push({ route, before, bytes, change });
}

for (const route of Object.keys(recorded)) {
  if (!measured.has(route)) vanished.push(route);
}

let failed = false;

if (grown.length) {
  failed = true;
  console.error(`✗ ${grown.length} route(s) ship more than ${pct(tolerance)} extra JavaScript:\n`);
  for (const g of grown.sort((a, b) => b.change - a.change)) {
    console.error(`    ${g.route}\n      ${kb(g.before)} → ${kb(g.bytes)}  (+${pct(g.change)})`);
  }
  console.error(
    `\n  This is first-load JavaScript, on every visit, on a phone. Find what was added — ` +
      `usually one import pulled into a shared component — or accept the cost deliberately ` +
      `with \`node scripts/assert-bundle-budget.mjs --update\`.\n`,
  );
}

if (unrecorded.length) {
  failed = true;
  console.error(`✗ ${unrecorded.length} route(s) have no recorded budget:\n`);
  for (const u of unrecorded) console.error(`    ${u.route}  (${kb(u.bytes)})`);
  console.error(
    `\n  A new route's first-load cost is a number worth looking at once. ` +
      `Accept it with \`--update\`.\n`,
  );
}

if (vanished.length) {
  failed = true;
  console.error(`✗ ${vanished.length} recorded route(s) are not in this build:\n`);
  for (const v of vanished) console.error(`    ${v}`);
  console.error(
    `\n  Either a route was removed and the baseline needs tidying with \`--update\`, ` +
      `or the build did not produce what it used to.\n`,
  );
}

if (shrunk.length) {
  // Not a failure. But a baseline that is far above reality has stopped being a
  // budget, because the next regression fits underneath it.
  console.log(`ℹ ${shrunk.length} route(s) got more than ${pct(tolerance)} smaller — re-baseline when convenient:`);
  for (const s of shrunk) console.log(`    ${s.route}  ${kb(s.before)} → ${kb(s.bytes)}  (${pct(s.change)})`);
}

if (failed) process.exit(1);

const largest = [...measured.entries()].sort((a, b) => b[1] - a[1])[0];
console.log(
  `✓ ${measured.size} routes within ${pct(tolerance)} of budget; largest is ${largest[0]} at ${kb(largest[1])}.`,
);
