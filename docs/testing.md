# Testing Plan

A staged plan to get this codebase from "the parts we looked at work" to
"the parts nobody has looked at also work". Written **2026-08-17** against
measured coverage, not impressions.

Read the phases in order. Each is a batch with an ID (`TEST-01`), a definition
of done, and the bugs it is expected to surface. Prompt with **`do TEST-10`**.

> **Phases 0 through 5 are done (2026-08-17).** Fourteen defects found and
> fixed, two of which moved money incorrectly: `AddMemberLoanPayment` accepted
> concurrent overpayments and drove an account's loan balance to −5000
> ([Phase 2](#what-phase-2-found)), and `MarkLoanDefaulted` re-ran the whole
> recovery waterfall on a second click, taking a borrower's savings twice for one
> debt. Two more were inert until first use: the `HN-ACC-DONATION` account was
> never created by anything, so **recording a donation would have failed the
> first time anyone tried**; and the statement PDF printed every receipt number
> wrapped mid-digit, so the reference a member quotes at a counter was wrong on
> **every statement** ([Phase 5](#what-phase-5-found)).
>
> Counts: web unit 131 → **336**, Next route contracts **266**, Go integration
> 26 tests → **~700 assertions**, plus 400,000 property iterations over the loan
> arithmetic. **Next up: `do TEST-26`** (Phase 6, interface).

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

## Phase 6 — Interface `TEST-26 … TEST-30`

Two specs exist. 39 pages do not have one.

| ID | Target |
|---|---|
| **TEST-26** | Member journey end to end: register → approve → deposit → borrow → repay → statement |
| **TEST-27** | Worker journey and admin journey, same depth |
| **TEST-28** | Every form: empty submit · whitespace-only · maximum length · paste · back-button · double-submit · offline mid-submit |
| **TEST-29** | The matrix: mobile *and* desktop × `en` *and* `bn` × light *and* dark. Bengali is longer than English and breaks layouts English does not |
| **TEST-30** | Accessibility: keyboard-only completion of every flow · visible focus · form labels · contrast · screen-reader announcement of errors |

**Expected findings:** layout breakage in `bn`, dark-mode contrast, and forms
that lose state on the back button.

---

## Phase 7 — Non-functional `TEST-31 … TEST-35`

| ID | Target |
|---|---|
| **TEST-31** | Load: sustained concurrent postings; assert the ledger still balances afterwards |
| **TEST-32** | Query counts per endpoint — fail the test if a list route issues N+1 |
| **TEST-33** | Failure injection: database gone mid-transaction · Cloudinary down · Brevo down · disk full. Every one must fail *closed* and leave no orphan |
| **TEST-34** | The restore drill: back up, destroy, restore, reconcile. Run against the real host while the data is still disposable |
| **TEST-35** | Budgets: bundle size, cold start, p95 latency — recorded now so regressions are visible later |

---

## Phase 8 — Documentation `TEST-36 … TEST-38`

4,291 lines across 16 files, and the two largest are growing without bound.

| ID | Work |
|---|---|
| **TEST-36** | `work-orders.md` (1,023 lines) keeps **open** work orders only. Completed batches compress to one line each in a new `docs/changelog.md`; their durable lessons move to [changing-things.md](changing-things.md), [decisions.md](decisions.md) or [data-model.md](data-model.md) — **mine them before deleting them** |
| **TEST-37** | `production-readiness.md` (701) and `tasks.md` (207) repeat the same banners. One owns *operational* state, the other *product* state; delete the overlap and cross-link instead |
| **TEST-38** | This file becomes the permanent testing guide: how to run each suite, how to add a case, the fixture contract. Add the suite inventory to [CLAUDE.md](../CLAUDE.md) so the next session finds it |

**Nothing is deleted without being read.** Compress, don't discard.

---

## Order, and why

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

## Suites, and what each is for

| Command | Needs | Covers |
|---|---|---|
| `pnpm test:unit` | nothing | pure TS: auth primitives, error classification, validation, formatting, ids, document numbers, the four document builders and both renderers, and the FR/status/code three-way check |
| `pnpm test:go` | nothing | pure Go: money arithmetic (including 400k property iterations), utils, middleware |
| `pnpm test:integration` | Postgres | repositories against real SQL, real transactions, real concurrency; the Go route contract and hostile-input sweeps |
| `pnpm test:routes` | Postgres | the 21 Next route methods, driven directly — no browser, no server |
| `pnpm test:e2e` | full stack | browser journeys, on a phone viewport |

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
