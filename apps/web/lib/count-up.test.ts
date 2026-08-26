import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { parseFigure } from '../components/ui/count-up';

/**
 * The hero's figures animate from zero, restored on the owner's instruction
 * (2026-08-26). What is checked here is the **parsing**, because that is where
 * a counter for this site differs from every counter on the internet: it is not
 * given a number, it is given a sentence an admin typed, in one of two scripts,
 * and it has to find the number inside without disturbing anything else.
 *
 * The animation itself is not unit-tested — a `requestAnimationFrame` loop
 * asserted in jsdom tests the mock. It is checked in a real browser by
 * `e2e/matrix.spec.ts` (nothing overflows while the digits change width) and by
 * the screenshots that show it mid-flight.
 */
describe('finding the number inside what an admin typed', () => {
  it('reads a plain figure with a suffix', () => {
    expect(parseFigure('135+')).toMatchObject({ prefix: '', target: 135, suffix: '+' });
  });

  it('reads a currency prefix and a word suffix', () => {
    expect(parseFigure('৳25 Lakh+')).toMatchObject({
      prefix: '৳',
      target: 25,
      suffix: ' Lakh+',
    });
  });

  it('reads Bengali digits', () => {
    // U+09E6…U+09EF, not ASCII. Every Bengali figure on the site is written in
    // these, and a parser that only knows `0-9` finds nothing and silently
    // renders the string unanimated — which looks like the feature being off.
    expect(parseFigure('১৩৫+')).toMatchObject({ target: 135, suffix: '+' });
    expect(parseFigure('৳২৫ লক্ষ+')).toMatchObject({ prefix: '৳', target: 25, suffix: ' লক্ষ+' });
  });

  it('keeps the decimal places the admin wrote', () => {
    // `৳3.5 Lakh+` must not count up to `৳4 Lakh+`, and must not arrive at
    // `৳3.50 Lakh+` either.
    expect(parseFigure('৳3.5 Lakh+')).toMatchObject({ target: 3.5, fractionDigits: 1 });
    expect(parseFigure('৳৩.৫ লক্ষ+')).toMatchObject({ target: 3.5, fractionDigits: 1 });
    expect(parseFigure('135+')!.fractionDigits).toBe(0);
  });

  it('treats a comma as a separator and strips it before counting', () => {
    expect(parseFigure('BDT 4,796,100')).toMatchObject({
      prefix: 'BDT ',
      target: 4796100,
      grouped: true,
    });
    expect(parseFigure('৪৭,৯৬,১০০৳')).toMatchObject({ target: 4796100, grouped: true, suffix: '৳' });
  });

  it('records whether the admin grouped, so it can render it back the same way', () => {
    // A typed `1500` counts up to `1500`, not to `1,500`. This renders what the
    // foundation wrote; a component that quietly re-punctuates its input is one
    // nobody can predict.
    expect(parseFigure('1500+')!.grouped).toBe(false);
    expect(parseFigure('1,500+')!.grouped).toBe(true);
  });

  it('gives up rather than guessing when there is no number', () => {
    // An admin is allowed to type `—` or `many`. `null` is the signal to render
    // the string untouched and skip the animation entirely.
    expect(parseFigure('—')).toBeNull();
    expect(parseFigure('')).toBeNull();
    expect(parseFigure('coming soon')).toBeNull();
  });
});

describe('the figures on the hero go through the counter', () => {
  const WEB_ROOT = resolve(new URL('.', import.meta.url).pathname, '..');

  it('the home page renders stats.* through CountUp, not as bare text', () => {
    // The point of the census: the figures are the one place on the site where
    // a settings value is *animated*, and a future edit that inlines the value
    // back into the markup loses the animation with nothing failing.
    const page = readFileSync(resolve(WEB_ROOT, 'app/[locale]/page.tsx'), 'utf8');
    expect(page).toContain('CountUp');
    expect(page, 'the hero figures no longer reach the counter').toMatch(/<CountUp[\s\S]{0,300}value=\{value\}/);
  });

  it('nothing renders a stats.* key without it', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx$/.test(entry) && !entry.includes('.test.')) {
          const source = readFileSync(full, 'utf8');
          if (!/'stats\.\w+'/.test(source)) continue;
          if (!source.includes('CountUp')) offenders.push(full.slice(WEB_ROOT.length + 1));
        }
      }
    };
    // The admin's own editing screen is the deliberate exception: it renders
    // these keys as *form fields*, where a number that ticks up while you are
    // typing into it would be a defect rather than a flourish.
    walk(resolve(WEB_ROOT, 'app'));
    walk(resolve(WEB_ROOT, 'components/ui'));
    walk(resolve(WEB_ROOT, 'components/layout'));
    expect(
      offenders,
      'a component reads a stats.* figure and renders it without CountUp, so it ' +
        'will not animate. If the figure genuinely should be static there, say so ' +
        'in this test rather than leaving the two silently different.',
    ).toEqual([]);
  });
});
