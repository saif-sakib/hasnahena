/**
 * Why an application was turned down: the admin picks a code (FR-05), with an
 * optional note. A code renders in the applicant's language and survives the
 * retention sweep, unlike the note (ADR-033). OTHER requires the note. The Go
 * twin is rejectionReasonSentence in email_service.go (rejection-reasons.test.ts).
 */

export const REJECTION_REASON_CODES = [
  'INCOMPLETE_DOCUMENTS',
  'UNCLEAR_DOCUMENTS',
  'IDENTITY_MISMATCH',
  'DUPLICATE_APPLICATION',
  'OUTSIDE_SERVICE_AREA',
  'BELOW_MINIMUM_AGE',
  'COULD_NOT_VERIFY',
  'OTHER',
] as const;

export type RejectionReasonCode = (typeof REJECTION_REASON_CODES)[number];

/** The code that obliges the admin to write something. */
export const REJECTION_REASON_REQUIRING_NOTE: RejectionReasonCode = 'OTHER';

/** How long the free-text note may be. Long enough for a sentence or two. */
export const REJECTION_NOTE_MAX_LENGTH = 400;

type Labels = { en: string; bn: string };

/** Picker labels, phrased as the reason itself so they read the same everywhere. */
export const REJECTION_REASON_LABELS: Record<RejectionReasonCode, Labels> = {
  INCOMPLETE_DOCUMENTS: {
    en: 'Required documents were missing',
    bn: 'প্রয়োজনীয় কাগজপত্র জমা দেওয়া হয়নি',
  },
  UNCLEAR_DOCUMENTS: {
    en: 'Documents were not readable',
    bn: 'জমা দেওয়া কাগজপত্র স্পষ্ট নয়',
  },
  IDENTITY_MISMATCH: {
    en: 'Details did not match the NID provided',
    bn: 'দেওয়া তথ্য এন.আই.ডি-র সাথে মেলেনি',
  },
  DUPLICATE_APPLICATION: {
    en: 'An account already exists for this person',
    bn: 'এই ব্যক্তির নামে ইতিমধ্যে একটি অ্যাকাউন্ট রয়েছে',
  },
  OUTSIDE_SERVICE_AREA: {
    en: 'Address is outside the area the foundation serves',
    bn: 'ঠিকানাটি ফাউন্ডেশনের কার্যএলাকার বাইরে',
  },
  BELOW_MINIMUM_AGE: {
    en: 'Applicant is below the minimum age for membership',
    bn: 'আবেদনকারীর বয়স সদস্যপদের ন্যূনতম বয়সের কম',
  },
  COULD_NOT_VERIFY: {
    en: 'The applicant could not be contacted to verify the application',
    bn: 'আবেদন যাচাইয়ের জন্য আবেদনকারীর সাথে যোগাযোগ করা যায়নি',
  },
  OTHER: {
    en: 'Other reason (write it below)',
    bn: 'অন্যান্য কারণ (নিচে লিখুন)',
  },
};

export function isRejectionReasonCode(value: unknown): value is RejectionReasonCode {
  return typeof value === 'string'
    && (REJECTION_REASON_CODES as readonly string[]).includes(value);
}

/** The label for a stored code, for the approvals screen. */
export function rejectionReasonLabel(
  code: string | null | undefined,
  locale: string,
): string {
  if (!isRejectionReasonCode(code)) return '';
  return REJECTION_REASON_LABELS[code][locale === 'bn' ? 'bn' : 'en'];
}
