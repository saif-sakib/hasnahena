import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { PRIVACY_LAST_UPDATED, TERMS_LAST_UPDATED, formatLegalDate } from '@/lib/legal';

/**
 * Legal revision dates must be real ISO dates and not in the future; they sit
 * beside the copy so a reviewer sees both in one diff.
 */

const WEB = resolve(process.cwd());
const read = (rel: string) => readFileSync(join(WEB, rel), 'utf8');

const DATES = {
  PRIVACY_LAST_UPDATED,
  TERMS_LAST_UPDATED,
} as const;

describe('the legal revision dates', () => {
  for (const [name, value] of Object.entries(DATES)) {
    it(`${name} is a real ISO date`, () => {
      expect(value, `${name} must be YYYY-MM-DD`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())).toBe(false);
    });

    it(`${name} is not in the future`, () => {
      expect(new Date(`${value}T00:00:00Z`).getTime()).toBeLessThanOrEqual(Date.now());
    });
  }

  it("renders in the reader's own numerals", () => {
    // Bengali readers count in Bengali numerals, and this string sits on the
    // page that tells them what the foundation does with their national ID.
    const en = formatLegalDate('2026-08-26', 'en');
    const bn = formatLegalDate('2026-08-26', 'bn');
    expect(en).toContain('2026');
    expect(bn).not.toBe(en);
    expect(/[০-৯]/.test(bn), `the Bengali date has no Bengali numerals: ${bn}`).toBe(true);
  });

  it('is fixed to UTC, so the date does not shift with the reader', () => {
    // UTC, or readers west of Greenwich see the previous day.
    expect(formatLegalDate('2026-01-01', 'en')).toContain('January 1');
  });
});

describe('the legal copy lives in the message files', () => {
  it('is not inlined back into either page', () => {
    // Rule 5: legal copy lives in messages, where messages.test.ts can read it.
    for (const page of ['app/[locale]/privacy/page.tsx', 'app/[locale]/terms/page.tsx']) {
      const source = read(page);
      expect(
        source.length,
        `${page} has grown its own copy back — it should be a shell around legal.* ` +
          'in messages/{en,bn}.json',
      ).toBeLessThan(4000);
      expect(source, `${page} no longer reads the legal namespace`).toContain("namespace: 'legal'");
    }
  });

  it('renders both pages inside the site chrome', () => {
    // Both pages use the shared header and footer (navigation, language switch).
    for (const page of ['app/[locale]/privacy/page.tsx', 'app/[locale]/terms/page.tsx']) {
      const source = read(page);
      expect(source, `${page} does not render <Header>`).toContain('<Header settings={settings} />');
      expect(source, `${page} does not render <Footer>`).toContain('<Footer settings={settings} />');
    }
  });
});
