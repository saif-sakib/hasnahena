import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { IMAGE_PRESETS, UPLOAD_SIZE_LIMITS } from '@/lib/image-utils';
import { PUBLIC_CONFIG_KEYS } from '@/lib/system-config';
import {
  personFolder,
  applicationFolder,
  settingsImagePublicId,
  settingsImageTransformation,
} from '@/lib/cloudinary';

/**
 * Every image is compressed in the browser first, AND next.config.js declares a
 * Server Action body limit above every validator — otherwise an oversize file is
 * a silent framework rejection rather than a real error.
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

    // Every validator, no exemptions: never a body limit below a validator.
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
    // Transparent assets must not be flattened (JPEG would add a white box).
    for (const name of ['logo', 'favicon', 'partner'] as const) {
      expect(IMAGE_PRESETS[name].alpha, `${name} must keep its alpha channel`).toBe(true);
    }
    // Photographs have no alpha to lose, and JPEG is smaller for a photograph.
    for (const name of ['hero', 'gallery', 'avatar', 'document'] as const) {
      expect(IMAGE_PRESETS[name].alpha, `${name} is a photograph; JPEG is smaller`).toBe(false);
    }
  });

  it('keeps an NID legible', () => {
    // ~470dpi across an 8.6cm NID — legible for an approver.
    expect(IMAGE_PRESETS.document.maxEdge).toBeGreaterThanOrEqual(1600);
  });
});

describe('a settings image replaces its predecessor rather than orphaning it', () => {
  it('derives a stable public id from the settings key', () => {
    expect(settingsImagePublicId('branding.logo')).toBe('branding-logo');
    expect(settingsImagePublicId('hero.partnerLogo1')).toBe('hero-partnerlogo1');
    // Stable: same key, same asset, or overwrite overwrites nothing.
    expect(settingsImagePublicId('branding.favicon')).toBe(
      settingsImagePublicId('branding.favicon'),
    );
  });

  it('never deletes the asset it has just written', () => {
    // With fixed ids, deleting the "previous" image would delete the new one.
    const action = read('app', 'actions', 'upload-settings-image.ts');
    expect(action).toMatch(/oldPublicId\s*!==\s*uploadResult\.publicId/);
  });

  it('caps what is stored, and never enlarges', () => {
    // The favicon is deliberately absent: it is *padded* to a square rather than
    // limited, which has its own test below.
    for (const key of ['branding.logo', 'hero.backgroundImage', 'hero.partnerLogo1']) {
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

describe('every asset is stored under a name a human can look up', () => {
  /** People are filed by account number, so the tree is readable without the database. */
  it('files a person under their account number, not their row id', () => {
    expect(personFolder('ACC-KH-33001', 'cmob97efh00003zynz0as5knq')).toBe('people/ACC-KH-33001');
    // Per person, not per role (a hired member keeps their folder).
    expect(personFolder('STF-0001', 'x')).toBe('people/STF-0001');
  });

  it('still files somebody with no account number somewhere', () => {
    // Fallback only for a row with no number.
    expect(personFolder(null, 'cmob97efh0000')).toBe('people/cmob97efh0000');
    expect(personFolder('   ', 'cmob97efh0000')).toBe('people/cmob97efh0000');
  });

  /**
   * Registration documents go under the APPLICATION number (no account number
   * exists yet); one prefix per application is the unit a refusal deletes.
   */
  it('files registration documents under the application number', () => {
    expect(applicationFolder('APP-2026-000001', 'cmob97efh0000')).toBe(
      'applications/APP-2026-000001',
    );
    expect(applicationFolder(null, 'cmob97efh0000')).toBe('applications/cmob97efh0000');
    // The two trees must not collide: an application folder is never a person
    // folder, whatever either is named.
    expect(applicationFolder('X', 'y').startsWith('people/')).toBe(false);
    expect(personFolder('X', 'y').startsWith('applications/')).toBe(false);
  });

  it('gives the avatar and the four registration documents fixed names', () => {
    const cloudinary = read('lib', 'cloudinary.ts');
    expect(cloudinary).toMatch(/publicId: 'avatar'/);
    const registrations = read('app', 'api', 'v1', 'registrations', 'route.ts');
    expect(registrations).toContain('applicationFolder(created.formNumber, created.id)');
    expect(registrations).toMatch(/publicId: requirement\.slug/);
    // An NID scan must never be re-encoded, whatever else changes here.
    expect(registrations).toContain('preserveOriginal: true');
  });

  /** An admitted member's documents move into their own folder (ADR-040). */
  it('moves an admitted member’s documents into their own folder', () => {
    const filing = read('lib', 'application-documents.ts');
    expect(filing).toContain('export async function fileApplicationDocuments');
    // Into `people/<accountNo>`, derived from the same helper every other
    // person-scoped upload uses, so the two can never disagree about the name.
    expect(filing).toContain('personFolder(member.accountNo, member.id)');
    // A rename, not a re-upload: these are NID scans stored with
    // `preserveOriginal`, and re-uploading them would re-encode them.
    expect(filing).toContain('moveAsset(source, target)');
    // Idempotent. This runs from a browser after an approval and again from the
    // nightly sweep, so "already filed" has to be an outcome, not a failure.
    expect(filing).toMatch(/alreadyFiled/);
    // Never deleteFolder here — deleteEmptyFolder refuses a half-moved folder.
    expect(filing).toContain('deleteEmptyFolder(');
    expect(
      /deleteFolder\(applicationFolder\([^)]*\)\)/.test(
        filing.slice(filing.indexOf('export async function fileApplicationDocuments')),
      ),
      'filing must never delete assets — only purging does',
    ).toBe(false);

    // The document names are declared once. Three layers have to agree about
    // them: the upload, the `documents` row, and the move.
    expect(filing).toContain('export const APPLICATION_DOCUMENTS');
    const registrations = read('app', 'api', 'v1', 'registrations', 'route.ts');
    expect(registrations).toContain("from '@/lib/application-documents'");
  });

  it('has a backstop for the filing call that never arrived', () => {
    // The nightly sweep backstops a closed tab.
    const retention = read('app', 'api', 'v1', 'admin', 'retention', 'route.ts');
    expect(retention).toContain('fileApplicationDocuments');
    // Matched on the URL, because the URL is the fact — a row whose `url` still
    // names the applications tree is a file that is still there.
    expect(retention).toContain("url: { contains: '/applications/' }");
  });

  it('dates a gallery photograph, which has no identifier of its own', () => {
    const cloudinary = read('lib', 'cloudinary.ts');
    expect(cloudinary).toMatch(/publicId: `\$\{day\}-\$\{suffix\}`/);
  });
});

describe('the favicon accepts whatever shape it is given', () => {
  it('pads to a square rather than limiting to one', () => {
    // The favicon is padded to a transparent square.
    const steps = settingsImageTransformation('branding.favicon');
    const resize = steps.find((step) => 'crop' in step);
    expect(resize?.crop).toBe('pad');
    expect(resize?.background).toBe('transparent');
    expect(resize?.width).toBe(resize?.height);
  });
});

describe('the two brand keys that had no reader', () => {
  /** Both keys must be RENDERED, not merely named by their own uploader. */
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
    // PUBLIC, so the sidebar fetch needs no token and cannot trip the shell's 401 race.
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
