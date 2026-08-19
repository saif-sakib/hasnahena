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
 */

import type { Locale } from '@/i18n';

export type FaqEntry = { q: string; a: string };

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
    {
      q: 'Can I withdraw my deposited funds?',
      a: 'Yes. A minimum 3-month prior notice is required before withdrawal.',
    },
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
    {
      q: 'জমা টাকা উত্তোলন করা যাবে?',
      a: 'হ্যাঁ। তবে উত্তোলনের জন্য অন্তত ৩ মাস আগে কর্তৃপক্ষকে জানাতে হবে।',
    },
    {
      q: 'ঋণের জন্য যোগ্যতা কীভাবে নির্ধারিত হয়?',
      a: 'আপনার নিয়মিত জমা, সদস্যপদের অবস্থা এবং প্রশাসনিক যাচাই অনুযায়ী ঋণ যোগ্যতা নির্ধারিত হয়।',
    },
  ],
};

export function faqEntries(locale: Locale): readonly FaqEntry[] {
  return FAQ[locale];
}
