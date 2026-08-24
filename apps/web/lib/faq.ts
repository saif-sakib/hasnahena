/**
 * The questions on `/faq`, in one place.
 *
 * WO-79 needs these twice — once as the page's visible content and once inside
 * the `FAQPage` structured data — and Google treats a rich result whose answer
 * differs from the answer on the page as a policy violation, not a typo. Two
 * copies kept equal by hand is the ADR-023 shape; there is one copy.
 *
 * These live here rather than in `messages/{en,bn}.json` because they are not
 * interface copy: the JSON-LD builder is a plain function with no next-intl
 * context to read from, and giving it one would make every schema an async
 * server call. If they ever need to be editable by an admin they belong in
 * `system_config` with a key per question, not in a component.
 *
 * One answer is already parameterised that way. "Can I withdraw?" used to say
 * "a minimum 3-month prior notice is required" — a rule that was enforced in
 * code until ADR-030 and is now a request, and a number an admin can change on
 * the settings screen. It is rendered from `loan.noticePeriodDays` so the page
 * and the policy cannot drift, and the *page* and the *structured data* are
 * still one string: Google treats a rich result whose answer differs from the
 * one on the page as a policy violation.
 */

import type { Locale } from '@/i18n';

export type FaqEntry = { q: string; a: string };

/**
 * What the withdrawal answer says when no notice period is configured, or the
 * setting is missing. It promises no number rather than inventing one — the
 * previous hardcoded "3 months" was exactly the fallback that outlived its
 * rule.
 */
const NO_NOTICE_PERIOD: Record<Locale, string> = {
  en: 'Yes. Tell your field worker when you would like to withdraw and they will arrange it.',
  bn: 'হ্যাঁ। কবে টাকা তুলতে চান তা আপনার মাঠকর্মীকে জানান, তিনি ব্যবস্থা করবেন।',
};

const withdrawalAnswer = (locale: Locale, noticePeriodDays: number): string => {
  if (!Number.isFinite(noticePeriodDays) || noticePeriodDays <= 0) return NO_NOTICE_PERIOD[locale];
  return locale === 'bn'
    ? `হ্যাঁ। উত্তোলনের অন্তত ${noticePeriodDays} দিন আগে আপনার মাঠকর্মীকে জানাতে অনুরোধ করা হয়, যাতে টাকা প্রস্তুত রাখা যায়।`
    : `Yes. We ask for at least ${noticePeriodDays} days' notice to your field worker so the money can be ready for you.`;
};

const FAQ: Record<Locale, readonly FaqEntry[]> = {
  en: [
    {
      q: 'How can I become a member?',
      a: 'Complete the registration form and upload the required documents. Your membership is activated after approval.',
    },
    {
      q: 'Do I have to pay interest on loans?',
      a: 'No. All loans are fully interest-free under Qard al-Hasan principles.',
    },
    // The answer is supplied by withdrawalAnswer(); this placeholder is
    // replaced in faqEntries and never rendered.
    { q: 'Can I withdraw my deposited funds?', a: '' },
    {
      q: 'How is loan eligibility determined?',
      a: 'Eligibility is determined by your deposit behavior, membership status, and administrative review.',
    },
  ],
  bn: [
    {
      q: 'কিভাবে সদস্য হবো?',
      a: 'নিবন্ধন ফর্ম পূরণ করে প্রয়োজনীয় নথি আপলোড করুন। অনুমোদনের পর আপনি সদস্যপদ পাবেন।',
    },
    {
      q: 'ঋণের উপর কি সুদ দিতে হবে?',
      a: 'না। আমাদের সকল ঋণ কর্জে হাসানা নীতিতে সম্পূর্ণ সুদমুক্ত।',
    },
    { q: 'জমা টাকা উত্তোলন করা যাবে?', a: '' },
    {
      q: 'ঋণের জন্য যোগ্যতা কীভাবে নির্ধারিত হয়?',
      a: 'আপনার নিয়মিত জমা, সদস্যপদের অবস্থা এবং প্রশাসনিক যাচাই অনুযায়ী ঋণ যোগ্যতা নির্ধারিত হয়।',
    },
  ],
};

/**
 * The questions for a locale, with the withdrawal answer filled in from
 * `loan.noticePeriodDays`.
 *
 * `noticePeriodDays` defaults to 0, which renders the no-number answer. That is
 * the honest default for a caller that has no settings map to hand — better a
 * true sentence with no figure than a figure nobody set.
 */
export function faqEntries(locale: Locale, noticePeriodDays = 0): readonly FaqEntry[] {
  return FAQ[locale].map((entry) =>
    entry.a === '' ? { q: entry.q, a: withdrawalAnswer(locale, noticePeriodDays) } : entry,
  );
}

/**
 * `loan.noticePeriodDays` out of a settings map, as a whole number of days.
 *
 * One parser rather than one per caller. The FAQ page renders the answer and
 * `<StructuredData>` renders the same answer into JSON-LD; if those two read the
 * setting differently, Google sees a rich result that disagrees with the page,
 * which is a policy violation rather than a cosmetic difference.
 *
 * Anything unparseable, negative or absent is 0, which renders the answer that
 * quotes no figure.
 */
export function noticePeriodDaysFrom(settings: Record<string, string> | undefined): number {
  const parsed = Number(settings?.['loan.noticePeriodDays']);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}
