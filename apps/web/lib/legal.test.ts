import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { PRIVACY_LAST_UPDATED, TERMS_LAST_UPDATED, formatLegalDate } from '@/lib/legal';

/**
 * The revision date on a legal document is a claim about the document.
 *
 * Both pages printed `Last updated: March 2026` as a literal inside the page,
 * in both languages, and it was wrong in the way that matters: the Terms' loan
 * clause had been rewritten twice since — once to delete the promise of
 * administrative fees, once to deny a late fee outright — and the line still
 * said March. A member who had read the March version had no way to learn that
 * what they agreed to had changed.
 *
 * This cannot check that somebody remembered to update the date when they
 * changed the wording; nothing can. What it can do is refuse the two states the
 * old literal was in — a date that is not a date, and a date that has not
 * happened yet — and keep the constants somewhere a reviewer sees them in the
 * same diff as the copy.
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
      // A document cannot have been revised tomorrow. This catches the typo
      // that turns 2026 into 2062 and would otherwise sit on the page for
      // decades looking authoritative.
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
    // Without `timeZone: 'UTC'` a reader west of Greenwich sees the previous
    // day — a legal document appearing to have been revised a day earlier for
    // some readers than for others.
    expect(formatLegalDate('2026-01-01', 'en')).toContain('January 1');
  });
});

describe('the legal copy lives in the message files', () => {
  it('is not inlined back into either page', () => {
    // Rule 5, and on these two pages it is the rule that matters most: the fee
    // promise survived a CHECK constraint, `applicationFee = BigInt(0)` and a
    // source-wide search for "markup" purely because it was a string inside a
    // component, where none of this repository's guards can read it.
    // `messages.test.ts` reads the message files.
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
    // They used to carry a bespoke header (a logo and "Back to Home") and a
    // one-line footer, so a visitor arriving from a search result had no
    // navigation and no language switcher — and the mini-footer was English on
    // the Bengali page.
    for (const page of ['app/[locale]/privacy/page.tsx', 'app/[locale]/terms/page.tsx']) {
      const source = read(page);
      expect(source, `${page} does not render <Header>`).toContain('<Header settings={settings} />');
      expect(source, `${page} does not render <Footer>`).toContain('<Footer settings={settings} />');
    }
  });
});
