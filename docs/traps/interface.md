# Interface

**A badge inside a link changes that link's accessible name.** The Approvals
nav item gained a red dot carrying `role="status"` and an `aria-label` of
"3 pending approvals", which is right for a screen reader — a colour is not
information — and it means `getByRole('link', { name: 'Approvals', exact: true })`
stops matching the moment the badge works. The spec written alongside the badge
failed on its own feature. Locate a nav item by `href`, which is what actually
identifies it, and keep the name assertions for the badge itself.

The same applies to a tab button that renders its own count: `{ name: 'Deposit',
exact: true }` matches until the queue is non-empty, which is precisely the state
every test about the queue sets up.


**A feature behind `@supports` that degrades to nothing degrades SILENTLY, and
looks exactly like never having built it.** The home page's section reveal was
written as a scroll-driven CSS animation — `animation-timeline: view()`, no
observer, no listener, off the main thread, not one byte of JavaScript. It is
the right answer on paper and it was wrapped in `@supports` so that a browser
without the feature would fall back to the finished page, which is the correct
way to write it.

`animation-timeline` reached Safari in **26** and Firefox in **144**. The owner
was on an engine that had neither, so *not one line of the block was ever
applied for them*. It was reported twice, in the same words both times —
"everything is loaded previously and shown as static" — and both reports were
accurate. Two rounds of fixes were made in between, each carefully measured, and
neither could possibly have helped: they were adjustments to a block that never
ran.

Three things generalise:

- **The engine you test in is the one that supports the feature.** A headless
  Chromium check confirms the animation works, which is true and irrelevant. So
  does reading the CSS. So does the bundle containing it.
- **A graceful degradation and a broken feature are the same observation.** The
  page renders correctly in both, which is why the report was "nothing happens"
  rather than "something is wrong" — and why it took a second identical report
  to suspect the mechanism rather than the tuning.
- **Ask what the reader's browser is before optimising for elegance.** The
  replacement — `IntersectionObserver` plus a CSS transition — costs 1,280 bytes
  of first-load JavaScript and has worked in every engine since 2019. That was
  the right trade from the start for a site whose readers are not chosen.

Guarded now by `apps/web/e2e/scroll-reveal.spec.ts`, and the assertion that
matters is the negative one: **elements below the fold must actually be hidden
before you scroll to them.** A reveal that reveals nothing passes every check
that only looks at the finished page.


**A reveal that hides on a page which has already painted will animate the wrong
way first.** The replacement above hides elements by putting `data-reveal-js` on
`<html>` from JavaScript — deliberately, so that no JavaScript means nothing
hidden and the page can never fail closed. But the `transition` was written on
the hiding rule, so when the attribute landed on an already-painted page, every
revealed element transitioned from its resting opacity of **1 down to 0**: a
520ms fade-OUT of twenty-nine elements at load, then a fade back in. On screen
it is a blink.

Put the transition on the ARRIVAL rule (`[data-revealed]`) and nowhere else.
Hiding then happens in one frame — invisible, because everything it applies to
is off-screen when it happens — and the animation can only ever run inwards.

The test for it is a direction, not a state: sample opacity twice and assert
nothing **decreased**. "Nothing is part-way" is the obvious assertion and it is
wrong, because part-way is also what a legitimate reveal looks like — that form
failed on ten elements sitting at 0.915 on their way up.


**A spec that proves a negative must first prove its precondition.** The
reduced-motion case asserts that no observer is armed and nothing is hidden.
Written with `test.use({ reducedMotion: 'reduce' })` inside a `describe`, the
emulation never reached the page under this project's Playwright config —
`matchMedia('(prefers-reduced-motion: reduce)').matches` was `false` — so the
test was asserting the ordinary behaviour of an ordinary page and would have
passed forever. `page.emulateMedia()` sets it unambiguously, and the spec now
asserts the media query is in force before asserting what follows from it.


**Opacity and movement want different timing, whatever the mechanism.** This
survived a complete rewrite of the reveal, which is the sign that it is about
reading rather than about CSS. Tie a fade to the same slow curve as the travel
and the text is unreadable for as long as the travel lasts — that was reported
as "why are the hadith grey, the colour is so light", and measured at **0.19
opacity on an element that was fully on screen**, under 0.9 for five hundred
pixels of scrolling, across thirty-four elements. Nothing was wrong with the
colours; the paragraphs have no `text-*` class at all and inherit near-black.

A reader who stops to read stops in the middle of your animation. So the fade is
short and linear and finishes early; the movement is longer and eased and
finishes late. In a staggered row, stagger the **movement** — staggering the
fade by the same amount is what made the third card of each row the one that was
still grey when you stopped at it.


**An `nth-child(3n)` stagger is a cascade on a three-column grid and a rendering
fault on a four-column one.** `reveal-row` shifts each column's range by a step
using `nth-child(3n + 2)` and `(3n + 3)`, which is right for the three- and
six-card rows it was written against. Two rows on the home page are
`lg:grid-cols-4`, and there the fourth card falls back onto the *first* card's
offset — so cards 1 and 4 arrived together while 2 and 3 were still fading, and
what a reader sees is not a stagger but one card that has failed to animate.

CSS cannot count a grid's columns, so the cycle cannot be inferred: the caller
has to say which one it is in (`reveal-row` or `reveal-row-4`). Keep the
keyframe, the timeline and the base range shared between them, or the variants
drift apart the first time one is tuned.

**`position: fixed` escapes the page only while no ancestor opens a stacking
context.** The gallery lightbox is `fixed inset-0 z-50`. On `/gallery` it
covered the viewport correctly. On the home page the same component sits inside

```html
<section class="relative overflow-hidden">
  <div class="container-wide relative z-10">
```

and that `relative z-10` is a stacking context, so the overlay's `z-50` was
50-*within*-10: the page's `fixed z-50` header painted straight over the top of
it, and the section's `overflow-hidden` clipped the rest. Nothing was wrong with
the component, and no test of the component could have found it — what changed
was the page that wrapped it.

Render an overlay through `createPortal(…, document.body)`. It is then a child
of `<body>`, out of reach of whatever any page wraps the grid in, and it is the
only version that stays correct when someone adds a `relative z-10` above it
later. No mounted flag is needed for the server: the overlay's open state starts
`null`, so it renders as nothing on the server and through hydration, and only a
click can reach `createPortal`.

Assert the symptom rather than the styles. `gallery-lightbox.spec.ts` hit-tests
`document.elementFromPoint` at the top of the screen and requires the result to
be inside the dialog — which reported `NAV` on the home page before the fix and
passed on `/gallery` in the same run, reproducing the report exactly. A test of
one page would have been green.

Use `dvh`, not `vh`, for anything that must stay on screen on a phone: on
Android the address bar makes `vh` taller than the visible area, which pushes
the last element of a full-height panel off the bottom.


- **A barrel import charges you for everything the barrel touches.** Moving a
  fifteen-line `saveBlob` helper into `lib/documents/export.ts` and importing it
  from `@/lib/documents` put **jsPDF** — 400 kB — into the approvals screen,
  whose job is to show a photograph. First-load JavaScript went up 44.3% on a
  screen that gained no feature, and nothing else noticed: it typechecks, it
  runs, every test passes, and the only symptom is a slower page on the phones
  this platform is actually used on. `scripts/assert-bundle-budget.mjs` after
  `pnpm build` is the *only* check that sees it, which is why a build is not
  optional before calling a UI change done. A helper with no dependencies
  belongs in a module with no dependencies.
- **`img-src` and `connect-src` are the same asset and not the same permission,
  and a screen that has one of them looks completely correct.** The approvals and
  member-detail screens showed a member's NID scan and had a Download button
  beside it that did nothing at all. `img-src` named `res.cloudinary.com`;
  `connect-src` did not — and saving a file means `fetch`ing it into a Blob first,
  to name it something better than the URL's last segment. The fetch rejects, the
  handler logs to a console nobody has open on a phone, and the button is
  indistinguishable from a broken click handler. When a page can *display*
  something from a third-party host but not *save* it, check the second
  directive before reading any JavaScript.
- **A download after `await` works exactly once per page load, then silently
  stops.** Chrome permits one download without user activation and then requires
  the site's "Automatic downloads" permission — refused on Android with no prompt
  and no message. jsPDF's `save()` defers its anchor click by a
  `setTimeout(…, 0)`, which puts every download in a fresh task with no
  activation attached, so the first receipt saved and the second button did
  nothing until the page was reloaded. `pdf.output('blob')` plus a click in the
  same task fixes it; the gesture survives `await` on a resolved promise, so the
  rule is *don't defer*, not *don't await*. Reloading resetting the symptom is
  the tell: that is the per-page-load counter, not stale state.
- **A calendar widget is the wrong control for a birthday, and the platform gives
  you one by default.** `<input type="date">` is what every form reaches for and
  it opens on *this month*. A member born in 1985 is then asked to travel there;
  on the Android pickers this application's users actually have, that is between
  forty taps and a hunt for an unlabelled caret beside the month name that turns
  the header into a year list. The control is right for "when is your next
  appointment" and wrong for anything decades old, and the distinction is not
  about dates at all — it is about *distance from today*. Day/month/year selects
  are three taps and no travel, and the year list starts at the oldest plausible
  member rather than the youngest, because a village cooperative's next member is
  far more likely to be sixty than eighteen.

- **A CSS property that only applies to one input type, applied to another, is a
  no-op that looks like a mechanism.** `data-no-native-password-toggle` set
  `-webkit-text-security: disc` on an input that was already `type="password"`.
  That property masks *text* inputs; on a password input it does nothing at all.
  So the attribute existed, was applied at five call sites, was named after
  exactly the right problem — and every password field still showed two eyes on
  Edge, ours and the browser's. Nobody re-checked because the marker was there.
  The actual fix is one rule in the global stylesheet (`input::-ms-reveal`),
  which is also the right *scope*: the failure is per browser, not per screen, so
  a mechanism somebody has to remember to apply is one that gets missed on the
  next form.

- **A canvas re-encode to JPEG destroys transparency, and JPEG is the obvious
  default.** `downscaleImageFile` filled the canvas white before drawing —
  correct for a photograph of an NID, and the reason a transparent signature did
  not come back on a black background. Reused for brand images it would have
  baked a **white rectangle behind every logo**, visible the moment one sat on a
  coloured header. Alpha is a property of the *purpose*, not of the compressor:
  `IMAGE_PRESETS` marks which uploads keep it, and those encode WebP. Never name
  an output `format` in a Cloudinary transformation for the same reason.

- **`useState(prop)` is a one-time seed, and on a screen that fetches its data
  the prop arrives afterwards.** `ImageUpload` seeded its preview from
  `currentImage` and never looked again, so on Content & Media — which loads
  settings with SWR — every brand field mounted with `undefined` and kept the
  empty drop zone for the rest of the session. An admin with a logo already
  uploaded saw a screen telling them there was none, and uploaded it again. Sync
  in an effect, and guard the case the reader is mid-edit (here: a `blob:`
  preview must not be replaced by a server value landing behind them).

- **A generic UI primitive with English string literals is invisible to the
  translation census.** `ImageUpload` said "Drag and drop your image here", "or
  click to browse", "Choose Image" and "Uploading..." — so the Bengali dashboard
  rendered English chrome under Bengali headings and Bengali descriptions.
  Nothing could see it: `messages.test.ts` compares the two message files, and a
  string that was never in either has nothing to be compared against. Pass the
  copy in from the call site, which already knows the locale.

- **A `flex` section makes its container a flex item, and a flex item with no
  width shrinks to its contents.** The hero was
  `<section class="… flex items-center">` wrapping `<div class="container-wide">`
  — and `container-wide` is `mx-auto max-w-7xl px-…`, which sets a *maximum* and
  no width at all. So the hero's width was whatever its own text measured: the
  headline started ~200 px right of the logo above it and of every section
  below it, and it **moved when the language changed**, because Bengali is the
  wider script. It moved again whenever the copy or the figures were
  reworded. Nothing over the source could see it — the page does not scroll
  sideways, no text is clipped, and each language looks self-consistent until
  the two are put side by side, which is why it survived an audit that measured
  overflow at six widths in both languages. Add `w-full`, and measure the
  headline against a fixed part of the page in a browser
  (`e2e/matrix.spec.ts`). **The general form: centring a section vertically
  with flex silently changes the sizing rules of everything inside it.**

- **That the database knows a number does not mean the number may be
  published.** The home page's four statistics were invented literals — "125+
  members", "BDT 250,000+ deposits" — so they were moved into `system_config`,
  which left the hero blank until somebody typed something, which read to the
  owner as a broken screen. The obvious fix, and the one taken: **count them.**
  The platform holds the members, the ledger and the loan book, so the figures
  became `SELECT count(*)` and three sums — true by construction, never stale,
  no admin work, and every engineering argument on its side.
  It lasted a day. The owner's ruling was that the fund's real member count and
  real balances are **not for publication**: a cooperative may describe its
  scale without opening its books to anyone who loads a page, and a headline
  that moves with every deposit is not a headline. The figures are stated in
  settings and `lib/public-stats.ts` was deleted rather than switched off, with
  `test/unit/public-figures.test.ts` asserting its absence — because the next
  person to see four hand-maintained numbers beside a database that knows all
  four will reach for exactly this change, and will be right about everything
  except the part that decides it. **"Can we derive it?" is an engineering
  question. "May we publish it?" is the owner's, and it is asked first.**
- **`aria-hidden` on a decorative wrapper becomes a content wrapper the moment
  the decoration gains children.** The hero's geometric panel carried
  `aria-hidden="true"` on its root, correctly, while it was a drawing. Putting
  the foundation's figures inside it would have hidden every one of them from
  every screen reader — the numbers, their labels, and the heading — with no
  visual difference and nothing in any test to say so. The attribute belongs on
  the `<svg>`, not on the box.
- **A long number wraps between its own digits, and only at a real viewport
  width.** `BDT 4,796,100` in half of a 420 px panel rendered as "BDT 4,796,1 /
  00" on the phone hero — on the page asking to be trusted with money. The
  cause was a `break-words` added for a *different* concern (Bengali being the
  wider script), which turns a number into something breakable anywhere. A
  number is one word however long it is: widen the column instead. Two columns
  now exist only above the width where a seven-digit total fits on one line.

- **An application-level check that is stricter than the constraint it
  anticipates is invisible, and it always wins.** Staff creation looked a
  contact up with `OR: [{ email }, { phone }]` and no `liveIdentityFilter`, so a
  person whose membership application had been *refused* could not be hired as a
  field worker: the screen said "that email address is already in use" and named
  a row `users_email_live_key` does not consider to hold it — the database would
  have accepted the insert. Nothing failed, nothing logged, and the only way out
  was an admin with SQL. **A pre-check exists to turn a constraint violation
  into a sentence; when the two disagree, the pre-check is the bug**, because it
  runs first and the constraint never gets to speak. The rule had been written
  down in CLAUDE.md and in `product.md` for a day, and written down is not
  enforced — the census over every `prisma.user.find*` that filters on a contact
  detail is.

- **A page whose layout depends on an admin having filled a box in looks broken
  on launch day.** The hero's right-hand column was four statistic cards; when
  those figures moved out of the message files into `system_config` — correctly,
  they had been invented — an unconfigured foundation was left with a hero whose
  right half was empty. The fix is not to seed a number back: it is that the
  hero always has a visual of its own and the figures are a band below it that
  appears when there are figures. **Design the unconfigured state first**; it is
  the one every new deployment sees, and the only one the owner sees before they
  have anything to say.

- **A spec that drives a third-party service cannot run in CI, and failing is
  not the same as being honest about it.** `entry-path.spec.ts` filled the
  registration form and submitted it, which uploads four documents to
  Cloudinary. CI has no credentials on purpose — that account holds real
  members' NID scans — so `POST /registrations` rolled the application back
  every time and six tests failed for twenty minutes a run, on every push. The
  answer was to separate what each test is actually about: four of the six are
  about the *decision*, so they seed the applicant row and run everywhere; the
  two that are about what the applicant is *shown after submitting* skip, and
  say why. A test that needs a service the environment cannot provide should
  skip loudly, never fail quietly into the noise.

- **A CSS `auto` silently overrides the size you just computed.** `logo.tsx`
  derived a width from its `size` prop, passed it to `next/image` as the `width`
  attribute, and set `h-auto w-auto` in the className. A replaced element sized
  `auto`/`auto` renders at its **intrinsic** dimensions, so the attribute did
  nothing: `sm` and `md` both measured 192×108, inside a 64 px header. The prop
  had no effect at any call site, which is why nobody could have fixed one page
  without finding this. Nothing in the suite could see it either — the page does
  not scroll sideways, no text is clipped, and an oversized image is not an
  untranslated key. **When a size prop appears to do nothing, measure the
  rendered element before changing the number**; the matrix sweep now does, on
  every page with a logo.

  **And then the fix over-corrected.** Constraining the lockup to 40 px made it
  obey its header and made the wordmark unreadable — the tagline beneath
  হাসনাহেনা is two lines of small Bengali type, about eight pixels each at that
  size, on a platform whose members read it on a cheap Android in sunlight. A
  ceiling without a floor is half an invariant: the assertion is now
  `36 ≤ logo ≤ header`, and the header is sized to hold the lockup (`h-24`,
  shrinking to `h-16` on scroll) rather than the lockup shrinking to fit a
  header nobody chose.

- **A loading skeleton is a lie when nothing is loading.** The home page's
  partner-logo block rendered three grey `animate-pulse` rectangles as its
  *else* branch — the state for "no partner logos are configured". They had been
  shimmering on the live site under the heading "Trusted by community" since the
  page was written, and they read as a page that never finishes loading.
  **`animate-pulse` belongs to a pending request, never to an empty
  collection.** An empty collection renders nothing, or says it is empty.

- **A number in the copy is a claim, and copy has no owner.** "125+ Total
  Members", "BDT 250,000+ Total Deposits" were literals in
  `messages/{en,bn}.json`, invented when the page was designed, live for months,
  and unchangeable by the foundation whose figures they were. Nothing was wrong
  with them technically: both languages had them, the parity census passed, and
  they were correctly translated into Bengali numerals. **A figure a page states
  about the organisation belongs in `system_config`, not in a message file** —
  a message file is for words the software says, and this is a fact the
  foundation asserts.

- **A dead control on a public page advertises a feature that does not exist.**
  The gallery's Like button toggled a heart, incremented a count in the DOM, and
  persisted nothing — no endpoint in either backend accepts a like. For a
  signed-out visitor it went further and raised a red "Login Required" toast,
  telling them that liking is a members' feature. It was removed rather than
  implemented. The rule `UNIMPLEMENTED_CONFIG_KEYS` states for settings is the
  same rule: **a control that does nothing is worse than no control, because it
  will eventually be trusted.**

- **A page can be in the sitemap and reachable by nobody.** The menu pointed at
  `/#about`, `/#donate` and `/#contact` while `/about`, `/donate` and `/contact`
  existed as real pages with different content. The link crawl found 24 links to
  `/#about` and exactly one to `/about` — the language switcher on the page
  itself. `/#features` was worse: no element on the home page has ever had that
  id, so the menu item scrolled nowhere on every page it appeared on.
  **Crawl the rendered links, not the route list.** A route that exists, builds,
  prerenders and appears in `sitemap.xml` can still be unreachable, and no test
  over the source can tell.

- **A segment's `not-found.tsx` does not catch an unmatched URL.** It only
  catches `notFound()` thrown from *inside* that segment, and a URL that matches
  no route never reaches the segment at all — so `app/[locale]/not-found.tsx`
  renders for nothing. Verified on all three shapes this site can produce:
  `/nonexistent`, `/bn/nonexistent` and `/fr` (an unknown locale, where the
  layout itself calls `notFound()`) all land on `app/not-found.tsx`. The
  consequence is that the 404 renders **outside** `app/[locale]/layout.tsx`,
  which is where next-intl's provider and the font variables live: there is no
  `useTranslations`, and no locale to translate into either. Say it in both
  languages and import `globals.css` directly.

- **Prose in a component is invisible to every guard, and legal pages are all
  prose.** `/privacy` and `/terms` each carried a `content = { en: …, bn: … }`
  object, which is the inline-string problem wearing a different shape: the
  parity census, the placeholder check and the fee-promise search all read
  `messages/{en,bn}.json` and none of them read that object. It is the same
  reason the Terms once promised administrative fees in both languages with
  every check green. Both pages are shells around `legal.*` now.

- **A revision date is a claim about the document, and it goes stale in
  silence.** Both legal pages printed `Last updated: March 2026` as a literal,
  through two rewrites of the loan clause — one deleting the promise of
  administrative fees, one denying a late fee. A member who had read the March
  version had no way to learn what they agreed to had changed. The dates are
  constants in `lib/legal.ts` now, next to nothing else, so changing the wording
  and changing the date are one edit in one place.

- **A workaround can be the thing that makes the defect unfixable.** Rejecting a
  registration overwrote the applicant's email and phone
  (`rejected+<id>@hasnahena.local`) so the unique constraint would let them
  apply again. It worked, and it was the reason nothing could tell the applicant
  they had been rejected: the address was destroyed by the statement that
  recorded the decision. Six months of "why does nobody hear back?" had its
  cause in a line written to solve an unrelated constraint problem. **Before
  adding a notification to a flow, check whether an earlier step has already
  thrown away what the notification needs.** The fix was not to send the email
  sooner — it was to scope uniqueness to live rows so nothing had to be
  destroyed at all.

- **Removing a workaround silently breaks whatever was reading its
  side-effects.** That same tombstone was how `retention_repository.go`
  identified a rejected application: `phone LIKE 'rejected-%'`. Deleting the
  scramble would have left the daily sweep matching **nothing, ever again** —
  running on schedule, logging success, reporting zero cleared, and retaining
  every rejected applicant's NID and addresses indefinitely. Zero cleared is
  also what a correct sweep reports on a quiet week, so nothing would have
  looked wrong. Grep for the *value* a workaround writes, not just for the code
  that writes it, and give the concept one definition all its readers share.

- **A form's "default" is a writer, not a fallback, when the form posts every
  field.** The admin Settings screen held its own `DEFAULT_ORG_SETTINGS` for any
  `org.*` row the database lacked, and submitted the whole object on save. It
  disagreed with `scripts/seed.mjs` about the foundation's own name — `Hasnahena`
  against `Hasnahena Foundation` — so an admin who changed the phone number and
  pressed Save silently renamed the organisation everywhere the name is
  published: the JSON-LD, the letterhead of every generated document, the
  browser tab. It had already happened; the wrong name was recorded on the task
  board as a settings row somebody had mistyped, and correcting the row by hand
  would have held exactly until the next save. **Ask of any default: is it shown,
  or is it sent?** If it is sent, it is a second copy of the seed and needs a
  test that reads both files — `org-defaults.test.ts` is that test. The tell that
  this had been happening for a while: `getOrgNameEn()` in
  `lib/documents/theme.ts` carries a hand-written guard reading
  `name.toLowerCase() === 'hasnahena' ? BRAND_NAME_EN : name`. Somebody saw the
  short name arrive on a PDF and defended the PDF. **A downstream fallback
  written against one specific wrong value is evidence of an upstream writer**,
  not a fix for it — the JSON-LD and the browser tab had no such guard.

- **A timestamp is not a unique value, however precise it looks.** Staff account
  numbers were `STF-${Date.now().toString(36).toUpperCase()}`. Two admins adding
  two *different* workers within the same millisecond collided on `accountNo`,
  which is `@unique` — so the second create raised `P2002` on a column neither
  of them had sent, and the 409 told them to change an email and a phone that
  were both fine. Random bytes, or a sequence.

- **A one-line re-export is not proof that two screens are the same screen.**
  `dashboard/worker/approvals` was `export { default } from '../../admin/approvals/page'`
  and had never worked for a worker: the component it re-exported calls
  `/v1/dashboard/admin/approvals`, which was mounted inside the admin-only group,
  so every worker who opened it got a 403 and a blank page. Sharing a component
  across roles only works if the endpoints it calls are reachable by all of them —
  check the route table, not the import.
- **Two roles sharing one component still need the same rows underneath it.**
  Merging the worker and admin dashboards into single components fixed the code
  duplication and left the *data* duplicated: the two loan queries disagreed on
  which statuses to return, so the same table's own "N loans" differed by role.
  When a screen is shared, either the query is shared too, or the difference is
  labelled on the screen — the deposits list genuinely shows a worker only what
  they processed, and now says so, because two totals under one heading read as
  a bug rather than as two questions.
- **The same action offered from two screens is two implementations, and they
  will not stay equal.** Deposit, withdrawal, loan instalment and loan
  application each existed twice — once on the member's page, once on a list
  screen. The member's page refused paisa; the list screens ran
  `Math.round(Number.parseFloat(…))` and silently posted 1501 for 1500.75, which
  is the *same defect* that had already been found and fixed once, on the other
  copy. The member's page refused a withdrawal with no matured FR-08 notice
  because it had the notices loaded; the deposits screen had only the balance, so
  it let the worker submit and wait for a 409. (That particular rule is gone —
  [ADR-030](../decisions.md) — but it took one edit in one file to remove, which is
  the point.) Whichever entry point you happened
  to use decided which rules you got. Extract the action, not the form: one
  dialog that fetches the facts its rules are about, opened from anywhere.
- **A census that names files by hand tests the past.** The guard on that
  rounding listed three screens and asserted each contained `Math.round(` — the
  *old* rule — so it went on passing while two of the three rounded money. It
  walks the source for anything posting an `amount:` now and requires the
  whole-taka parser, which immediately turned up three more forms nobody had
  listed.
- **Two forms over one key/value table will fight.** Each posts the whole list it
  read, so the later save reverts the other's edits, and neither reports
  anything. When Settings split into Settings and Content & Media, the fix was to
  make the two key lists a partition and pin it with a test
  (`CONTENT_CONFIG_KEYS` / `SETTINGS_CONFIG_KEYS`); the same test catches the
  opposite failure, a declared key that *no* form offers, whose value is then
  whatever the seed wrote.

- **A `|| 'fallback'` on a value nobody can set is not a fallback.** The public
  `/donate` page read four `bank.*` keys that were absent from
  `SYSTEM_CONFIG_KEYS`, so `PUT /api/v1/settings` — which rejects the whole
  request on one unknown key — could never write them. The hardcoded
  `2050 0000 0000 0000` was therefore the only account number the page could ever
  display, to anyone deciding where to send a donation. `/contact` had the same
  shape with `contact@example.com`. The allow-list already guarded the write
  side; nothing guarded the read side, and a census of `settings['…']` reads
  against the allow-list closes it in one assertion (WO-67).
- **When a page needs a fact the organisation already has, do not add a second
  key for it.** `contact.email`/`phone`/`address` were a duplicate of
  `org.email`/`org.phone`/`org.address`, which are declared, seeded with the real
  details and printed on every generated document. The fix was deleting the
  duplicate, not declaring it — same shape as ADR-023.
- **A swallowed query error becomes a fabricated balance.** `GetMemberDashboardData`
  ended `if err != nil { stats = DashboardStats{} }` — so when its query broke,
  every member got a **200 response** reading "Current Balance: BDT 0" with no
  error, nothing to retry, and nothing to distinguish it from the truth. This is
  TEST-26's worst finding on the server side, and it stayed hidden for as long as
  the query happened to work. `pgx.ErrNoRows` is the one case that legitimately
  means zero; everything else must fail loudly.
- **Never initialise a money figure to zero.** The member dashboard's initial
  state was four zeros, so it displayed "Current Balance: BDT 0" until the fetch
  resolved — and its `catch` discarded the error and kept those zeros permanently
  on failure. "Your balance is 0" is the most alarming thing this application can
  say and is indistinguishable from the truth. Use a placeholder and a
  `loading | ready | error` status.
- **A config key nothing reads is worse than a missing one.** A setting an admin
  can edit that no code path consults reports a policy the system does not apply.
  When checking whether a feature exists, search the *enforcement* surface, not
  the settings page.
- **Measure a layout, do not look at it.** The statement's Reference column was
  0.44 mm too narrow, so every 15-character receipt number wrapped mid-digit on
  every printed statement. Nobody spotted it in a PDF viewer; a test computing
  rendered text width against column width found it immediately — and found a
  second overflowing column on its first run.

**`x-default` is not the default locale, even when the two hold the same value.**
It was written out as `'en'` when `defaultLocale` was `bn`, because they answer
different questions: *what this site is primarily in* versus *what to serve a
reader the site was not built for*. WO-94 made the site's default English, so the
two now agree — and the line is still written out, because collapsing it would
make a future change to one silently change the other, and the failure it
produces (every unmatched reader in the world sent to a page they cannot read) is
invisible from inside Bangladesh. A constant that happens to equal another
constant is not the same constant.

**JSON-LD cannot be a text child.** React HTML-escapes text children, and HTML
entities are **not** decoded inside a `<script>` element, so every `"` in the
payload reaches the crawler as `&quot;` and the JSON is unparseable. Next's own
guide specifies `dangerouslySetInnerHTML` with `<` escaped to `\u003c`. That is
the one sanctioned sink in this codebase and `csp.test.ts` counts them, because
[ADR-024](../decisions.md) rests on there being no others.

**One name for two things is a bug waiting for a rename to expose it.**
`memberId` meant the account number (`ACC-KH-33001`) in every response payload
*and* the member's cuid row id in every `/worker/members/{memberId}` route,
handler local and `PathValue` call. A blanket rename to `accountNo` compiled and
would have sent `PathValue("accountNo")` to a route still declaring
`{memberId}` — every member-detail request 400ing on an empty id, at runtime,
with the types perfectly happy. Classify each occurrence against the SQL it was
scanned from before renaming anything. The route parameter is `{memberUserId}`
now, which is what it always was.

---

[← all traps](../traps.md)
