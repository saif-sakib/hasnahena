import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  REJECTION_REASON_CODES,
  REJECTION_REASON_LABELS,
  REJECTION_REASON_REQUIRING_NOTE,
  REJECTION_NOTE_MAX_LENGTH,
  rejectionReasonLabel,
} from '@/lib/rejection-reasons';

/**
 * Rejection reason codes must agree across lib/rejection-reasons.ts (picker),
 * dashboard_handler.go (allow-list) and email_service.go (the applicant's
 * sentence) — drift is a dead button, a reasonless email, or dead vocabulary.
 */

const REPO = resolve(process.cwd(), '..', '..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');

const HANDLER = 'apps/api/internal/handlers/dashboard_handler.go';
const EMAIL = 'apps/api/internal/services/email_service.go';

/** The codes the Go handler will accept, read out of its allow-list map. */
function handlerCodes(): string[] {
  const source = read(HANDLER);
  const block = source.match(/var rejectionReasonCodes = map\[string\]bool\{([\s\S]*?)\n\}/);
  if (!block) throw new Error(`rejectionReasonCodes not found in ${HANDLER}`);
  const codes: string[] = [];
  for (const line of block[1].split('\n')) {
    const quoted = line.match(/"([A-Z_]+)":\s*true/);
    if (quoted) codes.push(quoted[1]);
    // `OTHER` is written through the constant so the note rule can reference it.
    else if (/rejectionReasonOther:\s*true/.test(line)) codes.push('OTHER');
  }
  return codes;
}

/** The codes the rejection email has a sentence for. */
function emailCodes(): string[] {
  const source = read(EMAIL);
  const block = source.match(
    /func rejectionReasonSentence\(code, locale string\) string \{([\s\S]*?)\n\}/,
  );
  if (!block) throw new Error(`rejectionReasonSentence not found in ${EMAIL}`);
  return [...block[1].matchAll(/case "([A-Z_]+)":/g)].map((m) => m[1]);
}

describe('rejection reasons', () => {
  it('parses both Go sources it is comparing against', () => {
    // A regex that quietly matches nothing makes every assertion below vacuous.
    expect(handlerCodes().length).toBeGreaterThan(4);
    expect(emailCodes().length).toBeGreaterThan(4);
  });

  it('offers the same codes the Go handler accepts', () => {
    expect([...handlerCodes()].sort()).toEqual([...REJECTION_REASON_CODES].sort());
  });

  it('has an email sentence for every code that is not OTHER', () => {
    // OTHER deliberately has no sentence — the admin's note is the reason, and
    // the handler refuses OTHER without one.
    const needsSentence = REJECTION_REASON_CODES.filter(
      (code) => code !== REJECTION_REASON_REQUIRING_NOTE,
    );
    for (const code of needsSentence) {
      expect(
        emailCodes(),
        `${code} can be chosen and accepted, but the rejection email has no sentence ` +
          'for it — the applicant would be told they were refused and nothing else',
      ).toContain(code);
    }
  });

  it('says the same thing about the note in both languages and both backends', () => {
    const handler = read(HANDLER);
    expect(
      handler,
      'the Go handler no longer bounds the note length; a paste of arbitrary size ' +
        'would reach the email body and the audit row',
    ).toContain(`rejectionNoteMaxLength = ${REJECTION_NOTE_MAX_LENGTH}`);
    expect(
      handler,
      'the Go handler no longer requires a note for OTHER. "Other reason" with ' +
        'nothing after it is the same as no reason at all',
    ).toMatch(/reasonCode == rejectionReasonOther && reasonNote == ""/);
  });

  it('labels every code in both languages, with no copy-paste between them', () => {
    for (const code of REJECTION_REASON_CODES) {
      const labels = REJECTION_REASON_LABELS[code];
      expect(labels?.en?.trim(), `${code} has no English label`).toBeTruthy();
      expect(labels?.bn?.trim(), `${code} has no Bengali label`).toBeTruthy();
      expect(
        labels.bn,
        `${code}'s Bengali label is identical to its English one — the admin picker ` +
          'is bilingual and the applicant reads the result',
      ).not.toBe(labels.en);
      // The Bengali label must actually be Bengali. An untranslated string that
      // differs only by punctuation would pass the check above.
      expect(/[ঀ-৿]/.test(labels.bn), `${code}'s Bengali label has no Bengali script`)
        .toBe(true);
    }
  });

  it('resolves a stored code to a label, and an unknown one to nothing', () => {
    expect(rejectionReasonLabel('IDENTITY_MISMATCH', 'en'))
      .toBe(REJECTION_REASON_LABELS.IDENTITY_MISMATCH.en);
    expect(rejectionReasonLabel('IDENTITY_MISMATCH', 'bn'))
      .toBe(REJECTION_REASON_LABELS.IDENTITY_MISMATCH.bn);
    // A row written before this feature, or by a future code this build does
    // not know, renders as blank rather than as the raw enum name.
    expect(rejectionReasonLabel(null, 'en')).toBe('');
    expect(rejectionReasonLabel('SOMETHING_ELSE', 'en')).toBe('');
  });
});
