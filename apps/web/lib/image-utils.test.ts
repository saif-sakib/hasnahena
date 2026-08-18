import { describe, it, expect } from 'vitest';
import { validateImageFile, UPLOAD_TYPES, formatFileSize, getInitials } from './image-utils';
import { REGISTRATION_UPLOAD_LIMITS } from './validation/registration';

// WO-55. The registration documents are NID scans, member photos and
// signatures — regulatory records, in a third-party account with no export
// (DATA-06). This is the gate they pass through, and it had no test.
//
// A file of the wrong type does not fail loudly at Cloudinary: it uploads as
// the wrong resource type and is unrecoverable in the same way a wrong balance
// is.

function fileOf(type: string, sizeBytes = 1024): File {
  const file = new File([new Uint8Array(1)], 'document', { type });
  // `size` is derived from the content, and allocating 4 MB per case to test a
  // size check is not a trade worth making.
  Object.defineProperty(file, 'size', { value: sizeBytes });
  return file;
}

describe('validateImageFile', () => {
  it('accepts the photo formats a phone produces', () => {
    for (const type of UPLOAD_TYPES.avatar) {
      const result = validateImageFile(fileOf(type), { acceptedTypes: UPLOAD_TYPES.avatar });
      expect(result.valid, `${type} was refused: ${result.error}`).toBe(true);
    }
  });

  it('refuses anything that is not an image', () => {
    for (const type of ['application/pdf', 'text/html', 'application/octet-stream', 'image/svg+xml', '']) {
      const result = validateImageFile(fileOf(type), { acceptedTypes: UPLOAD_TYPES.avatar });
      expect(result.valid, `${type} was accepted`).toBe(false);
      expect(result.error).toMatch(/Invalid file type/);
    }
  });

  it('names the accepted types, so the member knows what to send instead', () => {
    const result = validateImageFile(fileOf('application/pdf'), { acceptedTypes: UPLOAD_TYPES.avatar });
    expect(result.error).toContain('jpeg');
    expect(result.error).toContain('png');
  });

  it('enforces the per-file limit at the boundary', () => {
    const mb = 1024 * 1024;
    const limit = REGISTRATION_UPLOAD_LIMITS.PER_FILE_MB;

    const atLimit = validateImageFile(fileOf('image/jpeg', limit * mb), { maxSizeMB: limit });
    expect(atLimit.valid, 'a file exactly at the limit must be accepted').toBe(true);

    const over = validateImageFile(fileOf('image/jpeg', limit * mb + 1), { maxSizeMB: limit });
    expect(over.valid).toBe(false);
    expect(over.error).toContain(`${limit}MB`);
  });

  it('accepts an empty-but-typed file — emptiness is the route\'s check, not this one', () => {
    expect(validateImageFile(fileOf('image/jpeg', 0), { acceptedTypes: UPLOAD_TYPES.avatar }).valid).toBe(true);
  });

  it('checks the type before the size, so the message names the real problem', () => {
    const result = validateImageFile(fileOf('application/pdf', 99 * 1024 * 1024), {
      acceptedTypes: UPLOAD_TYPES.avatar,
      maxSizeMB: 1,
    });
    expect(result.error).toMatch(/Invalid file type/);
  });
});

describe('the four registration documents fit the platform budget', () => {
  it('four files at the per-file limit exceed the total, which is why both exist', () => {
    const perFileBytes = REGISTRATION_UPLOAD_LIMITS.PER_FILE_MB * 1024 * 1024;
    expect(perFileBytes * 4).toBeGreaterThan(REGISTRATION_UPLOAD_LIMITS.TOTAL_BYTES);
    // And the total stays under the 4.5 MB serverless request cap, so a
    // submission that is too large fails with our message rather than the
    // platform's error page.
    expect(REGISTRATION_UPLOAD_LIMITS.TOTAL_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });
});

describe('formatFileSize', () => {
  it('reads the way a member would say it', () => {
    expect(formatFileSize(0)).toBe('0 Bytes');
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(4 * 1024 * 1024)).toBe('4 MB');
  });
});

describe('getInitials', () => {
  it('handles one name, several names, and none', () => {
    expect(getInitials('Abdul Karim')).toBe('AK');
    expect(getInitials('Karim')).toBe('K');
    expect(getInitials('Md Abdul Karim')).toBe('MK');
    expect(getInitials('')).toBe('?');
  });
});
