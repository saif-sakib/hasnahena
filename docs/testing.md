# Testing Plan

A staged plan to get this codebase from "the parts we looked at work" to
"the parts nobody has looked at also work". Written **2026-08-17** against
measured coverage, not impressions.

Read the phases in order. Each is a batch with an ID (`TEST-01`), a definition
of done, and the bugs it is expected to surface. Prompt with **`do TEST-10`**.

> **Phase 1 is done and Phase 0 is done bar TEST-03 (2026-08-17).** The harness exists
> (`pnpm test:stack`), the security primitives are tested, and the three defects
> they turned up are fixed — see [What Phase 1 found](#what-phase-1-found).
> Web unit tests went 59 → 131; `internal/handlers` went from no test file at
> all to 29 assertions over the authorization gate. **Next up: `do TEST-10`**,
> or Phase 3 if you would rather take the larger yield first.

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

## Phase 0 — Make testing cheap `TEST-01 … TEST-04` — **TEST-03 still open**

Everything after this is gated on it. Today, exercising an endpoint means hand-
starting Postgres, running migrations, minting a JWT with a shell script and
tearing it all down — which is why it rarely happens.

| ID | Work | Done when |
|---|---|---|
| **TEST-01** | One command brings up Postgres, migrates, seeds deterministic fixtures, starts both servers, and tears down on exit. `pnpm test:stack` | A cold clone runs the full suite with one command |
| **TEST-02** | Go handler harness: `httptest` server over the real router with a test database, plus a helper that mints tokens for each role | Any of the 65 routes can be exercised in ~5 lines |
| **TEST-03** `[ ]` | Next route-handler harness: call the exported `GET`/`POST` with a constructed `Request`, against a test database | Any of the 21 methods testable without a browser |
| **TEST-04** | CI runs Playwright; coverage is reported per package with a ratchet that can only go up | A PR that drops coverage fails |

**Done 2026-08-17.** `scripts/test-stack.sh` brings up Postgres 17 on a
non-default port, migrates (not `db push` — ADR-014), seeds, optionally starts
both servers, and prints the exports each suite needs. `--serve` and `down` are
one flag apart, and `down` destroys the volume: these suites truncate tables, so
the database must be one nobody minds losing. The Go handler harness is
`auth_gate_integration_test.go` — a real chi router, a real database, a token
minted the way login mints one. Playwright now runs in CI on a Pixel 7 viewport.

**TEST-03 was not built** and is deliberately left open. Phase 1 tested the
`lib/` modules directly, which needed no route harness; the harness is only
required once Phase 3 starts driving the 21 route methods, so it belongs there
rather than as speculative scaffolding. **Do it as the first item of TEST-16.**

**Findings:** none. This was scaffolding, as expected.

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

## Phase 2 — Money `TEST-10 … TEST-14`

The arithmetic is at 93%. The **paths around it** are the gap: 66 repository
methods, 26 tests.

| ID | Target | Cases |
|---|---|---|
| **TEST-10** | Every exported repository method | one happy path plus one failure path each; enumerate from the source so none is missed |
| **TEST-11** | Concurrency, extended | the existing pattern applied to *every* balance-touching method — deposit, withdrawal, donation, repayment, disbursement, waterfall — not just the four already covered |
| **TEST-12** | BigInt boundaries | 0 · 1 · `MaxInt64` · overflow on sum · negative rejected at every entry point · a deposit that would overflow the account total |
| **TEST-13** | Default waterfall, exhaustively | no guarantor · guarantor with 0 · guarantor with less than the shortfall · exactly the shortfall · more · multiple loans against one guarantor · donation pool empty · residual debt arithmetic |
| **TEST-14** | Audit completeness | **assert that every method that changes a balance writes exactly one `audit_logs` row**, driven off the same enumeration as TEST-10. Rule 6 in CLAUDE.md is currently enforced by review only |

**Expected findings:** unaudited mutations, missing negative-amount guards on
the less-travelled methods, and at least one lost-update variant in a method the
2026-08-17 pass did not reach.

---

## Phase 3 — Every HTTP contract `TEST-15 … TEST-19`

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

**Expected findings:** the highest yield in the plan. Missing role checks,
missing 404s, over-broad payloads, and lifecycle transitions the state machine
does not actually guard.

---

## Phase 4 — Domain rules `TEST-20 … TEST-22`

| ID | Target |
|---|---|
| **TEST-20** | One test per FR-01…22 in [product.md](product.md), named for the requirement, so the doc and the suite cannot drift |
| **TEST-21** | The Shariah invariant, mechanically: no rate, markup or fee field reachable from any money path; total repaid can never exceed principal, property-tested over random schedules |
| **TEST-22** | Lifecycle state machines: loan `PENDING_GUARANTOR → … → COMPLETED`, withdrawal request → process → confirm. Every illegal transition rejected. Collapse the legacy `PENDING`/`APPROVED` values while you are here |

**Expected findings:** partially-implemented FRs currently marked `[~]`, and
illegal transitions that succeed because nothing checks them.

---

## Phase 5 — Generated documents `TEST-23 … TEST-25`

Members keep this paper. A wrong number here is argued about at a counter.

| ID | Target |
|---|---|
| **TEST-23** | All four builders against golden models: statement, receipt, loan agreement, certificate |
| **TEST-24** | **HTML and PDF renderers cannot drift** — same model, same visible content, asserted structurally rather than by pixel |
| **TEST-25** | Amount formatting at boundaries (0, lakh, crore) · pagination at the page break · long names and addresses · English-only enforcement (ADR-012) · document numbers from `document_sequences` only (ADR-013) |

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
| `pnpm test:unit` | nothing | pure TS: validation, formatting, ids, document numbers |
| `pnpm test:go` | nothing | pure Go: money arithmetic, utils, middleware |
| `pnpm test:integration` | Postgres | repositories against real SQL, real transactions, real concurrency |
| `pnpm test:e2e` | full stack | browser journeys, on a phone viewport |

The split is deliberate: the first two must stay fast enough to run on every
save, so nothing that needs a database belongs in them.
