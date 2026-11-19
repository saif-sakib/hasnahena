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
      q: 'How can I become a member of Hasnahena Foundation?',
      a: 'Complete the online registration form, upload your national ID photo, personal photograph, signature, and nominee details, and pay the one-time ৳500 non-refundable office expense. Your membership becomes active after administrative review and approval.',
    },
    {
      q: 'Do I have to pay interest, profit, or late fees on loans?',
      a: 'No. All loans at Hasnahena Foundation are 100% interest-free under Qard al-Hasan principles — there is zero interest rate, zero profit markup, and zero late fee or penalty on missed instalments. Members only pay a flat ৳500 non-refundable office expense once at loan application, which is never added to the loan.',
    },
    {
      q: 'What is Qard al-Hasan and how does Hasnahena Foundation practice it?',
      a: 'Qard al-Hasan means a "goodly loan" given sincerely for the sake of Allah to help someone in need, where the borrower repays only the exact principal borrowed. In Jashore, Hasnahena Foundation pools member savings and charity so members can access zero-interest loans without falling into riba.',
    },
    {
      q: 'How is loan eligibility and maximum loan amount determined?',
      a: 'Loan eligibility depends on regular savings behavior, active membership status, and administrative review. Under standard policy, members need at least ৳8,000 in savings and can apply for up to 5 times their deposit, repayable over up to 24 monthly instalments, with one active loan at a time.',
    },
    {
      q: 'Do I need a guarantor to apply for a loan?',
      a: 'Loans above ৳20,000 require another active member to act as your guarantor. The nominated guarantor reviews and approves your request directly from their own member dashboard.',
    },
    // Filled in by faqEntries; never rendered as-is.
    { q: 'Can I withdraw my deposited savings?', a: '' },
    {
      q: 'How do deposits and loan repayments work transparently?',
      a: 'Deposits and repayments follow a three-step Request, Process, and Confirm workflow: you submit a request or pay your field worker, staff record the posting with a sequential receipt number, and you confirm the posting in your digital passbook alongside the foundation’s official physical books.',
    },
    {
      q: 'How can I donate (Sadaqah or charity) to Hasnahena Foundation?',
      a: 'You can contribute via the bKash, Nagad, Rocket, or bank account details published on our Donate page. Every taka helps fund interest-free support and social welfare programs in Jashore.',
    },
    {
      q: 'Where is Hasnahena Foundation located and who can join?',
      a: 'Hasnahena Foundation is based in Bhekutia, Sadar, Jashore, Bangladesh. Adult residents who meet the minimum age requirement and agree to follow the cooperative’s halal-source and interest-free rules can apply for membership.',
    },
    {
      q: 'How is my personal and financial data protected?',
      a: 'Passwords are stored only as one-way cryptographic hashes, access is strictly restricted by role, and every balance change is recorded in an append-only audit log that cannot be edited or deleted.',
    },
  ],
  bn: [
    {
      q: 'কীভাবে হাসনাহেনা ফাউন্ডেশনের সদস্য হবো?',
      a: 'অনলাইন নিবন্ধন ফর্ম পূরণ করে জাতীয় পরিচয়পত্রের ছবি, নিজের ছবি, স্বাক্ষর ও নমিনির তথ্য আপলোড করুন এবং নিবন্ধনের সময় অফিস খরচ বাবদ এককালীন ৳৫০০ (অফেরতযোগ্য) পরিশোধ করুন। প্রশাসনিক যাচাই ও অনুমোদনের পর আপনার সদস্যপদ সক্রিয় হবে।',
    },
    {
      q: 'ঋণের উপর কি কোনো সুদ, মুনাফা বা বিলম্ব জরিমানা দিতে হয়?',
      a: 'না। হাসনাহেনা ফাউন্ডেশনের সকল ঋণ কর্জে হাসানা নীতিতে ১০০% সুদমুক্ত — কোনো সুদের হার, মুনাফা, মার্কআপ বা বিলম্ব জরিমানা নেই। শুধুমাত্র ঋণ আবেদনের সময় একবার অফিস খরচ বাবদ ৳৫০০ (অফেরতযোগ্য) দিতে হয়, যা কখনো মূল ঋণের সাথে যোগ হয় না।',
    },
    {
      q: 'কর্জে হাসানা কী এবং হাসনাহেনা ফাউন্ডেশন কীভাবে এটি পরিচালনা করে?',
      a: 'কর্জে হাসানা অর্থ "উত্তম ঋণ", যা আল্লাহর সন্তুষ্টির উদ্দেশ্যে অভাবগ্রস্তের প্রয়োজনে দেওয়া হয় এবং ঋণগ্রহীতা ঠিক যত টাকা নিয়েছেন ততটুকুই ফেরত দেন। যশোরে হাসনাহেনা ফাউন্ডেশন সদস্যদের সঞ্চয় ও অনুদানের মাধ্যমে রিবা-মুক্ত এই সমবায় ঋণ ব্যবস্থা পরিচালনা করে।',
    },
    {
      q: 'ঋণের যোগ্যতা ও সর্বোচ্চ ঋণের পরিমাণ কীভাবে নির্ধারিত হয়?',
      a: 'নিয়মিত সঞ্চয়, সক্রিয় সদস্যপদ এবং প্রশাসনিক যাচাইয়ের মাধ্যমে ঋণের যোগ্যতা নির্ধারিত হয়। প্রচলিত নীতি অনুযায়ী ন্যূনতম ৳৮,০০০ সঞ্চয় থাকলে সদস্যরা জমার সর্বোচ্চ ৫ গুণ পর্যন্ত ঋণের জন্য আবেদন করতে পারেন এবং সর্বোচ্চ ২৪টি মাসিক কিস্তিতে পরিশোধ করতে পারেন। একসাথে একটি সক্রিয় ঋণ নেওয়া যায়।',
    },
    {
      q: 'ঋণের জন্য কি জামিনদার প্রয়োজন হয়?',
      a: '৳২০,০০০-এর বেশি ঋণের ক্ষেত্রে আরেকজন সক্রিয় সদস্যকে জামিনদার হিসেবে যুক্ত করতে হয়। মনোনীত জামিনদার তাঁর নিজস্ব সদস্য ড্যাশবোর্ড থেকে অনুরোধটি যাচাই ও অনুমোদন করেন।',
    },
    { q: 'জমা টাকা কি উত্তোলন করা যাবে?', a: '' },
    {
      q: 'আমানত ও ঋণের কিস্তি পরিশোধের স্বচ্ছতা কীভাবে নিশ্চিত করা হয়?',
      a: 'আমানত ও ঋণ পরিশোধ অনুরোধ, প্রক্রিয়াকরণ ও নিশ্চিতকরণ — এই তিন ধাপে সম্পন্ন হয়। আপনি অনুরোধ পাঠালে বা মাঠকর্মীর কাছে জমা দিলে কর্মীরা ধারাবাহিক রশিদ নম্বরসহ এন্ট্রি করেন এবং আপনি আপনার ডিজিটাল পাসবুকে তা নিশ্চিত করতে পারেন; পাশাপাশি ফাউন্ডেশনের অফিসিয়াল খাতাও সংরক্ষিত থাকে।',
    },
    {
      q: 'হাসনাহেনা ফাউন্ডেশনে কীভাবে দান বা সাদাকা পাঠানো যায়?',
      a: 'আমাদের অনুদান পাতায় প্রকাশিত বিকাশ, নগদ, রকেট অথবা ব্যাংক হিসাব নম্বরের মাধ্যমে অনুদান পাঠাতে পারেন। আপনার প্রতিটি টাকা যশোরে সুদমুক্ত অর্থায়ন ও সমাজকল্যাণমূলক কাজে ব্যয় হয়।',
    },
    {
      q: 'হাসনাহেনা ফাউন্ডেশনের অফিস কোথায় এবং কারা সদস্য হতে পারেন?',
      a: 'হাসনাহেনা ফাউন্ডেশনের অফিস যশোর সদরের ভেকুটিয়ায় অবস্থিত। ন্যূনতম বয়সসীমা পূরণকারী প্রাপ্তবয়স্ক ব্যক্তিরা, যাঁরা হালাল উপার্জন ও সুদমুক্ত সমবায়ের নিয়মাবলি মেনে চলতে সম্মত, সদস্যপদের জন্য আবেদন করতে পারেন।',
    },
    {
      q: 'আমার ব্যক্তিগত ও আর্থিক তথ্য কীভাবে সুরক্ষিত রাখা হয়?',
      a: 'পাসওয়ার্ড কেবল একমুখী হ্যাশ আকারে সংরক্ষণ করা হয়, ভূমিকা অনুযায়ী প্রবেশাধিকার নিয়ন্ত্রিত থাকে এবং ব্যালেন্সের প্রতিটি পরিবর্তন অপরিবর্তনীয় অডিট লগে লিপিবদ্ধ থাকে।',
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
