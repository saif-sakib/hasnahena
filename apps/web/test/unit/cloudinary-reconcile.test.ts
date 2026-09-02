import { describe, it, expect } from 'vitest';

import * as script from '../../scripts/cloudinary-reconcile.mjs';

/**
 * The script is a plain `.mjs` — it runs under `node` with no TypeScript
 * loader, like everything else in that directory — so its exports arrive
 * untyped and the shapes are stated here instead. Writing them out is the point
 * as much as the convenience: this is the contract the plan is read against
 * before anything is deleted from a live account.
 */
type Asset = {
  publicId: string;
  resourceType: string;
  assetFolder: string | null;
  bytes: number;
  width?: number;
  height?: number;
  createdAt: string;
};

type PlanInput = {
  assets: Asset[];
  folders: string[];
  urls: string[];
  pendingFolders: Map<string, unknown>;
};

type Plan = {
  rehome: (Asset & { from: string; to: string })[];
  orphans: Asset[];
  unreferencedElsewhere: Asset[];
  removeFolders: string[];
  createFolders: string[];
};

const planRepairs = (script as unknown as { planRepairs: (input: PlanInput) => Plan })
  .planRepairs;

/**
 * The plan the reconciliation script would apply, checked without an account.
 *
 * `planRepairs` is pure and exported for exactly this reason: the script's
 * decisions are the dangerous part — what gets deleted from an account holding
 * real members' NID photographs — and they must be testable without Cloudinary
 * credentials, which CI does not have and must not have.
 *
 * Every case below is drawn from the state the account was actually in on
 * 2026-09-02: assets renamed into `people/` that the Media Library still filed
 * under `applications/`, 44 test pixels sitting beside real documents under the
 * same names, and thirteen folders for applications that were either admitted
 * long ago or never existed.
 */

const asset = (publicId: string, over: Record<string, unknown> = {}) => ({
  publicId,
  resourceType: 'image',
  assetFolder: publicId.slice(0, publicId.lastIndexOf('/')),
  bytes: 100_000,
  width: 1200,
  height: 1600,
  createdAt: '2026-08-31T04:23:00Z',
  ...over,
});

/** A member document that was renamed but whose folder never followed. */
const strandedDoc = asset('hasnahena/people/ACC-KH-33001/nid-front', {
  assetFolder: 'hasnahena/applications/APP-2026-000001',
});

/** The 70-byte 1x1 PNG that `entry-path.spec.ts` uploads. */
const testPixel = (folder: string, name: string) =>
  asset(`hasnahena/applications/${folder}/${name}`, {
    bytes: 70,
    width: 1,
    height: 1,
    createdAt: '2026-09-01T14:29:26Z',
  });

const url = (publicId: string) =>
  `https://res.cloudinary.com/demo/image/upload/v1788150180/${publicId}.jpg`;

const plan = (over: Partial<PlanInput> = {}): Plan =>
  planRepairs({
    assets: [],
    folders: [],
    urls: [],
    pendingFolders: new Map(),
    ...over,
  });

describe('planRepairs', () => {
  it('re-homes an asset the Media Library still files under its old folder', () => {
    const { rehome } = plan({ assets: [strandedDoc], urls: [url(strandedDoc.publicId)] });
    expect(rehome).toHaveLength(1);
    expect(rehome[0].from).toBe('hasnahena/applications/APP-2026-000001');
    expect(rehome[0].to).toBe('hasnahena/people/ACC-KH-33001');
  });

  it('leaves an asset alone when its folder already agrees with its URL', () => {
    const good = asset('hasnahena/people/ACC-KH-33001/avatar');
    expect(plan({ assets: [good], urls: [url(good.publicId)] }).rehome).toEqual([]);
  });

  it('deletes an application asset that no stored URL mentions', () => {
    const pixel = testPixel('APP-2026-000001', 'nid-front');
    const { orphans } = plan({ assets: [pixel], urls: [url(strandedDoc.publicId)] });
    expect(orphans.map((a) => a.publicId)).toEqual([pixel.publicId]);
  });

  it('keeps an application asset that a document row points at', () => {
    // The two pending applications on 2026-09-02. Their documents are the whole
    // reason this script may not simply empty `applications/`.
    const live = asset('hasnahena/applications/APP-2026-000005/nid-front');
    expect(plan({ assets: [live], urls: [url(live.publicId)] }).orphans).toEqual([]);
  });

  it('finds the reference wherever the URL is stored', () => {
    // system_config holds the logo, the favicon and each partner; gallery_items
    // holds the photographs. The haystack is every stored value, so a new place
    // to keep an image URL is covered the day it is added rather than the day
    // somebody remembers to widen a query.
    const logo = asset('hasnahena/settings/logo/brand');
    const { orphans, unreferencedElsewhere } = plan({
      assets: [logo],
      urls: [`{"url":"${url(logo.publicId)}"}`],
    });
    expect(orphans).toEqual([]);
    expect(unreferencedElsewhere).toEqual([]);
  });

  it('never proposes deleting outside applications/, however unreferenced', () => {
    // A member's own folder, a gallery photograph and a branding asset. An
    // unreferenced file in any of them is a question for a person: the row may
    // be the thing that is missing.
    const elsewhere = [
      asset('hasnahena/people/ACC-KH-33001/nid-front'),
      asset('hasnahena/gallery/2026-05-14-61g0po'),
      asset('hasnahena/settings/logo/brand'),
    ];
    const { orphans, unreferencedElsewhere } = plan({ assets: elsewhere });
    expect(orphans).toEqual([]);
    expect(unreferencedElsewhere).toHaveLength(3);
  });

  it('removes an application folder once nothing will be left in it', () => {
    const pixel = testPixel('APP-2026-000011', 'nid-front');
    const { removeFolders } = plan({
      assets: [pixel],
      folders: ['hasnahena/applications/APP-2026-000011'],
    });
    expect(removeFolders).toEqual(['hasnahena/applications/APP-2026-000011']);
  });

  it("removes an admitted member's application folder, which the approval could not", () => {
    // The folder holds nothing once the documents are re-homed out of it. Six
    // of these had survived every approval since the first member.
    const { removeFolders } = plan({
      assets: [strandedDoc],
      urls: [url(strandedDoc.publicId)],
      folders: ['hasnahena/applications/APP-2026-000001'],
    });
    expect(removeFolders).toEqual(['hasnahena/applications/APP-2026-000001']);
  });

  it('keeps the folder of an application still waiting for a decision', () => {
    // Even when it is empty: an undecided application with no documents is a
    // defect to notice, not a directory to tidy away.
    const { removeFolders } = plan({
      folders: ['hasnahena/applications/APP-2026-000007'],
      pendingFolders: new Map([['hasnahena/applications/APP-2026-000007', { status: 'PENDING' }]]),
    });
    expect(removeFolders).toEqual([]);
  });

  it('keeps a folder that still holds a referenced asset', () => {
    const live = asset('hasnahena/applications/APP-2026-000005/nid-front');
    const { removeFolders } = plan({
      assets: [live],
      urls: [url(live.publicId)],
      folders: ['hasnahena/applications/APP-2026-000005'],
    });
    expect(removeFolders).toEqual([]);
  });

  it("creates the folder entry a member without an avatar never got", () => {
    // A rename does not create a folder, so a member whose documents were filed
    // in and who has never uploaded a profile picture has assets under
    // `people/ACC-KH-33003` and no folder anybody can open.
    const { createFolders } = plan({
      assets: [asset('hasnahena/people/ACC-KH-33003/nid-front')],
      folders: ['hasnahena/people/ACC-KH-33001'],
    });
    expect(createFolders).toEqual(['hasnahena/people/ACC-KH-33003']);
  });
});
