/**
 * The /faq questions, in one place: the page and its FAQPage JSON-LD must be
 * the same string (Google treats a mismatch as a policy violation). Not in
 * messages because the JSON-LD builder has no next-intl context. The
 * withdrawal answer is rendered from loan.noticePeriodDays.
 */

import type { Locale } from '@/i18n';

export type FaqEntry = { q: string; a: string };

/** The withdrawal answer when no notice period is set — it promises no number. */
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
    // Filled in by faqEntries; never rendered as-is.
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

/** The questions for a locale; noticePeriodDays 0 renders the no-number answer. */
export function faqEntries(locale: Locale, noticePeriodDays = 0): readonly FaqEntry[] {
  return FAQ[locale].map((entry) =>
    entry.a === '' ? { q: entry.q, a: withdrawalAnswer(locale, noticePeriodDays) } : entry,
  );
}

/**
 * loan.noticePeriodDays as whole days (0 if unparseable). One parser, so the
 * page and the JSON-LD cannot disagree.
 */
export function noticePeriodDaysFrom(settings: Record<string, string> | undefined): number {
  const parsed = Number(settings?.['loan.noticePeriodDays']);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}
