/* eslint-disable @next/next/no-html-link-for-pages -- every link here is a
   deliberate full document load; see the note on the component below. */
import Image from 'next/image';

import './globals.css';

/**
 * The 404 for unmatched URLs. At the ROOT: a segment's not-found.tsx only
 * catches notFound() thrown inside it. Copy is inline in both languages (rule 5
 * exception): this renders outside the locale layout, with no locale to know.
 */
export default function RootNotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 py-16 text-center">
      <a href="/" className="mb-8 inline-block">
        <Image
          src="/images/logo/logo.png"
          alt="হাসনাহেনা ফাউন্ডেশন / Hasnahena Foundation"
          width={214}
          height={120}
          style={{ height: '56px', width: 'auto' }}
          className="max-w-full object-contain"
          priority
        />
      </a>

      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-600">404</p>

      <h1 className="mt-3 text-2xl font-bold text-slate-900 sm:text-3xl">
        We could not find that page
      </h1>
      <p className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">
        পাতাটি খুঁজে পাওয়া যায়নি
      </p>

      <p className="mt-5 max-w-md leading-relaxed text-slate-600">
        The address may be mistyped, or the page may have moved. Everything on the site is
        reachable from the home page.
      </p>
      <p className="mt-2 max-w-md leading-relaxed text-slate-600">
        ঠিকানাটি ভুল হতে পারে, অথবা পাতাটি সরে গিয়ে থাকতে পারে। হোম পেজ থেকে সাইটের সবকিছুতেই যাওয়া যায়।
      </p>

      {/* Plain <a>: outside the root layout there is no router context for <Link>. */}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <a
          href="/"
          className="rounded-md bg-emerald-600 px-6 py-3 font-medium text-white transition-colors hover:bg-emerald-700"
        >
          Home · হোম
        </a>
        <a
          href="/support"
          className="rounded-md border border-slate-300 bg-white px-6 py-3 font-medium text-slate-700 transition-colors hover:bg-slate-100"
        >
          Get help · সহায়তা
        </a>
      </div>
    </main>
  );
}
