import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * moveAsset must update BOTH public_id and asset_folder (dynamic folder mode;
 * rename changes only the first). Mocks the SDK, unlike cloudinary.test.ts.
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
    // Logged, not thrown — the URL is already right (cloudinary-reconcile.mjs repairs).
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
