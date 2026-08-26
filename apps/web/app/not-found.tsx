/* eslint-disable @next/next/no-html-link-for-pages -- every link here is a
   deliberate full document load; see the note on the component below. */
import Image from 'next/image';

import './globals.css';

/**
 * The page a visitor gets for a URL that does not exist.
 *
 * There was no `not-found.tsx` anywhere in this app until T-10, so every bad URL
 * — a mistyped address, a stale link from a printed leaflet, an old `/en/donate`
 * bookmark — was answered by Next's built-in default: black Helvetica on white
 * reading `404 | This page could not be found.`, with no logo, no navigation, no
 * way back and no Bengali. On a site whose whole job is to look like an
 * institution people can trust with their savings, that was the worst-looking
 * page on it, and it was the one shown to somebody already lost.
 *
 * **Why it lives at the root and not under `app/[locale]/`.** A segment's
 * `not-found.tsx` only catches `notFound()` thrown *from inside that segment*.
 * An unmatched URL never reaches the segment at all, so a
 * `app/[locale]/not-found.tsx` renders for nothing — checked, on all three
 * shapes this site can produce: `/nonexistent`, `/bn/nonexistent` and `/fr`
 * (an unknown locale, where the layout itself calls `notFound()`) all land
 * here. That file was written first and deleted rather than kept as decoration.
 *
 * **Why the copy is inline, against rule 5.** This renders outside
 * `app/[locale]/layout.tsx`, which is where next-intl's provider lives — so
 * there is no `useTranslations` and, more to the point, **no locale to
 * translate into**. Next generates a bare root layout for this route. The same
 * constraint `global-error.tsx` documents, and the same answer: say it in both
 * languages, because a 404 is the one page that does not know who is reading.
 *
 * `globals.css` is imported directly so the Tailwind classes below resolve. The
 * `--font-sans` variable is set by `next/font` in the locale layout and is
 * absent here, so the stack falls back — deliberately accepted rather than
 * loading a webfont for an error page.
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

      {/*
        Plain <a>, not next/link, and `no-html-link-for-pages` is disabled at
        the top of the file for the same reason global-error.tsx disables it:
        this page renders outside the app's own root layout, so a client-side
        navigation would be asking a tree that never fully mounted to render the
        next page. A full document load rebuilds it from scratch, which is the
        point — and the router context a <Link> needs is exactly what is missing.
      */}
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
