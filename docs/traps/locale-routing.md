# Locale routing

- **Changing the default locale does not change any code — it changes what
  every untested assumption was hiding.** Bengali was the default for the
  project's whole life, so a Bengali string written straight into a component
  looked right on every page anyone opened, and a locale switch that only ever
  ran with a prefix present was never asked to add one. Making English the
  default (WO-94) did not break these; it *revealed* them, all at once, on the
  live site. Budget for a sweep of rendered pages after any such flip, not a
  sweep of the diff — the diff is where they are not.
- **There is no correct way to swap a locale with `String.replace`.** Under
  `as-needed` one of the two locales has no segment to replace, so the match
  lands somewhere else: `localePath('en')` is `/`, and
  `pathname.replace(localePath(locale), '/bn')` therefore rewrote the **first
  slash** of `/dashboard/admin` and produced `/bndashboard/admin`. It
  typechecks, it renders, and only a click reveals it — the language button on
  every staff screen went to a 404. `switchLocalePath` is the only sanctioned
  spelling, and `locale-routing.test.ts` bans the shape rather than the
  instance.
- **Playwright matches an accessible name by substring by default.**
  `getByRole('link', { name: 'EN' })` matched the logo, whose alt text is
  "Hasnah**en**a Foundation", so the first version of the language-toggle spec
  clicked the logo and passed without ever touching the button it was written
  for. Pass `exact: true` whenever the name is short enough to be a substring of
  something else — which two-letter language codes always are.
- **A `system_config` value that is prose needs one row per language.** There
  was a single `org.address`, so whichever script the admin typed it in was
  shown to both audiences: the Bengali address appeared under an English
  "Address" heading on the home, contact and support pages and in the footer of
  every public page, and on the letterhead of every generated document, which
  [ADR-012](../decisions.md) makes English only. `org.name`/`org.nameEn` had
  already solved this; the address now has the same pair. Nothing over the
  source can catch this class — the string is in the database, not the repo — so
  the guard is a unit test on the pair plus an e2e test on the rendered page.
  **And that guard did not catch the next one.** `org.description` was still a
  single row four months later, and neither half of the guard could see it: the
  pair test only knows about pairs somebody has already made, and the e2e test
  reads *rendered pages*, while the description's only reader is the JSON-LD in
  `organizationSchema()` — a surface no member ever looks at, whose whole
  contract is that it is English, and which was publishing the foundation's
  Bengali self-description to every search engine and assistant on both
  locales. When splitting one of these, **enumerate the prose keys and check
  each**, rather than fixing the one that was reported: `org.name`,
  `org.address` and `org.description` were always the same bug three times.
  **It then happened a fourth time**, because that instruction was written and
  not carried out. The T-09 audit found nine more — `hero.tagline`,
  `features.title`, `contact.title`, three `donation.*`, `navigation.donate`,
  `auth.welcomeBack` — every one a single box labelled in English on the admin
  screen. The list is the fix, not the key: `LOCALIZED_SETTING_PAIRS` in
  `lib/localized-settings.ts` names all twelve pairs, one resolver reads them,
  and the census reads source **line by line** and fails on a pair key named
  anywhere that does not also call the resolver. That last detail matters: the
  first version of the census searched for `settings['…']` and walked straight
  past `trimmed(settings, 'org.name')` in the JSON-LD builder, which is the
  reader that hid `org.description` for four months in the first place.
- **An e2e test that reads rendered text must strip what an admin typed.** A
  cooperative in Jashore legitimately has Bengali in its own settings, and a
  test that goes red because someone edited a database row gets deleted rather
  than read. `locale-content.spec.ts` fetches the public settings and removes
  their values before asserting, so it only ever fails on copy the code owns.
- **A redirect at the root is what makes `/` and `/bn` duplicates, not the
  choice of default locale.** Search Console reported *"Duplicate, Google chose
  different canonical than user"* on `/bn` with a Google-selected canonical of
  `/`. `/` was 307ing to a negotiated locale; Google merges a redirecting root
  with whatever it lands on and keeps the shorter URL. Flipping `defaultLocale`
  from `bn` to `en` would have moved the report to `/en` and changed nothing
  else. The fix is that `/` renders (WO-95, [ADR-034](../decisions.md)). Before
  blaming canonical tags, check the pages are not *actually* duplicates: strip
  the tags and compare (here 6% shared tokens).
- **next-intl's `as-needed` redirect is a 307, and a 307 is not a canonical
  signal.** Google treats a temporary redirect as reversible and may keep
  indexing the old URL. Every `/en/*` URL that is already out in the world has
  to answer **301**, which means doing it in `proxy.ts` before next-intl runs.
- **`localePrefix` is a routing rule, not a directory rule.** `app/[locale]/`
  is unchanged, `generateStaticParams` still yields both locales, and the
  prerender manifest keys are still `/en/...` — next-intl *rewrites* `/faq` to
  `/en/faq` internally. `assert-static-routes.mjs` reads the manifest, so it
  needed no change; rewriting it to match the public URLs would have made it
  report every English page as missing.
- **Switching to `as-needed` turns every hand-built `/${locale}/…` into a
  redirect.** Twenty-two files did it, and under the old `always` scheme it was
  merely repetitive. Afterwards each one produces `/en/faq`, which 301s — so a
  member tapping a header link pays a round trip and a crawler is told the href
  it was given is not the real URL. One `localePath()`, and a census on the next
  one.
- **`pathname.replace('/en', '/bn')` was never a language switch.** It matches
  `/enrolment`, and under `as-needed` the English pathname has no segment to
  replace at all. Split on `/`, check the first segment against the locale list,
  and rebuild.
- **A `Vary` that is not true is not free.** `Vary: Accept-Language` was the
  correct fix for a cacheable, negotiating root. Once nothing negotiates it is a
  CDN cache entry per distinct header value on the busiest pages the site has,
  bought for a property nothing needs. Deleting it is part of the change, not a
  loose end.
- **A URL in an email is not a URL in a page.** A link that 301s is fine in a
  header and wrong in an approval email: emails outlive the deploy that wrote
  them, they are forwarded, and some clients and corporate link scanners resolve
  a redirect before a person ever clicks. When a URL shape changes, the email
  templates are a separate surface from the pages — and in this repository they
  are in the *other language*, which is why a sweep of `apps/web` found none of
  them.
- **A guard's coverage can shrink as the code improves.** The fee-promise census
  walked `app/` and was complete only because almost all the copy lived there.
  Moving 73 strings into `messages/{en,bn}.json` — the *correct* change, rule 5 —
  moved them out of its reach, silently. When copy, config or logic migrates out
  of a directory a census walks, the census moves with it or it quietly becomes
  a check on a shrinking subset.
- **A lint rule can be silenced by making its input unanalysable.**
  `window.location.href = '/en'` warns; `window.location.href = localePath(locale)`
  does not, because the rule cannot see a literal any more. The warning count
  went down and the code was no better. If a rule stops firing after a refactor,
  check whether it was satisfied or merely blinded.
- **A response whose target depends on a request header must send `Vary`.**
  While `/` negotiated on `Accept-Language`, next-intl's 307 carried
  `cache-control: public` and no `Vary`, so Cloudflare could serve one visitor's
  redirect to the next. Check such a header over HTTP in the browser suite — a
  middleware header can be replaced further down the response path. (`/` no
  longer negotiates; `e2e/locale-negotiation.spec.ts` now asserts *no* `Vary`.)

---

[← all traps](../traps.md)
