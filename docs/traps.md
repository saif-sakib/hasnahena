# Traps

Every entry here was found by something breaking, most at runtime rather than
at build time. They are grouped by **what you have to be touching to hit one**.

This is the only file that keeps them. If you are about to add a lesson to
another doc, add it here and link instead.

**This file is the index — 207 traps in 24 files.** The lines below are the
trap titles verbatim, so this page alone answers "is my problem already known?".
Open the one file whose heading matches what you are touching; the set is 111 KB
and the largest single file is 32 KB.

### [Money and concurrency](traps/money-and-concurrency.md) · 10

- An invariant enforced only in application code is a claim about today's code.
- A balance written absolutely is a lost update.
- One question, one function — or the same page gives two answers side by side.
- An aggregate with no status filter counts intentions.
- A fix applied from memory covers the methods someone thought of.
- Integer division loses money.
- A `transactions` row is not necessarily money that moved.
- The same function can write one correct record and one wrong one.
- A ledger row is not proof that money moved, and money moving is not proof of a ledger row.
- A disputed posting is money that moved.

### [Seed data that outlives the seed](traps/seed-data-that-outlives-the-seed.md) · 2

- "Reusing the row" is not the same as resetting the account.
- What a reset must *not* touch is as worth stating as what it must.

### [Cost, and the idle process](traps/cost-and-the-idle-process.md) · 5

- An idle connection pool is not free when the database bills for being awake.
- An uptime check on a readiness endpoint keeps the database awake.
- A ticker ties load to nothing at all, which is not obviously better than tying it to a scraper.
- Count background jobs in wakes per day, not in queries per pass.
- A build that nothing consumes is a bill nothing notices.

### [A safety job that spends the budget the safety job needs](traps/a-safety-job-that-spends-the-budget-the-safety-job-needs.md) · 3

- The restore drill ran on every code commit and the nightly backup stopped for four days.
- A scheduled job that never starts cannot fail.
- A guard that shares a metered resource with the thing it guards can starve it.

### [A column that stores what could be derived](traps/a-column-that-stores-what-could-be-derived.md) · 2

- A stored copy of a computed value is only correct at the instant it is written, and nothing tells you when it stops being.
- A column nothing reads is a column nothing keeps honest.

### [SQL that no compiler reads](traps/sql-that-no-compiler-reads.md) · 2

- A dropped column referenced from a Go string is invisible to every build step.
- Skip by shape, never by message.

### [Reading a schema built for machines](traps/reading-a-schema-built-for-machines.md) · 2

- Make the database readable with a view, not by denormalising a table.
- `prisma migrate diff` does not model views.

### [An identifier issued too early](traps/an-identifier-issued-too-early.md) · 2

- A number is spent the moment it is issued, and a public form must not be able to spend one.
- Changing an identifier strands whoever held the old one.

### [Deleting only what the database remembers](traps/deleting-only-what-the-database-remembers.md) · 4

- "Erase this person" written as a list of columns is a promise that decays one schema change at a time.
- Two meaningful folder names are still worse than one, if nothing joins them.
- A rename moves the URL. It does not move the folder anybody looks at.
- The test rig has a disposable database and no disposable image host, and nothing said so.

### [Connection pools and transactions](traps/connection-pools-and-transactions.md) · 2

- Reading config from the pool inside a transaction deadlocks it.
- `&&` short-circuiting can hide a latent deadlock for weeks.

### [A script that runs because it was imported](traps/a-script-that-runs-because-it-was-imported.md) · 3

- Importing a module executes it, and `main()` at the bottom of a file is a module that works.
- Output sent to `/dev/null` is evidence destroyed before it is read.
- A backup taken after an incident captures the incident.

### [Prisma and migrations](traps/prisma-and-migrations.md) · 20

- The test stack cannot review a data migration, because it has no data.
- A migration that fails leaves Prisma's advisory lock on an idle pooled backend, and every later `migrate` blames the server.
- A migration that is only ever run against an empty database is only ever tested against an empty database.
- A primary key that changes has exactly one hazard, and it is the caller holding the old value across the change.
- `_prisma_migrations` is a table like any other, and emptying it turns a deploy into a replay from zero.
- A view depends on the columns it names, and nothing you run before a deploy will tell you.
- An idempotent seed that refuses to touch an existing value cannot repair a row that exists and is blank — and a settings screen creates those by the dozen.
- `@unique` on a text column is case-sensitive, so uniqueness you believe you have is a convention two write paths happen to share.
- An expression index is invisible to `prisma migrate diff` — which is what makes it safe to add and dangerous to lose.
- A foreign key you did not declare is still a decision.
- Two definitions of one table will disagree, and `IF NOT EXISTS` makes the disagreement silent.
- Dropping an enum label is a runtime error in every query that still names it, and nothing compiles it.
- `prisma migrate diff` generates a shape, not a data migration.
- `@updatedAt` emits no database default.
- Two backends write these tables, so a schema-level fix is half applied until you grep the other one.
- `prisma migrate` needs a direct, non-pooled Neon connection.
- Timestamps are `timestamp without time zone`.
- Triggers are invisible to Prisma.
- `prisma migrate diff` cannot see a rename.
- "These rows cannot be migrated" is worth checking before believing.

### [PostgreSQL clients](traps/postgresql-clients.md) · 2

- `/usr/bin/pg_dump` is not a binary.
- Two parameters added together are `unknown + unknown`.

### [Test stacks and stale processes](traps/test-stacks-and-stale-processes.md) · 7

- Never run `pnpm test:integration` while `pnpm test:e2e` is running.
- `sr-only` is a 1x1 clipping box, so a clipped-text detector reports it as clipped text.
- A test stack can hand `next dev` the right `DATABASE_URL` and have Next overwrite it from `apps/web/.env` before any of your code runs.
- A rig that does not export the credentials it seeded makes its own specs look broken.
- `test-stack.sh up --serve` will not replace a server that is already answering.
- `next dev` hot-reloads, `go run` does not.
- `down` used to leave the API running and say it had not.

### [Docker](traps/docker.md) · 8

- `.dockerignore` does not use git's matching rules.
- `node:*-slim` ships no OpenSSL.
- `@swc/helpers` is only half-traced.
- `NEXT_PUBLIC_*` is baked at build time
- `docker compose --env-file` must come before the subcommand
- `DATABASE_URL` is hard-coded to the `postgres` service in `docker-compose.yml` on purpose.
- A Dockerfile that has never been built is a hypothesis.
- Making a page static moves its database reads into the build.

### [Next, React and the build](traps/next-react-and-the-build.md) · 16

- A streamed response's failure cannot be caught by the route that returned it.
- A Server Action's request body is capped at 1 MB, and exceeding it is silent.
- A reader census that greps for a key name is satisfied by the writer.
- Awaiting in a layout changes when everything below it mounts.
- A single click can fire a handler and then submit the form, when a conditional swaps a button's `type` in place.
- React Hook Form's `shouldFocusError` defaults to true and will fight your own scrolling.
- `next-env.d.ts` churns on every run and must not be tracked.
- `outputFileTracingIncludes` must stay top-level.
- The Tailwind 4 codemod deletes `tailwind.config.ts` and does not carry `plugins:` across.
- Next 16 removed `next lint`
- `output: 'standalone'` is gated behind `DOCKER_BUILD=1`
- The React Compiler config is top-level `reactCompiler` in Next 16.
- `unstable_cache` serialises what it stores, so a `Date` comes back a string.
- `generateStaticParams` on a locale segment applies to the entire subtree.
- An unwrapped `useSearchParams` fails the *build* the moment its route can be prerendered.
- `revalidateTag(tag)` with one argument is deprecated in Next 16

### [Composition — a correct function defeated by what surrounds it](traps/composition-a-correct-function-defeated-by-what-surrounds-it.md) · 4

- chi's `RealIP` destroyed the rate limiter's input three middlewares before it ran.
- Three handlers had their own copy of the same decision.
- A guard was invalidated by a row added later in the same file.
- Watch for a safety net positioned where it can never be reached.

### [Tests and evidence](traps/tests-and-evidence.md) · 27

- A truncated read of a file is a claim about the file, and it will be believed as one.
- The site's own domain is in the repository; do not take it from a screenshot.
- `next dev` can serve a stale route handler, and a browser test will believe it.
- A helper that throws fails the tests rather than the code, and the failure looks like the suite's fault.
- A source-reading census anchored on an incidental detail goes blind the day that detail is removed, and passes.
- Red-check a new census by planting the defect, not by reading the regex.
- A regression test can be green before the fix because the defect was already fixed by somebody else.
- A guard that two independent clauses enforce cannot be red-checked by deleting one.
- `audit_logs` is append-only, so every assertion about it is a delta.
- The defects that moved money were found by running the code, not by reading it.
- A green secret scan is not evidence that history is clean.
- A route contract proves who may call a route, not what it returns.
- A list of things to cover goes stale the day it is written; an enumeration does not.
- "Revert the fix and watch it fail" only counts if you reverted the whole fix.
- Some defects cannot be reproduced by a test, and saying so is part of the fix.
- An `httptest` handler that does not drain the request body cannot tell that the client has gone
- `golangci-lint` compiles the test files too, with `build-tags: integration`.
- A detector must search code, not prose.
- Suppressing stderr on a setup step turns a broken fixture into a passing test.
- A dead endpoint can look healthy in a test log.
- A green test that never reached the code proves nothing.
- A budget recorded from a build is a fact; a budget maintained by hand is a wish.
- An ordinary refusal reported as a 500 reads as a broken feature.
- A test cannot clean up after itself in `audit_logs`.
- A hardcoded unique value in a shared-database suite passes until another suite runs first.
- Comparing whole response bodies compares the clock.
- A red run for the wrong reason is not evidence.

### [Browser suites](traps/browser-suites.md) · 9

- A spec that passes alone and fails in the suite is shared state or a limit, not luck.
- A Playwright run starved of CPU produces timeouts that read exactly like defects.
- Reading `innerText` once races every page that fills in its figures.
- `nextjs-portal` is in the DOM and in the tab order, and is not the application.
- Radix `Select` renders a hidden native `<select aria-hidden tabindex="-1">`
- `bringToFront()` does not background the other tab.
- `networkidle` never arrives on a page that polls.
- Chromium reports `'upgrade-insecure-requests' is ignored when delivered in a report-only policy` to the console on every page load.
- Generous per-page waits multiply.

### [Interface](traps/interface.md) · 52

- A badge inside a link changes that link's accessible name.
- A feature behind `@supports` that degrades to nothing degrades silently, and looks exactly like never having built it.
- A reveal that hides on a page which has already painted will animate the wrong way first.
- Hide with an animation, not a transition — the element's own `transition` will otherwise animate it into hiding.
- A reveal that re-arms on scroll position also re-arms on layout growth, and at load the layout grows.
- `preserveAspectRatio="none"` makes a viewBox's height a divisor, not a canvas.
- A spec that proves a negative must first prove its precondition.
- Opacity and movement want different timing, whatever the mechanism.
- An `nth-child(3n)` stagger is a cascade on a three-column grid and a rendering fault on a four-column one.
- `position: fixed` escapes the page only while no ancestor opens a stacking context.
- A barrel import charges you for everything the barrel touches.
- `img-src` and `connect-src` are the same asset and not the same permission, and a screen that has one of them looks completely correct.
- A download after `await` works exactly once per page load, then silently stops.
- A calendar widget is the wrong control for a birthday, and the platform gives you one by default.
- A CSS property that only applies to one input type, applied to another, is a no-op that looks like a mechanism.
- A canvas re-encode to JPEG destroys transparency, and JPEG is the obvious default.
- `useState(prop)` is a one-time seed, and on a screen that fetches its data the prop arrives afterwards.
- A generic UI primitive with English string literals is invisible to the translation census.
- A `flex` section makes its container a flex item, and a flex item with no width shrinks to its contents.
- That the database knows a number does not mean the number may be published.
- `aria-hidden` on a decorative wrapper becomes a content wrapper the moment the decoration gains children.
- A long number wraps between its own digits, and only at a real viewport width.
- A font the page downloads is not a font the page uses.
- An application-level check that is stricter than the constraint it anticipates is invisible, and it always wins.
- A page whose layout depends on an admin having filled a box in looks broken on launch day.
- A spec that drives a third-party service cannot run in CI, and failing is not the same as being honest about it.
- A CSS `auto` silently overrides the size you just computed.
- A loading skeleton is a lie when nothing is loading.
- A number in the copy is a claim, and copy has no owner.
- A dead control on a public page advertises a feature that does not exist.
- A page can be in the sitemap and reachable by nobody.
- A segment's `not-found.tsx` does not catch an unmatched URL.
- Prose in a component is invisible to every guard, and legal pages are all prose.
- A revision date is a claim about the document, and it goes stale in silence.
- A workaround can be the thing that makes the defect unfixable.
- Removing a workaround silently breaks whatever was reading its side-effects.
- A form's "default" is a writer, not a fallback, when the form posts every field.
- A timestamp is not a unique value, however precise it looks.
- A one-line re-export is not proof that two screens are the same screen.
- Two roles sharing one component still need the same rows underneath it.
- The same action offered from two screens is two implementations, and they will not stay equal.
- A census that names files by hand tests the past.
- Two forms over one key/value table will fight.
- A `|| 'fallback'` on a value nobody can set is not a fallback.
- When a page needs a fact the organisation already has, do not add a second key for it.
- A swallowed query error becomes a fabricated balance.
- Never initialise a money figure to zero.
- A config key nothing reads is worse than a missing one.
- Measure a layout, do not look at it.
- `x-default` is not the default locale, even when the two hold the same value.
- JSON-LD cannot be a text child.
- One name for two things is a bug waiting for a rename to expose it.

### [Go](traps/go.md) · 6

- A `Scan` with more destinations than the SELECT has columns fails every row, silently.
- A startup context is not a background context.
- JWT `iat` is whole seconds.
- `% ` over a random byte is not uniform.
- A security mechanism can be built, enforced and wired to the wrong half of the problem.
- An oracle closed at the status code can still run on the clock.

### [Dependencies](traps/dependencies.md) · 2

- Never take a major version through `pnpm update`.
- After merging any dependency PR, run `pnpm install` and commit the regenerated lockfile.

### [Deleting a rule](traps/deleting-a-rule.md) · 2

- A rule you remove needs a test that asserts its absence, or nothing stops it coming back.
- And check what the deletion strands.

### [Locale routing](traps/locale-routing.md) · 15

- Changing the default locale does not change any code — it changes what every untested assumption was hiding.
- There is no correct way to swap a locale with `String.replace`.
- Playwright matches an accessible name by substring by default.
- A `system_config` value that is prose needs one row per language.
- An e2e test that reads rendered text must strip what an admin typed.
- A redirect at the root is what makes `/` and `/bn` duplicates, not the choice of default locale.
- next-intl's `as-needed` redirect is a 307, and a 307 is not a canonical signal.
- `localePrefix` is a routing rule, not a directory rule.
- Switching to `as-needed` turns every hand-built `/${locale}/…` into a redirect.
- `pathname.replace('/en', '/bn')` was never a language switch.
- A `Vary` that is not true is not free.
- A URL in an email is not a URL in a page.
- A guard's coverage can shrink as the code improves.
- A lint rule can be silenced by making its input unanalysable.
- A response whose target depends on a request header must send `Vary`.
