# Traps

Every entry here was found by something breaking, most at runtime rather than at
build time. They are grouped by **what you have to be touching to hit one**, so
skim the heading that matches your task and ignore the rest.

This is the only file that keeps them. If you are about to add a lesson to
another doc, add it here and link instead.

---

## Money and concurrency

- **A balance written absolutely is a lost update.** Read the balance, add in Go,
  write the total back, and twenty concurrent ৳1,000 deposits leave ৳1,000 with
  ৳20,000 of ledger rows. Write it relatively (`SET "x" = "x" + $1 … RETURNING`)
  or read it `FOR UPDATE` inside the same transaction ([ADR-015](decisions.md)).
  A *check* against a balance belongs in the same statement as the write
  (`WHERE "remainingAmount" >= $1`), not a line above it.
- **A fix applied from memory covers the methods someone thought of.** ADR-015
  was written, reviewed and applied to four balance writers. The fifth — loan
  repayment — kept the bug for months and was found only when a census
  re-derived the list from the source. Enumerate from the code, never from recall.
- **Integer division loses money.** `amount / installments` stored 3,333 for a
  ৳10,000 loan over 3 months, while the PDF printed an adjusted final
  installment — so the signed contract and the stored schedule disagreed and the
  loan could never reach zero. `money.InstallmentPlan` returns both figures.
- **A `transactions` row is not necessarily money that moved.** A `PENDING`
  withdrawal is a member's notice and a `PENDING` deposit is a request. Four
  aggregates were counting intentions as income. Filter on status
  ([ADR-016](decisions.md)).
- **The same function can write one correct record and one wrong one.** Every
  posting wrote an audit line with `%d BDT` — correct — and a member
  notification with `BDT %.2f` from a `float64`. A test reading either alone
  would have passed the code. The int64 ceiling rendered as `…808.00`.

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
- **Generous per-page waits multiply.** A helper that waits up to 25 s per page is
  fine once and fatal in a loop: a spec walking ten admin pages blew the 30 s test
  timeout and reported as a broken page rather than a slow one. Keep the helper's
  waits short, let the retrying assertions wait, and raise `test.setTimeout()` on
  sweeps. `next dev` compiles each route on first visit, so the first pass is slow
  in a way a production build never is.

## Interface

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

## Go

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
