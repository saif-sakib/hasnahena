import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `moveAsset` has to move **both halves** of an asset.
 *
 * This account is in Cloudinary's *dynamic folder* mode, where `public_id` — the
 * path in the URL — and `asset_folder` — the folder the Media Library draws —
 * are independent properties, and `uploader.rename` changes only the first.
 *
 * That is not a subtlety anybody would notice from the outside, and nothing
 * failed when it was wrong: for every member admitted before 2026-09-02 the four
 * registration documents were *served* from `people/ACC-KH-33001` and still
 * *filed* under `applications/APP-2026-000001`. The database was correct
 * throughout, every URL worked, and two things followed from it — the
 * `deleteEmptyFolder` ending each approval silently did nothing for ever
 * (the folder still held what had just been moved out of it), and when the
 * application numbers came round again after a restore, four of those folders
 * took a second set of files under the same four names.
 *
 * So this file mocks the SDK, unlike `cloudinary.test.ts` beside it, which
 * deliberately never touches it. The thing under test *is* the pair of calls.
 */

const { rename, update } = vi.hoisted(() => ({ rename: vi.fn(), update: vi.fn() }));

vi.mock('cloudinary', () => ({
  v2: {
    config: vi.fn(),
    uploader: { rename },
    api: { update },
  },
}));

const { moveAsset } = await import('./cloudinary');

const FROM = 'hasnahena/applications/APP-2026-000001/nid-front';
const TO = 'hasnahena/people/ACC-KH-33001/nid-front';
const URL = `https://res.cloudinary.com/x/image/upload/v1/${TO}.jpg`;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
  process.env.CLOUDINARY_API_KEY = 'test-key';
  process.env.CLOUDINARY_API_SECRET = 'test-secret';
  rename.mockResolvedValue({ secure_url: URL });
  update.mockResolvedValue({});
});

describe('moveAsset', () => {
  it('files the asset where it now serves from, not only renames it', async () => {
    await expect(moveAsset(FROM, TO)).resolves.toBe(URL);

    expect(rename).toHaveBeenCalledWith(FROM, TO, { overwrite: true, invalidate: true });
    expect(
      update,
      'the rename moved the URL and left the Media Library showing the file in the ' +
        "applicant's folder — which is what made deleteEmptyFolder a no-op for every " +
        'member ever admitted',
    ).toHaveBeenCalledWith(TO, {
      asset_folder: 'hasnahena/people/ACC-KH-33001',
      display_name: 'nid-front',
    });
  });

  it('renames before it re-files', async () => {
    // `api.update` addresses the asset by its **new** public id, so the order is
    // load-bearing rather than stylistic.
    await moveAsset(FROM, TO);
    expect(rename.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]);
  });

  it('still reports success when only the folder update fails', async () => {
    // The bytes have moved and the URL is right; the asset is served correctly
    // either way. Failing an approval over the librarian's view would be the
    // wrong trade — `scripts/cloudinary-reconcile.mjs` finds what is left behind.
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    update.mockRejectedValue(new Error('folder mode not enabled'));

    await expect(moveAsset(FROM, TO)).resolves.toBe(URL);
    expect(warned, 'a half-finished move with no evidence is how this went unnoticed').toHaveBeenCalled();
    warned.mockRestore();
  });

  it('does not re-file anything when the rename itself failed', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    rename.mockRejectedValue(new Error('not found'));

    await expect(moveAsset(FROM, TO)).resolves.toBeNull();
    expect(
      update,
      'updating the folder of an asset that was never renamed would file a live ' +
        "member's document under a member it does not belong to",
    ).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it('does nothing when the source and destination are the same', async () => {
    await expect(moveAsset(TO, TO)).resolves.toBeNull();
    expect(rename).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
