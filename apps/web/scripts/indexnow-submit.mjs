#!/usr/bin/env node
/**
 * Tell Bing the sitemap changed, without waiting for it to notice.
 *
 * Why this exists at all
 * ----------------------
 * Google finds a small site through Search Console: the sitemap is submitted,
 * the property is verified, and `docs/go-live.md` already says to resubmit after
 * a URL change. Bing has no equivalent that happens by itself. It crawls a new
 * domain with no inbound links slowly enough — months, not weeks — that "the
 * site is not in Bing" and "the site ranks badly in Bing" look identical from
 * the outside, and neither is fixed by editing another meta tag.
 *
 * IndexNow is the mechanism Bing publishes for exactly this: POST the URLs that
 * changed, and the crawler is told rather than left to discover. It is also read
 * by Yandex, Seznam and Naver, and — since 2024 — by Cloudflare's crawler hints,
 * which this site sits behind.
 *
 * The key is not a secret
 * -----------------------
 * IndexNow authenticates by asking the *site* to prove the key: the file at
 * `public/<key>.txt` must be reachable at `https://<host>/<key>.txt` and contain
 * the key. That is the whole scheme. Publishing the key in the repository is
 * therefore not a leak — the file it names is served to anybody who asks — and
 * keeping it in the filename is what stops the key and the file drifting apart,
 * which is the one failure this protocol has (a mismatch is a 403 that says
 * nothing else).
 *
 * Usage
 * -----
 *   node scripts/indexnow-submit.mjs                  # every URL in the sitemap
 *   node scripts/indexnow-submit.mjs /faq /bn/faq     # only these paths
 *   node scripts/indexnow-submit.mjs --dry-run        # print, submit nothing
 *
 * The host comes from NEXT_PUBLIC_SITE_URL, so this submits whatever the build
 * calls canonical rather than a second hardcoded copy of the domain. Submitting
 * the wrong host is not a small mistake: IndexNow rejects a URL whose host is
 * not the one that serves the key file, and www and the apex are different hosts
 * to it exactly as they are to a crawler.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadEnv } from './lib/env.mjs';
import { runAsScript } from './lib/guard.mjs';

// Plain `node`, so nothing has loaded .env — the same reason the four database
// scripts in this directory call this. Without it, this refused to run for want
// of a variable sitting in `apps/web/.env` beside the one `pnpm db:seed` reads.
// A real environment variable still wins, so a one-off submission to a
// different host stays `NEXT_PUBLIC_SITE_URL=... pnpm seo:indexnow`.
loadEnv('NEXT_PUBLIC_SITE_URL');

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');

const ENDPOINT = 'https://api.indexnow.org/indexnow';

function siteOrigin() {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || '').trim();
  if (!raw) {
    throw new Error(
      'NEXT_PUBLIC_SITE_URL is not set, in the shell or in apps/web/.env. It ' +
      'decides which host these URLs claim to ' +
        'be, and IndexNow refuses a host that does not serve the key file — so ' +
        'guessing it would produce a silent 403 rather than a wrong submission.',
    );
  }
  return raw.replace(/\/+$/, '').startsWith('http') ? raw.replace(/\/+$/, '') : `https://${raw.replace(/\/+$/, '')}`;
}

/** The key is the name of the only `<hex>.txt` in `public/`. */
function indexNowKey() {
  const keys = readdirSync(publicDir).filter((name) => /^[0-9a-f]{8,128}\.txt$/.test(name));
  if (keys.length !== 1) {
    throw new Error(
      `Expected exactly one IndexNow key file in public/, found ${keys.length}` +
        (keys.length ? `: ${keys.join(', ')}` : '') +
        '. The key is the filename; two of them means the crawler is told one key ' +
        'and served another.',
    );
  }
  return keys[0].replace(/\.txt$/, '');
}

/**
 * The URL list, read from the deployed sitemap rather than from
 * `publicPagePaths`.
 *
 * The sitemap is generated from that list and from `locales`, so reading it back
 * over HTTP checks the deploy actually happened before announcing it: submitting
 * a URL that 404s is how a site teaches a crawler to stop believing its hints.
 */
async function urlsFromSitemap(origin) {
  const response = await fetch(`${origin}/sitemap.xml`, {
    headers: { 'user-agent': 'hasnahena-indexnow-submit' },
  });
  if (!response.ok) {
    throw new Error(`GET ${origin}/sitemap.xml returned ${response.status}`);
  }
  const xml = await response.text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim());
  if (!urls.length) throw new Error('The sitemap parsed to zero URLs.');
  return urls;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const paths = args.filter((arg) => !arg.startsWith('--'));

  const origin = siteOrigin();
  const key = indexNowKey();
  const host = new URL(origin).host;

  const urlList = paths.length
    ? paths.map((path) => `${origin}${path.startsWith('/') ? path : `/${path}`}`)
    : await urlsFromSitemap(origin);

  console.log(`host      ${host}`);
  console.log(`key       ${key}`);
  console.log(`key file  ${origin}/${key}.txt`);
  console.log(`urls      ${urlList.length}`);
  urlList.forEach((url) => console.log(`  ${url}`));

  if (dryRun) {
    console.log('\n--dry-run: nothing submitted.');
    return;
  }

  // Checked before submitting, because a missing or mismatched key file is the
  // only way this fails, and IndexNow's own answer for it is a bare 403.
  const keyFile = await fetch(`${origin}/${key}.txt`);
  const served = keyFile.ok ? (await keyFile.text()).trim() : null;
  if (served !== key) {
    throw new Error(
      `${origin}/${key}.txt returned ${keyFile.status}${served ? ` and the body "${served}"` : ''}. ` +
        'It must return the key itself — deploy first; the file is in public/.',
    );
  }

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key, keyLocation: `${origin}/${key}.txt`, urlList }),
  });

  // 200 and 202 both mean accepted; 202 is "key not validated yet", which is
  // normal on a first submission and resolves itself once the fetcher reads the
  // file. Anything else is worth the exit code.
  if (response.status !== 200 && response.status !== 202) {
    throw new Error(`IndexNow returned ${response.status}: ${await response.text()}`);
  }
  console.log(`\nIndexNow accepted ${urlList.length} URLs (${response.status}).`);
}

runAsScript(import.meta.url, main, { label: 'indexnow' });
