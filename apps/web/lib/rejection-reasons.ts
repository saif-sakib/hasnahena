/**
 * Why an application was turned down.
 *
 * The owner's ruling, 2026-08-26: the applicant is emailed, and the admin
 * **picks** a reason from a list rather than composing one, with free text
 * available when they want it. A list is the important half. Before this, the
 * approvals screen posted `reason: ''` — hardcoded, with no control to change
 * it — so FR-05's "approve/reject with reason" was never met on the reject
 * side, and the only record of a rejection was an audit row whose `details`
 * column was the empty string.
 *
 * Picking beats typing here for three reasons that are specific to this
 * foundation rather than general UI taste:
 *
 *   1. **It gets sent to a neighbour.** Jashore is one town and the admin knows
 *      the applicant. A preset sentence the foundation has agreed on is easier
 *      to send, and easier to defend, than one person's wording.
 *   2. **It has to be Bengali.** The applicant reads Bengali; the admin may be
 *      working in either language. A code chosen in one language renders in the
 *      applicant's, which free text cannot do.
 *   3. **It survives the retention sweep.** ADR-033 clears a rejected
 *      applicant's identity data after `security.rejectedRetentionDays`, and
 *      free text an admin typed may name them. The *code* is the decision and
 *      is kept for ever; the note is cleared with the rest.
 *
 * `OTHER` requires the note, because a rejection whose stated reason is "other"
 * and nothing else tells the applicant nothing at all.
 *
 * ---
 *
 * **The Go API holds the same list**, in `rejectionReasonSentence` in
 * `internal/services/email_service.go`, because that is where the email is
 * built. `apps/web/test/unit/rejection-reasons.test.ts` reads both files and
 * fails when the codes drift: a code this file offers that Go does not know
 * renders as a blank reason in the one message the applicant receives.
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

/**
 * What the admin sees in the picker.
 *
 * Deliberately phrased as the reason itself rather than as an instruction, so
 * the same words make sense in the list, on the rejected application's row, and
 * quoted back in the email.
 */
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
