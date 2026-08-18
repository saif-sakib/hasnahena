# Testing Plan

A staged plan to get this codebase from "the parts we looked at work" to
"the parts nobody has looked at also work". Written **2026-08-17** against
measured coverage, not impressions.

Read the phases in order. Each is a batch with an ID (`TEST-01`), a definition
of done, and the bugs it is expected to surface. Prompt with **`do TEST-10`**.

> **All eight phases are done (2026-08-17).** Eighteen defects found and
> fixed, three of which moved or misreported money: `AddMemberLoanPayment` accepted
> concurrent overpayments and drove an account's loan balance to −5000
> ([Phase 2](#what-phase-2-found)), and `MarkLoanDefaulted` re-ran the whole
> recovery waterfall on a second click, taking a borrower's savings twice for one
> debt. Two more were inert until first use: the `HN-ACC-DONATION` account was
> never created by anything, so **recording a donation would have failed the
> first time anyone tried**; and the statement PDF printed every receipt number
> wrapped mid-digit, so the reference a member quotes at a counter was wrong on
> **every statement** ([Phase 5](#what-phase-5-found)).
>
> Phase 6 added the third money-related one: the member dashboard rendered a
> **fabricated `BDT 0`** while loading and kept it forever if the fetch failed,
> so a member could be shown a zero balance that was not theirs.
>
> Counts: web unit **336**, Next route contracts **266**, Go integration ~800
> assertions, 400,000 property iterations over the loan arithmetic, and **143
> browser specs** across six files. This file is now the standing guide rather
> than a plan — see [Working in the suites](#working-in-the-suites).

---

## 1. Where the project actually stands

Measured, not estimated — `go test ./... -cover` and a file census.

| Layer | Surface | Tests today | Coverage |
|---|---|---|---|
| Go `internal/money` | loan/installment/waterfall arithmetic | 1 file | **93.3%** |
| Go `internal/utils` | ids, document numbers | 2 files | 64.7% |
| Go `internal/middleware` | rate limit, logging | 2 files | 52.6% |
| Go `internal/repositories` | **66 exported methods** | 26 integration tests | needs a database |
| Go `internal/services` | security service | 1 file | **0.3%** |
| Go `internal/handlers` | **61 methods** | 29 assertions on the auth gate (Phase 1) | the other 60 methods untested |
| Go `cmd/server` | **65 routes** | **none** | **0%** |
| Go `internal/config` | env parsing, the boot contract | **none** | **0%** |
| Go `internal/observability`, `models` | | **none** | **0%** |
| Next route handlers | **21 methods across 11 files** | **none** | **0%** |
| Next `lib/` | 33 modules | **9 tested** (Phase 1 added jwt, auth, auth-revocation, cors, rate-limit) | 24 untested |
| Components | 26 | **none** | — |
| Pages | 39 | 11 Playwright specs, now in CI | — |

**The shape of the gap: the arithmetic is well tested and the boundaries are
not.** Everything that decides *who may do what*, *what a request is allowed to
contain*, and *what status code comes back* has no test at all.

That is also where the two most recent production defects lived — a settings
endpoint that rejected every save, and a document-number allocator that made
loan applications impossible. Neither was arithmetic. Both were boundaries.

---

## 2. Evidence that the gap is real

Twenty minutes of probing the untested security primitives, before writing any
of this plan, turned up two defects. **Both are fixed** (Phase 1) — they are
kept here because they are the argument for the rest of the plan: this is what
an untested boundary looks like, and it took twenty minutes to find two.

### `lib/jwt.ts` threw the wrong error class `[x]`

```
sig="short"      -> THROWS RangeError: Input buffers must have the same byte length
sig="TKECX_pF_b" -> THROWS RangeError: Input buffers must have the same byte length
sig=""           -> THROWS RangeError: Input buffers must have the same byte length
```

`crypto.timingSafeEqual` requires equal lengths and throws otherwise, so a token
with a truncated signature never reaches `throw new Error('Invalid token
signature')`.

### Six of eight auth failures returned 500 where 401 belongs `[x]`

Five Next route handlers decide the status code by **substring-matching the
error message**:

```ts
if (msg.toLowerCase().includes('authorization')) return 401;
return 500;
```

`verifyHs256Jwt` and `requireAuth` can throw eight distinct messages. Only two
contain the word "authorization":

| Thrown | Status today | Should be |
|---|---|---|
| `Missing Authorization header` | 401 | 401 |
| `Invalid Authorization header` | 401 | 401 |
| **`Token expired`** | **500** | **401** |
| `Invalid token signature` | 500 | 401 |
| `Invalid token format` | 500 | 401 |
| `Invalid token algorithm` | 500 | 401 |
| `Invalid token claims` | 500 | 401 |
| `Server missing JWT_SECRET` | 500 | 500 |

**A member whose session expires gets "Failed to create loan application"
instead of being sent to log in again.** The client cannot tell it needs to
re-authenticate, because the server said it was the server's fault.

Affected: `admin/audit-logs`, `loans/applications`,
`loans/[id]/guarantor-approval`, `member/transactions/[id]/dispute`,
`members/lookup`.

---

## 3. What this plan is and is not

**It is not a coverage-percentage exercise.** A line-coverage number is a proxy
that stops correlating with correctness the moment you start writing tests to
raise it. The 2026-08-17 audit is the standing reminder: 17 integration tests
were green while two defects were destroying money, because the suite never ran
two postings at once and never seeded a loan without a guarantor. **Coverage
bounds what was executed, never what was checked.**

**It is a contract exercise.** For every boundary — HTTP endpoint, exported
function, form — write down what it promises and prove it keeps the promise for
valid input, invalid input, hostile input, and concurrent input.

### The rules of the exercise

1. **Every fix gets a test that was seen to fail first.** Revert the fix, run
   the test, watch it fail with the symptom it describes, restore, watch it
   pass. A test written after the fix and never run against the bug proves only
   that today's code passes today's test.
2. **Test behaviour at the boundary, not implementation.** A test that breaks
   when you rename a private helper is a liability.
3. **A found bug is fixed in the same batch**, not filed. The point of the plan
   is a working system, not an inventory.
4. **If a test is hard to write, that is a finding.** It usually means the seam
   is in the wrong place; note it rather than contorting the test.
5. **Never suppress stderr on a setup step.** A silent failure in fixture setup
   makes a broken test look like a passing one. That has already cost this
   project an afternoon.
6. **Flaky is failing.** Fix the race or delete the test.

---

## Phase 0 — Make testing cheap `TEST-01 … TEST-04` — **done**

Everything after this is gated on it. Today, exercising an endpoint means hand-
starting Postgres, running migrations, minting a JWT with a shell script and
tearing it all down — which is why it rarely happens.

| ID | Work | Done when |
|---|---|---|
| **TEST-01** | One command brings up Postgres, migrates, seeds deterministic fixtures, starts both servers, and tears down on exit. `pnpm test:stack` | A cold clone runs the full suite with one command |
| **TEST-02** | Go handler harness: `httptest` server over the real router with a test database, plus a helper that mints tokens for each role | Any of the 65 routes can be exercised in ~5 lines |
| **TEST-03** | Next route-handler harness: call the exported `GET`/`POST` with a constructed `Request`, against a test database | Any of the 21 methods testable without a browser |
| **TEST-04** | CI runs Playwright; coverage is reported per package with a ratchet that can only go up | A PR that drops coverage fails |

**Done 2026-08-17.** `scripts/test-stack.sh` brings up Postgres 17 on a
non-default port, migrates (not `db push` — ADR-014), seeds, optionally starts
both servers, and prints the exports each suite needs. `--serve` and `down` are
one flag apart, and `down` destroys the volume: these suites truncate tables, so
the database must be one nobody minds losing. The Go handler harness is
`auth_gate_integration_test.go` — a real chi router, a real database, a token
minted the way login mints one. Playwright now runs in CI on a Pixel 7 viewport.

**TEST-03 built with Phase 3**, as planned — `apps/web/test/route-harness.ts`,
under `pnpm test:routes` and a `vitest.routes.config.ts` kept separate from the
fast unit suite so `pnpm test:unit` never needs Postgres. It mints tokens the way
the login endpoint does, so the interesting ones (expired, forged, for a deleted
user) are reachable, which they are not if a test has to log in first.

Building the Go harness needed one refactor: the 64-route table lived inline in
`main()`, where nothing could enumerate it. It is now `mountRoutes(r, routerDeps)`
in the same file, and `chi.Walk` is what drives TEST-15. That is rule 4 in
action — the test being hard to write was the finding.

**Findings:** none from the scaffolding itself.

---

## Phase 1 — Authentication and authorization `TEST-05 … TEST-09` — **done**

Highest risk per line in the codebase, and currently at 0%.

| ID | Target | Cases |
|---|---|---|
| **TEST-05** | `lib/jwt.ts` | truncated/absent/oversized signature · `alg: none` and `alg: RS256` confusion · `{"alg":"hs256"}` lower-case · missing `exp` · `exp` in the past, at the boundary second, non-numeric · payload that is not JSON · padding variants · **the RangeError above** |
| **TEST-06** | `lib/auth.ts`, `lib/server-auth.ts`, and the 5 routes mapping errors by substring | every one of the 8 throw sites → correct status · `Bearer` casing · double `Bearer` · whitespace · token in a cookie vs header · **replace substring matching with a typed error** |
| **TEST-07** | `lib/rate-limit.ts`, `lib/cors.ts` | window boundary · counter reset · `callerAddress` with spoofed `X-Forwarded-For` and `TRUSTED_PROXIES` at 0/1/2 · concurrent consumption of the last token · origin allow-list bypass attempts (`evil.com?x=hasnahena.org`, subdomain, null origin, case) |
| **TEST-08** | Go auth/role middleware | each role against each `/admin` route · expired · blacklisted · malformed · **role escalation via a second token in the body** |
| **TEST-09** | **SEC-11**, already known open | a revoked token must be refused by the *Next* handlers too, not only Go |

**Done 2026-08-17.** 62 new tests across `jwt`, `auth`, `auth-revocation`,
`cors` and `rate-limit`, plus 29 assertions over the Go authorization gate.

### What Phase 1 found

**Three defects, all fixed, each with a test seen to fail first.**

1. **Malformed tokens crashed instead of being rejected.** `timingSafeEqual`
   throws on unequal-length buffers, so a truncated signature escaped as a
   `RangeError`. Four tests failed against the pre-fix code with exactly that
   symptom.
2. **Six of eight auth failures answered 500 instead of 401**, including
   `Token expired`. Replaced with an `AuthError` carrying its own status —
   the status now travels with the error instead of being re-derived from prose,
   so rewording a message can no longer change an HTTP contract.
3. **SEC-11 — the Next handlers ignored revocation.** Now closed:
   `requireActiveAuth` checks `token_blacklist` on all six `requireAuth`
   routes, and `server-auth.ts` checks it for settings, gallery and avatar
   upload. Both mechanisms mirror the Go implementation, including the
   whole-second `iat` truncation without which first login is born revoked.
   It **fails closed** — the opposite of the rate limiter, deliberately.

The Go gate was already sound: a demoted member presenting a stale
`SUPER_ADMIN` claim is refused because the role is re-read from the database,
and inactive, suspended and deleted accounts are all rejected mid-token-lifetime.
Those are now pinned rather than assumed.

---

## Phase 2 — Money `TEST-10 … TEST-14` — **done**

The arithmetic is at 93%. The **paths around it** are the gap: 66 repository
methods, 26 tests.

| ID | Target | Cases |
|---|---|---|
| **TEST-10** | Every exported repository method | one happy path plus one failure path each; enumerate from the source so none is missed |
| **TEST-11** | Concurrency, extended | the existing pattern applied to *every* balance-touching method — deposit, withdrawal, donation, repayment, disbursement, waterfall — not just the four already covered |
| **TEST-12** | BigInt boundaries | 0 · 1 · `MaxInt64` · overflow on sum · negative rejected at every entry point · a deposit that would overflow the account total |
| **TEST-13** | Default waterfall, exhaustively | no guarantor · guarantor with 0 · guarantor with less than the shortfall · exactly the shortfall · more · multiple loans against one guarantor · donation pool empty · residual debt arithmetic |
| **TEST-14** | Audit completeness | **assert that every method that changes a balance writes exactly one `audit_logs` row**, driven off the same enumeration as TEST-10. Rule 6 in CLAUDE.md is currently enforced by review only |

**Done 2026-08-17.** `internal/repositories/money_paths_integration_test.go` and
`replay_integration_test.go`.

### What Phase 2 found

**Predicted, and correct: a lost-update variant in a method the earlier pass did
not reach.**

1. **`AddMemberLoanPayment` accepted concurrent overpayments.** It read the
   member, the account and the loan *from the pool*, before opening a
   transaction; checked `amount > remainingAmount` against that stale read; then
   wrote back an absolute `remainingAmount - amount` computed in Go. That is
   LEDGER-01 exactly ([ADR-015](decisions.md)). Ten concurrent 1000-taka payments
   against a 5000-taka loan **all committed**, leaving `accounts."loanBalance"`
   at **−5000** and disagreeing with the loan's own remaining amount. A member
   double-tapping a button on a bad connection paid twice for one debt. Now every
   read is inside the transaction and locked, and the write is relative and
   guarded: `SET "remainingAmount" = "remainingAmount" - $1 WHERE id = $2 AND
   "remainingAmount" >= $1 RETURNING …`. The overpayment check and the write are
   one statement, so there is no window between them. Verified failing against
   the committed method.
2. **The donation pool account did not exist.** `RecordDonation` locks
   `accounts` where `accountNumber = 'HN-ACC-DONATION'`. Nothing in the schema,
   the migrations or the application ever created that row — only a test did —
   so the foundation's first real donation would have failed with a 500 and
   "Failed to record donation". `pnpm db:seed` creates it now, `pnpm db:clear`
   preserves it, and a missing row answers 503 naming the fix rather than 500
   naming nothing.

**Deliberately kept honest:** `TestBalanceWritersAreEnumerated` re-derives the
list of balance-writing methods from the source on every run, so a ninth cannot
be added without the suite demanding a concurrency test and an audit test for it.
"At least one audit row" is *not* the assertion either — it is exactly one,
because a duplicated log entry is indistinguishable from a duplicated posting to
whoever is reconciling.

---

## Phase 3 — Every HTTP contract `TEST-15 … TEST-19` — **done**

86 endpoints, 0 tested. This is the largest batch and the most mechanical, so it
should be **table-driven**: one table per route listing method, roles, required
fields, and expected statuses. The table is the specification; the runner is
twenty lines.

| ID | Target |
|---|---|
| **TEST-15** | All 65 Go routes: unauthenticated → 401 · wrong role → 403 · malformed body → 400 · missing resource → 404 · valid → 2xx |
| **TEST-16** | All 21 Next methods, same matrix |
| **TEST-17** | Response shape: BigInt serialised as string everywhere · no `passwordHash`, no internal ids, no other member's data in any payload |
| **TEST-18** | Hostile input: oversized bodies · deeply nested JSON · wrong content type · unicode and RTL in every string field · SQL metacharacters · `__proto__` pollution · duplicate JSON keys |
| **TEST-19** | Idempotency and replay: double-submit of every money endpoint · out-of-order lifecycle transitions (confirm before process, approve twice) |

**Done 2026-08-17.** `apps/api/cmd/server/{routes,hostile_input}_integration_test.go`
and `apps/web/test/routes.contract.test.ts`.

**Both halves enumerate rather than list.** Go walks the router with `chi.Walk`;
Next walks `app/api` on disk. A route with no contract row fails the suite, and
so does a row with no route. That is the property that matters — a missing role
check is a one-line diff that reads as correct.

### What Phase 3 found

**As predicted, the highest yield: eight defects.**

1. **`MarkLoanDefaulted` re-ran the recovery waterfall on a second click.** It
   never looked at the status it was changing *from*, so a second call recovered
   again from whatever the borrower had saved since — for a debt already settled
   against them. Money left an account twice for one default. Now the loan row is
   locked and its status checked first: 404 for an unknown loan, 409 for one not
   in a defaultable state. A table test walks all nine `LoanStatus` values, and a
   concurrency test proves exactly one of six simultaneous defaults wins.
2. **Malformed JSON was a 500 on almost every Next route.** Every handler did
   `await req.json()` inside a try whose catch ended `return 500`. A truncated
   POST from a phone that lost signal was reported as a server fault. Now
   `lib/route-errors.ts` classifies it once, and every route uses it.
3. **`/api/v1/admin/workers` answered 500 to an expired session** on all four
   methods — the Phase 1 defect, in the one file Phase 1 did not reach.
4. **`GET /api/v1/settings` returned the whole `system_config` table** to
   anonymous callers. It has to stay unauthenticated (the marketing pages read
   the org's contact details), but it now returns only the declared keys — the
   same allowlist `PUT` validates against. The day a key holds something internal,
   it will not become public with no code change.
5. **A NUL byte in a query parameter was a 500.** PostgreSQL text cannot hold
   U+0000, so `?threadId=%00` became a database error. Fixed once for every route
   with `middleware.RejectNulBytes`, and for bodies in `utils.ParseJSON` — where
   the escaped form is valid JSON and decodes to a real NUL. The scanner honours
   escaping, so a literal backslash-u-0000 in text is not mistaken for one.
6. **`{"amount": 1e400}` crashed loan applications.** `z.number()` accepts
   Infinity, and `BigInt(Infinity)` throws. The schema is `.int().finite()` with a
   cap now — which also removed a silent `Math.floor` that turned 1000.9 into
   1000 rather than reporting it (rule 1).
7. **Four routes validated the body before checking the role**, so a WORKER
   posting to a member-only endpoint got a 400 listing the fields it wanted
   rather than a 403. Authorization now precedes validation everywhere.
8. **Prisma's "record not found" was a 500.** Deleting a gallery item that is
   not there is a 404; a duplicate is a 409.

Two smaller ones came out of the same sweep: a duplicate phone or email on
`PUT /worker/profile` was a 500 rather than a 409 and left no audit row despite
changing the address a password reset is delivered to; and that route accepted a
MEMBER while the `GET` beside it was staff-only.

**Assertions that did *not* fire, and are now pinned:** no response on any GET
carries `passwordHash`, `resetToken` or any other credential material at any
depth; every Go response is the `{success, data, error, meta}` envelope; and no
route answers 5xx to any of the 21 hostile bodies or 10 hostile query strings.

---

## Phase 4 — Domain rules `TEST-20 … TEST-22` — **done**

| ID | Target |
|---|---|
| **TEST-20** | One test per FR-01…22 in [product.md](product.md), named for the requirement, so the doc and the suite cannot drift |
| **TEST-21** | The Shariah invariant, mechanically: no rate, markup or fee field reachable from any money path; total repaid can never exceed principal, property-tested over random schedules |
| **TEST-22** | Lifecycle state machines: loan `PENDING_GUARANTOR → … → COMPLETED`, withdrawal request → process → confirm. Every illegal transition rejected. Collapse the legacy `PENDING`/`APPROVED` values while you are here |

**Done 2026-08-17.** `apps/web/test/unit/requirements.test.ts` and
`apps/api/internal/repositories/lifecycle_integration_test.go`, plus
`apps/api/internal/money/shariah_test.go`.

**TEST-20 is not 22 hand-written tests.** That would satisfy the letter of "one
test per requirement" and none of the intent — it drifts the moment a
requirement is added, renamed, or quietly implemented. Instead the enumeration
comes from `product.md`, the status from `tasks.md`, and the suite holds one row
per FR saying either where it is covered or what is still missing. Three things
must agree, and any two disagreeing fails.

The sharpest part is the gap assertions: a requirement marked `[~]` claims
something is absent, and the row proves it *stays* absent by searching the
source. Implement the withdrawal notice period without updating the status board
and the suite fails, naming the file that now implements it. Verified by
planting a `checkNoticePeriod` function and watching it fire.

### What Phase 4 found

**No defect in the state machines** — every illegal transition was already
refused, across all six `TransactionStatus` and all nine `LoanStatus` values.
That is worth stating plainly rather than padding: the lifecycle was sound, and
is now pinned instead of assumed, including the "refused *and* inert" half —
a rejected approval must also have moved no money and changed no status.

What it did find was **three status-board errors of my own making**, which is
exactly what the three-way check exists to catch: FR-18, FR-21 and FR-22 are
`[~]` in `tasks.md` and I had recorded them as covered. The suite refused the
mismatch and named each one.

Two things worth recording:

- **A detector must search code, not prose.** The first run flagged
  `loan_repository.go` for containing the word "markup" — in its own header
  comment, which says *"Nothing here may compute a rate, a markup or a fee"*. A
  rule that fires on its own statement trains people to delete the
  documentation. Comments are stripped before searching now.
- **`loan.noticePeriodMonths` exists as a config key and is editable in the
  admin UI, while nothing reads it.** The setting reports a policy the system
  does not apply. The FR-08 gap search is scoped to the enforcement surface for
  that reason — matching the settings page would prove only that the key exists,
  which is not the claim being made.

**One thing flagged rather than fixed (rule 3).** The loan agreement prints
*"Late payment may attract a fixed, interest-free late fee as set by foundation
policy"*, and FR-13 asks for late-fee flags "per policy" — but nothing
implements one, and no policy document says **who would keep it**. That is the
whole question: a penalty retained by the lender is riba on the mainstream
reading, while one paid entirely to charity is the form scholars permit. The
suite pins the tension in both directions: implementing a fee fails, and
removing the printed term fails.

---

## Phase 5 — Generated documents `TEST-23 … TEST-25` — **done**

Members keep this paper. A wrong number here is argued about at a counter.

| ID | Target |
|---|---|
| **TEST-23** | All four builders against golden models: statement, receipt, loan agreement, certificate |
| **TEST-24** | **HTML and PDF renderers cannot drift** — same model, same visible content, asserted structurally rather than by pixel |
| **TEST-25** | Amount formatting at boundaries (0, lakh, crore) · pagination at the page break · long names and addresses · English-only enforcement (ADR-012) · document numbers from `document_sequences` only (ADR-013) |

**Done 2026-08-17.** 151 tests across `builders.test.ts`,
`render-parity.test.ts` and `boundaries.test.ts`.

**TEST-24 is asserted structurally, not by pixel.** The question is not "do
these look the same" — they deliberately do not, one is a web page and one is
A4 — but "does every fact in the model reach both outputs". The HTML is stripped
of markup; the PDF is read back out of jsPDF's own content streams, so a string
passed to a drawing call that never landed on a page cannot pass. Two documented
differences are normalised away and nothing else: case (both uppercase the same
five places, one in CSS and one in code) and typographic punctuation.

### What Phase 5 found

**TEST-23 found nothing** — all 40 builder tests passed first run. The builders
were correct. The defects were all in the *rendering*.

1. **The PDF silently dropped typographic punctuation.** jsPDF discards anything
   above U+00FF without complaint, and `toPdfSafe`'s allowlist passed those
   characters straight to it. The loan agreement's default clause — the one
   naming whose savings are taken — printed as *"the borrowers own savings, then
   the guarantors savings"*, two possessives read as plurals. `0% — Qard
   al-Hasan` printed as `0%  Qard al-Hasan`. Worst of all, `orDash`'s own `—`
   placeholder vanished, so an **empty field printed as a blank gap** — exactly
   the failure that function was written to prevent. Now transliterated to
   Latin-1 rather than passed along to be dropped.
2. **Every receipt number on every statement wrapped mid-digit.** The Reference
   column was 0.15 of the content width — 22.7 mm usable — and a 15-character
   document number measures 23.14 mm at the table's 8 pt Helvetica. Short by
   0.44 mm, so `DEP-2026-000001` printed as `DEP-2026-00000` with a stray `1`
   on the line below. A member reading that off a printed statement to query a
   transaction transcribes it wrong. Only reachable at all *because* ADR-013
   made document numbers sequential and therefore uniformly 15 characters.
3. **`BALANCE (BDT)` overflowed its column into `DEBIT (BDT)` beside it** —
   18.02 mm of header in a 17.36 mm column, drawn without wrapping. Found by the
   measurement written for defect 2, on its first run.

The durable part is that measurement. `table columns fit their content` computes
the rendered width of the widest cell and header against the column it has to
fit in, so the next column that is a fraction too narrow fails there instead of
on a member's printed statement. Eyeballing a PDF is what let a 0.44 mm shortfall
ship.

---

## Phase 6 — Interface `TEST-26 … TEST-30` — **done**

Two specs exist. 39 pages do not have one.

| ID | Target |
|---|---|
| **TEST-26** | Member journey end to end: register → approve → deposit → borrow → repay → statement |
| **TEST-27** | Worker journey and admin journey, same depth |
| **TEST-28** | Every form: empty submit · whitespace-only · maximum length · paste · back-button · double-submit · offline mid-submit |
| **TEST-29** | The matrix: mobile *and* desktop × `en` *and* `bn` × light *and* dark. Bengali is longer than English and breaks layouts English does not |
| **TEST-30** | Accessibility: keyboard-only completion of every flow · visible focus · form labels · contrast · screen-reader announcement of errors |

**Done 2026-08-17.** `e2e/matrix.spec.ts`, `e2e/accessibility.spec.ts`,
`e2e/journeys.spec.ts` and `e2e/forms.spec.ts`, on fixtures in `e2e/fixtures/`.

The fixtures seed three accounts straight through Prisma rather than driving
sign-up first — the journeys under test start *after* approval — and
`assertDisposableDatabase` refuses to run against anything but localhost,
because these specs write balances and the mistake is one pasted environment
variable away.

### What Phase 6 found

**The expected findings did not appear.** All 75 layout cells — 13 public pages
and 23 dashboard pages × phone/desktop × `en`/`bn` — passed first run, and the
`/bn` dashboards measure 84–97% Bengali. The Bengali layouts hold up. Worth
stating plainly rather than dressing up.

What it found instead was worse:

1. **The member dashboard showed a fabricated `BDT 0`.** Its initial state was
   four zeros, so for the ~1.5 s before the fetch resolved a member saw
   "Current Balance: BDT 0" — and the catch block was
   `catch { setData(prev => ({ ...prev })) }`, which discards the error and
   keeps those zeros **forever** on a failed fetch. A member whose savings are
   ৳73,500 could be told their balance is zero, with no error, no retry and
   nothing to distinguish it from the truth. Now a dash while loading, and a
   live-region error with a retry on failure.
2. **Twenty-plus icon-only controls had no accessible name** across every
   dashboard page — the mobile menu, the notification bell, the support close
   button, row-action menus, refresh buttons, and seven filter `<select>`s.
   Announced as "button" and "combo box" with no indication of what they do.
3. **Eight labels on the settings page were not associated with their inputs.**
   The visible text was right there; nothing linked it, so a screen reader
   announced "edit text" for the organisation's name, address, phone and email.
4. **Five aria-labels were hardcoded English**, including all three
   password-visibility toggles — a Bengali member hears English for a control
   whose surroundings are Bengali (rule 5). Now in `messages/{en,bn}.json`.
5. **A ternary whose two branches were character-for-character identical**, so
   the condition decided nothing. Collapsed.

Two of my own tests were wrong in instructive ways, both recorded in
[work-orders.md](work-orders.md#traps-that-cost-a-session): reading `innerText`
once races a page that fills in its figures, and `nextjs-portal` — the dev-tools
overlay — sits in the tab order and reports no focus ring, so it has to be
excluded explicitly.

---

## Phase 7 — Non-functional `TEST-31 … TEST-35` — **done**

| ID | Target |
|---|---|
| **TEST-31** | Load: sustained concurrent postings; assert the ledger still balances afterwards |
| **TEST-32** | Query counts per endpoint — fail the test if a list route issues N+1 |
| **TEST-33** | Failure injection: database gone mid-transaction · Cloudinary down · Brevo down · disk full. Every one must fail *closed* and leave no orphan |
| **TEST-34** | The restore drill: back up, destroy, restore, reconcile. Run against the real host while the data is still disposable |
| **TEST-35** | Budgets: bundle size, cold start, p95 latency — recorded now so regressions are visible later |

**Done 2026-08-17.** `internal/repositories/nonfunctional_integration_test.go`
and `failure_injection_integration_test.go`.

### What Phase 7 found

**One harness defect, and it was masquerading as flakiness.** The e2e suite
comes from a single address and the API's rate limiter allows 60 requests a
minute (`RATE_LIMIT_REQUESTS`), so partway through a run the limiter starts
answering 429 and the *later* specs render empty pages. It reproduced only in a
full run — the failing spec passed three times in isolation — and the obvious
fix was a retry, which would have hidden it permanently. What settled it was
`grep -c 429 .test-stack/api.log`: **91 rejections**. `test-stack.sh` and the CI
e2e job now raise the limit, with the reasoning written down beside it.

**The application itself held up under all of it:**

- **TEST-31.** 240 sustained mixed postings from six goroutines against four
  members, at ~180/s. Every account reconciles *exactly* against its own ledger,
  every posting left exactly one audit row, and no two postings shared a receipt
  number.
- **TEST-32.** Query counts measured with a `pgx.QueryTracer` — which counts
  what *this call* issued, unlike `pg_stat_statements`. Every list read is flat:
  one or two queries for ten rows and the same for forty. The member dashboard
  is five queries whether the member has three transactions or twenty-five.
- **TEST-33.** Cancelled contexts, an unreachable pool, an over-withdrawal, a
  member who does not exist: every one leaves the balance untouched, no audit
  row, and no transaction row. Including the subtle one — **a failed posting
  gives its receipt number back**, so the printed sequence has no gaps to
  explain during an audit.
- **The email service is not on the money path and cannot become one.** The
  repository takes no email service at all; a worker at a member's door with
  Brevo down still records the deposit, and the in-app notification is written
  in the same transaction.

**TEST-34 was already built and is not duplicated here.** The restore drill runs
on every push to `main` — `scripts/backup.sh` then `scripts/restore-check.sh`
into a scratch database — as the `restore` job in
[ci.yml](../.github/workflows/ci.yml). An untested backup is a rumour, and that
job is what stops it becoming one; re-implementing it as a Go test would test a
copy rather than the script an operator would actually run.

**TEST-35, measured on this machine** so a regression has something to be
compared against. These are observations, not thresholds — a budget invented
before anything is slow is a number nobody trusts:

| Budget | Measured 2026-08-17 |
|---|---|
| Sustained postings | ~180/s, six concurrent writers, four contended accounts |
| List read | 1–2 queries, flat in row count |
| Member dashboard read | 5 queries, flat in history length |
| Go integration suite | ~8 s for every package |
| Web unit suite | ~2 s for 336 tests |
| Next route contracts | ~3 s for 266 assertions |
| Browser suite | ~12 min for 143 specs, one worker |

---

## Phase 8 — Documentation `TEST-36 … TEST-38` — **done**

4,291 lines across 16 files, and the two largest are growing without bound.

| ID | Work |
|---|---|
| **TEST-36** | `work-orders.md` (1,023 lines) keeps **open** work orders only. Completed batches compress to one line each in a new `docs/changelog.md`; their durable lessons move to [changing-things.md](changing-things.md), [decisions.md](decisions.md) or [data-model.md](data-model.md) — **mine them before deleting them** |
| **TEST-37** | `production-readiness.md` (701) and `tasks.md` (207) repeat the same banners. One owns *operational* state, the other *product* state; delete the overlap and cross-link instead |
| **TEST-38** | This file becomes the permanent testing guide: how to run each suite, how to add a case, the fixture contract. Add the suite inventory to [CLAUDE.md](../CLAUDE.md) so the next session finds it |

**Done 2026-08-17.**

- **TEST-36.** `work-orders.md` holds open orders and the traps. Everything
  finished is one line per batch in the new [changelog.md](changelog.md), for
  both WO-01 → WO-50 and TEST-01 → TEST-38. The file had reached 1,023 lines,
  most of it narrative about work finished months earlier; it stops growing now
  because a completed batch becomes a row somewhere else.
- **TEST-37.** `tasks.md` and `production-readiness.md` both opened with the
  same git-history banner, and had already drifted apart in how they described
  it. Operational state is stated once, where it lives; `tasks.md` links to it.
- **TEST-38.** This file, plus the four enumerating suites listed in
  [CLAUDE.md](../CLAUDE.md) so the next session finds them without reading this.

**Nothing was deleted without being read.** Compress, don't discard.

---

## Phase 9 — What the suites still do not cover `TEST-39 … TEST-43` — **done**

Opened and closed 2026-08-18. Phases 0–8 closed the boundary gap and found
eighteen defects. This phase exists because **"the suite is green" and "this is
checked" are different statements**, and the whole point of the eight phases
above was that nobody could tell them apart. Every entry below was a surface no
assertion reached; writing them down is what made them stop being invisible, and
three of the five turned out to have a live defect sitting behind them.

Each has an execution spec in [work-orders.md](work-orders.md); this table is the
*why*, and [tasks.md](tasks.md#coverage-gaps-under-watch) is the status.

| ID | Uncovered surface | Why it is the next place a defect hides | Order |
|---|---|---|---|
| **TEST-39** `[x]` | **EN/BN message parity** — closed 2026-08-18 | `apps/web/test/unit/messages.test.ts`: equal key sets, no long untranslated copy-paste, every `{placeholder}` carried through. All four assertions were confirmed red — by deleting a key, by pasting an English string, by stripping a placeholder — before being allowed to pass | [WO-51](work-orders.md) |
| **TEST-40** `[x]` | **What a notification says** — closed 2026-08-18 | `apps/api/internal/notify/`: every message is a pure `(title, message)` builder, table-tested at seven amounts including `0` and the int64 ceiling, plus two censuses — one fails when a builder has no test row, the other when a repository builds a message itself. `email_service.go` is covered for its escaping asymmetry (HTML escaped, text not). **The defect it was written to guard was already present** — LEDGER-07, now fixed | [WO-52](work-orders.md) |
| **TEST-41** `[x]` | **The cleanup loop** — closed 2026-08-18 | Two halves, because the defect has two. `internal/services/cleanup_integration_test.go` proves the sweep deletes expired rows **and only those** — a sweep that deletes too much un-revokes a logged-out token and clears an attacker's lockout — and that a cancelled context deletes nothing. `cmd/server/wiring_test.go` reads main.go's AST and fails if nothing starts the loop, or if it is started with `startupCtx`, the ten-second startup context that would make it run once and stop | [WO-53](work-orders.md) |
| **TEST-42** `[x]` | **Prisma schema drift** — closed 2026-08-18 | `pnpm db:migrate:check` (`prisma migrate diff --exit-code`) runs in CI right after `db:migrate`. Verified both ways against a real migrated database: no difference today, exit 2 with the column printed when a field is added to `schema.prisma` without generating a migration. The `audit_logs` immutability trigger is **not** reported as drift — it is invisible to `migrate diff`, which is the same property that makes [WO-33](work-orders.md) delicate | [WO-54](work-orders.md) |
| **TEST-43** `[x]` | **The Cloudinary paths** — closed 2026-08-18 | `lib/cloudinary.test.ts` table-tests the public-id parser against every URL shape (plain, versioned, transformed, chained, named, nested, non-Cloudinary) — it was returning an id that names nothing for the transformed shape, which is the normal one. `lib/image-utils.test.ts` covers the type and size gate. `test/routes/registration.test.ts` drives the compensation path with the client stubbed: an upload failure leaves no user, no document rows and **no orphaned assets**. Nothing touches the real account — it holds members' NID scans. **DATA-06, the missing backup, is not closed by this** | [WO-55](work-orders.md) |

### What the 2026-08-18 code audit found, and why Phase 9 grew

Phase 9 opened as a list of *untested surfaces*. Then the code was read rather
than the coverage, and it produced **ten defects in a codebase whose eight
testing phases were all green** — including the only broken FR on the board.

That is the finding worth keeping. Some of it was reachable by tools:

| Tool | Ran | Result |
|---|---|---|
| `go vet` | whole API | clean |
| `golangci-lint` errcheck + staticcheck | whole API | **19 findings** — 12 unchecked errors, `SA1019 middleware.RealIP`. All fixed; `RealIP` removed by WO-60, so there are no staticcheck suppressions left |
| `go test -race` unit | whole API | clean |
| `go test -race` integration | whole API, real Postgres | **zero data races** in ~40 s — now [WO-66](work-orders.md) |
| `next build` | web | clean |
| `pnpm typecheck` / `lint` | web | clean, 26 warnings |

Most of it was not. The rest came from reading money paths and asking what each
function returns, and the sharpest one is worth stating in full because it
indicts the suite design rather than the code:

> **`POST /api/v1/member/transactions/[id]/dispute` returns 500 on success.** The
> route serialises a raw Prisma row whose fields are `BigInt`, and
> `NextResponse.json` throws on that. The dispute *is* recorded and the member is
> told it failed.
>
> `routes.contract.test.ts` drives that route with `id: 'no-such-txn'`. Every
> authorization case passes. **The success path had never been executed by any
> test.**

**A route contract proves who may call a route, not what it returns.** The
enumerating suites were built to answer "can a WORKER reach this?", and they
answer it exhaustively for all 85 route methods. They say almost nothing about
what a permitted caller gets back. That is the gap Phase 9 now owns, and the
cheapest way to close it is a rule rather than a list: **every route in the
contract table needs at least one row that drives it to a 2xx.**

`test/routes/success-paths.test.ts` starts that, and generalises the specific
defect rather than just fixing it: alongside the driven dispute it walks every
route file and fails if any of them hands a row from a BigInt-bearing model
(`transaction`, `loan`, `account`, `documentSequence`) straight to
`NextResponse.json`. That census would have caught WO-57 the day it was written,
without anyone thinking to test that route.

Second lesson, cheaper to state: **the same function can write one correct record
and one wrong one.** Every posting in `transaction_repository.go` wrote an audit
line with `%d BDT` — correct — and a member notification with `BDT %.2f` from a
`float64` — a rule-1 violation. A test that read either one alone would have
concluded the code was fine. Fixed 2026-08-18 by moving every message into
`internal/notify`, where a census makes the next one impossible to add untested.
The int64 ceiling made the point concrete: `%.2f` rendered
9,223,372,036,854,775,807 as `…808.00`, having lost the low digits to `float64`
before it ever reached the format string.

**Two of these five were worth more than the other three**, and the call held up:
TEST-40, because it guards money rendered to a member and we had already shipped
that exact defect once — writing it found the defect sitting there a second time;
and TEST-42 — an hour of work that fails the build on a whole class of drift,
closed the same day it was called for.

### What is deliberately still uncovered

Not everything absent is a gap. These are decisions:

| Not covered | Why |
|---|---|
| Brevo actually delivering mail | Testing a third party's SMTP proves nothing about this code. WO-52 tests the message; delivery is an operational check on the go-live list |
| ~~The React Compiler lint findings~~ | **No longer deliberate.** The compiler is on as of 2026-08-18 and all 20 findings are cleared; `pnpm lint` reports 6 warnings, none of them this rule |
| Load and stress testing | Out of scope in [product.md](product.md). TEST-31's 240 sustained postings is the ceiling this workload needs |
| A generic accessibility audit | See the reasoning in `e2e/accessibility.spec.ts` — four specific checks beat a long advisory list nobody actions |

### The one-pass browser run

**Proven 2026-08-18: 142 passed, 1 skipped, 10.2 minutes, exit code 0**, against
`scripts/test-stack.sh up --serve` on an otherwise idle machine (load average
0.6). That closes the one item the eight phases left unverified.

It had been unproven for a while, and how that happened is the useful part: four
earlier attempts were killed because the machine was saturated by unrelated
processes, and **a Playwright run starved of CPU produces timeouts that read
exactly like defects**. The run that finally completed was not a different test
suite; it was the same suite on a quiet machine.

So: before acting on a browser failure, check `uptime` and re-run the single spec
on its own. Two of the Phase 6 "failures" were the machine. One — the rate
limiting — was real, and the only thing that separated them was
`grep -c 429 .test-stack/api.log`.

**The 1 skipped is `e2e/admin-dashboard.spec.ts`.** It guards itself behind
`E2E_ADMIN_IDENTIFIER` / `E2E_ADMIN_PASSWORD`, and neither `test-stack.sh env`
nor the CI e2e job sets them — so that spec has **never run in any environment**.
It is not a coverage hole (`journeys.spec.ts` signs in as an admin through the
fixtures and asserts more), but a permanently-skipped spec is worse than no spec:
it reads as covered in every report. Wire it to `ACCOUNTS.ADMIN` or delete it.

That matters more than it sounds: **an e2e failure on a loaded machine is not
evidence of a bug, and it is not evidence of a working system either.** Before
acting on one, check the load, and re-run the single spec on its own. Two of the
Phase 6 "failures" were the machine; one — the rate limiting — was real, and the
only way to tell them apart was `grep -c 429 .test-stack/api.log`.

Video recording is off by default (`PWVIDEO=1` re-enables it) precisely because
it costs an ffmpeg process per test, around 30% of a core, on a machine that may
not have it to spare.

---

## The order it was done in, and why

```
Phase 0  harness           ── everything is gated on this
Phase 1  auth              ── highest risk per line, currently 0%
Phase 3  HTTP contracts    ── largest yield, mechanical, unblocked by Phase 0
Phase 2  money             ── deepest, but the known defects are already fixed
Phase 4  domain rules
Phase 5  documents
Phase 6  interface
Phase 7  non-functional
Phase 8  documentation     ── continuously, not at the end
```

Phase 3 runs before Phase 2 deliberately. The money *arithmetic* is the best-
tested code here and its known defects were fixed on 2026-08-17; the untested
HTTP boundary in front of it is where an unauthorised caller would reach it.

**Documentation is updated in the same commit as the work it describes**, per
the existing convention — Phase 8 is the consolidation, not the write-up.

---

## Working in the suites

The part to read if you are adding a test rather than reviewing what was found.

### Where a new test goes

| What you are testing | Put it here | Needs |
|---|---|---|
| a pure function in `lib/` | `apps/web/lib/<module>.test.ts` | nothing |
| pure Go arithmetic | `apps/api/internal/<pkg>/*_test.go` | nothing |
| SQL, a transaction, a race | `apps/api/internal/repositories/*_integration_test.go` | Postgres |
| a Go HTTP contract | `apps/api/cmd/server/routes_integration_test.go` | Postgres |
| a Next route handler | `apps/web/test/routes/routes.contract.test.ts` | Postgres |
| a document builder or renderer | `apps/web/lib/documents/*.test.ts` | nothing |
| a screen, a form, a layout | `apps/web/e2e/*.spec.ts` | the full stack |

The split is load-bearing: `pnpm test:unit` and `pnpm test:go` must stay fast
enough to run on every save, so nothing that needs a database belongs in them.
That is also why `test:routes` is a second vitest project rather than an addition
to the first.

### The fixture contract

1. **Namespace everything you seed to your own suite.** Ids, phone numbers,
   emails, `memberId`, account numbers. Both contract suites originally seeded a
   member with `memberId = 'RT-MEMBER'`, and whichever ran second died on
   `users_memberId_key` — invisible when either ran alone, so invisible until CI
   ran both.
2. **Seed what you need; never depend on what another suite left.** The Go
   suites truncate every table between tests. A test that passes because a
   neighbouring package created a row passes or fails on package ordering.
3. **Upsert rather than truncate** in the browser fixtures — they share the
   database with the Go suites, and clearing it out from under them is the same
   ordering bug from the other direction.
4. **Never suppress stderr on a setup step.** A failed fixture insert that looks
   like success turns into an auth failure blamed on the token. That has already
   cost this project an afternoon.
5. **The browser fixtures refuse a non-localhost `DATABASE_URL`**
   (`assertDisposableDatabase`). They write balances; the mistake is one pasted
   environment variable away.

### Adding an assertion that stays true

- **Enumerate, do not list.** Four suites derive their coverage from the source:
  `chi.Walk` for the Go routes, a filesystem walk for the Next ones, a regex
  census for balance writers, and `product.md` for the requirements. Each fails
  the build when the code grows something the table does not know about. Prefer
  that shape over any list a human maintains — the ADR-015 fix was applied to the
  four balance writers someone thought of, and the fifth kept the bug for months.
- **A regression test must be seen to fail first.** Revert the fix, watch it fail
  with the symptom it describes, restore, watch it pass. And revert the *whole*
  fix: restore the file from `git show HEAD:<path>` rather than editing back what
  you remember changing.
- **In a browser, use the retrying matchers.** `await expect(locator).toContainText(x)`
  retries; `expect(await locator.innerText()).toContain(x)` reads once and races
  every page that fills in its figures after mount.
- **Flaky is failing.** Fix the cause or delete the test. When a spec passes
  alone and fails in the suite, suspect shared state or a limit — the e2e rate
  limiting in Phase 7 read exactly like flaky ordering, and a retry would have
  buried it.

### When something fails and you cannot see why

- `.test-stack/api.log` and `.test-stack/web.log` hold the server output. Start
  with `grep -c 429 .test-stack/api.log`.
- `playwright-report/` and `test-results/` carry a screenshot, a video and a
  trace for every failed spec.
- Go integration failures print the seeded ids; query the database directly with
  `docker exec hn-test psql -U postgres -d hasnahena_test`.

---

## Suites, and what each is for

| Command | Needs | Covers |
|---|---|---|
| `pnpm test:unit` | nothing | pure TS: auth primitives, error classification, validation, formatting, ids, document numbers, the four document builders and both renderers, and the FR/status/code three-way check |
| `pnpm test:go` | nothing | pure Go: money arithmetic (including 400k property iterations), utils, middleware |
| `pnpm test:integration` | Postgres | repositories against real SQL, real transactions, real concurrency; the Go route contract and hostile-input sweeps |
| `pnpm test:routes` | Postgres | the 21 Next route methods, driven directly — no browser, no server. Plus the success paths: a real dispute, a real registration with Cloudinary stubbed, and the census that fails when a route returns an unserialised BigInt |
| `pnpm db:migrate:check` | Postgres | the migrated database still matches `schema.prisma`. Runs in CI after `db:migrate` |
| `pnpm test:e2e` | full stack | 143 browser specs: journeys, forms, the layout matrix (phone/desktop × en/bn), accessibility |

The split is deliberate: the first two must stay fast enough to run on every
save, so nothing that needs a database belongs in them. `test:routes` is a
second vitest project for exactly that reason — merging it into `test:unit`
would make the fast suite require Postgres.

**The database-backed ones share one database and can run in any order**, which
is deliberate: the Go suites truncate every table between tests, so anything
depending on rows another suite left behind would pass or fail on package
ordering. Each seeds what it needs, under identifiers namespaced to itself.

```bash
scripts/test-stack.sh up
eval "$(scripts/test-stack.sh env)"
pnpm test:integration && pnpm test:routes
scripts/test-stack.sh down
```

Namespacing is not cosmetic. Both contract suites originally seeded a member
with `memberId = 'RT-MEMBER'`, and whichever ran second died on
`users_memberId_key` — a collision invisible when either suite runs alone, and
therefore invisible until CI runs both.
