# Testing

The standing guide: how the suites are split, where a new test goes, what the
fixtures guarantee, and what is deliberately not covered.

Nine phases (`TEST-01 … TEST-43`) built this and are all closed; what each found
is one line per phase in [changelog.md](changelog.md). This file is what you need
*before* writing a test, not the record of past ones.

---

## The suites

| Command | Needs | Covers |
|---|---|---|
| `pnpm test:unit` | nothing | pure TS: auth primitives, error classification, validation, formatting, ids, document numbers, the four document builders and both renderers, EN/BN message parity, the FR three-way check, the CSP policy builder and its route tiering, the SEO metadata and JSON-LD builders, and the source censuses — foreign-key index coverage, the settings keys pages read, **every form that posts a money `amount`** (found by walking `app/`, `components/` and `lib/` rather than by a hand-written list, which is how the previous version went on passing while two screens rounded paisa into the ledger), and the count of `dangerouslySetInnerHTML` that [ADR-024](decisions.md) rests on |
| `pnpm test:go` | nothing | pure Go: money arithmetic (incl. 400k property iterations), utils, middleware, the email transport's timeout budget, chi-square uniformity of generated passwords and codes, the lockout escalation table, and the source census that every rate-limited action is a declared constant with a policy |
| `pnpm test:integration` | Postgres | repositories against real SQL, real transactions, real concurrency; the database's own CHECK constraints; **the ledger reconciliation, with a drift planted for every invariant it claims to check**; the Go route contract and hostile-input sweeps. **CI runs this under `-race`** |
| `pnpm test:routes` | Postgres | the Next route methods driven directly — no browser, no server. Plus success paths: a real dispute, a real registration with Cloudinary stubbed, the support proxy's allow-list and per-member limit |
| `pnpm db:migrate:check` | Postgres | the migrated database still matches `schema.prisma`. CI runs it after `db:migrate` |
| `pnpm test:e2e` | full stack | browser specs: journeys, forms, registration, the layout matrix (phone/desktop × en/bn), accessibility, **zero CSP violations across every page and both dashboards**, and **how many background requests one open dashboard tab makes in a minute** |
| `node apps/web/scripts/assert-static-routes.mjs` | a completed `pnpm build` | that the marketing routes are still prerendered and no dashboard or auth route is. Reads `.next/prerender-manifest.json`; CI runs it right after the build |
| `pnpm test:bundle` | a completed `pnpm build` | first-load JavaScript per route against `bundle-budget.json`, failing on >10% growth, an unrecorded route, or a recorded route the build no longer produces. Reads `.next/diagnostics/route-bundle-stats.json` — the bundler's own answer. Accept a real cost with `pnpm test:bundle:update` |

**Two things about the auth suites are worth knowing before you add to them.**
`securityRouter` in `cmd/server/auth_security_integration_test.go` builds a
router with a **configured** email service (Brevo stubbed in-process), because
with no email service every identifier gets the same 503 and an oracle test
passes without the fix. And every response comparison goes through `answerOf`,
which drops `meta.timestamp` — otherwise "these two answers are identical" is a
statement about the clock. Assertions about `audit_logs` count a **delta**: the
append-only trigger means a test cannot delete its own rows
([traps.md](traps.md)).

**The split is load-bearing.** The first two must stay fast enough to run on
every save, so nothing needing a database belongs in them — which is why
`test:routes` is a second vitest project rather than an addition to the first.

### Running the database-backed ones

```bash
scripts/test-stack.sh up          # Postgres on :55433, migrated, seeded
eval "$(scripts/test-stack.sh env)"
pnpm test:integration && pnpm test:routes
scripts/test-stack.sh down        # destroys the volume
```

`up --serve` also builds and starts both apps, for `pnpm test:e2e`.
`pnpm test:stack` is the same thing through the package script.

**Never point this at a development database.** These suites truncate tables and
`down` destroys the volume — that is the point, not a hazard to work around.

**They share one database and run in any order**, deliberately: the Go suites
truncate every table between tests, so anything depending on rows another suite
left behind would pass or fail on package ordering.

---

## Where a new test goes

| What you are testing | Put it here | Needs |
|---|---|---|
| a pure function in `lib/` | `apps/web/lib/<module>.test.ts` | nothing |
| pure Go arithmetic | `apps/api/internal/<pkg>/*_test.go` | nothing |
| a cross-file invariant read off disk | `apps/web/test/unit/*.test.ts` | nothing |
| SQL, a transaction, a race | `apps/api/internal/repositories/*_integration_test.go` | Postgres |
| a Go HTTP contract | `apps/api/cmd/server/routes_integration_test.go` | Postgres |
| **what an auth endpoint discloses** | `apps/api/cmd/server/auth_security_integration_test.go` | Postgres |
| a Next route handler | `apps/web/test/routes/*.test.ts` | Postgres |
| **who owns a contact, and what a deletion takes with it** | `apps/web/test/routes/identity-integrity.test.ts` | Postgres |
| **how long identity data is kept** | `apps/api/internal/repositories/retention_integration_test.go` | Postgres |
| a document builder or renderer | `apps/web/lib/documents/*.test.ts` | nothing |
| a screen, a form, a layout | `apps/web/e2e/*.spec.ts` | the full stack |
| **a URL shape, a redirect, or a middleware header** | `apps/web/e2e/locale-negotiation.spec.ts` | the full stack — never a unit test, see traps.md "Locale routing" |
| **what a reader in one language actually sees** | `apps/web/e2e/locale-content.spec.ts` | the rendered page. A source census cannot see copy that was never in a message file, and a database value is not the code's to assert — so this reads `document.body.innerText`, strips the public settings' own values, and fails on Bengali left on an English page. The language toggle is here too, because only a click distinguishes a working switch from one that builds a 404 |
| **whether a rule still holds across the whole tree** | `apps/web/test/unit/*.test.ts` as a *census* that walks the source | nothing |

## The fixture contract

1. **Namespace everything you seed to your own suite** — ids, phones, emails,
   `accountNo`. Both contract suites originally seeded `accountNo = 'RT-MEMBER'`
   and whichever ran second died on `users_accountNo_key`: invisible when either
   ran alone, therefore invisible until CI ran both.
2. **Seed what you need; never depend on what another suite left.**
3. **Upsert rather than truncate** in the browser fixtures — they share the
   database with the Go suites, and clearing it out from under them is the same
   ordering bug from the other direction.
4. **Never suppress stderr on a setup step.** A failed fixture insert that looks
   like success turns into an auth failure blamed on the token.
5. **The browser fixtures refuse a non-localhost `DATABASE_URL`**
   (`assertDisposableDatabase`). They write balances; the mistake is one pasted
   environment variable away.
6. **Assert on a *delta* of `audit_logs`, never an absolute count.** The table is
   append-only and the trigger refuses a `DELETE`, so rows your suite wrote on
   previous runs are still there. A test that expected exactly one
   `MEMBER_ERASED` row passed once and then found three. Read the newest row and
   compare counts before and after.

## Writing an assertion that stays true

- **Some questions can only be answered by an artifact.** "Is this route
  static?" is a conclusion `next build` draws after following every import in a
  page, its layout and every component it renders — no test that reads the
  source can know it, and a grep for `export const revalidate` would pass on
  exactly the regression it was meant to catch. Same for "does this CSP break
  the app": a header assertion cannot see a blocked bootstrap script, and only a
  real browser can. Prefer the artifact when the source cannot answer.
- **Enumerate, do not list.** Twenty-one suites and two CI checks derive their
  coverage from the source and fail the build when the code grows something they
  do not know about. The table of what each one demands is in
  [CLAUDE.md](../CLAUDE.md) — read it before adding a route, a balance writer, a
  notification, a message key or a schema field.
- **A regression test must be seen to fail first**, with the symptom it
  describes. And revert the *whole* fix to check — restore from
  `git show HEAD:<path>` rather than editing back what you remember changing.
- **A route contract proves who may call a route, not what it returns.** Every
  route in the contract table wants at least one row driving it to a 2xx;
  `success-paths.test.ts` is where those live.
- **Test behaviour at the boundary, not implementation.** A test that breaks when
  you rename a private helper is a liability.
- **A found bug is fixed in the same batch**, not filed.
- **If a test is hard to write, that is a finding** — usually the seam is in the
  wrong place. Extracting `mountRoutes` and `mountMiddleware` from `main()` is
  what made the routes and the middleware stack testable at all.
- **Flaky is failing.** Fix the cause or delete the test.
- **In a browser, use the retrying matchers.**

More failure modes, with the stories behind them: [traps.md](traps.md) —
especially *Tests and evidence* and *Browser suites*.

## When something fails and you cannot see why

- `.test-stack/api.log` and `.test-stack/web.log` hold the server output. Start
  with `grep -c 429 .test-stack/api.log`.
- `playwright-report/` and `test-results/` carry a screenshot, a video and a
  trace for every failed spec. Video is off by default (`PWVIDEO=1`) — it costs
  an ffmpeg process per test.
- Go integration failures print the seeded ids; query directly with
  `docker exec hn-test psql -U postgres -d hasnahena_test`.
- **Check `uptime` before believing a browser failure.** A Playwright run starved
  of CPU produces timeouts that read exactly like defects.

---

## What is deliberately not covered

Not everything absent is a gap. These are decisions:

| Not covered | Why |
|---|---|
| Brevo actually delivering mail | Testing a third party's SMTP proves nothing about this code. The message and the transport are both tested against stubs; delivery is an operational check on the go-live list |
| Load and stress testing | Out of scope in [product.md](product.md). 240 sustained postings is the ceiling this workload needs |
| A generic accessibility audit | See the reasoning in `e2e/accessibility.spec.ts` — four specific checks beat a long advisory list nobody actions |
| Cloudinary against the real account | It holds members' NID scans. The client is stubbed and the compensation path driven end to end |

**One known hole.** `e2e/admin-dashboard.spec.ts` skips unless
`E2E_ADMIN_IDENTIFIER` and `E2E_ADMIN_PASSWORD` are set, and neither
`test-stack.sh env` nor the CI e2e job sets them — so it has **never run in any
environment** and is the "1 skipped" in every report. `journeys.spec.ts` already
signs in as an admin through the fixtures and asserts more, so this is redundant
rather than missing coverage. Wire it to `ACCOUNTS.ADMIN` or delete it: a
permanently-skipped spec is worse than no spec, because it reads as covered.

## Measured, so a regression has something to compare against

Observations, not thresholds — a budget invented before anything is slow is a
number nobody trusts. Taken on the author's machine.

| | Measured |
|---|---|
| Sustained postings | ~180/s, six concurrent writers, four contended accounts, reconciling exactly |
| List read | 1–2 queries, flat in row count |
| Member dashboard read | 5 queries, flat in history length |
| Go integration suite | ~8 s; ~40 s under `-race` |
| Web unit suite | ~6 s for 556 tests across 30 files |
| Next route contracts | ~3 s |
| Browser suite | 153 passed + 1 skipped, 10.8 min, one worker, on an idle machine |
| Largest client bundle | `/[locale]/dashboard/{worker,admin}/transactions`, ~1.41 MB uncompressed first-load JS — the same figure twice, because they are the same component. Recorded, not endorsed — see `bundle-budget.json` |

---

## The rule that makes a regression test worth writing

**A regression test must be seen to fail against the pre-fix code before it is
allowed to pass.** Put the defect back, watch the test go red, then restore the
fix. A test written after the fix and never seen red proves only that it
compiles — and this repository has caught two of those: a census whose regex
matched its own documentation, and a language-toggle spec that clicked the logo
instead of the button because Playwright matches an accessible name by
substring. Both were green and both were checking nothing.

When a test genuinely *cannot* be made to fail — a guard against something the
type system already prevents, say — say so in the test itself, so the next
reader does not go looking for the red run that never happened.

