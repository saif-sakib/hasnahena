# Traps

Every entry here was found by something breaking, most at runtime rather than at
build time. They are grouped by **what you have to be touching to hit one**, so
skim the heading that matches your task and ignore the rest.

This is the only file that keeps them. If you are about to add a lesson to
another doc, add it here and link instead.

---

## Money and concurrency

- **An invariant enforced only in application code is a claim about today's
  code.** This schema had no CHECK constraint at all, and two backends writing
  the same tables. Measured against the unconstrained database: it accepted a
  negative savings balance, a zero-amount posting, a loan owing more than its
  principal, and **a loan carrying an application fee** — the last one a rule-3
  violation that only a test stood between. Put the invariant where neither
  service can go around it (WO-69).
- **A balance written absolutely is a lost update.** Read the balance, add in Go,
  write the total back, and twenty concurrent ৳1,000 deposits leave ৳1,000 with
  ৳20,000 of ledger rows. Write it relatively (`SET "x" = "x" + $1 … RETURNING`)
  or read it `FOR UPDATE` inside the same transaction ([ADR-015](decisions.md)).
  A *check* against a balance belongs in the same statement as the write
  (`WHERE "remainingAmount" >= $1`), not a line above it.
- **One question, one function — or the same page gives two answers side by
  side.** "Is this loan overdue?" was answered by whichever date column the query
  nearest to hand happened to have. `/worker/loans` sent `installmentStartDate`
  as `nextDueDate`, which is behind every active loan by construction, so every
  borrower showed as overdue; `/admin/loans` sent no due date at all, so none
  did; the member's own history sent `expectedEndDate`, the day the *last*
  instalment falls due. The two staff lists are literally the same React
  component, so the disagreement was visible as "0 overdue" and "4 overdue" on
  one screen depending on who opened it. The arithmetic now lives once, in
  `internal/money`, and the API sends the answer rather than the ingredients —
  the browser deriving it again is how a second implementation gets created.
- **An aggregate with no status filter counts intentions.** Rule 6a, and it
  recurs: the admin dashboard summed every `DEPOSIT` row as "Total Deposits"
  (a PENDING deposit is a *request*) and every `principalAmount` as "Loans
  Disbursed" (including REJECTED applications), while the worker's dashboard
  next door filtered on `CONFIRMED`. Also watch the *set* of statuses, not only
  its presence: `GetLoanStats` filtered on `('ACTIVE','COMPLETED','DEFAULTED')`
  and omitted `SETTLED`, so a loan closed against a member's savings disappeared
  from the disbursed total and from the recovery rate at once. Name the set in
  one constant and interpolate it.
- **A fix applied from memory covers the methods someone thought of.** ADR-015
  was written, reviewed and applied to four balance writers. The fifth — loan
  repayment — kept the bug for months and was found only when a census
  re-derived the list from the source. Enumerate from the code, never from recall.
- **Integer division loses money.** `amount / installments` stored 3,333 for a
  ৳10,000 loan over 3 months, while the PDF printed an adjusted final
  installment — so the signed contract and the stored schedule disagreed and the
  loan could never reach zero. `money.InstallmentPlan` returns both figures.
- **A `transactions` row is not necessarily money that moved.** A `PENDING`
  withdrawal is an intention and a `PENDING` deposit is a request. Four
  aggregates were counting intentions as income. Filter on status
  ([ADR-016](decisions.md)). Still true after [ADR-030](decisions.md) removed the
  notice: staff can pay without a `PENDING` row, and a `PENDING` row can sit
  unpaid, so neither direction lets you skip the filter.
- **The same function can write one correct record and one wrong one.** Every
  posting wrote an audit line with `%d BDT` — correct — and a member
  notification with `BDT %.2f` from a `float64`. A test reading either alone
  would have passed the code. The int64 ceiling rendered as `…808.00`.

**A ledger row is not proof that money moved, and money moving is not proof of a
ledger row.** `waterfallRecoveryTx` inserted its three default-recovery rows with
no `status` column, so they took Prisma's default of `PENDING` — while the
savings had already been deducted in the same transaction. Every aggregate that
correctly filters on `CONFIRMED` (ADR-016) therefore under-counted a recovery
that had happened. The same function reduced `loans."remainingAmount"` and never
touched `accounts."loanBalance"`, so a member whose savings were taken to settle
a default kept seeing the whole debt — permanently, because nothing recomputes
that column. Neither failed any of the four existing waterfall tests: they
asserted savings and ordering, which were right. **Summing the ledger is the only
check that asks the question those tests do not** (WO-82).

**A disputed posting is money that moved.** Disputing a `CONFIRMED` transaction
flips its status and changes no balance. Any reconciliation, aggregate or report
that treats status as a proxy for "did this happen" has to decide about
`DISPUTED` explicitly — [ADR-026](decisions.md).

## Connection pools and transactions

- **Reading config from the pool inside a transaction deadlocks it.** With N
  goroutines and a pool of N, every connection is held by an open transaction and
  every transaction waits for a free connection to read a config key. Nothing
  errors and nothing times out — the suite hangs until the framework kills it.
  Use the `…Tx` readers inside a transaction ([ADR-017](decisions.md)).
- **`&&` short-circuiting can hide a latent deadlock for weeks.** The same shape
  already existed behind `activeLoan > 0 &&`, false in the common case. The test
  that eventually exposed it had been green the whole time, over code one boolean
  away from hanging.

## Prisma and migrations

- **Two definitions of one table will disagree, and `IF NOT EXISTS` makes the
  disagreement silent.** The Go API ran `CREATE TABLE IF NOT EXISTS` at boot for
  four tables `schema.prisma` also owns. On any database that already had them
  the DDL was a no-op, so the divergence was invisible — until it wasn't:
  `document_sequences."updatedAt"` was `NOT NULL DEFAULT NOW()` in the bootstrap
  and `NOT NULL` with no default in the migration, which is the shape that once
  broke all four money flows at once as a generic 500. A second index with the
  same name went further: the bootstrap's covering variant had **never existed
  anywhere**, because migrations run first and the second creator does nothing.
  It read like an optimisation and was a no-op (WO-70).
- **Dropping an enum label is a runtime error in every query that still names
  it, and nothing compiles it.** Collapsing the legacy `LoanStatus` values missed
  three occurrences: the ones found read `IN ('APPROVED','ACTIVE')` and the ones
  missed read `IN ('APPROVED', 'ACTIVE')` — one space. A grep finds what you
  thought to grep for. `enum-literals.test.ts` re-derives both sides instead and
  asserts every member of a comparison list shares one enum; `'APPROVED'` looks
  legitimate label-by-label, because it is a `RequestStatus`, and is still
  nonsense next to a `LoanStatus`.
- **`prisma migrate diff` generates a shape, not a data migration.** For the
  Block S change it emitted, in order: an enum swap with no `UPDATE` first (fails
  outright the moment a row holds a removed label), a `DROP COLUMN
  users."presentAddressId"` with no backfill into the new column (discards every
  member's present address), and `ADD COLUMN … NOT NULL` with no default (fails
  on any existing row). Read generated migration SQL before applying it, and
  write the data steps yourself.
- **`@updatedAt` emits no database default.** Neither `db push` nor a generated
  migration writes one — Prisma applies it client-side. Hand-written SQL must set
  `"createdAt"` and `"updatedAt"` itself, or the first insert fails a NOT NULL
  check. This broke *all four* money flows once, as a generic 500.
- **Two backends write these tables, so a schema-level fix is half applied until
  you grep the other one.** The Go document-number allocator named both columns
  for months; the TypeScript one did not, so no loan application could ever be
  created — the first `INSERT` of a series each year failed and the `ON CONFLICT`
  branch was never reached.
- **`prisma migrate` needs a direct, non-pooled Neon connection.** PgBouncer
  cannot hold the session advisory lock and the failure looks like a **hang**,
  not a wrong-host error. `pnpm db:migrate` derives the direct host and logs it.
- **Timestamps are `timestamp without time zone`.** `NOW()` stores the session's
  wall clock; pgx reads it back as UTC. On a non-UTC server a revocation marker
  reads hours in the future and every new token is born revoked. The pool pins
  `timezone=UTC`. Neon defaults to UTC — a VPS will not.
- **Triggers are invisible to Prisma.** `migrate diff` cannot see the `audit_logs`
  immutability trigger, so a later `--from-empty` baseline would drop it
  silently. That is also why it is not reported as drift by `db:migrate:check`.

**`prisma migrate diff` cannot see a rename.** Renaming `users.memberId` to
`users.accountNo` generates `DROP COLUMN "memberId"` followed by
`ADD COLUMN "accountNo"`, which is a migration that discards every member's
account number and reports success. `ALTER TABLE … RENAME COLUMN` carries the
data, the unique index and the constraint across untouched, and has to be written
by hand. Third time in this project: the addresses relation and the `LoanStatus`
enum needed the same treatment, for the same reason.

Postgres also does **not** rename the dependent index, so
`users_memberId_key` keeps its old name over a column that no longer exists
under it. `ALTER INDEX … RENAME` separately, or the next drift check compares an
index name against a schema that disagrees.

## PostgreSQL clients

- **`/usr/bin/pg_dump` is not a binary.** On Debian and Ubuntu it is
  `pg_wrapper`, which resolves to the version of the **configured cluster** and
  only falls back to "newest installed" when there is no cluster. GitHub's
  `ubuntu-latest` ships a PostgreSQL 16 *server*, so installing
  `postgresql-client-18` changes nothing and `pg_dump --version` keeps answering
  16 — which is how the nightly backup failed against a 17.11 Neon server with a
  new-enough client already on disk. Resolved by absolute path in
  [scripts/lib/pg-client.sh](../scripts/lib/pg-client.sh) and on `PATH` by
  [.github/actions/postgres-client](../.github/actions/postgres-client). **A bare
  container with no cluster does not reproduce this** — the wrapper picks
  correctly there, which is what makes the bug look like a failed install.

## Test stacks and stale processes

- **`test-stack.sh up --serve` will not replace a server that is already
  answering.** It polls `/v1/health` and moves on, so an API left running by an
  earlier session keeps serving — and a full green browser run then proves
  nothing about the code you just wrote. `down` first, or check the process start
  time against when you made your changes.
- **`next dev` hot-reloads, `go run` does not.** So the web half of a stale stack
  is usually current and the API half is usually not, which makes the symptom
  look like a frontend/backend contract bug rather than a stale binary.
- **`down` used to leave the API running and say it had not.** `go run` compiles
  to a temp binary and execs it as a **child**, so the recorded pid was the
  wrapper's and `pkill -f "cmd/server/main.go"` matched nothing either — the
  child's command line is `/tmp/go-buildNNN/b001/exe/main`. Fixed 2026-08-19: the
  script builds to `$RUNDIR/api-bin` and runs that directly, and `stop_servers`
  sweeps anything still holding either port, because a pid file only knows about
  processes this script started.

## Docker

- **`.dockerignore` does not use git's matching rules.** Docker matches each
  pattern against the full path from the context root, so a bare `.env` covers
  only the repository root and `apps/web/.env` stayed in the context. Every
  pattern needs an explicit `**/`. This is a **secret-containment** control, not
  tidiness: a file that reaches an image layer is not removed by a later `RM`.
- **`node:*-slim` ships no OpenSSL.** Prisma cannot detect a version, warns, and
  falls back to `openssl-1.1.x` — wrong for bookworm. Install `openssl` in both
  the deps and runtime stages.
- **`@swc/helpers` is only half-traced.** Next 16 resolves it through the
  package's `exports` map at `./esm/*`; the tracer follows the CommonJS entry and
  copies `cjs/` only. The container dies at startup, before serving one request.
  Named explicitly in `outputFileTracingIncludes`.
- **`NEXT_PUBLIC_*` is baked at build time** — including for server-side route
  handlers. A value supplied at `docker run` is too late; in Docker it is a
  `--build-arg` that `-e` cannot override.
- **`docker compose --env-file` must come before the subcommand**, and Compose
  interpolates the *entire* file even for `up -d postgres` — so a `:?` default on
  an unrelated service fails a command that does not use it. Use `:-`.
- **`DATABASE_URL` is hard-coded to the `postgres` service in
  `docker-compose.yml` on purpose.** `.env.local` holds the production Neon URL;
  interpolating it would point the one-shot migrate container at production and
  run `db:seed` against real member data.
- **A Dockerfile that has never been built is a hypothesis.** Static review
  caught none of the three defects above.

**Making a page static moves its database reads into the build.** WO-73
prerendered the marketing pages; `apps/web/Dockerfile` builds with
`DATABASE_URL` pointing at a placeholder database that does not exist, on purpose
— `prisma generate` parses the URL and never connects. The next image build died
with `Export encountered an error on /[locale]/donate/page` and exit code 1. Two
of the eight pages had their own `try` and survived, which made it look like a
bug in the other six. **A page that can be prerendered must render without a
database** — [ADR-028](decisions.md).

## Next, React and the build

- **A single click can fire a handler and then submit the form, when a
  conditional swaps a button's `type` in place.** `{!isLastStep ? <Button
  type="button" onClick={next}/> : <Button type="submit"/>}` is one `<button>` in
  one slot as far as reconciliation is concerned, so React mutates `type` on the
  node the member just clicked. `next` is `async`, and the continuation after
  `await trigger(...)` runs as a **microtask — before the browser performs the
  click's default action**. So the state update lands, the node becomes
  `type="submit"`, and the browser then submits. One ordinary click, no double
  tap. Give the branches distinct `key`s — a new node has no pending default
  action.
- **React Hook Form's `shouldFocusError` defaults to true and will fight your own
  scrolling.** It focuses the first errored field, which scrolls it into view —
  and on a long step that can be the *last* control on the page. On the
  registration form a blocked submit sent the member to the bottom with the four
  document slots off-screen above them. A form that reveals its own errors has to
  turn it off.
- **`next-env.d.ts` churns on every run and must not be tracked.** `next dev`
  writes `import "./.next/dev/types/routes.d.ts"`; `next build` writes
  `import "./.next/types/routes.d.ts"`. A tracked copy therefore shows as
  modified after whichever command you ran last, forever. Next's own docs say to
  gitignore it. It stays in the tsconfig `include` array — tsc tolerates a listed
  file that does not exist.
- **`outputFileTracingIncludes` must stay top-level.** Next 15 promoted it out of
  `experimental` and only *warns* if you leave it behind — which silently ships
  an image with no Prisma engine that dies on the first query.
- **The Tailwind 4 codemod deletes `tailwind.config.ts` and does not carry
  `plugins:` across.** `tailwindcss-animate` stopped loading and Tailwind
  compiles unknown utilities away without complaint — 81 classes across 17 files,
  every Radix animation, would have become dead strings. Restored with `@plugin`
  in `globals.css`.
- **Next 16 removed `next lint`** and does not fail usefully: it reads `lint` as a
  directory name and reports "no such directory .../lint".
- **`output: 'standalone'` is gated behind `DOCKER_BUILD=1`** so a Docker concern
  cannot change what `pnpm build` emits for Vercel.
- **The React Compiler config is top-level `reactCompiler` in Next 16.** The old
  `experimental.reactCompiler` key is silently ignored.
- **`unstable_cache` serialises what it stores, so a `Date` comes back a
  string.** Typed as `Date` it compiles, and it works — on the cache *miss*.
  The *hit* returns the JSON round-trip, and the build died on
  `item.date.toISOString is not a function` at the second render of the
  homepage. Normalise at the accessor boundary so there is one type, and be
  aware that every wrong-on-the-second-render bug has this shape: local checks
  pass, the first deploy looks fine.
- **`generateStaticParams` on a locale segment applies to the entire subtree.**
  Adding it so the marketing pages could be prerendered swept in every dashboard
  route as well — the build emitted `● /en/dashboard/member`. Nothing leaked,
  because those pages fetch with the reader's own token, but that is a property
  of how they are written rather than a rule. `export const dynamic =
  'force-dynamic'` on the dashboard layout states it, and
  `scripts/assert-static-routes.mjs` fails the build on a route that becomes
  static in either direction.
- **An unwrapped `useSearchParams` fails the *build* the moment its route can be
  prerendered.** It is legal while everything is dynamic and becomes a hard
  error the day something upstream makes the route static — which is how
  `/reset-password` broke a build it had nothing to do with. A `<Suspense>`
  boundary is the fix and the better page anyway.
- **`revalidateTag(tag)` with one argument is deprecated in Next 16**, and the
  replacement is not one call but two: `updateTag(tag)` in a Server Action,
  which expires immediately and is what read-your-own-writes needs, and
  `revalidateTag(tag, profile)` everywhere else — where `'max'` is
  stale-while-revalidate and will show an admin the value they just replaced.
  `{ expire: 0 }` is the immediate form for a route handler. `updateTag` throws
  outright if called from one.

## Composition — a correct function defeated by what surrounds it

- **chi's `RealIP` destroyed the rate limiter's input three middlewares before it
  ran.** `clientIP` was right, was unit-tested, and carried a comment explaining
  exactly why the leftmost `X-Forwarded-For` entry must never be trusted — and
  the limiter still keyed on that entry, because `RealIP` had already written it
  into `r.RemoteAddr`. **Nothing about the function was wrong; the stack around
  it was.** The test that catches this had to drive the whole stack, which is why
  `mountMiddleware` was extracted from `main()` ([ADR-019](decisions.md)).
- **Three handlers had their own copy of the same decision.** The login lockout
  counted failed attempts against the caller-supplied end, so varying one header
  stepped around it entirely. When a fact about a request is security-relevant,
  resolve it **once**, in middleware, and put it in the context.
- **A guard was invalidated by a row added later in the same file.** `seedAdmin`
  refuses to skip on a database with no admin, testing `role IN (ADMIN,
  SUPER_ADMIN)`. Then `seedDonationPool` was added below it, creating an owner
  with `role: ADMIN` — INACTIVE, with a password hash bcrypt can never match.
  From that day the guard passed on exactly the databases it existed to catch.
  **A role is not a capability**: if the question is "can somebody log in as an
  admin", the predicate has to say so.
- **Watch for a safety net positioned where it can never be reached.** SEC-11's
  `fetchUserFromApi` fallback *would* have been blacklist-checked — it only ran
  when `JWT_SECRET` was unset, i.e. never in a correct deployment.

## Tests and evidence

- **The defects that moved money were found by running the code, not by reading
  it.** Every audit that reviewed those files by eye passed them. A green suite
  bounds only the cases it contains — 17 integration tests were green while two
  defects destroyed money, because the suite never ran two postings concurrently
  and never seeded a loan without a guarantor. Coverage measures what was
  *executed*, never what was *checked*.
- **A green secret scan is not evidence that history is clean.** gitleaks looks
  for credential *patterns*, not for documents that should never have been
  committed. It has always passed on this repository, which has 39 member-record
  files in its history.
- **A route contract proves who may call a route, not what it returns.** The
  worst finding of the 2026-08-18 audit sat behind a test that drove the route
  with a non-existent id and asserted the 404. Every authorization case passed;
  the success path had never run.
- **A list of things to cover goes stale the day it is written; an enumeration
  does not.** Prefer a census derived from the source over any list a human
  maintains — see the table in [CLAUDE.md](../CLAUDE.md).
- **"Revert the fix and watch it fail" only counts if you reverted the whole
  fix.** Removing one guard left the new `FOR UPDATE` in place and the test still
  passed, which briefly looked like a weak test rather than a partial revert.
  Restore from `git show HEAD:<path>`, not by editing back what you remember.
- **Some defects cannot be reproduced by a test, and saying so is part of the
  fix.** A floating `prisma.notification.create(...)` settles anyway under Node,
  so the obvious test passes against the broken code. The *regression* guard is a
  source census; write the note in the test, or the next reader will trust it.
- **An `httptest` handler that does not drain the request body cannot tell that
  the client has gone**, so `r.Context()` stays live and `Server.Close` blocks on
  it — the suite hangs with no failure and no output. `net/http` learns of the
  peer's departure from a read on the connection, and an unread body is what that
  read returns instead. `io.Copy(io.Discard, r.Body)` first, then block.
- **`golangci-lint` compiles the test files too, with `build-tags: integration`.**
  A new `_test.go` helper colliding with one in a tagged file in the same package
  is green under `go test` and `go build`, and shows up as a `typecheck` finding
  that reads like a configuration problem. It is a real redeclaration only the
  tagged build sees.
- **A detector must search code, not prose.** A rule forbidding the word "markup"
  in the money paths flagged `loan_repository.go` for its own header comment,
  which states the rule. A check that fires on its own documentation teaches
  people to delete the documentation. Strip comments first.
- **Suppressing stderr on a setup step turns a broken fixture into a passing
  test.** A failed `INSERT` of test users looked like success, and the resulting
  auth failure was blamed on the token.
- **A dead endpoint can look healthy in a test log.** A guarantor route's "invalid
  vs valid id" discrimination was cited as proof the handler worked — but the
  check read ids through a UUID regex that rejects every `cuid()`, so a fully dead
  endpoint passed. When a test discriminates, check *what* it is discriminating on.

**A green test that never reached the code proves nothing.** The first
`public-content-fallback.test.ts` asserted that `getPublicSettings()` returns
`{}` when the database is unreachable, and passed — with `findMany` called
**zero** times. Outside a Next server `unstable_cache` throws
`Invariant: incrementalCache missing`, and the `catch` under test swallowed it.
The fix is two lines: mock `next/cache` to a pass-through so the real query runs,
and assert the mock **was called**. Any test whose subject is an error path
should assert it reached the thing that was supposed to fail.

**A budget recorded from a build is a fact; a budget maintained by hand is a
wish.** `assert-bundle-budget.mjs` reads
`.next/diagnostics/route-bundle-stats.json`, which the bundler emits — "how much
JavaScript does this route ship" is a conclusion drawn after following every
import, and no test over the source can reach it. Same reasoning as
`assert-static-routes.mjs` reading `prerender-manifest.json`.

**An ordinary refusal reported as a 500 reads as a broken feature.**
(The two FR-08 refusals in this story no longer exist — [ADR-030](decisions.md)
deleted the notice period itself. The lesson is about error classification and
stands unchanged.) `WorkerAddWithdrawal` classified the repository's errors with
`strings.Contains(err.Error(), …)`. The two FR-08 refusals — no withdrawal
notice on file, notice not yet matured — matched no branch, so both arrived as
`500 WITHDRAWAL_FAILED "Failed to process withdrawal"`: the single most common
outcome of that screen, indistinguishable from a crash, which is how it was
reported ("admin member withdrawal is not working"). The same substring matching
also ordered `"active loan"` before `"guarantor"`, and
`"is guarantor for active loan"` contains `"active loan"`, so a guarantor was
told they had a loan of their own.

Two rules fall out. Classify errors with `errors.Is` over sentinels, never over
message text — substrings have no ordering guarantee and no compiler. And test
the **translation** from error to HTTP answer: the repository behaviour here was
thoroughly covered and every one of those tests passed while the endpoint
answered 500.

## Browser suites

- **A spec that passes alone and fails in the suite is shared state or a limit,
  not luck.** The e2e run tripped the API's 60-requests-per-minute limiter partway
  through, so the *later* specs rendered empty pages. It read as flaky ordering;
  `grep -c 429 .test-stack/api.log` said 91. A retry would have buried it
  permanently. `test-stack.sh` raises the limit now.
- **A Playwright run starved of CPU produces timeouts that read exactly like
  defects.** Four attempts at a one-pass run were killed by unrelated load. Before
  acting on a browser failure, check `uptime` and re-run the single spec alone.
- **Reading `innerText` once races every page that fills in its figures.** Use the
  retrying matchers (`await expect(locator).toContainText(x)`). Reading once made
  four working specs fail.
- **`nextjs-portal` is in the DOM and in the tab order, and is not the
  application.** `next dev` injects a dev-tools overlay absent from a production
  build. It has cost two sessions: once by matching a `"Next"` button locator,
  once by absorbing Tab presses and reporting no focus ring. Exclude it in any DOM
  sweep — and Next's route announcer is an always-empty `role="alert"`, so filter
  on `hasText: /\S/` when counting alerts.
- **Radix `Select` renders a hidden native `<select aria-hidden tabindex="-1">`**
  for plain-form submission. An accessibility sweep must respect `aria-hidden`, or
  it reports a false positive on every page with a filter.
- **`bringToFront()` does not background the other tab.** In headless Chromium
  the first page's `document.visibilityState` stays `'visible'`, so a spec
  written to prove that a hidden tab stops polling was measuring a *foreground*
  tab and reporting its ordinary polls as the failure. Redefine `document.hidden`
  and `visibilityState` and dispatch `visibilitychange` — that drives exactly
  what the browser drives and what a visibility hook subscribes to. Say in the
  test that it is a simulation.
- **`networkidle` never arrives on a page that polls.** It is the obvious wait
  and it times out at 30 s, which reads as a broken page rather than a busy one.
  `e2e/fixtures/session.ts` already carries a `waitForContent` that budgets it
  and moves on; use that.
- **Chromium reports `'upgrade-insecure-requests' is ignored when delivered in a
  report-only policy` to the console on every page load.** A spec that collects
  CSP violations by reading the console counts it as one, on every page. The fix
  is to omit the directive when the policy is report-only rather than to filter
  the message — a matcher with a special case is a matcher that will hide a real
  violation later.
- **Generous per-page waits multiply.** A helper that waits up to 25 s per page is
  fine once and fatal in a loop: a spec walking ten admin pages blew the 30 s test
  timeout and reported as a broken page rather than a slow one. Keep the helper's
  waits short, let the retrying assertions wait, and raise `test.setTimeout()` on
  sweeps. `next dev` compiles each route on first visit, so the first pass is slow
  in a way a production build never is.

## Interface

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
  [ADR-030](decisions.md) — but it took one edit in one file to remove, which is
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

**`x-default` is not the default locale.** This project's `defaultLocale` is
`bn`, because its members are Bengali. `x-default` answers the opposite question
— what to serve a reader the site was *not* built for — and there the answer is
`/en`. Writing `getLocalizedUrl(defaultLocale, path)` reads as the tidier version
of the same line and sends every unmatched reader in the world to a page they
cannot read. It compiled, and a test caught it.

**JSON-LD cannot be a text child.** React HTML-escapes text children, and HTML
entities are **not** decoded inside a `<script>` element, so every `"` in the
payload reaches the crawler as `&quot;` and the JSON is unparseable. Next's own
guide specifies `dangerouslySetInnerHTML` with `<` escaped to `\u003c`. That is
the one sanctioned sink in this codebase and `csp.test.ts` counts them, because
[ADR-024](decisions.md) rests on there being no others.

**One name for two things is a bug waiting for a rename to expose it.**
`memberId` meant the account number (`ACC-KH-33001`) in every response payload
*and* the member's cuid row id in every `/worker/members/{memberId}` route,
handler local and `PathValue` call. A blanket rename to `accountNo` compiled and
would have sent `PathValue("accountNo")` to a route still declaring
`{memberId}` — every member-detail request 400ing on an empty id, at runtime,
with the types perfectly happy. Classify each occurrence against the SQL it was
scanned from before renaming anything. The route parameter is `{memberUserId}`
now, which is what it always was.

## Go

- **A `Scan` with more destinations than the SELECT has columns fails every row,
  silently.** `GetWorkerTransactions` listed twelve columns and scanned thirteen,
  and the loop's error branch was `continue` — so the endpoint answered `[]` with
  a 200, no log line, and two worker screens that had never shown anything looked
  exactly like a worker who had processed nothing. `continue` on a scan error is
  how a column-count bug becomes an empty page instead of a crash; if you write
  one, count the columns first.

- **A startup context is not a background context.** `main.go` had a bare `ctx`
  that was a 10-second startup timeout; anything long-lived handed it runs exactly
  once and returns, silently. It froze the business gauges immediately — and a
  frozen gauge is indistinguishable from a calm system. It is `startupCtx` now,
  and `wiring_test.go` fails if a loop is started with it.
- **JWT `iat` is whole seconds.** A revocation marker timestamped to the
  microsecond makes a token issued 200 ms later compare as *older* and be born
  revoked. Revocation compares at second precision.
- **`% ` over a random byte is not uniform.** 256 does not divide by 10 or 62, so
  `digits[b % 10]` makes 0–5 4% likelier than 6–9 and the 62-character alphabet
  skews 21%. Use `utils.RandomString`, which rejection-samples. Both suites keep
  the biased version to prove a chi-square can tell them apart.

## Dependencies

- **Never take a major version through `pnpm update`.** A major is a migration:
  read its guide, do it on a branch, check it by hand. `tailwindcss` 3→4 broke the
  Vercel build that way.
- **After merging any dependency PR, run `pnpm install` and commit the
  regenerated lockfile.** Every such PR rewrites it, and merging two in a row
  leaves a lockfile that resolves neither — Vercel installs frozen and fails.
  The pre-push hook checks this; `--no-verify` skips it.

---

## Deleting a rule

**A rule you remove needs a test that asserts its absence, or nothing stops it
coming back.** [ADR-030](decisions.md) deleted the withdrawal notice period. Every
test that had covered it was deleted with it — which left a suite where
reintroducing the gate would break nothing, because no assertion said "this must
be paid". Two tests now do exactly that:
`TestWithdrawalWithNoRequestBehindItIsPaid` and `TestAFreshRequestIsPaidImmediately`.

The same shape applies to wording. `WithdrawalRequestReady` replaced a builder
that told the member their "notice period has elapsed", and its test row carries
`mustNotContain: ["notice"]` — because the natural way to write that message is
the way it used to read, and prose has no compiler.

**And check what the deletion strands.** Removing the two config readers left
`getSystemConfigNonNegativeInt64Tx` with no callers, which `golangci-lint`'s
`unused` catches; removing the member-side notice left an empty panel on the
staff member-detail screen, which nothing catches, because a card that says "no
notices outstanding" forever is valid code. Grep for the *concept*, not only for
the identifier.

---

## Locale routing

**A response whose target depends on a request header must send `Vary`.**
next-intl's middleware reads `Accept-Language` to decide whether `/` sends a
visitor to `/bn` or `/en`, and emits a 307 with `cache-control: public` and no
`Vary` of its own. As shipped that is cache-poisonable in the ordinary sense: a
shared cache may store the redirect computed for one visitor and hand it to the
next, so a member in Jashore lands on the English site because an English
speaker asked first. Cloudflare sits in front of production, which makes the
shared cache real rather than theoretical.

`proxy.ts` adds `Vary: Accept-Language` now, and `e2e/locale-negotiation.spec.ts`
holds it. The test is in the **browser** suite on purpose: `proxy.ts` is edge
middleware and the header it sets can be replaced further down the response
path, so the only honest check is what comes back over HTTP. Next does exactly
that on a rendered page — `/bn` comes back with Next's own `Vary` and not this
one, which is correct, because `/bn` is Bengali for everyone and its content
does not depend on the header.

**And know what it does not fix.** Search Console reporting
`/bn` as *"Duplicate, Google chose different canonical than user"* is a
different thing: `/` redirects to `/bn`, Google merges a redirect with its
target, and it often keeps the shorter URL. The content stays indexed under `/`.
Before blaming the canonical tags, check the two pages are not *actually*
duplicates — strip the tags and compare. Here they share 6% of their tokens and
`/bn` is 95% Bengali script, which ruled out the obvious suspect in one command
and stopped a day of edits to correct canonical tags.
