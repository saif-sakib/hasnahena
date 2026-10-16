/**
 * An encrypted copy of the whole Cloudinary account — the only copy of member
 * NID scans outside it (ADR-020).
 *
 *   node scripts/cloudinary-backup.mjs [outdir]
 *   → backups/hasnahena-assets-<UTC stamp>.tar.gz.gpg  (files/ + manifest.json)
 *
 * Read-only by construction (repairs are cloudinary-reconcile.mjs). Needs no
 * database and no SDK — plain fetch, runnable with just node and this file.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadEnv } from './lib/env.mjs';
import { runAsScript } from './lib/guard.mjs';

/** Everything this application stores lives under one prefix. */
const ROOT = 'hasnahena';

/** How many files to fetch at once. The CDN is not the rate-limited surface. */
const CONCURRENCY = 6;

function configure() {
  loadEnv('CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'BACKUP_PASSPHRASE');

  const missing = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].filter(
    (key) => !process.env[key],
  );
  if (missing.length) {
    throw new Error(`Cloudinary is not configured. Set ${missing.join(', ')}.`);
  }

  // Refuse without encryption: this archive holds national identity documents.
  if (!process.env.BACKUP_PASSPHRASE) {
    throw new Error(
      'BACKUP_PASSPHRASE is not set — refusing to write an unencrypted copy of members’ identity documents.',
    );
  }

}

/** One authenticated Admin API call. */
async function adminApi(pathname, params) {
  const url = new URL(
    `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/${pathname}`,
  );
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  const credentials = Buffer.from(
    `${process.env.CLOUDINARY_API_KEY}:${process.env.CLOUDINARY_API_SECRET}`,
  ).toString('base64');

  const response = await fetch(url, { headers: { Authorization: `Basic ${credentials}` } });
  if (!response.ok) {
    throw new Error(`Cloudinary ${pathname}: HTTP ${response.status} ${await response.text()}`);
  }
  return response.json();
}

/** Every asset under `hasnahena/`, of every resource type, paginated. */
async function listAssets() {
  const assets = [];
  for (const resourceType of ['image', 'raw', 'video']) {
    let cursor;
    do {
      const page = await adminApi(`resources/${resourceType}/upload`, {
        prefix: `${ROOT}/`,
        max_results: 500,
        next_cursor: cursor,
      });
      for (const r of page.resources) {
        assets.push({
          publicId: r.public_id,
          resourceType,
          format: r.format ?? null,
          assetFolder: r.asset_folder ?? null,
          bytes: r.bytes ?? null,
          width: r.width ?? null,
          height: r.height ?? null,
          version: r.version ?? null,
          createdAt: r.created_at ?? null,
          url: r.secure_url,
        });
      }
      cursor = page.next_cursor;
    } while (cursor);
  }
  return assets.sort((a, b) => a.publicId.localeCompare(b.publicId));
}

/** Where one asset is stored inside the archive. */
function localPathFor(asset) {
  const suffix = asset.format ? `.${asset.format}` : '';
  return path.join('files', `${asset.publicId}${suffix}`);
}

async function download(asset, root) {
  const response = await fetch(asset.url);
  if (!response.ok) {
    throw new Error(`${asset.publicId}: HTTP ${response.status}`);
  }
  const body = Buffer.from(await response.arrayBuffer());

  // Cloudinary reports the stored byte length; a short read is a truncated
  // backup, which is the failure that looks exactly like a good one.
  if (asset.bytes !== null && body.length !== asset.bytes) {
    throw new Error(`${asset.publicId}: got ${body.length} bytes, expected ${asset.bytes}`);
  }

  const destination = path.join(root, localPathFor(asset));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, body);
  return body.length;
}

/** Runs `worker` over `items`, at most `limit` at a time. */
async function inParallel(items, limit, worker) {
  const queue = [...items];
  const failures = [];
  let done = 0;

  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        await worker(item);
      } catch (error) {
        failures.push({ item, message: error.message });
      }
      done += 1;
      if (done % 25 === 0) {
        console.log(`  … ${done} files`);
      }
    }
  });

  await Promise.all(runners);
  return failures;
}

function run(command, args, { stdin } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: [stdin === undefined ? 'ignore' : 'pipe', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
    if (stdin !== undefined) {
      child.stdin.end(stdin);
    }
  });
}

async function main() {
  configure();

  const outDir = path.resolve(process.argv[2] ?? 'backups');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const archive = path.join(outDir, `hasnahena-assets-${stamp}.tar.gz`);

  console.log(`cloud:    ${process.env.CLOUDINARY_CLOUD_NAME}`);
  console.log(`prefix:   ${ROOT}/`);
  console.log(`out:      ${archive}.gpg`);
  console.log('');

  console.log('listing…');
  const assets = await listAssets();

  // An empty account means wrong credentials or a failed listing — fail.
  if (assets.length === 0) {
    throw new Error(`no assets found under ${ROOT}/ — refusing to write an empty archive`);
  }
  console.log(`  ${assets.length} assets`);

  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'hasnahena-assets-'));
  try {
    console.log('downloading…');
    const failures = await inParallel(assets, CONCURRENCY, (asset) => download(asset, staging));
    if (failures.length) {
      for (const failure of failures) {
        console.error(`  ✗ ${failure.item.publicId}: ${failure.message}`);
      }
      throw new Error(`${failures.length} of ${assets.length} assets could not be backed up`);
    }

    await fs.writeFile(
      path.join(staging, 'manifest.json'),
      `${JSON.stringify(
        {
          takenAt: new Date().toISOString(),
          cloudName: process.env.CLOUDINARY_CLOUD_NAME,
          prefix: `${ROOT}/`,
          count: assets.length,
          assets: assets.map((asset) => ({ ...asset, file: localPathFor(asset) })),
        },
        null,
        2,
      )}\n`,
    );

    await fs.mkdir(outDir, { recursive: true });
    console.log('archiving…');
    await run('tar', ['-czf', archive, '-C', staging, '.']);

    console.log('encrypting…');
    await run(
      'gpg',
      [
        '--batch',
        '--yes',
        '--symmetric',
        '--cipher-algo',
        'AES256',
        '--pinentry-mode',
        'loopback',
        '--passphrase-fd',
        '0',
        '--output',
        `${archive}.gpg`,
        archive,
      ],
      { stdin: process.env.BACKUP_PASSPHRASE },
    );
    await fs.rm(archive, { force: true });

    const { size } = await fs.stat(`${archive}.gpg`);
    console.log('');
    console.log(`wrote ${archive}.gpg (${size} bytes, ${assets.length} assets)`);
    console.log('');
    console.log('Restore with:');
    console.log(`  gpg --decrypt ${path.basename(archive)}.gpg > assets.tar.gz && tar -xzf assets.tar.gz`);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

runAsScript(import.meta.url, main, { label: 'cloudinary-backup' });
