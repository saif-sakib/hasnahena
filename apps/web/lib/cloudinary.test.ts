import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  extractPublicId,
  buildUploadOptions,
  settingsImageFolder,
  AVATAR_TRANSFORMATION,
  CloudinaryConfigurationError,
  uploadImage,
  deleteOldAvatar,
} from './cloudinary';

// WO-63 / WO-55: which asset an operation touches. Pure — no Cloudinary calls.

const BASE = 'https://res.cloudinary.com/hasnahena/image/upload';
const ID = 'hasnahena/profiles/member/abc123';

describe('extractPublicId', () => {
  const cases: Array<[string, string, string | null]> = [
    ['plain', `${BASE}/${ID}.jpg`, ID],
    ['versioned', `${BASE}/v1712345678/${ID}.jpg`, ID],
    // The normal (transformed) avatar URL.
    ['transformed', `${BASE}/w_400,h_400,c_fill,g_face/${ID}.jpg`, ID],
    ['transformed and versioned', `${BASE}/w_400,h_400,c_fill,g_face/v1712345678/${ID}.jpg`, ID],
    ['chained transformations', `${BASE}/w_400,h_400/q_auto/f_auto/v1712345678/${ID}.jpg`, ID],
    ['single-parameter transformation', `${BASE}/q_auto/${ID}.png`, ID],
    ['named transformation', `${BASE}/t_media_lib_thumb/v1/${ID}.webp`, ID],
    ['nested folders', `${BASE}/v1/hasnahena/registrations/members/HF-0001/nid-front.jpg`,
      'hasnahena/registrations/members/HF-0001/nid-front'],
    ['no extension', `${BASE}/v1/${ID}`, ID],
    ['a dot in the folder name', `${BASE}/v1/hasnahena/a.b/c.jpg`, 'hasnahena/a.b/c'],
    ['query string', `${BASE}/v1/${ID}.jpg?_a=BAMAH+0`, ID],
    ['not Cloudinary', 'https://example.com/image/upload/v1/foo.jpg', null],
    ['not a URL at all', 'this is not a url', null],
    ['no /upload/ marker', 'https://res.cloudinary.com/hasnahena/image/fetch/v1/foo.jpg', null],
  ];

  for (const [name, url, expected] of cases) {
    it(name, () => {
      expect(extractPublicId(url)).toBe(expected);
    });
  }

  it('round-trips every folder this application uploads to', () => {
    // If a public id does not survive the trip, the asset it names cannot be
    // deleted — and these are the folders holding regulatory documents.
    const folders = [
      'hasnahena/profiles/member/user-1',
      'hasnahena/profiles/admin/user-2',
      'hasnahena/gallery',
      'hasnahena/settings/logo',
      'hasnahena/settings/partners',
      'hasnahena/registrations/members/HF-0001/signature',
    ];
    for (const folder of folders) {
      expect(extractPublicId(`${BASE}/w_400,h_400/v1712/${folder}/file.jpg`)).toBe(`${folder}/file`);
    }
  });
});

describe('buildUploadOptions', () => {
  it('namespaces every upload under one folder', () => {
    expect(buildUploadOptions('gallery', {}).folder).toBe('hasnahena/gallery');
  });

  it('re-encodes by default', () => {
    const options = buildUploadOptions('gallery', {});
    expect(options.quality).toBe('auto');
    expect(options.fetch_format).toBe('auto');
  });

  it('leaves a document exactly as it was submitted', () => {
    // A registration document is evidence. Re-encoding an NID scan to save
    // bandwidth is not a trade this application gets to make.
    const options = buildUploadOptions('registrations/members/HF-0001/nid-front', {
      preserveOriginal: true,
      useFilename: true,
      uniqueFilename: true,
    });
    expect(options.quality).toBeUndefined();
    expect(options.fetch_format).toBeUndefined();
    expect(options.use_filename).toBe(true);
    expect(options.unique_filename).toBe(true);
  });

  it('uploads as an image unless told otherwise', () => {
    expect(buildUploadOptions('gallery', {}).resource_type).toBe('image');
    expect(buildUploadOptions('gallery', { resource_type: 'raw' }).resource_type).toBe('raw');
  });
});

describe('settingsImageFolder', () => {
  const cases: Array<[string, string]> = [
    ['logo', 'settings/logo'],
    ['logoMark', 'settings/logo'],
    ['heroImage', 'settings/hero'],
    ['partnerLogo', 'settings/partners'],
    ['favicon', 'settings/icons'],
    ['', 'settings/icons'],
  ];
  for (const [imageType, folder] of cases) {
    it(`${imageType || '(empty)'} → ${folder}`, () => {
      expect(settingsImageFolder(imageType)).toBe(folder);
    });
  }
});

describe('AVATAR_TRANSFORMATION', () => {
  it('crops square to the face', () => {
    expect(AVATAR_TRANSFORMATION[0]).toMatchObject({ width: 400, height: 400, crop: 'fill', gravity: 'face' });
  });
});

describe('a configuration error says it is a configuration error', () => {
  const KEYS = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'] as const;
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.restoreAllMocks();
  });

  it('does not disguise a missing secret as an upload failure', async () => {
    for (const key of KEYS) delete process.env[key];
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // A missing secret, an exceeded quota and a rejected file type used to
    // surface as the same sentence, so an operator reading the log could not
    // tell a misconfiguration from an outage.
    await expect(uploadImage(Buffer.from('x'), 'gallery')).rejects.toThrow(CloudinaryConfigurationError);
    await expect(uploadImage(Buffer.from('x'), 'gallery')).rejects.toThrow(/CLOUDINARY_API_SECRET/);
  });
});

describe('deleteOldAvatar', () => {
  afterEach(() => vi.restoreAllMocks());

  it('treats "there was no old avatar" as success', async () => {
    await expect(deleteOldAvatar(null)).resolves.toBe(true);
    await expect(deleteOldAvatar('')).resolves.toBe(true);
  });

  it('leaves evidence when it cannot work out what to delete', async () => {
    const logged = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Cloudinary-hosted but not an upload URL, so no public id can be derived.
    const url = 'https://res.cloudinary.com/hasnahena/image/fetch/v1/foo.jpg';
    await expect(deleteOldAvatar(url)).resolves.toBe(false);
    expect(logged, 'a cleanup that fails silently is a leak with no evidence').toHaveBeenCalled();
    expect(String(logged.mock.calls[0])).toContain(url);
  });

  it('ignores an avatar hosted somewhere else', async () => {
    await expect(deleteOldAvatar('https://example.com/avatar.png')).resolves.toBe(true);
  });
});
