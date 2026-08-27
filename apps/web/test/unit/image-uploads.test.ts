import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { IMAGE_PRESETS, UPLOAD_SIZE_LIMITS } from '@/lib/image-utils';
import { PUBLIC_CONFIG_KEYS } from '@/lib/system-config';
import { settingsImagePublicId, settingsImageTransformation } from '@/lib/cloudinary';

/**
 * Every image this application accepts is compressed in the browser first.
 *
 * The failure this exists to stop has no error message, which is why it needs a
 * test rather than a note. Content & Media's brand uploader validated a file up
 * to 5 MB and posted it, uncompressed, into a **Server Action** — and Next caps
 * a Server Action request body at 1 MB by default. So every logo an admin
 * picked off a phone or exported from a design tool was rejected by the
 * framework *before* `uploadSettingsImageAction` was entered: nothing in the
 * action ran, nothing logged, and the screen reported a Server Action failure
 * naming no size and no field. The same ceiling sat under the avatar uploader.
 *
 * Two halves have to stay true, and each is useless without the other:
 *
 *   - the browser shrinks the file, so it fits with room to spare
 *   - `next.config.js` declares a body limit above what the validators allow,
 *     so a file that the compressor legitimately declined (an animated GIF, a
 *     decoder failure) still reaches the server and gets a real error back
 *     rather than a silent framework rejection
 */

const WEB_ROOT = resolve(new URL('.', import.meta.url).pathname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(WEB_ROOT, ...parts), 'utf8');

/** `'4mb'` / `500kb` / a bare byte count, as megabytes. */
function parseSizeToMb(literal: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(kb|mb|b)?$/i.exec(literal.trim());
  if (!match) throw new Error(`unparseable size literal: ${literal}`);
  const value = Number(match[1]);
  const unit = (match[2] ?? 'b').toLowerCase();
  if (unit === 'mb') return value;
  if (unit === 'kb') return value / 1024;
  return value / (1024 * 1024);
}

describe('the Server Action body limit is above what the uploaders accept', () => {
  const config = read('next.config.js');

  it('is declared at all', () => {
    // Absent, the limit is Next's default 1 MB — the state in which the brand
    // uploader could not accept a single photograph off a phone.
    expect(config).toMatch(/serverActions:\s*\{/);
    expect(config).toMatch(/bodySizeLimit:\s*'[^']+'/);
  });

  it('leaves room for the largest file any validator lets through', () => {
    const declared = /bodySizeLimit:\s*'([^']+)'/.exec(config)?.[1];
    expect(declared, 'bodySizeLimit is not a string literal this test can read').toBeTruthy();

    const limitMb = parseSizeToMb(declared as string);
    const largestUpload = Math.max(...Object.values(UPLOAD_SIZE_LIMITS));

    // Every validator, with no exemptions. The gallery's used to be 10 MB
    // against a 1 MB framework cap and a 4.5 MB platform cap, so two thirds of
    // what it claimed to accept could never arrive. What must never be true
    // again is a body limit *below* a validator, which is what turned "your
    // file is too big" into no message at all.
    expect(
      limitMb,
      `bodySizeLimit is ${limitMb}MB but a validator accepts up to ${largestUpload}MB — ` +
        'a file between the two is rejected by Next before any of our code runs, ' +
        'so the admin sees a failure that names nothing.',
    ).toBeGreaterThanOrEqual(largestUpload);
  });
});

describe('every uploader compresses before it sends', () => {
  it('gives each ImageUpload a preset', () => {
    // `preset` has a default, so a missing one is not a type error — it is the
    // gallery preset silently applied to a favicon. Each call site states its own.
    const contentScreen = read('components', 'dashboard', 'screens', 'content-screen.tsx');
    const openings = contentScreen.match(/<ImageUpload\b/g) ?? [];
    const presets = contentScreen.match(/\bpreset[=:]/g) ?? [];
    expect(openings.length).toBeGreaterThan(0);
    expect(
      presets.length,
      'an <ImageUpload> on Content & Media has no preset, so it falls back to the ' +
        'gallery compression rather than the one its image needs',
    ).toBeGreaterThanOrEqual(openings.length);
  });

  it('compresses the avatar, which posts to a Server Action of its own', () => {
    const avatar = read('components', 'ui', 'avatar-upload.tsx');
    expect(avatar).toContain('compressImageFile');
    // Before the compressed file, never after: validating the picked file would
    // reject a photograph the compressor was about to rescue.
    expect(avatar.indexOf('compressImageFile')).toBeLessThan(avatar.indexOf('validateImage('));
  });

  it('compresses the four registration documents', () => {
    const register = read('app', '[locale]', '(auth)', 'register', 'page.tsx');
    expect(register).toContain('downscaleImageFile');
  });

  it('compresses inside ImageUpload before the size check', () => {
    const uploader = read('components', 'ui', 'image-upload.tsx');
    expect(uploader.indexOf('compressImageFile')).toBeGreaterThan(-1);
    expect(uploader.indexOf('compressImageFile')).toBeLessThan(uploader.indexOf('validateImage('));
  });
});

describe('the compression presets', () => {
  it('keeps transparency for everything drawn over a background', () => {
    // A logo, a favicon and a partner mark are transparent PNGs. Flattened onto
    // white — which is what a JPEG encode does — each gets a white rectangle
    // behind it on every coloured header it sits in.
    for (const name of ['logo', 'favicon', 'partner'] as const) {
      expect(IMAGE_PRESETS[name].alpha, `${name} must keep its alpha channel`).toBe(true);
    }
    // Photographs have no alpha to lose, and JPEG is smaller for a photograph.
    for (const name of ['hero', 'gallery', 'avatar', 'document'] as const) {
      expect(IMAGE_PRESETS[name].alpha, `${name} is a photograph; JPEG is smaller`).toBe(false);
    }
  });

  it('keeps an NID legible', () => {
    // An NID card is 8.6cm wide, so 1600px across it is ~470dpi. Dropping this
    // makes a scan an approver cannot read, and the approver has no way to ask
    // for a better one after the fact.
    expect(IMAGE_PRESETS.document.maxEdge).toBeGreaterThanOrEqual(1600);
  });
});

describe('a settings image replaces its predecessor rather than orphaning it', () => {
  it('derives a stable public id from the settings key', () => {
    expect(settingsImagePublicId('branding.logo')).toBe('branding-logo');
    expect(settingsImagePublicId('hero.partnerLogo1')).toBe('hero-partnerlogo1');
    // Stability is the whole point: the same key must map to the same asset
    // every time, or `overwrite` overwrites nothing and the account grows a
    // copy per upload.
    expect(settingsImagePublicId('branding.favicon')).toBe(
      settingsImagePublicId('branding.favicon'),
    );
  });

  it('never deletes the asset it has just written', () => {
    // With a fixed public id the old id and the new id are the same string, so
    // the pre-existing "delete the previous image" step would destroy the
    // upload seconds after storing its URL — a setting pointing at a 404, with
    // the upload reported as successful.
    const action = read('app', 'actions', 'upload-settings-image.ts');
    expect(action).toMatch(/oldPublicId\s*!==\s*uploadResult\.publicId/);
  });

  it('caps what is stored, and never enlarges', () => {
    for (const key of ['branding.logo', 'branding.favicon', 'hero.backgroundImage', 'hero.partnerLogo1']) {
      const steps = settingsImageTransformation(key);
      const resize = steps.find((step) => 'crop' in step);
      expect(resize, `${key} has no size ceiling`).toBeTruthy();
      // 'limit' and not 'fill' or 'scale': a 300px logo must stay 300px, and
      // nothing here may crop an image an admin composed.
      expect(resize?.crop, `${key} must use crop:'limit'`).toBe('limit');
    }
  });

  it('names no output format, so a transparent logo stays transparent', () => {
    for (const key of ['branding.logo', 'branding.favicon', 'hero.partnerLogo2']) {
      for (const step of settingsImageTransformation(key)) {
        expect(step.format, `${key} must not be forced to a single format`).toBeUndefined();
      }
    }
  });
});

describe('the two brand keys that had no reader', () => {
  /**
   * `settings-keys-read.test.ts` asks whether a declared key is *named*
   * anywhere in the source, and both of these were — in the uploader that
   * writes them. A key vouching for itself through its own writer passes that
   * census while nothing renders it, which is what these two did: an admin
   * uploaded a favicon and a dashboard logo, saw them stored, and watched the
   * browser tab and the sidebar keep the shipped asset for ever.
   */
  it('renders branding.favicon in the document head', () => {
    const layout = read('app', '[locale]', 'layout.tsx');
    expect(layout).toContain("settings['branding.favicon']");
    expect(layout).toMatch(/icons:/);
  });

  it('renders branding.dashboardLogo in the dashboard shell', () => {
    const branding = read('components', 'dashboard', 'branding.tsx');
    expect(branding).toContain("settings?.['branding.dashboardLogo']");

    const shell = read('components', 'layout', 'dashboard-layout.tsx');
    expect(shell).toContain('useDashboardBranding');
    expect(shell).toMatch(/<Logo\s+size="sm"\s+src=\{dashboardLogo/);
  });

  it('reads that key without a token, so it can never end a session', () => {
    // The first attempt read this in the dashboard's server layout. Awaiting
    // there delayed the shell's mount enough to trip a pre-existing race in its
    // effects — a fetch landing without a token, a 401, and the 401 handler
    // clearing the session — so every dashboard navigation bounced the user to
    // the login page. Keeping the key PUBLIC is what makes this fetch unable to
    // participate in that: it needs no token and its failure is a missing logo.
    expect(PUBLIC_CONFIG_KEYS as readonly string[]).toContain('branding.dashboardLogo');
    expect(PUBLIC_CONFIG_KEYS as readonly string[]).toContain('branding.favicon');
  });

  it('falls back to a shipped asset when no image is uploaded', () => {
    // getPublicSettings() returns {} on a database outage by design. A site
    // whose favicon vanishes when Neon hiccups would be a strange thing to ship.
    const layout = read('app', '[locale]', 'layout.tsx');
    expect(layout).toContain('/favicon.ico');
  });
});
