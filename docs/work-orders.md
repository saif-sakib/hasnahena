# Work Orders

Execution specs. [production-readiness.md](production-readiness.md) says *why* a
task exists; this file says *exactly what to change*, so a future session can act
without re-exploring the codebase.

Prompt with just the ID: **`do WO-57`** · `do WO-59 and WO-60`.

Line numbers are anchors, not guarantees — match on the quoted code, not the
number.

**No work order is open.** WO-62, WO-64, WO-65 and WO-66 — the last four —
closed on 2026-08-18, with WO-53 → WO-61 and WO-63 earlier the same day. That
is the whole of the 2026-08-18 code audit.

WO-58 fell out of WO-52, because once every notification message came from one
tested builder there was nowhere left for a `%.2f` to live; **WO-28 was closed
as a decision rather than a task** ([ADR-018](decisions.md)) after the owner
reviewed the `Official Infos/` files and determined none of it is live member
data, which was the purge's entire justification.

**Two things a closed order left behind**, both tracked in
[production-readiness.md](production-readiness.md) rather than here, because
neither is a code change anyone can make today:

- **DATA-06** — no backup of the Cloudinary assets. WO-55 covered the upload
  paths and the registration compensation path; the backup it asked for next
  can only be built against a real account with real credentials.
  [ADR-020](decisions.md) accepts the exposure until the first real member
  document exists, and names that document as the trigger.
- **A rate limiter keyed on the member rather than the address.** WO-64 put a
  per-member limit on the Next side of the support proxy, which is where the
  member's address is known; the Go limiter still sees one address for all
  proxied traffic. Fixing that properly needs verified identity in middleware
  — see [ADR-021](decisions.md) for why forwarding a header cannot do it.

Testing work is tracked separately in [testing.md](testing.md) as `TEST-01 …
TEST-43`. **All of it is closed**: TEST-39 and TEST-40 with WO-51 and WO-52,
TEST-41 → 43 with WO-53 → WO-55.

### Standing rules for every order

- `pnpm typecheck` must exit clean, zero errors.
- `pnpm lint` must exit 0. It reports **6 warnings** — 5 pre-existing
  `@next/next` ones and 1 `Compilation Skipped` on the registration form, which
  uses react-hook-form's `watch` subscription and so cannot be analysed by the
  React Compiler. That is a notice, not a defect. The 20 `set-state-in-effect`
  findings were cleared by WO-27. **Do not let that count grow.**
- A regression test must be seen to **fail against the pre-fix code** before it
  is allowed to pass. A test written after the fix, never observed red, proves
  only that today's code passes it. When a test *cannot* be made to fail — see
  the floating-promise trap below — say so in the test rather than letting it
  stand as proof.
- Money changes stay in the Go API, one transaction, with an `audit_logs` row
  (CLAUDE.md rules 1, 2, 6).
- Update [tasks.md](tasks.md) and tick the order here in the same commit.


# Open

Nothing. New work goes in [tasks.md](tasks.md) first and becomes an order here
only when it needs a spec someone can execute without re-reading the codebase.

---

# Completed work

Moved to [changelog.md](changelog.md) — one line per batch, for WO-01 → WO-63
and TEST-01 → TEST-43. The lessons that outlived the work are below.

Two pieces of closed orders outlived them — DATA-06 and the per-member rate
limiter — and are described at the top of this file.

# Traps that cost a session

Each of these was found by something breaking, most of them at runtime rather
than at build time. They are grouped by what you have to be touching to hit them.

### Concurrency and the connection pool

- **Reading config from the pool inside a transaction deadlocks it.** With N
  goroutines and a pool of N, every connection is held by an open transaction
  and every transaction is waiting for a free connection to read a config key.
  Nothing errors, nothing times out — the suite hangs until the test framework
  kills it. Adding one unconditional `getWithdrawalNoticePeriodMonths(ctx)` was
  enough. Use the `…Tx` readers inside a transaction ([ADR-017](decisions.md)).
- **`&&` short-circuiting can hide a latent deadlock for weeks.**
  `AddMemberWithdrawal` already read a config key from the pool inside its
  transaction, guarded by `activeLoan > 0 &&`, which is false in the common
  case. The concurrency test that eventually exposed the bug had been green the
  whole time, over code one boolean away from hanging.

### Test stacks and stale processes

- **`test-stack.sh up --serve` will not replace a server that is already
  answering.** It polls `/v1/health` and moves on, so a Go API left running by an
  earlier session keeps serving — and a full green browser run then proves
  nothing about the code you just wrote. Check the process start time
  (`ps -o lstart -p $(ss -lptnH | grep 8099 | grep -oP 'pid=\K[0-9]+')`) against
  when you made your changes, or `down` first. Found by a new route answering
  404 while its route-contract test passed.
- **`next dev` hot-reloads, `go run` does not.** So the web half of a stale stack
  is usually current and the API half is usually not, which makes the symptom
  look like a frontend/backend contract bug rather than a stale binary.

### Prisma and migrations

- **`@updatedAt` emits no database default.** Neither `db push` nor a generated
  migration writes one — Prisma applies it client-side. Hand-written SQL in the
  Go API must set both timestamps itself, or the first insert fails a NOT NULL
  check. This broke *all four* money flows once, as a generic 500.
- **`prisma migrate` needs a direct, non-pooled Neon connection.** PgBouncer
  cannot hold the session advisory lock and the failure looks like a **hang**,
  not a wrong-host error. `pnpm db:migrate` derives the direct host and logs it.
- **Timestamps are `timestamp without time zone`.** `NOW()` stores the session's
  wall clock; pgx reads it back as UTC. On a non-UTC server a revocation marker
  reads hours in the future and every new token is born revoked. The pool pins
  `timezone=UTC`. Neon defaults to UTC — a VPS will not.
- **Triggers are invisible to Prisma.** `migrate diff` will not see one, so a
  later `--from-empty` baseline drops it silently (relevant to WO-33).

### PostgreSQL clients

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

### Docker

- **`.dockerignore` does not use git's matching rules.** Docker matches each
  pattern against the full path from the context root, so a bare `.env` covers
  only the repository root. `apps/web/.env` stayed in the context. Every pattern
  needs an explicit `**/`. This is a **secret-containment** control, not tidiness:
  a file that reaches an image layer is not removed by a later `RM`.
- **`node:*-slim` ships no OpenSSL.** Prisma cannot detect a version, warns, and
  falls back to `openssl-1.1.x` — wrong for bookworm. Install `openssl` in both
  the deps and runtime stages.
- **`@swc/helpers` is only half-traced.** Next 16 resolves it through the
  package's `exports` map at `./esm/*`; the tracer follows the CommonJS entry and
  copies `cjs/` only. The container dies at startup, before serving one request.
  Named explicitly in `outputFileTracingIncludes`.
- **`NEXT_PUBLIC_*` is baked at build time** — including for server-side route
  handlers. A value supplied at `docker run` is too late.
- **`docker compose --env-file` must come before the subcommand.**
  `docker compose --env-file .env.local up`, never `... up --env-file ...`.
- **Compose interpolates the entire file** even for `up -d postgres`, so a `:?`
  default on an unrelated service fails a command that does not use it. Use `:-`.
- **`DATABASE_URL` is hard-coded to the `postgres` service in `docker-compose.yml`
  on purpose.** `.env.local` holds the production Neon URL; interpolating it would
  point the one-shot migrate container at production and run `db:seed` against
  real member data.
- **A Dockerfile that has never been built is a hypothesis.** Static review
  caught none of the three defects above.

### Next, React and the build

- **A single click can fire a handler and then submit the form, when a
  conditional swaps a button's `type` in place.** `{!isLastStep ? <Button
  type="button" onClick={next}/> : <Button type="submit"/>}` is one `<button>` in
  one slot as far as reconciliation is concerned, so React mutates `type` on the
  node the member just clicked instead of replacing it. `next` is `async`, and
  the continuation after `await trigger(...)` runs as a **microtask — before the
  browser performs the click's default action**. So the state update lands, the
  node becomes `type="submit"`, and the browser then submits. One ordinary click,
  no double tap: on the registration form this advanced to the Documents step and
  submitted it in the same gesture, so the member arrived at an error about
  fields they had not been shown yet. Give the branches distinct `key`s — a new
  node has no pending default action.
- **React Hook Form's `shouldFocusError` defaults to true and will fight your own
  scrolling.** It focuses the first errored field, which scrolls it into view —
  and on a long step "first errored field" can be the last control on the page.
  The registration form's agreement checkbox is below the rules and the pledge,
  so a blocked submit sent the member to the bottom with the four document slots
  off-screen above them. A form that reveals its own errors has to turn it off.

**`next-env.d.ts` churns on every run and must not be tracked.** `next dev`
writes `import "./.next/dev/types/routes.d.ts"`; `next build` writes
`import "./.next/types/routes.d.ts"`. A tracked copy therefore shows up modified
after whichever command you ran last, forever. Next's own docs say to gitignore
it and remove it from Git if tracked
(`node_modules/next/dist/docs/01-app/03-api-reference/05-config/02-typescript.md`).
Untracked 2026-08-17. It stays in the tsconfig `include` array — tsc tolerates a
listed file that does not exist, and `.next/types/**/*.ts` is included directly,
so `pnpm typecheck` passes on a fresh clone with no build (verified from a
clean tree).

- **`outputFileTracingIncludes` must stay top-level.** Next 15 promoted it out of
  `experimental` and only *warns* if you leave it behind — which silently ships an
  image with no Prisma engine that dies on the first query.
- **The Tailwind 4 codemod deletes `tailwind.config.ts` and does not carry
  `plugins:` across.** `tailwindcss-animate` stopped loading and Tailwind compiles
  unknown utilities away without complaint — 81 classes across 17 files, every
  Radix dialog, dropdown, select and toast animation, would have become dead
  strings. Restored with `@plugin` in `globals.css`.
- **Next 16 removed `next lint`** and does not fail usefully: it reads `lint` as a
  directory name and reports "no such directory .../lint".
- **`output: 'standalone'` is gated behind `DOCKER_BUILD=1`** so a Docker concern
  cannot change what `pnpm build` emits for Vercel.

### Composition — a correct function defeated by what surrounds it

- **chi's `RealIP` destroyed the rate limiter's input three middlewares before
  it ran.** `clientIP` was right, was unit-tested, and had a comment explaining
  exactly why the leftmost X-Forwarded-For entry must never be trusted — and the
  limiter was still keying on that entry, because `RealIP` had already written
  it into `r.RemoteAddr`. **Nothing about the function was wrong; the stack
  around it was.** The test that catches this had to drive the whole stack,
  which is why `mountMiddleware` was extracted from `main()` — the same move
  that made the routes testable.
- **Three handlers had their own copy of the same decision.** `getClientIP` in
  `auth_handler.go` and three inline `r.Header.Get("X-Forwarded-For")` blocks in
  `dashboard_handler.go` each answered "who is calling" differently from the
  limiter. The login lockout counted failed attempts against the caller-supplied
  end, so varying one header stepped around it entirely. When a fact about a
  request is security-relevant, resolve it **once**, in middleware, and put it
  in the context.

### Tests and evidence

- **An `httptest` handler that does not drain the request body cannot tell that
  the client has gone**, so `r.Context()` stays live and `Server.Close` blocks on
  it — the suite hangs with no failure and no output. `net/http` learns of the
  peer's departure from a read on the connection, and an unread body is what
  that read returns instead. `io.Copy(io.Discard, r.Body)` first, then block.
  Cost half an hour of thinking the code under test had a deadlock.

- **A dead endpoint can look healthy in a test log.** WO-23 cited the guarantor
  route's "invalid vs valid id" discrimination as proof that `await params`
  worked. It did prove that — but the check was read through a UUID regex that
  rejects every id the database can produce (`cuid()`), so a fully dead endpoint
  passed. When a test discriminates, check *what* it is discriminating on.
- **Suppressing stderr on a setup step turns a broken fixture into a passing
  test.** A failed `INSERT` of test users looked like success, and the resulting
  auth failure was blamed on the token.
- **A list of things to cover goes stale the day it is written; an enumeration
  does not.** The ADR-015 fix was applied to the four balance writers someone
  thought of. The fifth — loan repayment — kept the bug for months and was found
  only once a test re-derived the list from the source. Three suites now do this:
  `chi.Walk` for the Go routes, a filesystem walk for the Next ones, and a regex
  census for balance writers. Each fails the build when the code grows something
  the table does not know about. Prefer that over any list a human maintains.
- **"Revert the fix and watch it fail" only counts if you reverted the whole
  fix.** Removing the `WHERE "remainingAmount" >= $1` guard from the repayment
  fix left the new `FOR UPDATE` in place, and the test still passed — which
  briefly looked like the test being weak rather than the revert being partial.
  Restore the method from `git show HEAD:<path>`, not by editing back what you
  remember changing.
- **Some defects cannot be reproduced by a test, and saying so is part of the
  fix.** WO-59's floating `prisma.notification.create(...)` fails only where the
  runtime freezes at the response — Node settles the promise regardless, so the
  obvious test ("the notification row exists afterwards") passes against the
  broken code. That test is still worth having, as a contract; the *regression*
  guard is a census that reads the source for a Prisma call in statement
  position. Write the note in the test, or the next reader will trust it.
- **`golangci-lint` compiles the test files too, with `build-tags: integration`.**
  A new `_test.go` helper named `post` collided with one in a tagged file in the
  same package: `go test ./cmd/server/` was green, `go build` was green, and the
  linter reported a `typecheck` failure that reads like a configuration problem.
  It is not — it is a real redeclaration that only the tagged build sees.
- **A detector must search code, not prose.** A rule forbidding the word
  "markup" in the money paths flagged `loan_repository.go` — for its own header
  comment, which states the rule. A check that fires on its own documentation
  teaches people to delete the documentation. Strip comments first.
- **Measure a layout, do not look at it.** The statement's Reference column was
  0.44 mm too narrow, so every 15-character receipt number wrapped mid-digit on
  every printed statement. Nobody spotted it in a PDF viewer; a test computing
  the rendered text width against the column width found it immediately, and
  found a second overflowing column on its first run.
- **A config key nothing reads is worse than a missing one.**
  `loan.noticePeriodMonths` is declared and editable in the admin settings page,
  and no code path consults it — so the UI reports a policy the system does not
  apply. When checking whether a feature exists, search the *enforcement*
  surface, not the settings.
- **Never initialise a money figure to zero.** The member dashboard's initial
  state was four zeros, so it displayed "Current Balance: BDT 0" for the second
  and a half before the fetch resolved — and its `catch` discarded the error and
  kept those zeros permanently on failure. "Your balance is 0" is the most
  alarming thing this application can say and is indistinguishable from the
  truth. Use a placeholder and a `loading | ready | error` status.
- **`nextjs-portal` is in the DOM and in the tab order, and is not the
  application.** `next dev` injects a dev-tools overlay that is absent from a
  production build. It has now cost two sessions: once by matching a `"Next"`
  button locator, once by absorbing Tab presses and reporting no focus ring.
  Exclude it explicitly in any DOM sweep.
- **Reading `innerText` once races every page that fills in its figures.** Use
  Playwright's retrying matchers (`await expect(locator).toContainText(x)`).
  Reading once made four working specs fail — and, usefully, is what surfaced the
  fabricated `BDT 0` above.
- **A spec that passes alone and fails in the suite is shared state or a
  limit, not luck.** The e2e run tripped the API's 60-requests-per-minute
  limiter partway through, so the *later* specs rendered empty pages. It read as
  flaky ordering; `grep -c 429 .test-stack/api.log` said 91. A retry would have
  buried it permanently. `test-stack.sh` raises the limit now.
- **Radix `Select` renders a hidden native `<select aria-hidden tabindex="-1">`**
  for plain-form submission. An accessibility sweep must respect `aria-hidden`,
  or it reports a false positive on every page with a filter — and a suite that
  cries wolf is a suite people stop reading.
- **Generous per-page waits multiply.** A browser helper that waits up to 25 s
  for a page to settle is fine once and fatal in a loop: a spec walking ten
  admin pages blew the 30 s test timeout and reported as a broken page rather
  than a slow one. Keep the helper's waits short and let the *retrying
  assertions* do the waiting, then raise `test.setTimeout()` on the sweeps.
  `next dev` compiles each route on first visit, so the first pass is slow in a
  way a production build never is — that is a harness allowance, not a budget.

### Go

- **A startup context is not a background context.** `main.go` had a bare `ctx`
  that was a 10-second startup timeout; anything long-lived handed it runs exactly
  once and returns, silently. It froze the new business gauges immediately — and a
  frozen gauge is indistinguishable from a calm system. It is now `startupCtx`
  with a comment.
- **Integer division loses money.** `amount / installments` stored 3,333 for a
  10,000 taka loan over 3 months. The PDF already printed an adjusted final
  installment, so the signed contract and the stored schedule disagreed and the
  loan could never reach zero. `money.InstallmentPlan` returns both figures and
  the "repays principal exactly" invariant is a test.
- **JWT `iat` is whole seconds.** A revocation marker timestamped to the
  microsecond makes a token issued 200 ms later compare as *older* and be born
  revoked. Revocation compares at second precision.

---
