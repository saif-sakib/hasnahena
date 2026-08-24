# Work Orders

An execution spec: exact files, exact changes, exact verification, so a session
can act without re-exploring the codebase.

**Prompt with the ID — `do WO-67` — or with a whole block — `do block S`.**

Line numbers are anchors, not guarantees: match on quoted code. The traps that
outlived earlier orders are in [traps.md](traps.md); WO-01 → WO-66 are closed and
compressed in [changelog.md](changelog.md).

---

## The plan, in the order to do it

Six blocks. **The order is not arbitrary** — each is ordered by what it costs to
do later, the same principle as [go-live.md](go-live.md).

| Block | What | Orders | Why here |
|---|---|---|---|
| ~~**R**~~ | ~~Live defects~~ | WO-67 | **Done 2026-08-19** |
| ~~**S**~~ | ~~Database — correctness, constraints, redundancy~~ | WO-68 → 72 | **Done 2026-08-19** |
| ~~**T**~~ | ~~Performance~~ | WO-73 → 75 | **Done 2026-08-19** |
| ~~**U**~~ | ~~Security~~ | WO-76 → 78 | **Done 2026-08-19** |
| ~~**V**~~ | ~~SEO~~ | WO-79 → 81 | **Done 2026-08-19** |
| ~~**W**~~ | ~~Future-proof~~ | WO-82 → 84 | **Done 2026-08-19** |
| **X** | **Account security — the live ones** | WO-85 → 89 | **Open.** Opened 2026-08-24. Every order here is a way an account survives its own remediation. Cheapest to fix now, most expensive to fix after a member is robbed |
| **Y** | **Identity and deletion integrity** | WO-90 → 93 | **Open.** One contact = one account, and a deleted thing is actually gone. Costs more the more rows exist, so it is before launch, not after |
| **Z** | **English first** | WO-94 → 97 | **Open.** Locale defaults and the URL shape. Last because nothing here can lose money — but WO-95 gets dearer with every link and every indexed URL |

Blocks R → W are closed. **X, Y and Z are open** and were opened 2026-08-24 from
an owner review. Everything else is in
[production-readiness.md](production-readiness.md) and
[go-live.md](go-live.md) — and one item in this file's last section that needs a
credential rather than a session.

### Doing these in order

**X before Y before Z.** Within a block the orders are independent unless an
order says otherwise, so `do WO-86` on its own is a valid instruction. Three
dependencies exist and are named where they bind: WO-91 needs WO-85's revocation
helper, WO-95 supersedes WO-94's URL shape, and WO-93 needs a decision from the
owner before a line is written.

### Standing rules for every order

- `pnpm typecheck` exits clean, zero errors.
- `pnpm lint` exits 0 with **2 warnings**. **Do not let the count grow.**
  (Was 6 until WO-75 converted the last four raw `<img>` tags. The two left are
  the React compiler skipping the registration form — `watch` from
  react-hook-form is not analysable — and one `window.location.href` in
  `header.tsx`.)
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

- **`x-default` is not `defaultLocale`.** This project's default locale is `bn`,
  because its members are Bengali. `x-default` answers the opposite question —
  what to serve someone the site was *not* built for — and the answer there is
  `/en`. Writing `defaultLocale` reads as the tidier version of the same line and
  sends every unmatched reader in the world to a page they cannot read.

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

# Block X — Account security

Opened 2026-08-24 from an owner review: *"I don't want anyone account to be
compromised by a hacker."*

**Read this table before touching anything in this block.** The authentication
here is in better shape than a quick reading suggests, and the fastest way to
create a vulnerability is to "fix" one of these:

| Already correct — leave it alone | Where |
|---|---|
| Reset tokens are 32 bytes from **`crypto/rand`**, hex-encoded, 30-minute expiry, and every older token for that account is deleted before a new one is issued | `auth_service.go:266-275` |
| Login has a **distributed, per-identifier** lockout that counts failures on both the unknown-user and wrong-password branches, returns the same error either way, and clears on success | `auth_service.go:61-95` |
| A logged-in password change **does** revoke every other session | `dashboard_handler.go:1244`, `:1487` |
| Both backends check the revocation marker on every request, and both fail closed on a lookup error | `auth_service.go:238`, `lib/auth-revocation.ts:85` |
| The registration availability endpoint is throttled to 20 per 10 minutes with the membership-disclosure reasoning written out | `registrations/route.ts:78` |
| Passwords are bcrypt at `DefaultCost`; the blacklist stores SHA-256, never the token | `security_service.go:29` |

What follows are the five places that reasoning did **not** reach. The theme is
not weak authentication — it is that the good mechanisms are **wired to some
paths and not others**, and the paths they miss are the ones a member reaches
*after* something has already gone wrong.

---

## WO-85 — A password *reset* leaves every session alive

**The defect, precisely.** Token revocation is built, wired and enforced on both
backends. It is called from **one of the two** password paths — and it is the
wrong one that is missing.

| Path | Reached by | Revokes other sessions? |
|---|---|---|
| Logged-in change — `handlers/dashboard_handler.go:1244`, `:1487` | someone who **still has** access | **Yes** — `InvalidateAllUserTokens(…, "password_change")` |
| Forgot-password reset — `services/auth_service.go:291` | someone who has **lost** access | **No. Nothing.** |

`ResetPassword` runs `UpdatePassword` → `MarkResetTokenUsed` → audit → `return
nil`, and never touches revocation. `handlers/auth_handler.go:154` adds nothing.

**Why this asymmetry is the wrong way round.** The logged-in change is performed
by a member who already controls the account — ending their other sessions is
good hygiene. The reset is the flow a member reaches *because they cannot get
in*: the locked-out case, and the **"someone else is using my account"** case.
It is the one path where evicting the other sessions is the entire purpose, and
it is the one path that does not do it.

So: a member's password is stolen. They cannot log in, so they use *Forgot
password* — the only route available to them — and set a new one. The attacker's
token keeps working, against both backends, for up to 24 hours. The member has
done everything right and has no way to know it did not work.

**The enforcement half is already correct — do not touch it.**

| Surface | Honours the `all:<userId>` marker at |
|---|---|
| Go | `services/auth_service.go:238` → `IsUserTokensRevoked` |
| Next | `apps/web/lib/auth-revocation.ts:85` → `checkRevocation` |

**Change.** In `services/auth_service.go` `ResetPassword`, after `UpdatePassword`
succeeds and before `MarkResetTokenUsed`, call
`s.InvalidateAllUserTokens(ctx, user.ID, "password_reset")`. One call site.

**Write it in the same transaction as the password.** `UpdatePassword`
(`auth_repository.go:320`) `Exec`s against the pool today. A password that
changed without its marker is exactly the defect being fixed; two independent
statements with a crash between them rebuilds it on a smaller scale. This
overlaps WO-87, which is rewriting that same statement — **do WO-87 first and
this becomes a two-line change.**

**The 24-hour trap — fix it here, it is latent in the path that already works.**
`BlacklistAllUserTokens` (`services/security_service.go:58`) hardcodes
`"expiresAt" = NOW() + INTERVAL '24 hours'`, while `JWT_EXPIRY_SECONDS` defaults
to `86400` — exactly 24h (`internal/config/config.go:94`). It is safe today
*only* because the marker is always created after the token it revokes, so it
outlives it by the gap between the two. Raise `JWT_EXPIRY_SECONDS` past 86400 —
a plausible operational change, with nothing warning against it — and **revoked
tokens come back to life** when the marker expires early, silently, on both
backends at once. Derive the interval from `cfg.JWTExpiry` plus a margin.

**Test — must be seen red first.**
- Integration: issue a token → complete a forgot-password reset → `ValidateToken`
  returns `ErrTokenRevoked`. Red today.
- Integration, as the control: the same for the logged-in change. **Green
  today** — it pins the behaviour that already works so this order cannot
  regress it. Say in the test that it is the control.
- Pure: the marker outlives the longest issuable token for any `JWTExpiry`.
  Cannot be made red without changing the config default — say so in the test.

**Verify.** `pnpm test:go && pnpm test:integration`

---

## WO-86 — Password-reset tokens are stored in plaintext

**The defect.** `password_reset_tokens.token` holds the raw secret from the
email, and `GetResetToken` (`auth_repository.go:295`) matches
`WHERE token = $1`.

Anything that can read one row of that table can take over the account it
belongs to: a database backup, the Neon console, a support screenshot, a log
line, an SQL-injection anywhere in either backend, or a restored snapshot
handed to a contractor. The table is not a set of pointers to credentials — for
its lifetime it *is* a set of working credentials.

**This codebase already knows the answer.** `token_blacklist.tokenHash` stores
`sha256(token)` for exactly this reason, and says so in the schema comment:
*"(not the full token)"*. Reset tokens simply never got the same treatment.

**Change.**
- Store `sha256(token)`; look up by the hash of the presented token. The
  plaintext exists only in the email.
- **The prefix conventions break under hashing** and must move to their own
  column first. `DeleteResetTokensByPrefix` (`auth_repository.go:263`) does
  `token LIKE $1`, and `ChangePassword` matches `token LIKE 'first-login-%'`.
  Two live conventions: `first-login-…` and `pwd-change:<userId>:…`. Add a
  `scope String` column carrying the prefix, hash only the secret, and rewrite
  both queries against `scope`.
- Migration: `pnpm db:migrate:dev`. Existing unexpired rows cannot be migrated —
  the plaintext cannot be recovered from a hash and must not be kept. Delete
  them in the migration; the affected members re-request a link. Say this in the
  migration comment.

**Test.** `internal/repositories/…_integration_test.go` — create a token, assert
no column of the row equals the token handed to the caller, and that presenting
the plaintext still validates. Seen red: today the first assertion fails.

**Verify.** `pnpm db:migrate:check && pnpm test:integration`

---

## WO-87 — `UpdatePassword` can set two accounts' passwords at once

**The defect.** `auth_repository.go:320`:

```sql
UPDATE users SET "passwordHash" = $1 WHERE email = $2 OR phone = $3
```

Three faults in one statement:

1. **It is not scoped to a user.** If the email on the token belongs to one row
   and the phone to another — reachable through the rejection tombstones
   (`admin_repository.go:717`), an admin phone edit, or any future contact
   change — this sets **both** accounts to the requester's new password. The
   caller asked to reset one account and silently reset a stranger's.
2. **It never checks how many rows it touched.** Zero rows affected returns
   `nil`. The API answers *"password reset"* and the member's password is
   unchanged; they are now locked out of an account they still own, with a used
   token and no error anywhere.
3. `ResetPassword` (`auth_service.go:306`) already resolved the row —
   `FindByIdentifier(email)`, falling back to phone. The id is in hand and
   thrown away.

**Change.** Pass `user.ID`; `WHERE id = $1`; require exactly one row affected
and return an error otherwise. While there: the `FindByIdentifier` fallback at
`auth_service.go:306-312` treats *any* error from the email lookup as "not
found" and retries with the phone, so a transient database error silently
resolves a different account. Distinguish not-found from failed.

**Test.** `internal/repositories/…_integration_test.go`, seen red: two users, one
holding the token's email and one holding its phone; reset; assert the second
user's `passwordHash` is byte-identical to what it was.

**Verify.** `pnpm test:integration`

---

## WO-88 — `forgot-password` is a membership oracle

**The defect.** `internal/handlers/auth_handler.go:112` answers a
password-reset request with the truth about who exists:

| Response | What it tells an unauthenticated caller |
|---|---|
| `404 AUTH_USER_NOT_FOUND` — *"No account found with this email or phone"* | this person is **not** a member |
| `400 AUTH_EMAIL_REQUIRED` — *"This account does not have an email address"* | this person **is** a member, and here is a fact about their record |
| `200` | this person **is** a member |

**Why it matters here specifically.** This repository has already reasoned about
exactly this risk and reached the opposite conclusion three files away.
`apps/web/app/api/v1/registrations/route.ts:78`:

> *"unthrottled it is a bulk membership-disclosure oracle, and for a
> religious-finance cooperative in one town, membership itself is the sensitive
> fact. A list of who banks here is worth more to the wrong person than any
> single balance."*

That endpoint is throttled to 20 checks per 10 minutes per address and the
reasoning is sound — **leave it exactly as it is.** `forgot-password` answers
the same question, more precisely, and carries no such throttle: only the global
per-IP mutating-request limiter applies.

**Change.** Always `200`, always the same body, whatever the identifier. Do the
lookup and the send after the response is decided, never branching the reply on
what was found. Add a throttle keyed on the *identifier* as well as the address,
via the existing `consumeRateLimit` / `rate_limits` table, so one address
cycling through numbers is stopped and one member retrying is not. Keep an audit
row for the attempts that found nothing — that is the signal an enumeration is
under way, and right now it is invisible.

The "no email on this account" case becomes a silent no-op. That is the correct
trade: a member without an email cannot be sent a link either way, and the
support route already exists for them.

**Test.** `cmd/server/…_integration_test.go`, seen red: a known and an unknown
identifier produce byte-identical status and body.

**Verify.** `pnpm test:integration`

---

## WO-89 — The login lockout never escalates and never tells anyone

**Read this first: login throttling is already implemented, and implemented
well.** `services/auth_service.go:61` checks a **distributed, per-identifier**
limit before the password is compared, records a failed attempt on both the
unknown-user and wrong-password branches (`:68`, `:76`), returns the *same*
`ErrRateLimited` either way so it leaks nothing, and clears the counter on
success (`:93`) with a comment explaining why that failure is logged rather than
returned. `identifierKey` is lowercased, so case variants share one bucket.
**Do not rewrite any of that.**

Two things are left.

**(a) The lockout is flat.** `services/security_service.go:116`:

```go
RateLimitMaxAttempts = 5
RateLimitLockout     = 30 * time.Second
```

Five guesses, wait 30 seconds, five more — for ever, with no escalation, no
alert and no audit row. That is **10 guesses a minute against one named account,
indefinitely**: ~14,000 a day. Against a strong password, irrelevant. Against a
first-login temporary password that was never changed, or a member who chose
their phone number, it is not.

Escalate the lockout instead — 30s, then 2m, 10m, 1h — off the attempt count
already stored in `rate_limits`. The first lockout stays as cheap as it is now
for the member who mistyped, and a sustained attack prices itself out within a
few minutes. Write an audit row when the lockout escalates past the first step:
today a sustained attack on one member is invisible to everyone.

Note the tension both ways: the counter is keyed on the identifier alone, so an
attacker can hold a known member out of their savings for as long as they keep
guessing. At 30 seconds that is a nuisance; at 1 hour it is a weapon. **Escalate
on the identifier+address pair, and keep the flat 30s for the identifier alone**
— then a member logging in from their own phone is unaffected by an attack from
somewhere else.

**(b) An inactive account identifies itself.** `auth_service.go:83` returns
`ErrUserInactive` where a wrong password returns `ErrInvalidCredentials`. That
distinguishes *"this identifier is a real account, currently suspended"* from
*"wrong credentials"* — the same membership oracle as WO-88, on a different
endpoint. A suspended member does need to be told why they cannot get in; tell
them **after** the password is verified, not before. The check already sits after
`bcrypt.CompareHashAndPassword`, so this is only about not answering it to a
caller who failed that comparison — confirm the ordering holds and add a test
that pins it.

**Test.** Integration, seen red: attempts 6→10 against one identifier are locked
for longer than attempts 1→5; an audit row exists after escalation; a wrong
password for a suspended account is indistinguishable from a wrong password for
an active one.

**Verify.** `pnpm test:integration`

---

# Block Y — Identity and deletion integrity

Owner review, 2026-08-24: *"All the email and phone number should be distinct
through all the members, admin, workers, pending. Also all the deletion is
perfectly deleting. All the message is clear that already exists."*

**Read this before starting — most of it is already right.** Members, workers,
admins and pending applicants are all rows in `users`, so `@unique` on `email`
and `phone` already spans every role and every status; there is no separate
pending table to diverge. `bdPhoneRegex = /^01\d{9}$/` is enforced on both
creation paths, so phone numbers are already in one canonical form and cannot
duplicate as `+880…` versus `01…`. Registration rejection tombstones the contact
fields (`admin_repository.go:710`) so a rejected applicant can re-register —
that is deliberate and good. The worker DELETE handler
(`apps/web/app/api/v1/admin/workers/route.ts:413`) counts historical references,
archives instead of deleting when any exist, and otherwise clears reset tokens
and notifications before cascading — that is careful work; **do not rewrite it.**

Four gaps remain.

---

## WO-90 — Email uniqueness is case-sensitive, and one collision path returns 500

**Two defects, same area.**

**(a) The database index is case-sensitive.** `email String? @unique` is a plain
Postgres unique index, so `Saif@x.com` and `saif@x.com` are two rows. Both
application paths lowercase before writing —
`registrations/route.ts:216` and `workers/route.ts:124` — so today nothing
creates a collision. That is a convention holding a constraint's job: a seed
script, a migration, a support fix applied by hand, or the next creation path
someone adds re-opens it, and the duplicate is permanent and invisible.
`accountNo` is unaffected (generated). Fix it where it belongs — a unique index
on `lower(email)`.

**(b) A concurrent duplicate is reported as a server fault.**
`workers/route.ts:129` reads, then writes:

```ts
const existing = await prisma.user.findFirst({ OR: [{ email }, { phone }] });
if (existing) return 409 'User with this email/phone already exists';
…
await prisma.user.create({ … })      // ← P2002 here falls to the catch
```

Two admins adding the same worker at once: both reads miss, the second create
raises `P2002`, and the handler's catch answers **500 "Failed to create staff
account"**. `routeErrorStatus` already maps `P2002 → 409`
(`lib/route-errors.ts:84`) and the registrations route already uses it
(`registrations/route.ts:492`) — the workers route just never wired it up. This
is CLAUDE.md rule 2b in the Next half: an expected refusal is not a 500.

**Change.** A functional unique index on `lower(email)` via
`pnpm db:migrate:dev` (Prisma cannot express it — raw SQL in the migration, and
say so in the migration comment so a later `--from-empty` baseline does not drop
it, exactly like the CHECK constraints and the `audit_logs` trigger). Route
`P2002` through `routeErrorStatus` in the workers POST and PUT, and name the
field that collided rather than saying "email/phone" — the caller cannot fix
what they are not told.

**Test.** `apps/web/test/routes/` — a create colliding on case answers 409 and
names the field. Seen red: today it is 500, or succeeds.

**Verify.** `pnpm db:migrate:check && pnpm test:routes`

---

## WO-91 — Deleting or deactivating a worker leaves their sessions alive

**Depends on WO-85.**

**The defect.** `workers/route.ts` DELETE cleans up thoroughly and then stops
one step short: it writes no revocation marker. The same is true of PATCH →
`INACTIVE` (`workers/route.ts:373`). A worker who is dismissed keeps a working
staff token — able to post deposits and process withdrawals — until it expires.

The archive branch is the worse of the two, because it is the branch that runs
for any worker who has ever processed a transaction: that is every real worker,
and it only sets `status = INACTIVE`.

**Change.** In both paths, inside the existing `prisma.$transaction`, insert the
`all:<userId>` row — the same shape `BlacklistAllUserTokens` writes, which
`lib/auth-revocation.ts` and the Go `ValidateToken` both already honour. Reason
`"admin_revoke"`. The Next side writes it with Prisma directly; keep the row
identical to the Go one, and say in a comment that the two must not drift, for
the reason `auth-revocation.ts:17` already gives.

Then check what the token still buys: confirm a request carrying a valid token
for an `INACTIVE` user is refused on **both** backends. If status is only read
at login, a deactivated worker keeps their access for the life of the token by a
second, independent route.

**Test.** `apps/web/test/routes/`, seen red: delete a worker, assert a marker
exists; deactivate a worker, assert the same.

**Verify.** `pnpm test:routes && pnpm test:integration`

---

## WO-92 — `Notification.targetUserId` is not a foreign key

**The defect.** `schema.prisma:522` — every other user-owned table declares
`onDelete: Cascade`. Notifications carry a bare `String?` with no relation.

They are cleaned up by hand in exactly one place, the worker DELETE. Any other
deletion path leaves them, and CLAUDE.md's contract table is explicit that an
unindexed or undeclared FK is a defect this repo pins with a test.

The failure is not just orphaned rows. `targetUserId` is a `cuid()`, so a
delivered-to-nobody notification is merely waste — but a notification is *read
by target id*, so any code that re-uses or mis-assigns an id delivers one
member's balance and loan detail to another member's bell icon.

**Change.** Declare the relation with `onDelete: Cascade` and a leading index on
`targetUserId` (the existing `@@index([targetUserId, isRead])` already leads
with it — confirm it satisfies `foreign-key-indexes.test.ts` and add nothing
redundant). Migration via `pnpm db:migrate:dev`. Then delete the by-hand
`notification.deleteMany` from the worker DELETE — the cascade owns it, and two
mechanisms for one rule is how they drift.

**Test.** `apps/web/test/unit/foreign-key-indexes.test.ts` covers the index. Add
an integration assertion that deleting a user removes their notifications.

**Verify.** `pnpm db:migrate:check && pnpm test:unit && pnpm test:integration`

---

## WO-93 — There is no member deletion, and tombstones are permanent

**Needs a decision from the owner before any code is written. Do not start this
one on your own judgement.**

**The situation.** Workers can be deleted. Members cannot — there is no endpoint,
no screen and no repository method. A rejected applicant's row is kept forever
with their address, both parents' names, their NID number and their photo URL,
under a tombstoned email and phone (`admin_repository.go:710`).

Keeping the row is defensible: a rejection is a decision the foundation may need
to justify, and the tombstone is what lets the applicant re-apply. Keeping the
**NID number and the photo** of someone who was refused membership, forever, is
a different question, and it is the owner's to answer, not a session's.

**The questions, in the order they need answering:**

1. May an *approved* member ever be removed, and what happens to their postings?
   A member with a confirmed transaction history cannot simply vanish — the
   ledger stops summing (rule 6c, `reconcile_repository.go`). The worker
   handler's archive-if-referenced pattern is the precedent.
2. How long is a rejected application kept, and what is stripped when it expires?
   Rejection already tombstones the contact fields; NID, addresses, parents'
   names and `avatarUrl` are untouched.
3. Does a member have a right to ask for their data to be removed, and who
   approves it?

**Once answered**, the implementation follows the worker handler exactly:
reference count → archive or delete → clear reset tokens and notifications →
cascade → audit row. Cloudinary assets need explicit deletion; the cascade does
not reach them.

**Verify.** Whatever is decided goes in `docs/product.md` and an ADR *before* the
code, because this one is policy first.

---

# Block Z — English first

Owner review, 2026-08-24: *"You can keep the en as default. Anyone can use bn if
he wants. Also the primary language should be en… do which one is the best
practice."*

**What is already correct — leave it alone.** `x-default` already points at
English and `lib/seo.ts:194` already argues why. Generated documents are already
English-only (ADR-012). Both locales are in the sitemap with full `hreflang`.
The `Vary: Accept-Language` fix shipped 2026-08-24 and is live.

What is wrong is that `defaultLocale` is `'bn'`, which is what sends the site's
single most valuable URL — the root — to Bengali.

---

## WO-94 — Make English the default locale

**Cheap, self-contained, and most of the benefit of this block. Do this first.**

**Change.** `apps/web/i18n.ts:4` — `defaultLocale = 'bn'` → `'en'`. That one line
moves: what `/` negotiates to for anyone not asking for Bengali, the
`NEXT_LOCALE` cookie's default, `proxy.ts`'s fallback when a path has no locale
segment (`proxy.ts:79`, `:90`), and next-intl's server fallback.

Then sweep the places that hardcode the same decision rather than reading it:

```
apps/web/lib/seo.ts:133          siteTitle — confirm the en branch is the fallback
apps/web/lib/structured-data.ts:158
apps/web/lib/faq.ts:41
apps/api/internal/handlers/auth_handler.go:127   req.Locale = "en"   ← already correct
apps/api/internal/services/email_service.go:136  normalizes to "bn"  ← check the fallback arm
```

**Do not change** `lib/utils.ts:10,19` — those select a *number and date format*
from an explicit locale, not a default.

**Test.** `apps/web/e2e/locale-negotiation.spec.ts` exists and already asserts
the negotiation both ways; update it so a request with no `Accept-Language`
lands on `/en`, and keep the `bn` case. It must be seen red.

**Verify.** `pnpm test:unit && pnpm build && pnpm test:e2e`

---

## WO-95 — Serve English at `/` with no redirect

**This is the actual fix for the Search Console report, and it supersedes
WO-94's URL shape. Bigger — read the cost before starting.**

**The problem it solves.** `/` 307s to a locale, so Google merges `/` with
whichever locale it lands on and keeps the shorter URL. That is the
*"Duplicate, Google chose different canonical than user"* on `/bn`, and
Google-selected canonical `https://hasnahenafoundation.com/`. Flipping the
default (WO-94) moves that report from `/bn` to `/en`; it does not end it.
**A redirect at the root is the cause.** Google's own guidance discourages
automatic language redirects for exactly this reason.

**The end state.** next-intl `localePrefix: 'as-needed'`:

| URL | Serves |
|---|---|
| `/` | English home — a real page, self-canonical, no redirect |
| `/about`, `/faq`, … | English |
| `/bn`, `/bn/about`, … | Bengali, self-canonical |

`hreflang`: `en → /`, `bn → /bn`, `x-default → /`. No negotiation at the root, so
`Vary: Accept-Language` is no longer needed there — but **leave `varyOnLanguage`
in place** for any response that still negotiates, and read the "Locale routing"
section of [traps.md](traps.md) first: middleware headers must be asserted over
HTTP, never in a unit test.

**The cost, honestly.** Every `/en/*` URL currently indexed and linked must
**301** to its unprefixed form — permanent, not 307, and it must survive. Touched:
`i18n.ts`, `proxy.ts` (including the dashboard cookie gate, which splits on the
first path segment), `lib/seo.ts` `getLocalizedPath` / `getLocalizedUrl`,
`app/sitemap.ts:34`, every `Link` built from a locale, and
`scripts/assert-static-routes.mjs`, which classifies routes by path shape.

**Decide before starting:** whether the dashboard also loses its prefix. It has
no SEO value and `proxy.ts` pins the URL segment to the role. Keeping
`/en/dashboard/...` prefixed while marketing pages are unprefixed is defensible
and much smaller; say which was chosen in the ADR.

**Test.** `e2e/locale-negotiation.spec.ts` and a new spec asserting `/en/faq`
→ 301 → `/faq`, and that `/` returns 200 with `lang="en"` rather than a redirect.
Seen red.

**Verify.** `pnpm build && pnpm test:e2e && node apps/web/scripts/assert-static-routes.mjs`

**Then:** write the ADR, resubmit the sitemap, and expect Search Console to take
one to three weeks. Do not re-inspect daily.

---

## WO-96 — The auth pages hardcode both languages, against rule 5

**Found while auditing locale defaults; it is a rule violation, not a
preference.**

CLAUDE.md rule 5: *"UI copy lives in `apps/web/messages/{en,bn}.json` — both
files, never hardcoded in a component."* Counted 2026-08-24, occurrences of
`locale === 'bn'` under `app/[locale]/(auth)/`:

| Page | Ternaries |
|---|---|
| `login/page.tsx` | **28** |
| `forgot-password/page.tsx` | **19** |
| `register/page.tsx` | 1 |
| `reset-password/page.tsx` | 0 — already correct, use it as the model |

Every label, every toast, every button on the two worst pages. `reset-password`
shows the shape they should have.

This is why the block matters rather than being tidiness: none of that copy is
reachable by `messages.test.ts`, so the parity census, the placeholder check and
the **fee-promise census** all read straight past it. The Terms of Service fee
promise survived every guard for the same reason — a string in a page is
invisible to every check this repo has.

**Change.** Move the strings into both message files under an `auth.forgotPassword`
namespace and read them with `useTranslations`. Keep the keys parallel; the
parity suite will enforce the rest.

**Test.** `apps/web/test/unit/messages.test.ts` picks these up automatically once
the keys exist. Consider extending it with a census that fails on
`locale === 'bn' ?` inside `app/` — that is the check which would have caught
this, and the one that stops it recurring.

**Verify.** `pnpm test:unit`

---

## WO-97 — Point the remaining copy at the domain that is owned

**Small, do it with any of the above.**

`org.email` in the production database reads `info@hasnahena.org` — a domain the
foundation does not own (WO-80 established this and fixed the code fallbacks).
The seeded default and the admin Settings screen are already correct; the live
row is not, and it is what the public pages render.

This is an **owner action, not a session's** — it is a database value, changed in
Admin → Settings. Listed here so it is not lost: a member replying to a
foundation email currently sends it into someone else's domain.

