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

## Seed data that outlives the seed

- **"Reusing the row" is not the same as resetting the account.** The cutover
  purge set the role, the status and the password on the two launch admins and
  left every other column as it found it — so both went into production carrying
  an old seed's invented values: `HN-A-001` and `STF-MOB97EFH` (two dead
  numbering schemes), a birthday of 1985-05-20, parents called `Admin Father` and
  `Admin Mother`, and **an NID of `9876543210987`**. That last one is the
  dangerous one: `users_nid_live_key` is a *unique* index over live rows, so a
  fabricated national ID sitting on an admin account is a real member refused at
  registration one day with "that NID is already in use" — a refusal no screen
  can explain and no admin can clear. **The general form: a seed writes
  plausible values into required columns, and plausible is exactly what nobody
  re-reads.** Enumerate the fields a reset must clear, and have the script print
  what it changed field by field rather than "row reused".

- **What a reset must *not* touch is as worth stating as what it must.** The row
  id, the email and the phone are identity other rows reference and the two
  things a person signs in with; the display name is something only the person
  can tell you, and inventing one is how `Admin` became somebody's name on every
  generated document. `test/unit/purge-script.test.ts` asserts the absence of
  those three from the update.

## Cost, and the idle process

- **An idle connection pool is not free when the database bills for being
  awake.** Neon suspends the compute when nothing is connected. `DB_MIN_CONNS=2`
  with a one-minute health check therefore held it open for ever — a 100% duty
  cycle, every night, on a platform nobody was using. Roughly 182 compute-hours a
  month against an allowance of 100, and **not one line of it looks wrong in
  review**: warm connections are a performance practice, and the reason they are
  the wrong one here is a property of the host rather than of the code. The
  general form: **when the platform charges for wall-clock time, the idle
  behaviour of a process is a line item.** [ADR-035](decisions.md), pinned by
  `internal/config/idle_cost_test.go`.

- **An uptime check on a readiness endpoint keeps the database awake.**
  `/v1/ready` pings the pool, which is exactly right for a load balancer and
  exactly wrong for a robot calling it every sixty seconds. `/v1/health` touches
  nothing and answers the question an uptime monitor is actually asking. The two
  needs look like one — *is it up?* — and separating them is what lets the API
  stay warm on Render while the database sleeps.

- **A ticker ties load to nothing at all, which is not obviously better than
  tying it to a scraper.** The business gauges refreshed every minute so that
  "database load does not depend on how often somebody else's scraper runs". The
  endpoint is scraped **twice a day**: 43,000 aggregate queries a month to answer
  60 questions, and enough on its own to stop the compute suspending. Refresh
  lazily *with a floor* — the floor keeps the original argument's teeth, and the
  laziness restores the connection between load and demand.

- **Count background jobs in wakes per day, not in queries per pass.** A tick
  against a scale-to-zero database is a wake, and a wake is billed for the whole
  idle timer whatever the query cost. Hourly cleanup and hourly reconciliation
  were forty-eight wakes a day to delete a few expired rate-limit buckets and
  add up a ledger nobody reads within the hour.

- **A build that nothing consumes is a bill nothing notices.** `images.yml` built
  two Docker images on every push to `main` — one a full Next.js production
  build — and `deployment.md` states plainly that nothing in production uses
  them: Vercel and Render build from source. It was the largest consumer of a
  metered Actions allowance, spent on artefacts nobody pulled. Moved to tags and
  manual runs, with a note to put it back when the VPS move makes the images the
  deployment.

## A column that stores what could be derived

**A stored copy of a computed value is only correct at the instant it is
written, and nothing tells you when it stops being.** `accounts.maxLoanAmount`
was inserted as 0 with the account and never updated by anything — no deposit
touched it, no admin screen set it, no migration backfilled it. Two production
queries selected it, and one of them fed the "Loan Eligibility / Max loan limit"
tile on the member dashboard, the first screen a member sees. So a member with
50,000 taka saved was told they could borrow nothing, while the loans page two
clicks away computed `savings x loan.maxLoanMultiplier` and showed the real
number. Neither screen was wrong about its own inputs; they had different inputs.

**A column nothing reads is a column nothing keeps honest.**
`accounts.isLoanEligible` was written by both creation paths with *opposite*
values — the Next registration route wrote `false`, the Go approval path wrote
`true`, for the same member, minutes apart — and it had been that way for as long
as both paths existed, because no query ever selected it. The disagreement was
not the bug; it was the *evidence* that the column was dead. Look for this shape
whenever two writers of one column have never been reconciled: usually it means
nothing reads it.

The rule that follows: **before adding a column, ask what recomputes it.** If the
answer is "nothing, it is set once", it is only safe when the thing it describes
also never changes. A balance changes. A multiplier in `system_config` changes.

## Reading a schema built for machines

Every table here is keyed on a `cuid()` and every join is between two of them, so
reading the database by hand means copying opaque strings between queries. The
reasonable-looking fix — make the account number the primary key, or copy the
member's name onto `transactions` — is wrong in both directions:
`users.accountNo` is **null until an application is approved** and a key cannot
be null, and a copied name is [ADR-023](decisions.md) again.

The answer is a **view**, which is the one construct free to be denormalised
because it stores nothing. See [ADR-037](decisions.md) and the `v_*` views. The
trap specific to them: Prisma's `migrate diff` does not model views, so
`pnpm db:migrate:check` reports "No difference detected" whether they are healthy
or reference three columns that no longer exist. The first thing that notices is
a migration failing at deploy time. `apps/web/test/unit/database-views.test.ts`
is what moves that to `pnpm test:unit`.

## An identifier issued too early

**A number is spent the moment it is issued, and a public form must not be able
to spend one.** Registration allocated the *membership* number `ACC-KH-33001`
when somebody submitted the form — before any admin had read the application —
so refusing the first applicant put a permanent hole in the foundation's own
register and made the next one `002`. Anybody who can open the registration page
could have pushed the series into the hundreds.

The fix is not to reuse the gap (two people would then be `ACC-KH-33001` in the
paper trail) and not to renumber on rejection (the number names their folder on
the image host). It is that **there are two numbers and there always were**: an
application number issued on submission, a membership number issued on admission
([ADR-039](decisions.md)). The paper process this platform replaces already
worked that way.

The trap generalises: before allocating a scarce, human-readable, permanent
identifier, ask **what happens when this record is refused**. If the answer is "a
gap", it is being issued at the wrong moment.

Watch for the second half too. `ApproveRegistration` used to overwrite
`formNumber` with `FORM-<accountNo>` on approval, which destroyed the reference
the applicant was given and the name of the folder holding their four identity
documents. And the handler read `candidate.AccountNo` from a snapshot taken
*before* the approval that allocates it — an empty string in the one email that
tells a member their number.

## Deleting only what the database remembers

- **Two meaningful folder names are still worse than one, if nothing joins
  them.** A member's avatar was under `people/ACC-KH-33001` and their four
  identity documents under `applications/APP-2026-000001`. Both names are
  readable; neither says the two are the same person. The join lived in the
  database — which is the thing an erasure destroys — so "delete everything you
  hold about this member" was correct only for as long as the row survived to
  say where to look, and an audit of what is stored about somebody needed a query
  to answer. The fix is not a better name, it is **one** name: approval renames
  the documents into the person's folder, so the erasure is a single prefix.
  Renaming and not re-uploading, because these are NID scans stored with
  `preserveOriginal` and a round trip through the uploader would re-encode them
  silently. And the emptied folder is removed with `deleteEmptyFolder`, which
  refuses a folder that still has contents — reaching for `deleteFolder` there
  would "finish" a half-completed move by deleting the half that did not move.

`documents` records what was *recorded*; the image host holds what was *stored*,
and those are not the same set. An upload that succeeded before its row insert
failed, a retry that wrote a second asset, a file put there by hand — none has a
row, all are still served from a public URL, and an erasure that iterates the
table reaches exactly none of them.

So erasure deletes **by prefix**, not by list: `hasnahena/people/ACC-KH-33001` and
`hasnahena/applications/APP-2026-000001` are the units. That is most of the
argument for one folder per person and one per application in the first place —
the naming is for humans, the *scoping* is for deletion.

Related: `deleteFolder` returns `null` on failure and `0` on "nothing there", and
callers must tell them apart. Collapsing the two makes an unreachable image host
indistinguishable from a clean erasure, which is the difference between a
member's NID scan being gone and it still being online after they were told it
was not.

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

- **A view depends on the columns it names, and nothing you run before a deploy
  will tell you.** `branches.code` was dropped in favour of making the code the
  primary key. `v_people` selected `b.code`. Prisma's `migrate diff` does not
  model views at all, so `pnpm db:migrate:check` said "No difference detected";
  the compiler cannot see inside a SQL string; and `test/unit/database-views.test.ts`
  — which exists for exactly this — passed, because it checked only the
  **quoted** camelCase identifiers, on the argument that a bare lowercase column
  would break every other query too. That argument is wrong for a column nothing
  else selects: dropping `code` broke precisely one thing, and the place it broke
  was `prisma migrate deploy`, during a deployment, on the migration *after* the
  one that caused it. What caught it was bringing the test stack up, because that
  applies every migration to a real database. Two fixes: the migration
  `CREATE OR REPLACE`s the view in the same file (same output column name and
  type, so a replace stands in for a drop and rebuild), and the views test now
  checks unquoted `alias.column` references as well — and reads the **latest**
  definition of each view rather than only the migration that first created them,
  which was its own quiet bug: it would have kept passing for a view a later
  migration broke.

- **An idempotent seed that refuses to touch an existing value cannot repair a
  row that exists and is blank — and a settings screen creates those by the
  dozen.** `seedConfig` upserted with `update: { description }`, on the
  reasonable-sounding ground that an operator who changed a value in the admin
  UI outranks a file in the repo. Then the public site's copy moved into
  `system_config` as Bengali/`…En` pairs. The English keys were new, so `create`
  ran and they got their words; the Bengali keys **already existed as empty
  strings**, because Admin → Content & Media POSTs every field on save and
  somebody had once pressed Save on a blank form. The seed dutifully declined to
  fill in a value nobody had ever set, and there was no way to repair it by
  re-running the seed — the only tool anyone would reach for. The site fell back
  to `messages/bn.json`, rendered correctly in both languages, and gave no sign
  at all; it was found by the owner opening the admin screen, not by anything in
  the repo. **An empty value is the absence of a decision, not a decision.**
  Backfill a blank, leave words alone, and accept the one thing that makes
  wrong: an operator who clears a box on purpose has it refilled next run. That
  is the right way round, because a settings screen can express "blank" and this
  file cannot express "deliberately blank", while the other failure is copy no
  re-run can fix.

- **`@unique` on a text column is case-sensitive, so uniqueness you believe you
  have is a convention two write paths happen to share.** `email String? @unique`
  is a plain Postgres unique index: `Saif@x.com` and `saif@x.com` are two rows,
  two savings balances and one person. Nothing had ever produced one, because
  both creation paths lowercase first — which is exactly why it would have gone
  unnoticed until a seed script, a hand-applied support fix at the psql prompt,
  or the next creation path someone adds produced the first. Prisma cannot
  express `lower(email)`, so the index lives in a migration and is documented on
  the field; it is the **third** object `prisma migrate diff` cannot see, along
  with the `audit_logs` trigger and the money CHECK constraints, which means a
  `--from-empty` baseline would drop all three silently (WO-90).
- **An expression index is invisible to `prisma migrate diff` — which is what
  makes it safe to add and dangerous to lose.** `pnpm db:migrate:check` reported
  "No difference detected" with `users_email_lower_key` present, because the
  diff engine compares the objects Prisma can model. That is the property that
  lets a hand-written index coexist with a generated schema, and the reason
  every such object has to be listed in one place.
- **A foreign key you did not declare is still a decision.** `Transaction.user`
  and `Loan.borrower` declare no `onDelete`, so Prisma's default for a required
  relation applies: `RESTRICT`. Deleting a member with any posting therefore
  fails at the database with a foreign-key error — correct, and unreadable. The
  application counts references first and *decides* between deleting and
  anonymising, which is what turns that constraint into an answer instead of a
  500 (WO-93, rule 2b).
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

- **"These rows cannot be migrated" is worth checking before believing.** The
  spec for hashing `password_reset_tokens` said existing rows had to be deleted
  because plaintext cannot be recovered from a hash. Nothing needed recovering:
  the plaintext was in the column and `encode(sha256(col::bytea), 'hex')` runs
  forward. Deleting them all would have destroyed the `first-login` markers,
  whose existence *is* `mustChangePassword`, silently switching off the forced
  password change for every already-approved member. Ask what each row is before
  writing one `DELETE` for all of them.

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

- **Two parameters added together are `unknown + unknown`.** pgx's simple
  protocol renders `$2` and `$3` as untyped literals, so
  `make_interval(secs => $2 + $3)` fails at runtime with
  `operator is not unique: unknown + unknown (SQLSTATE 42725)` — and only on the
  branch that runs it, which for a rate-limit lockout is the *fifth* failed
  attempt, not the first. Cast at the call site (`$2::double precision`)
  whenever a parameter appears in arithmetic rather than as a plain value. The
  integration suite pins its connections to simple protocol, so a query that only
  works under the extended protocol fails there and nowhere else.

## Test stacks and stale processes

- **Never run `pnpm test:integration` while `pnpm test:e2e` is running.** The Go
  suites truncate every table between tests, by design, and the browser suite
  reads the same database — so the integration run empties `system_config` and
  `users` out from under a browser suite mid-flight. What that looks like is not
  "the database is empty": it looks like **four unrelated specs failing on their
  own subject matter.** `locale-content.spec.ts` reported the foundation's own
  settings value as Bengali hardcoded in a component, because the endpoint it
  strips admin data with returned `{}` and it silently became a check on
  database content. That spec now fails loudly when the settings endpoint
  answers with nothing, which is the general shape of the fix: **a fixture that
  can come back empty must say so, rather than making every assertion after it
  mean something else.**
- **`sr-only` is a 1x1 clipping box, so a clipped-text detector reports it as
  clipped text.** `matrix.spec.ts` flagged four screen-reader labels the moment
  the hero's counting figures put the first `sr-only` on a public page. The
  technique *is* the thing being detected; exempt `clip: rect(0,0,0,0)` rather
  than removing the label, which is the accessible half of the component.

- **A test stack can hand `next dev` the right `DATABASE_URL` and have Next
  overwrite it from `apps/web/.env` before any of your code runs.** `@next/env`
  re-applies the `.env` files over `process.env` when it loads, so a value
  inherited from the parent shell loses to a file on disk.
  `/proc/<pid>/environ` showed the throwaway database; the app read the
  developer's Neon dev one. The Go API obeyed, so the **API half and the web
  half of the same browser run were on two different databases** — every
  assertion about a public page was made against whatever that developer's
  database happened to contain, three `entry-path` specs failed because the row
  the test process had just seeded was in the other database, and
  `public-content.spec.ts`, which PUTs settings through a Next route, was
  **writing to it**. CI never showed any of it, because CI has no `.env`. It was
  found by noticing that a home page served by the test stack listed ten members
  and four gallery photographs from a database holding one member and none.
  The fix is a name no `.env` in this repo defines — `TEST_DATABASE_URL`, which
  the route harness already keys on — so there is nothing to override it with;
  both halves are pinned by `test/unit/test-stack-database.test.ts`, because
  either alone is silently useless. **The general form: a variable your rig
  passes in is only as authoritative as the framework lets it be. Verify what
  the app read, not what you exported.**
- **A rig that does not export the credentials it seeded makes its own specs
  look broken.** `test-stack.sh` seeded `admin@hasnahena.test` and said nothing
  about it, so `public-content.spec.ts` failed locally with "Set
  E2E_ADMIN_IDENTIFIER and E2E_ADMIN_PASSWORD" — which reads like a defective
  spec and is a rig that did not finish introducing itself. `test-stack.sh env`
  exports them now, from the same two constants the seed uses.

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

- **A Server Action's request body is capped at 1 MB, and exceeding it is
  silent.** Next enforces `experimental.serverActions.bodySizeLimit` *before* the
  action runs, so nothing in the action executes and nothing logs. Content &
  Media's brand uploader validated a file up to 5 MB and posted it uncompressed:
  every logo off a phone or out of a design tool was refused by the framework,
  and the admin saw a Server Action failure naming no size, no field and no
  remedy — an uploader that simply did not work. The gallery (10 MB) and avatar
  (5 MB) uploaders had the same ceiling. **The general form: a size limit
  enforced by infrastructure produces no message a user can act on, so the
  application's own validator must be the stricter of the two.** Compress in the
  browser first and validate the *compressed* file; then the limit describes what
  gets stored, and a rejection only happens for a file nothing could rescue.
  `test/unit/image-uploads.test.ts` compares `bodySizeLimit` against every entry
  in `UPLOAD_SIZE_LIMITS` so the two cannot drift apart again. Note the platform
  in front of the app has its own cap (4.5 MB on Vercel) which is lower than the
  10 MB one validator used to claim.

- **A reader census that greps for a key name is satisfied by the writer.**
  `branding.favicon` and `branding.dashboardLogo` each had an admin control and
  **no reader anywhere**, and passed `settings-keys-read.test.ts` because the
  uploader that writes them names them as string literals. So an admin uploaded
  a favicon and a dashboard logo, saw both stored, and watched the browser tab
  and the sidebar keep the shipped assets for ever — the exact failure
  `UNIMPLEMENTED_CONFIG_KEYS` exists to make honest. A census over "is this
  string present" cannot tell a read from a write; where that distinction is the
  whole point, assert the *reader* by name and by file.

- **Awaiting in a layout changes when everything below it mounts.** Reading
  `getPublicSettings()` in the dashboard's server layout — to hand a logo down —
  put a database round trip on every dashboard navigation *and* tripped a race in
  the client shell's mount-time effects, so every navigation logged the reader
  out. Neither cost was visible in the diff. A value that only decorates belongs
  on a path that cannot delay or break the page: this one is a client fetch of a
  key that is in `PUBLIC_CONFIG_KEYS`, so it needs no token and its worst failure
  is a missing logo.

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

- **A regression test can be green before the fix because the defect was already
  fixed by somebody else.** WO-90 said the workers route answered 500 on a
  concurrent duplicate. The concurrency test written to see that 500 passed
  against the unmodified code: `routeErrorStatus` had routed `P2002 → 409` since
  the TEST-18 work, and the order was written from a reading of the file that
  predated it. A work order is a hypothesis; the red run is what confirms it.
  What *was* wrong turned out to be one line the order never mentioned — the
  message did not say which field collided.
- **A guard that two independent clauses enforce cannot be red-checked by
  deleting one.** The retention sweep excludes an approved-then-deactivated
  member by `approvedAt IS NULL` *and* by the tombstoned phone. Removing either
  alone left the test green, which is the point of defence in depth and also
  means the red check has to remove both to prove the test discriminates. Say so
  in the test rather than deleting the redundant clause to make the check
  simpler.
- **`audit_logs` is append-only, so every assertion about it is a delta.** A test
  asserting exactly one `MEMBER_ERASED` row passed on a clean database and found
  three after two red-check runs, because `t.Cleanup` cannot delete from that
  table. Count before, count after, and read the newest row.

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

- **A test cannot clean up after itself in `audit_logs`.** The DATA-08 trigger
  refuses `DELETE` unless the transaction has set `hasnahena.allow_audit_purge`,
  so a `t.Cleanup` deleting audit rows fails, is ignored because the cleanup
  discards the error, and the next run counts two where it expected one. Assert
  on a **delta**: read the count before, read it after. The same applies to any
  assertion over a table something else has appended to.
- **A hardcoded unique value in a shared-database suite passes until another
  suite runs first.** `withdrawal_status_integration_test.go` seeded its fixture
  with phone `01955500001`, which is the number `apps/web/test/routes` gives
  `nextroute-member`. Both suites use the same database, so the whole file failed
  on `users_phone_key` when the route suite had run first and passed when it had
  not — and `pnpm test:integration` alone always passed. Namespace every unique
  column to the suite that owns it, and prove it by running the two suites in
  **both** orders.
- **Comparing whole response bodies compares the clock.** The API envelope
  carries `meta.timestamp`, so a test asserting two responses are byte-identical
  — which is the only way to state "this endpoint is not an oracle" — passes when
  both land in the same second and fails when they do not. Normalise the envelope
  first; the fingerprint that matters is the status and everything except `meta`.
- **A red run for the wrong reason is not evidence.** Reverting WO-87's fix to
  prove its test could fail produced `unused argument: 0`, because the
  reconstructed statement no longer referenced `$1` — the test went red on a pgx
  error rather than on the cross-account write it exists to catch. Read *why* the
  red run failed, not just that it did.

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

- **A canvas re-encode to JPEG destroys transparency, and JPEG is the obvious
  default.** `downscaleImageFile` filled the canvas white before drawing —
  correct for a photograph of an NID, and the reason a transparent signature did
  not come back on a black background. Reused for brand images it would have
  baked a **white rectangle behind every logo**, visible the moment one sat on a
  coloured header. Alpha is a property of the *purpose*, not of the compressor:
  `IMAGE_PRESETS` marks which uploads keep it, and those encode WebP. Never name
  an output `format` in a Cloudinary transformation for the same reason.

- **`useState(prop)` is a one-time seed, and on a screen that fetches its data
  the prop arrives afterwards.** `ImageUpload` seeded its preview from
  `currentImage` and never looked again, so on Content & Media — which loads
  settings with SWR — every brand field mounted with `undefined` and kept the
  empty drop zone for the rest of the session. An admin with a logo already
  uploaded saw a screen telling them there was none, and uploaded it again. Sync
  in an effect, and guard the case the reader is mid-edit (here: a `blob:`
  preview must not be replaced by a server value landing behind them).

- **A generic UI primitive with English string literals is invisible to the
  translation census.** `ImageUpload` said "Drag and drop your image here", "or
  click to browse", "Choose Image" and "Uploading..." — so the Bengali dashboard
  rendered English chrome under Bengali headings and Bengali descriptions.
  Nothing could see it: `messages.test.ts` compares the two message files, and a
  string that was never in either has nothing to be compared against. Pass the
  copy in from the call site, which already knows the locale.

- **A `flex` section makes its container a flex item, and a flex item with no
  width shrinks to its contents.** The hero was
  `<section class="… flex items-center">` wrapping `<div class="container-wide">`
  — and `container-wide` is `mx-auto max-w-7xl px-…`, which sets a *maximum* and
  no width at all. So the hero's width was whatever its own text measured: the
  headline started ~200 px right of the logo above it and of every section
  below it, and it **moved when the language changed**, because Bengali is the
  wider script. It moved again whenever the copy or the figures were
  reworded. Nothing over the source could see it — the page does not scroll
  sideways, no text is clipped, and each language looks self-consistent until
  the two are put side by side, which is why it survived an audit that measured
  overflow at six widths in both languages. Add `w-full`, and measure the
  headline against a fixed part of the page in a browser
  (`e2e/matrix.spec.ts`). **The general form: centring a section vertically
  with flex silently changes the sizing rules of everything inside it.**

- **That the database knows a number does not mean the number may be
  published.** The home page's four statistics were invented literals — "125+
  members", "BDT 250,000+ deposits" — so they were moved into `system_config`,
  which left the hero blank until somebody typed something, which read to the
  owner as a broken screen. The obvious fix, and the one taken: **count them.**
  The platform holds the members, the ledger and the loan book, so the figures
  became `SELECT count(*)` and three sums — true by construction, never stale,
  no admin work, and every engineering argument on its side.
  It lasted a day. The owner's ruling was that the fund's real member count and
  real balances are **not for publication**: a cooperative may describe its
  scale without opening its books to anyone who loads a page, and a headline
  that moves with every deposit is not a headline. The figures are stated in
  settings and `lib/public-stats.ts` was deleted rather than switched off, with
  `test/unit/public-figures.test.ts` asserting its absence — because the next
  person to see four hand-maintained numbers beside a database that knows all
  four will reach for exactly this change, and will be right about everything
  except the part that decides it. **"Can we derive it?" is an engineering
  question. "May we publish it?" is the owner's, and it is asked first.**
- **`aria-hidden` on a decorative wrapper becomes a content wrapper the moment
  the decoration gains children.** The hero's geometric panel carried
  `aria-hidden="true"` on its root, correctly, while it was a drawing. Putting
  the foundation's figures inside it would have hidden every one of them from
  every screen reader — the numbers, their labels, and the heading — with no
  visual difference and nothing in any test to say so. The attribute belongs on
  the `<svg>`, not on the box.
- **A long number wraps between its own digits, and only at a real viewport
  width.** `BDT 4,796,100` in half of a 420 px panel rendered as "BDT 4,796,1 /
  00" on the phone hero — on the page asking to be trusted with money. The
  cause was a `break-words` added for a *different* concern (Bengali being the
  wider script), which turns a number into something breakable anywhere. A
  number is one word however long it is: widen the column instead. Two columns
  now exist only above the width where a seven-digit total fits on one line.

- **An application-level check that is stricter than the constraint it
  anticipates is invisible, and it always wins.** Staff creation looked a
  contact up with `OR: [{ email }, { phone }]` and no `liveIdentityFilter`, so a
  person whose membership application had been *refused* could not be hired as a
  field worker: the screen said "that email address is already in use" and named
  a row `users_email_live_key` does not consider to hold it — the database would
  have accepted the insert. Nothing failed, nothing logged, and the only way out
  was an admin with SQL. **A pre-check exists to turn a constraint violation
  into a sentence; when the two disagree, the pre-check is the bug**, because it
  runs first and the constraint never gets to speak. The rule had been written
  down in CLAUDE.md and in `product.md` for a day, and written down is not
  enforced — the census over every `prisma.user.find*` that filters on a contact
  detail is.

- **A page whose layout depends on an admin having filled a box in looks broken
  on launch day.** The hero's right-hand column was four statistic cards; when
  those figures moved out of the message files into `system_config` — correctly,
  they had been invented — an unconfigured foundation was left with a hero whose
  right half was empty. The fix is not to seed a number back: it is that the
  hero always has a visual of its own and the figures are a band below it that
  appears when there are figures. **Design the unconfigured state first**; it is
  the one every new deployment sees, and the only one the owner sees before they
  have anything to say.

- **A spec that drives a third-party service cannot run in CI, and failing is
  not the same as being honest about it.** `entry-path.spec.ts` filled the
  registration form and submitted it, which uploads four documents to
  Cloudinary. CI has no credentials on purpose — that account holds real
  members' NID scans — so `POST /registrations` rolled the application back
  every time and six tests failed for twenty minutes a run, on every push. The
  answer was to separate what each test is actually about: four of the six are
  about the *decision*, so they seed the applicant row and run everywhere; the
  two that are about what the applicant is *shown after submitting* skip, and
  say why. A test that needs a service the environment cannot provide should
  skip loudly, never fail quietly into the noise.

- **A CSS `auto` silently overrides the size you just computed.** `logo.tsx`
  derived a width from its `size` prop, passed it to `next/image` as the `width`
  attribute, and set `h-auto w-auto` in the className. A replaced element sized
  `auto`/`auto` renders at its **intrinsic** dimensions, so the attribute did
  nothing: `sm` and `md` both measured 192×108, inside a 64 px header. The prop
  had no effect at any call site, which is why nobody could have fixed one page
  without finding this. Nothing in the suite could see it either — the page does
  not scroll sideways, no text is clipped, and an oversized image is not an
  untranslated key. **When a size prop appears to do nothing, measure the
  rendered element before changing the number**; the matrix sweep now does, on
  every page with a logo.

  **And then the fix over-corrected.** Constraining the lockup to 40 px made it
  obey its header and made the wordmark unreadable — the tagline beneath
  হাসনাহেনা is two lines of small Bengali type, about eight pixels each at that
  size, on a platform whose members read it on a cheap Android in sunlight. A
  ceiling without a floor is half an invariant: the assertion is now
  `36 ≤ logo ≤ header`, and the header is sized to hold the lockup (`h-24`,
  shrinking to `h-16` on scroll) rather than the lockup shrinking to fit a
  header nobody chose.

- **A loading skeleton is a lie when nothing is loading.** The home page's
  partner-logo block rendered three grey `animate-pulse` rectangles as its
  *else* branch — the state for "no partner logos are configured". They had been
  shimmering on the live site under the heading "Trusted by community" since the
  page was written, and they read as a page that never finishes loading.
  **`animate-pulse` belongs to a pending request, never to an empty
  collection.** An empty collection renders nothing, or says it is empty.

- **A number in the copy is a claim, and copy has no owner.** "125+ Total
  Members", "BDT 250,000+ Total Deposits" were literals in
  `messages/{en,bn}.json`, invented when the page was designed, live for months,
  and unchangeable by the foundation whose figures they were. Nothing was wrong
  with them technically: both languages had them, the parity census passed, and
  they were correctly translated into Bengali numerals. **A figure a page states
  about the organisation belongs in `system_config`, not in a message file** —
  a message file is for words the software says, and this is a fact the
  foundation asserts.

- **A dead control on a public page advertises a feature that does not exist.**
  The gallery's Like button toggled a heart, incremented a count in the DOM, and
  persisted nothing — no endpoint in either backend accepts a like. For a
  signed-out visitor it went further and raised a red "Login Required" toast,
  telling them that liking is a members' feature. It was removed rather than
  implemented. The rule `UNIMPLEMENTED_CONFIG_KEYS` states for settings is the
  same rule: **a control that does nothing is worse than no control, because it
  will eventually be trusted.**

- **A page can be in the sitemap and reachable by nobody.** The menu pointed at
  `/#about`, `/#donate` and `/#contact` while `/about`, `/donate` and `/contact`
  existed as real pages with different content. The link crawl found 24 links to
  `/#about` and exactly one to `/about` — the language switcher on the page
  itself. `/#features` was worse: no element on the home page has ever had that
  id, so the menu item scrolled nowhere on every page it appeared on.
  **Crawl the rendered links, not the route list.** A route that exists, builds,
  prerenders and appears in `sitemap.xml` can still be unreachable, and no test
  over the source can tell.

- **A segment's `not-found.tsx` does not catch an unmatched URL.** It only
  catches `notFound()` thrown from *inside* that segment, and a URL that matches
  no route never reaches the segment at all — so `app/[locale]/not-found.tsx`
  renders for nothing. Verified on all three shapes this site can produce:
  `/nonexistent`, `/bn/nonexistent` and `/fr` (an unknown locale, where the
  layout itself calls `notFound()`) all land on `app/not-found.tsx`. The
  consequence is that the 404 renders **outside** `app/[locale]/layout.tsx`,
  which is where next-intl's provider and the font variables live: there is no
  `useTranslations`, and no locale to translate into either. Say it in both
  languages and import `globals.css` directly.

- **Prose in a component is invisible to every guard, and legal pages are all
  prose.** `/privacy` and `/terms` each carried a `content = { en: …, bn: … }`
  object, which is the inline-string problem wearing a different shape: the
  parity census, the placeholder check and the fee-promise search all read
  `messages/{en,bn}.json` and none of them read that object. It is the same
  reason the Terms once promised administrative fees in both languages with
  every check green. Both pages are shells around `legal.*` now.

- **A revision date is a claim about the document, and it goes stale in
  silence.** Both legal pages printed `Last updated: March 2026` as a literal,
  through two rewrites of the loan clause — one deleting the promise of
  administrative fees, one denying a late fee. A member who had read the March
  version had no way to learn what they agreed to had changed. The dates are
  constants in `lib/legal.ts` now, next to nothing else, so changing the wording
  and changing the date are one edit in one place.

- **A workaround can be the thing that makes the defect unfixable.** Rejecting a
  registration overwrote the applicant's email and phone
  (`rejected+<id>@hasnahena.local`) so the unique constraint would let them
  apply again. It worked, and it was the reason nothing could tell the applicant
  they had been rejected: the address was destroyed by the statement that
  recorded the decision. Six months of "why does nobody hear back?" had its
  cause in a line written to solve an unrelated constraint problem. **Before
  adding a notification to a flow, check whether an earlier step has already
  thrown away what the notification needs.** The fix was not to send the email
  sooner — it was to scope uniqueness to live rows so nothing had to be
  destroyed at all.

- **Removing a workaround silently breaks whatever was reading its
  side-effects.** That same tombstone was how `retention_repository.go`
  identified a rejected application: `phone LIKE 'rejected-%'`. Deleting the
  scramble would have left the daily sweep matching **nothing, ever again** —
  running on schedule, logging success, reporting zero cleared, and retaining
  every rejected applicant's NID and addresses indefinitely. Zero cleared is
  also what a correct sweep reports on a quiet week, so nothing would have
  looked wrong. Grep for the *value* a workaround writes, not just for the code
  that writes it, and give the concept one definition all its readers share.

- **A form's "default" is a writer, not a fallback, when the form posts every
  field.** The admin Settings screen held its own `DEFAULT_ORG_SETTINGS` for any
  `org.*` row the database lacked, and submitted the whole object on save. It
  disagreed with `scripts/seed.mjs` about the foundation's own name — `Hasnahena`
  against `Hasnahena Foundation` — so an admin who changed the phone number and
  pressed Save silently renamed the organisation everywhere the name is
  published: the JSON-LD, the letterhead of every generated document, the
  browser tab. It had already happened; the wrong name was recorded on the task
  board as a settings row somebody had mistyped, and correcting the row by hand
  would have held exactly until the next save. **Ask of any default: is it shown,
  or is it sent?** If it is sent, it is a second copy of the seed and needs a
  test that reads both files — `org-defaults.test.ts` is that test. The tell that
  this had been happening for a while: `getOrgNameEn()` in
  `lib/documents/theme.ts` carries a hand-written guard reading
  `name.toLowerCase() === 'hasnahena' ? BRAND_NAME_EN : name`. Somebody saw the
  short name arrive on a PDF and defended the PDF. **A downstream fallback
  written against one specific wrong value is evidence of an upstream writer**,
  not a fix for it — the JSON-LD and the browser tab had no such guard.

- **A timestamp is not a unique value, however precise it looks.** Staff account
  numbers were `STF-${Date.now().toString(36).toUpperCase()}`. Two admins adding
  two *different* workers within the same millisecond collided on `accountNo`,
  which is `@unique` — so the second create raised `P2002` on a column neither
  of them had sent, and the 409 told them to change an email and a phone that
  were both fine. Random bytes, or a sequence.

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

**`x-default` is not the default locale, even when the two hold the same value.**
It was written out as `'en'` when `defaultLocale` was `bn`, because they answer
different questions: *what this site is primarily in* versus *what to serve a
reader the site was not built for*. WO-94 made the site's default English, so the
two now agree — and the line is still written out, because collapsing it would
make a future change to one silently change the other, and the failure it
produces (every unmatched reader in the world sent to a page they cannot read) is
invisible from inside Bangladesh. A constant that happens to equal another
constant is not the same constant.

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
- **A security mechanism can be built, enforced and wired to the wrong half of
  the problem.** Token revocation was correct on both backends and called from
  the logged-in password *change* — the path taken by someone who still controls
  the account — and not from the forgot-password *reset*, the path a member
  reaches because they have lost control of it. Every component passed its own
  test. When auditing a control, do not ask whether it works; ask which paths
  reach it, and whether those are the paths that need it.
- **An oracle closed at the status code can still run on the clock.** Making
  every login answer `401 AUTH_INVALID_CREDENTIALS` leaves an unknown identifier
  answering in microseconds and a real member's wrong password taking ~60 ms,
  because only one of them reaches bcrypt. Equalise the work, not just the words.

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

- **Changing the default locale does not change any code — it changes what
  every untested assumption was hiding.** Bengali was the default for the
  project's whole life, so a Bengali string written straight into a component
  looked right on every page anyone opened, and a locale switch that only ever
  ran with a prefix present was never asked to add one. Making English the
  default (WO-94) did not break these; it *revealed* them, all at once, on the
  live site. Budget for a sweep of rendered pages after any such flip, not a
  sweep of the diff — the diff is where they are not.
- **There is no correct way to swap a locale with `String.replace`.** Under
  `as-needed` one of the two locales has no segment to replace, so the match
  lands somewhere else: `localePath('en')` is `/`, and
  `pathname.replace(localePath(locale), '/bn')` therefore rewrote the **first
  slash** of `/dashboard/admin` and produced `/bndashboard/admin`. It
  typechecks, it renders, and only a click reveals it — the language button on
  every staff screen went to a 404. `switchLocalePath` is the only sanctioned
  spelling, and `locale-routing.test.ts` bans the shape rather than the
  instance.
- **Playwright matches an accessible name by substring by default.**
  `getByRole('link', { name: 'EN' })` matched the logo, whose alt text is
  "Hasnah**en**a Foundation", so the first version of the language-toggle spec
  clicked the logo and passed without ever touching the button it was written
  for. Pass `exact: true` whenever the name is short enough to be a substring of
  something else — which two-letter language codes always are.
- **A `system_config` value that is prose needs one row per language.** There
  was a single `org.address`, so whichever script the admin typed it in was
  shown to both audiences: the Bengali address appeared under an English
  "Address" heading on the home, contact and support pages and in the footer of
  every public page, and on the letterhead of every generated document, which
  [ADR-012](decisions.md) makes English only. `org.name`/`org.nameEn` had
  already solved this; the address now has the same pair. Nothing over the
  source can catch this class — the string is in the database, not the repo — so
  the guard is a unit test on the pair plus an e2e test on the rendered page.
  **And that guard did not catch the next one.** `org.description` was still a
  single row four months later, and neither half of the guard could see it: the
  pair test only knows about pairs somebody has already made, and the e2e test
  reads *rendered pages*, while the description's only reader is the JSON-LD in
  `organizationSchema()` — a surface no member ever looks at, whose whole
  contract is that it is English, and which was publishing the foundation's
  Bengali self-description to every search engine and assistant on both
  locales. When splitting one of these, **enumerate the prose keys and check
  each**, rather than fixing the one that was reported: `org.name`,
  `org.address` and `org.description` were always the same bug three times.
  **It then happened a fourth time**, because that instruction was written and
  not carried out. The T-09 audit found nine more — `hero.tagline`,
  `features.title`, `contact.title`, three `donation.*`, `navigation.donate`,
  `auth.welcomeBack` — every one a single box labelled in English on the admin
  screen. The list is the fix, not the key: `LOCALIZED_SETTING_PAIRS` in
  `lib/localized-settings.ts` names all twelve pairs, one resolver reads them,
  and the census reads source **line by line** and fails on a pair key named
  anywhere that does not also call the resolver. That last detail matters: the
  first version of the census searched for `settings['…']` and walked straight
  past `trimmed(settings, 'org.name')` in the JSON-LD builder, which is the
  reader that hid `org.description` for four months in the first place.
- **An e2e test that reads rendered text must strip what an admin typed.** A
  cooperative in Jashore legitimately has Bengali in its own settings, and a
  test that goes red because someone edited a database row gets deleted rather
  than read. `locale-content.spec.ts` fetches the public settings and removes
  their values before asserting, so it only ever fails on copy the code owns.

- **A redirect at the root is what makes `/` and `/bn` duplicates, not the
  choice of default locale.** Search Console reported *"Duplicate, Google chose
  different canonical than user"* on `/bn` with a Google-selected canonical of
  `/`. `/` was 307ing to a negotiated locale; Google merges a redirecting root
  with whatever it lands on and keeps the shorter URL. Flipping `defaultLocale`
  from `bn` to `en` would have moved the report to `/en` and changed nothing
  else. The fix is that `/` renders (WO-95, [ADR-034](decisions.md)).
- **next-intl's `as-needed` redirect is a 307, and a 307 is not a canonical
  signal.** Google treats a temporary redirect as reversible and may keep
  indexing the old URL. Every `/en/*` URL that is already out in the world has
  to answer **301**, which means doing it in `proxy.ts` before next-intl runs.
- **`localePrefix` is a routing rule, not a directory rule.** `app/[locale]/`
  is unchanged, `generateStaticParams` still yields both locales, and the
  prerender manifest keys are still `/en/...` — next-intl *rewrites* `/faq` to
  `/en/faq` internally. `assert-static-routes.mjs` reads the manifest, so it
  needed no change; rewriting it to match the public URLs would have made it
  report every English page as missing.
- **Switching to `as-needed` turns every hand-built `/${locale}/…` into a
  redirect.** Twenty-two files did it, and under the old `always` scheme it was
  merely repetitive. Afterwards each one produces `/en/faq`, which 301s — so a
  member tapping a header link pays a round trip and a crawler is told the href
  it was given is not the real URL. One `localePath()`, and a census on the next
  one.
- **`pathname.replace('/en', '/bn')` was never a language switch.** It matches
  `/enrolment`, and under `as-needed` the English pathname has no segment to
  replace at all. Split on `/`, check the first segment against the locale list,
  and rebuild.
- **A `Vary` that is not true is not free.** `Vary: Accept-Language` was the
  correct fix for a cacheable, negotiating root. Once nothing negotiates it is a
  CDN cache entry per distinct header value on the busiest pages the site has,
  bought for a property nothing needs. Deleting it is part of the change, not a
  loose end.
- **A URL in an email is not a URL in a page.** A link that 301s is fine in a
  header and wrong in an approval email: emails outlive the deploy that wrote
  them, they are forwarded, and some clients and corporate link scanners resolve
  a redirect before a person ever clicks. When a URL shape changes, the email
  templates are a separate surface from the pages — and in this repository they
  are in the *other language*, which is why a sweep of `apps/web` found none of
  them.
- **A guard's coverage can shrink as the code improves.** The fee-promise census
  walked `app/` and was complete only because almost all the copy lived there.
  Moving 73 strings into `messages/{en,bn}.json` — the *correct* change, rule 5 —
  moved them out of its reach, silently. When copy, config or logic migrates out
  of a directory a census walks, the census moves with it or it quietly becomes
  a check on a shrinking subset.
- **A lint rule can be silenced by making its input unanalysable.**
  `window.location.href = '/en'` warns; `window.location.href = localePath(locale)`
  does not, because the rule cannot see a literal any more. The warning count
  went down and the code was no better. If a rule stops firing after a refactor,
  check whether it was satisfied or merely blinded.

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
