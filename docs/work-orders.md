# Work Orders

An execution spec: exact files, exact changes, exact verification, so a session
can act without re-exploring the codebase.

**Prompt with the ID — `do WO-67` — or with a whole block — `do block S`.**

Line numbers are anchors, not guarantees: match on quoted code. The traps that
outlived earlier orders are in [traps.md](traps.md); WO-01 → WO-66 are closed and
compressed in [changelog.md](changelog.md).

---

## The plan, in the order to do it

Nine blocks, all closed. **The order was not arbitrary** — each was ordered by
what it costs to do later, the same principle as [go-live.md](go-live.md).

| Block | What | Orders | Why here |
|---|---|---|---|
| ~~**R**~~ | ~~Live defects~~ | WO-67 | **Done 2026-08-19** |
| ~~**S**~~ | ~~Database — correctness, constraints, redundancy~~ | WO-68 → 72 | **Done 2026-08-19** |
| ~~**T**~~ | ~~Performance~~ | WO-73 → 75 | **Done 2026-08-19** |
| ~~**U**~~ | ~~Security~~ | WO-76 → 78 | **Done 2026-08-19** |
| ~~**V**~~ | ~~SEO~~ | WO-79 → 81 | **Done 2026-08-19** |
| ~~**W**~~ | ~~Future-proof~~ | WO-82 → 84 | **Done 2026-08-19** |
| ~~**X**~~ | ~~Account security — the live ones~~ | WO-85 → 89 | **Done 2026-08-24** |
| ~~**Y**~~ | ~~Identity and deletion integrity~~ | WO-90 → 93 | **Done 2026-08-25** |
| ~~**Z**~~ | ~~English first~~ | WO-94 → 97 | **Done 2026-08-25** |

**Every block is closed.** R → Z; X, Y and Z came out of the 2026-08-24 owner
review and are done. What remains is one owner action at the end of Block Z
(WO-97), which needs a database value rather than a session. Everything else is
in [production-readiness.md](production-readiness.md) and
[go-live.md](go-live.md).

### Doing these in order

There is nothing left to order. The three dependencies that existed are all
resolved: WO-91 used WO-85's revocation helper, WO-95 superseded WO-94's URL
shape, and WO-93's owner decision is [ADR-033](decisions.md).

### Standing rules for every order

- `pnpm typecheck` exits clean, zero errors.
- `pnpm lint` exits 0 with **1 warning**. **Do not let the count grow.**
  (Was 6 until WO-75 converted the last four raw `<img>` tags, then 2 until
  WO-95 replaced `header.tsx`'s `window.location.href` with `router.replace`.
  The one left is the React compiler skipping the registration form — `watch`
  from react-hook-form is not analysable.)
- A regression test must be seen to **fail against the pre-fix code** before it
  is allowed to pass. When a test *cannot* be made to fail, say so in the test.
- Money changes stay in the Go API, one transaction, with an `audit_logs` row.
- Update [tasks.md](tasks.md) and tick the order here in the same commit.

---

# Blocks R and S — closed 2026-08-19

WO-67 → WO-72 are done. What they contained is one row in
[changelog.md](changelog.md); what they *taught* is in [traps.md](traps.md). Two
things are worth repeating here, because both were found by the work rather than
specified by it:

- **The census found more than the order predicted.** WO-67 was written about
  four undeclared `bank.*` keys. The test that closed it walks every
  `settings['…']` read in `app/` and `components/`, and named **seven** — the
  other three were `contact.email`/`phone`/`address` on the public `/contact`
  page, which showed `contact@example.com` as the foundation's address. Those
  were not declared *or* added: `org.email`/`org.phone`/`org.address` already
  existed, seeded with the real details and printed on every generated document,
  so the fix was to delete the duplicate rather than legitimise it.
- **Two definitions of one table disagreed in exactly the predicted way.** WO-70
  asked for the bootstrap DDL and the migration to be compared before removing
  either. `document_sequences."updatedAt"` was `NOT NULL DEFAULT NOW()` in the
  bootstrap and `NOT NULL` with no default in the migration — the divergence that
  once broke all four money flows at once. And
  `idx_support_messages_thread_created_desc` was a covering index in one and a
  plain one in the other, so the covering variant had **never existed anywhere**:
  same name plus `IF NOT EXISTS` means the second creator is a silent no-op.

---

# Blocks T and U — closed 2026-08-19

WO-73 → WO-78 are done. What they contained is one row in
[changelog.md](changelog.md); what they *taught* is in [traps.md](traps.md).
Four things are worth repeating here, because all four were found by the work
rather than specified by it:

- **A nonce-based CSP and static rendering cannot both be had.** WO-76 asked for
  a nonce policy; WO-73 had just made ten routes static. Next injects a nonce
  while *rendering a request*, so a prerendered page has none and a nonce policy
  blocks its own hydration. `experimental.sri`, which the Next docs offer as the
  escape hatch, was tried and measured: it adds `integrity` to 8 of 14 external
  scripts and leaves all **6 inline RSC payload scripts** untouched — and those
  are exactly what a strict `script-src` blocks. The resolution is two policies
  chosen per route, argued in full in `apps/web/lib/csp.ts`.

- **Every census in these orders was low.** WO-73 said "the cause is one line" —
  it was eight files plus two `galleryItem` reads. WO-75 said "the one remaining
  raw `<img>`, in `dashboard/admin/gallery`" — there were **four**, in
  `dashboard/admin/approvals` and `dashboard/admin/members/[id]`, and none in
  gallery. Lint went 6 → 2, not 6 → 5. Count before quoting a number.

- **`unstable_cache` serialises, so a `Date` comes back a string.** Typed as
  `Date`, it compiled and then failed the build with
  `item.date.toISOString is not a function` — on a cache *hit*, never a miss, so
  the first render of anything always looked fine. Normalise at the boundary.

- **The pool size is not a correctness constraint, and now that is known rather
  than assumed.** WO-75 asked whether `DB_MAX_CONNS=25` is compatible with Neon.
  The whole integration suite — including the 20-way concurrent-deposit test —
  passes with `pool_max_conns=2`. It can only do that because no repository call
  holds two connections at once, which is the property [ADR-017](decisions.md)
  exists to preserve, so that run is the cheapest available check that it still
  holds.

---

# Blocks V and W — closed 2026-08-19

WO-79 → WO-84 are done. What they contained is one row in
[changelog.md](changelog.md); what they *taught* is in [traps.md](traps.md).
Five things are worth repeating here, because all five were found by the work
rather than specified by it:

- **WO-73 broke the Docker image build, and no test noticed for a day.**
  Prerendering moved the marketing pages' database reads from request time to
  *build* time, and `apps/web/Dockerfile` builds with `DATABASE_URL` pointing at
  a placeholder database that does not exist — deliberately, because
  `prisma generate` parses the URL and never connects. Six of the eight pages had
  no `try` of their own. The contract is now on the accessor
  ([ADR-028](decisions.md)), and the `catch` sits *outside* `unstable_cache`,
  because a cache stores resolved values and never rejections — catching inside
  would pin every public page to its fallback copy for the whole revalidate hour
  after one Neon blip.

- **A test can pass without ever reaching the thing it tests.** The first version
  of `public-content-fallback.test.ts` went green with `findMany` called **zero**
  times: called outside a Next server, `unstable_cache` throws
  `Invariant: incrementalCache missing`, and the very `catch` under test
  swallowed it. Assert that the mock was *used*, not only that the result was
  right.

- **`x-default` is not `defaultLocale`.** At the time the default was `bn` and
  `x-default` was `/en`, because they answer different questions — *what this
  site is primarily in* versus *what to serve someone the site was not built
  for*. WO-94 made them agree; the line is still written out, for the reason in
  [traps.md](traps.md).

- **The reconciliation job found two live defects before it ever ran in
  production.** `waterfallRecoveryTx` inserted its three recovery rows with **no
  status**, so they took the column default of `PENDING` while the savings had
  already been deducted in the same transaction — every status-filtered aggregate
  under-counted a recovery that had happened. And it never reduced
  `accounts."loanBalance"`, so a member whose savings were taken to settle a
  default still saw the whole debt on their dashboard, permanently, because
  nothing else recomputes that column. Neither failed any existing test. This is
  the argument for OPS-07 in one paragraph.

- **A dispute is not a reversal.** Disputing a `CONFIRMED` posting flips it to
  `DISPUTED` and moves no money, so a reconciliation that counted `CONFIRMED`
  alone would raise drift on every open dispute — an alarm that is always firing.
  [ADR-026](decisions.md) writes the refinement down beside ADR-016 rather than
  quietly widening it.

---

# Two things closed orders left behind

Both tracked in [production-readiness.md](production-readiness.md), neither a
code change anyone can make today:

- **DATA-06** — no backup of the Cloudinary assets. Buildable only against a real
  account with real credentials; [ADR-020](decisions.md) accepts the exposure
  until the first real member document exists and names that document as the
  trigger.
- **CI-09** — branch protection on `main`. Needs a paid plan on a private repo;
  `.githooks/pre-push` is the free stand-in and is active.
- **WO-84's rehearsal.** [runbook.md](runbook.md) is written and every command in
  it has been run, except one: the restore has never been performed against a
  Neon branch with a real archive. That needs the Neon account and the
  `BACKUP_PASSPHRASE` secret. A restore you have not performed is a rumour, so
  the runbook says "Last rehearsed: **Never**" until somebody does it and dates
  the line.

---

# Block X — closed 2026-08-24

WO-85 → WO-89 are done. What they contained is one row in
[changelog.md](changelog.md); the reasoning is [ADR-031](decisions.md) and
[ADR-032](decisions.md); what they *taught* is in [traps.md](traps.md). Seven
things are worth repeating here, because all seven were found by the work rather
than specified by it.

- **WO-86's migration instruction was wrong, and following it would have been a
  silent regression.** The order said existing rows "cannot be migrated — the
  plaintext cannot be recovered from a hash". Nothing has to be recovered: the
  plaintext is in the column, and hashing runs forward. What deleting every row
  *would* have done is destroy the `first-login` markers, whose existence is the
  entire implementation of `mustChangePassword` — so every member already
  approved and not yet signed in would have quietly stopped being asked to
  change the temporary password they were emailed. The migration splits them:
  `reset` and `pwd-change` rows are deleted (live credentials, minutes old, and
  the point is that plaintext does not survive), `first-login` rows are hashed in
  place.

- **A six-digit secret cannot be unique on its hash.** Moving the prefix to a
  `scope` column and hashing the rest looked like a mechanical change until two
  members were sent the same password-change code: `sha256("123456")` is one
  value, and the old unique index on the token had been satisfied only because
  the user id was *inside* the secret. The constraint is `(scope, tokenHash)`
  now, and the scope carries the user id.

- **The flat lockout was not the five-guesses-then-thirty-seconds WO-89
  described.** `CheckRateLimit` refused unconditionally once `attempts >= 5`,
  which had two consequences that both read as the code working: the
  `RetryAfterSecs: 30` it answered with was a number nothing enforced — the real
  wait was whatever the row had left of its TTL — and a lockout could never be
  *served*, so there was nothing for an escalation to escalate from. Removing
  that branch was the prerequisite, not the polish.

- **`ForgotPassword` was already deleting the first-login marker.** It cleared
  every reset-token row matching the address before issuing a link, so asking
  for a password reset and never clicking it switched off the forced password
  change. Invisible before the `scope` column existed, because there was nothing
  to scope the delete to. The retire-the-marker step now belongs to the reset
  itself, where it is true.

- **Atomicity moved code across a layer boundary.** WO-85 asks for the marker to
  be written in the same transaction as the password. `services` imports
  `repositories`, not the reverse, and repositories are the only layer that owns
  a transaction — so `BlacklistAllUserTokens` moved out of `SecurityService` and
  became `UserRepository.RevokeAllUserTokens`, with the read side
  (`IsUserTokensRevoked`) staying where it was. One definition of the INSERT, two
  entry points.

- **The membership oracle also ran on a clock.** WO-88 is about status codes, but
  an unknown identifier skipped `bcrypt.CompareHashAndPassword` entirely and
  answered in microseconds where a real member's wrong password took ~60 ms.
  Equalising the responses without equalising the timing would have moved the
  oracle rather than closed it.

- **Two suites had been sharing a phone number.** `withdrawal_status_
  integration_test.go` hardcoded `01955500001`, which is what
  `apps/web/test/routes` seeds `nextroute-member` with, so that whole file
  failed on `users_phone_key` if the route suite had run first and passed if it
  had not. `pnpm test:integration` on its own always passed, which is why nobody
  had seen it. Found by running the two in both orders, which is now the way to
  check any new fixture.
- **A test cannot clean up after itself in `audit_logs`.** The append-only
  trigger (DATA-08) refuses DELETE without an explicit session opt-in, so
  `t.Cleanup` deleting audit rows fails silently and the next run counts two.
  Every assertion about an audit row counts a **delta**. This is a nice property
  to have discovered from the enforcement rather than from a stale count.

---

# Block Y — closed 2026-08-25

WO-90 → WO-93 are done. What they contained is one row in
[changelog.md](changelog.md); the policy WO-93 needed is
[ADR-033](decisions.md) and [product.md](product.md); what they *taught* is in
[traps.md](traps.md). Six things are worth repeating, because all six were found
by the work rather than specified by it.

- **WO-90(b) was already fixed, and the order did not know.** It said the
  workers route "just never wired up" `routeErrorStatus`, so a concurrent
  duplicate answered 500. The catch has routed `P2002 → 409` since the TEST-16 /
  TEST-18 work; the concurrency test written to see that 500 was green before
  the fix. What was actually wrong is smaller and was not in the order: the 409
  said "User with this email/phone already exists" and `routeErrorMessage` said
  "That value is already in use", so an admin was told that one of two values
  was taken without being told which. Both name the field now.

- **`accountNo` was the collision the caller could not cause.** Staff numbers
  were `STF-${Date.now().toString(36)}`, so two admins adding *different* workers
  in the same millisecond collided on a unique column neither of them had sent,
  and the 409 told them to change an email and a phone that were both fine.
  Found by WO-90's concurrency test, which is about the other collision
  entirely.

- **The functional index also made login faster.** `FindByIdentifier` has
  matched on `lower(COALESCE(email,'')) = lower($1)` since the auth work, which
  no plain index on `email` can answer — every login by email was a sequential
  scan of `users`. `users_email_lower_key` exists for correctness and answers
  that predicate as a side effect.

- **WO-91's revocation needed a second copy of WO-85's derived TTL, in the other
  language.** The marker has to outlive the longest issuable token, and that
  length is `JWT_EXPIRY_SECONDS`, which only Render sets — so the Next half runs
  on the default far more often than the Go half does. `revocationTtlSeconds()`
  mirrors `revocationTTLFor`, and `test/unit/revocation-contract.test.ts` reads
  the Go source to keep the two from parting.

- **Neither backend re-reads a user's status per request, by design.** WO-91
  asks to "confirm a request carrying a valid token for an INACTIVE user is
  refused on both backends". It is not, and adding a status read would be a
  second user lookup on every call. The revocation marker *is* the mechanism,
  which is what makes writing it in the same transaction as the deactivation the
  whole of the fix rather than a belt-and-braces addition.

- **WO-93's `oldValue` had to be left out, which is the one place "follow the
  worker handler exactly" is wrong.** `WORKER_UPDATED` records the row it
  changed. An erasure that did the same would copy the NID number, the parents'
  names and the address into `audit_logs`, which nothing can delete from
  (DATA-08) — erasure that preserves what it erased. The row names the account
  number, the counts and the admin's reason, and a test asserts the rest is
  absent.

---

# Block Z — closed 2026-08-25

WO-94 → WO-96 are done; **WO-97 is an owner action and is restated at the end of
this file rather than closed here.** The reasoning is
[ADR-034](decisions.md); what the block *taught* is in [traps.md](traps.md).
Eight things are worth repeating, because all eight were found by the work
rather than specified by it.

- **Flipping `defaultLocale` would not have fixed the Search Console report, and
  the order said so.** WO-94 is cheap and WO-95 is the actual fix; doing WO-94
  alone would have moved *"Duplicate, Google chose different canonical than
  user"* from `/bn` to `/en`. The cause is a **redirect at the root**, not which
  locale it redirects to.

- **`Vary: Accept-Language` had to be deleted, not kept.** It was the right fix
  for a negotiating root and it is dead weight for a root that does not
  negotiate — a `Vary` that is not true costs a CDN cache entry per distinct
  header value on the busiest pages the site has. The e2e spec that used to
  assert its *presence* now asserts its absence, and the comment explaining the
  reversal is longer than the assertion.

- **next-intl's own `as-needed` redirect is a 307.** Correct for a browser,
  useless as a canonical signal, and the whole point of the block. `proxy.ts`
  answers **301** before next-intl runs. Verified over HTTP, because that is the
  only place a middleware header can be trusted (traps.md, "Locale routing").

- **Twenty-two files built locale URLs with a template literal, and under the
  old scheme that was harmless.** Under `as-needed` every one produces `/en/...`,
  which then 301s — so a member tapping a header link pays a redirect and a
  crawler following one is told the href it was given is not the real URL. They
  all go through `localePath()` now, and a census fails on the next one.

- **WO-96 undercounted by 26, and named the wrong file as the model.** It
  recorded `reset-password/page.tsx` as already correct — it is, because the copy
  is in `reset-password-form.tsx` beside it, where there were 26 more ternaries.
  73 strings on three files, none of them reachable by the parity census, the
  placeholder check or the **fee-promise search**. The repo-wide figure is
  **827 across 33 files**; the new census is scoped to `(auth)/` deliberately,
  because a census that failed on all 827 would be switched off within the day.
  The rest is a tracked item in [tasks.md](tasks.md).

- **The 301 came back as a 307 on exactly the routes that matter most.**
  `withCsp` re-issues a response through `NextResponse.redirect(location)` to
  attach the nonce, and that helper defaults to 307 — so `/en/login` and
  `/en/register`, the two URLs most likely to be in a bookmark or an old email,
  were downgraded while `/en/faq` was fine. The first spec covered marketing
  paths only and passed. A redirect renders nothing, so it now skips the nonce
  branch entirely, which fixes the status and removes a pointless nonce at once.

- **Three links in the emails still carried `/en/`.**
  `email_service.go` built `fmt.Sprintf("%s/%s/login", appURL, locale)` for the
  approval email, the staff welcome email and the password reset. They still
  work — a 301 is followed — but an email is the last place a redirect belongs:
  these outlive the deploy that wrote them, they get forwarded, and some clients
  and corporate link scanners resolve a redirect before a person ever clicks.
  The Go side now has its own `localeURL`, duplicated deliberately because the
  two runtimes cannot share a module, and a census over the source keeps the
  copies equal.

- **Moving copy into the message files moved it *out* of the fee-promise
  census.** That check walked `app/` alone, which was complete only while almost
  all the copy lived there. WO-96 moved 73 strings out of its reach and the
  remaining 827 will follow, so it reads `messages/{en,bn}.json` too now —
  verified by planting the Terms of Service's old sentence in `en.json` and
  watching it fail. A guard whose coverage shrinks as the codebase improves is
  the worst kind.

---

## WO-97 — Point the remaining copy at the domain that is owned

**Still open. It is an owner action, not a session's.**

`org.email` in the production database reads `info@hasnahena.org` — a domain the
foundation does not own (WO-80 established this and fixed the code fallbacks).
The seeded default and the admin Settings screen are already correct; the live
row is not, and it is what the public pages render.

Change it in **Admin → Settings → Organisation**. Until it is changed, a member
replying to a foundation email sends it into someone else's domain.

While that screen is open, two more rows need attention.

`org.nameEn` reads "Hasnahena" rather than "Hasnahena Foundation", and the
JSON-LD publishes whatever it holds — see the Search-discoverability row in
[production-readiness.md](production-readiness.md).

**`org.addressEn` is new and empty on the live database.** The address box used
to be single, and the live value is Bengali, which is why the English site
showed a Bengali address under an English "Address" heading. The English box now
exists beside it; until it is filled in, `orgAddress()` falls back to the
Bengali row and the English pages keep showing it — deliberately, since a real
address in the wrong script can still be posted to. It also prints on the
letterhead of every generated document, which [ADR-012](decisions.md) makes
English only.
