#!/usr/bin/env node
/**
 * Tell Bing (and other IndexNow readers) the sitemap changed. The key is not a
 * secret: IndexNow verifies it via the served file public/<key>.txt.
 *
 *   node scripts/indexnow-submit.mjs                  # every URL in the sitemap
 *   node scripts/indexnow-submit.mjs /faq /bn/faq     # only these paths
 *   node scripts/indexnow-submit.mjs --dry-run        # print, submit nothing
 *
 * The host is NEXT_PUBLIC_SITE_URL (www and apex are different hosts).
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadEnv } from './lib/env.mjs';
import { runAsScript } from './lib/guard.mjs';

// Plain node: load .env ourselves; a real env var still wins.
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

/** URLs from the DEPLOYED sitemap, which also proves the deploy happened. */
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

  // 202 = key not validated yet, normal on a first submission.
  if (response.status !== 200 && response.status !== 202) {
    throw new Error(`IndexNow returned ${response.status}: ${await response.text()}`);
  }
  console.log(`\nIndexNow accepted ${urlList.length} URLs (${response.status}).`);
}

runAsScript(import.meta.url, main, { label: 'indexnow' });
