/**
 * Reconcile the Cloudinary account with the database, and repair the drift.
 *
 *   node scripts/cloudinary-reconcile.mjs             # dry run: prints the plan
 *   node scripts/cloudinary-reconcile.mjs --confirm   # applies it
 *
 * Why this exists
 * ---------------
 * The asset tree is the only description of this foundation's files that
 * survives leaving Cloudinary ([ADR-040](../../../docs/decisions.md)), and on
 * 2026-09-02 it had drifted from the database in three separate ways at once:
 *
 * **1. Moved assets that never moved.** This account is in *dynamic folder*
 * mode, where `public_id` (the URL) and `asset_folder` (the folder a person
 * sees in the Media Library) are independent. `uploader.rename` — which is what
 * `fileApplicationDocuments` uses to file an admitted member's documents under
 * `people/ACC-KH-33001` — changes only the first. Every member admitted before
 * the fix therefore had four documents *served* from their own folder and still
 * *filed* under their application. `lib/cloudinary.ts` now sets both; this
 * repairs the ones already renamed.
 *
 * **2. Test pixels in the foundation's account.** `e2e/entry-path.spec.ts`
 * submits real registration forms, and its four uploads are a 70-byte 1×1
 * transparent PNG. The database half of the test rig is disposable; the image
 * host has no disposable half, so every local run of the browser suite left
 * four pixels named `nid-front`, `nid-back`, `member-photo` and `signature` in
 * whichever application folder the sequence handed out — including, after the
 * counter was restored on 2026-09-01, the folders of four admitted members,
 * where they sat *beside* the real documents under the same names.
 *
 * **3. Folders naming applications that do not exist.** A registration whose
 * uploads fail is rolled back asset by asset, which leaves the folder; an
 * approval empties a folder it could not then delete (see 1). Both are fixed at
 * source, and this clears what they left.
 *
 * What it will and will not delete
 * --------------------------------
 * An asset is **kept** if any URL stored anywhere in the database contains its
 * public id — `documents.url`, `users.avatarUrl`, `gallery_items.imageUrl` and
 * every `system_config` value, read as one haystack. That test is deliberately
 * cruder than parsing the URL: it has no second implementation of
 * `extractPublicId` to drift from the real one, and every way it can be wrong
 * keeps a file that might matter rather than deleting one.
 *
 * It will not delete anything under `people/`, ever — that is a live member's
 * folder and an unreferenced file in it is a question for a human, not for a
 * script. Deletions are confined to `applications/`, and reported in full
 * before any of them happen.
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

/**
 * Every URL the database holds, as one list of strings.
 *
 * Read wholesale rather than column by column so that a *new* place to store an
 * image URL is covered the day it is added: `system_config` alone holds the
 * logo, the favicon, the dashboard logo, the hero image and each partner.
 */
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
 * The application folders that are still an application's own.
 *
 * **Only the pending ones.** An admitted member's documents have been filed
 * under `people/<accountNo>` and their application folder is meant to have been
 * removed at that moment — `fileApplicationDocuments` ends with exactly that
 * call, and it silently failed every time because in dynamic folder mode the
 * folder it was trying to remove still contained the assets it had just
 * "moved". A refused applicant's folder is deleted at the decision
 * ([ADR-038](../../../docs/decisions.md)). So a folder belongs to somebody only
 * while the application is undecided; anything else is a leftover.
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

/**
 * What is wrong, and what to do about it.
 *
 * Pure: it reads the two inventories and returns a plan. Nothing here talks to
 * Cloudinary, which is what makes the plan printable before it is applied.
 */
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

    // `people/`, `gallery/`, `settings/` — reported, never deleted here. An
    // unreferenced file in a member's own folder is a question about that
    // member, and answering it by deleting is the one move that cannot be
    // undone.
    unreferencedElsewhere.push(asset);
  }

  // A folder goes when nothing will be left in it and it is not the folder of
  // an application still waiting for a decision. `people/` folders are never removed: a member with no avatar
  // has no folder entry at all (nothing was ever *uploaded* there, only renamed
  // in), and that is a gap to fill rather than a folder to delete.
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

  // The other half of the dynamic-folder repair: a member whose documents were
  // renamed in and who has never uploaded an avatar has assets at
  // `people/ACC-KH-33003/...` and no folder entry, so the Media Library shows
  // no folder for them at all. Creating it costs nothing and makes the tree
  // match the account.
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

  // Each step reports its own failure and carries on. A run that stops halfway
  // through because one asset would not move leaves the account in a third
  // state that neither the plan nor this script has a name for; finishing and
  // saying what did not work leaves it re-runnable, which is the property that
  // matters for something you point at a live account.
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
