/**
 * Reconcile the Cloudinary asset tree with the database and repair the drift.
 *
 *   node scripts/cloudinary-reconcile.mjs             # dry run: prints the plan
 *   node scripts/cloudinary-reconcile.mjs --confirm   # applies it
 *
 * Repairs `asset_folder` for renamed assets (dynamic folder mode, ADR-040),
 * deletes unreferenced assets and dead folders under `applications/` only, and
 * reports anything unreferenced under people/, gallery/ or settings/ for a
 * human. An asset is KEPT if any stored URL anywhere contains its public id —
 * crude on purpose, so every error keeps a file rather than deleting one.
 */

import { v2 as cloudinary } from 'cloudinary';
import { PrismaClient } from '@prisma/client';

import { loadEnv } from './lib/env.mjs';
import { runAsScript, requireConfirmation } from './lib/guard.mjs';

/** Everything this application stores lives under one prefix. */
const ROOT = 'hasnahena';
const APPLICATIONS = `${ROOT}/applications`;
const PEOPLE = `${ROOT}/people`;

function configure() {
  loadEnv(
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
    'DATABASE_URL',
  );
  const missing = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].filter(
    (key) => !process.env[key],
  );
  if (missing.length) {
    throw new Error(`Cloudinary is not configured. Set ${missing.join(', ')}.`);
  }
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

/** Every asset under `hasnahena/`, of every resource type, paginated. */
async function listAssets() {
  const out = [];
  for (const resourceType of ['image', 'raw', 'video']) {
    let cursor;
    do {
      const page = await cloudinary.api.resources({
        type: 'upload',
        resource_type: resourceType,
        prefix: `${ROOT}/`,
        max_results: 500,
        next_cursor: cursor,
      });
      for (const r of page.resources) {
        out.push({
          publicId: r.public_id,
          resourceType,
          assetFolder: r.asset_folder ?? null,
          bytes: r.bytes,
          width: r.width,
          height: r.height,
          createdAt: r.created_at,
        });
      }
      cursor = page.next_cursor;
    } while (cursor);
  }
  return out;
}

/** Every folder under `hasnahena/`, depth first. */
async function listFolders(path = ROOT) {
  const out = [];
  let page;
  try {
    page = await cloudinary.api.sub_folders(path);
  } catch {
    return out;
  }
  for (const folder of page.folders) {
    out.push(folder.path);
    out.push(...(await listFolders(folder.path)));
  }
  return out;
}

/** Every URL the database holds, read wholesale so a new URL column is covered. */
async function storedUrls(prisma) {
  const [documents, users, gallery, config] = await Promise.all([
    prisma.document.findMany({ select: { url: true } }),
    prisma.user.findMany({ where: { avatarUrl: { not: null } }, select: { avatarUrl: true } }),
    prisma.galleryItem.findMany({ select: { imageUrl: true } }),
    prisma.systemConfig.findMany({ select: { value: true } }),
  ]);
  return [
    ...documents.map((d) => d.url),
    ...users.map((u) => u.avatarUrl),
    ...gallery.map((g) => g.imageUrl),
    ...config.map((c) => c.value),
  ].filter(Boolean);
}

/**
 * Application folders still owned by an UNDECIDED application — an admitted
 * member's documents are in people/, a refused one's are deleted.
 */
async function pendingApplicationFolders(prisma) {
  const users = await prisma.user.findMany({
    where: { formNumber: { not: null }, status: 'PENDING' },
    select: { formNumber: true, accountNo: true, status: true },
  });
  return new Map(users.map((u) => [`${APPLICATIONS}/${u.formNumber}`, u]));
}

/** `hasnahena/people/ACC-KH-33001/avatar` -> `hasnahena/people/ACC-KH-33001`. */
function folderOf(publicId) {
  const cut = publicId.lastIndexOf('/');
  return cut > 0 ? publicId.slice(0, cut) : '';
}

function displayNameOf(publicId) {
  return publicId.slice(publicId.lastIndexOf('/') + 1);
}

/** Pure: the two inventories in, a printable plan out. */
export function planRepairs({ assets, folders, urls, pendingFolders }) {
  const referenced = (publicId) => urls.some((url) => url.includes(publicId));

  const rehome = [];
  const orphans = [];
  const unreferencedElsewhere = [];

  for (const asset of assets) {
    const home = folderOf(asset.publicId);

    if (referenced(asset.publicId)) {
      // Filed where it is served from, or it is not really where it says it is.
      if (asset.assetFolder && asset.assetFolder !== home) {
        rehome.push({ ...asset, from: asset.assetFolder, to: home });
      }
      continue;
    }

    if (home.startsWith(`${APPLICATIONS}/`)) {
      orphans.push(asset);
      continue;
    }

    // Outside applications/: reported, never deleted.
    unreferencedElsewhere.push(asset);
  }

  // A folder goes when it will be empty and is not a pending application's.
  // people/ folders are never removed.
  const doomed = new Set(orphans.map((a) => a.publicId));
  const survivorsByFolder = new Map();
  for (const asset of assets) {
    if (doomed.has(asset.publicId)) continue;
    const home = folderOf(asset.publicId);
    survivorsByFolder.set(home, (survivorsByFolder.get(home) ?? 0) + 1);
  }

  const removeFolders = folders.filter(
    (folder) =>
      folder.startsWith(`${APPLICATIONS}/`) &&
      !survivorsByFolder.get(folder) &&
      !pendingFolders.has(folder),
  );

  // Create missing people/ folder entries (renamed-in assets have none).
  const present = new Set(folders);
  const createFolders = [
    ...new Set(
      assets
        .map((a) => folderOf(a.publicId))
        .filter((home) => home.startsWith(`${PEOPLE}/`) && !present.has(home)),
    ),
  ];

  return { rehome, orphans, unreferencedElsewhere, removeFolders, createFolders };
}

function describe(asset) {
  const size = asset.bytes >= 1024 ? `${Math.round(asset.bytes / 1024)} kB` : `${asset.bytes} B`;
  const dims = asset.width && asset.height ? ` ${asset.width}x${asset.height}` : '';
  return `${asset.publicId} (${size}${dims}, ${asset.createdAt})`;
}

async function main() {
  configure();

  const confirmed = requireConfirmation({
    url: process.env.DATABASE_URL ?? '',
    action: `reconcile Cloudinary cloud "${process.env.CLOUDINARY_CLOUD_NAME}" against this database`,
  });

  const prisma = new PrismaClient();
  let plan;
  try {
    const [assets, folders, urls, pendingFolders] = await Promise.all([
      listAssets(),
      listFolders(),
      storedUrls(prisma),
      pendingApplicationFolders(prisma),
    ]);
    console.log(`inventory: ${assets.length} assets, ${folders.length} folders, ${urls.length} stored URLs\n`);
    plan = planRepairs({ assets, folders, urls, pendingFolders });
  } finally {
    await prisma.$disconnect();
  }

  console.log(`re-home ${plan.rehome.length} asset(s) whose folder disagrees with their URL:`);
  for (const a of plan.rehome) console.log(`  ${a.publicId}\n      ${a.from}  ->  ${a.to}`);

  console.log(`\ndelete ${plan.orphans.length} unreferenced asset(s) under applications/:`);
  for (const a of plan.orphans) console.log(`  ${describe(a)}`);

  console.log(`\ndelete ${plan.removeFolders.length} folder(s) belonging to no pending application:`);
  for (const f of plan.removeFolders) console.log(`  ${f}`);

  console.log(`\ncreate ${plan.createFolders.length} missing folder entr(y|ies) under people/:`);
  for (const f of plan.createFolders) console.log(`  ${f}`);

  if (plan.unreferencedElsewhere.length) {
    console.log(
      `\nNOT TOUCHED — ${plan.unreferencedElsewhere.length} unreferenced asset(s) outside applications/.` +
        '\nThese need a person to look at them; this script will not delete a file in a member,' +
        '\ngallery or settings folder on the strength of a database row being absent:',
    );
    for (const a of plan.unreferencedElsewhere) console.log(`  ${describe(a)}`);
  }

  if (!confirmed) {
    console.log('\nDry run — nothing was changed. Re-run with --confirm to apply.');
    return;
  }

  console.log('\napplying...');

  // Each step reports its own failure and carries on, so the run stays re-runnable.
  for (const asset of plan.rehome) {
    try {
      await cloudinary.api.update(asset.publicId, {
        resource_type: asset.resourceType,
        asset_folder: asset.to,
        display_name: displayNameOf(asset.publicId),
      });
      console.log(`  re-homed ${asset.publicId}`);
    } catch (error) {
      console.log(`  FAILED to re-home ${asset.publicId}: ${error.error?.message ?? error.message}`);
    }
  }

  for (const asset of plan.orphans) {
    try {
      const result = await cloudinary.uploader.destroy(asset.publicId, {
        resource_type: asset.resourceType,
        invalidate: true,
      });
      console.log(`  ${result.result === 'ok' ? 'deleted ' : `${result.result} `}${asset.publicId}`);
    } catch (error) {
      console.log(`  FAILED to delete ${asset.publicId}: ${error.error?.message ?? error.message}`);
    }
  }

  // After the assets, or Cloudinary refuses a folder that still has something
  // in it — which is the whole reason these folders survived until now.
  for (const folder of plan.removeFolders) {
    try {
      await cloudinary.api.delete_folder(folder);
      console.log(`  removed ${folder}`);
    } catch (error) {
      console.log(`  kept ${folder}: ${error.error?.message ?? error.message}`);
    }
  }

  for (const folder of plan.createFolders) {
    try {
      await cloudinary.api.create_folder(folder);
      console.log(`  created ${folder}`);
    } catch (error) {
      console.log(`  could not create ${folder}: ${error.error?.message ?? error.message}`);
    }
  }

  console.log('\ndone.');
}

runAsScript(import.meta.url, main, { label: 'cloudinary-reconcile' });
