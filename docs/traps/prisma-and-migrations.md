# Prisma and migrations

- **The test stack cannot review a data migration, because it has no data.**
  `scripts/test-stack.sh` builds from zero, so every migration runs before a
  single row exists: one that rewrites *shape* is exercised, and one that rewrites
  *data* passes for free. Both id migrations proved it — the first was refused by
  the owner's database and by nothing here. Rehearse on rows instead, which takes
  ten minutes: apply every migration **except** the new one to a scratch
  database, insert one row of each shape it has to survive (a printed receipt, a
  member's own reference in the same column, a row with the value missing, a row
  pointing at a key that is about to move, one audit row per `entityType`), then
  run it and read the tables back. That rehearsal is what showed a disbursement
  carrying its loan's number, and it is the only place the assertions in the
  migration's own `DO $$ … $$` blocks were ever executed against something that
  could trip them.
- **A migration that fails leaves Prisma's advisory lock on an idle pooled
  backend, and every later `migrate` blames the server.** After the
  first `user_id_history` migration was rejected by the append-only trigger, the next
  `pnpm db:migrate` said *"Please make sure your database server is running"* and
  *"Timed out trying to acquire a postgres advisory lock"* — against a database
  that answered `SELECT 1` immediately. The holder was a session whose
  `application_name` was **pgbouncer**, idle, still owning `72707369`. The
  message names the wrong thing twice: the server is fine and the timeout is not
  a cold start. Find it and kill it:

  ```sql
  SELECT l.pid, a.state, a.application_name
    FROM pg_locks l JOIN pg_stat_activity a USING (pid)
   WHERE l.locktype = 'advisory' AND l.objid = 72707369;
  SELECT pg_terminate_backend(<pid>);
  ```

  Then `prisma migrate resolve --rolled-back <name>` before re-running, or Prisma
  refuses to start with the failed migration still recorded.
- **A migration that is only ever run against an empty database is only ever
  tested against an empty database.** The `audit_logs` UPDATE in the first
  version of the user-id migration passed the entire test stack — because the
  stack builds from zero and every migration runs before a single audit row
  exists, so the trigger never fired. It failed on the first database that had
  history in it, which was the owner's. When a migration rewrites *data* rather
  than shape, the suite that proves it works is the one run against a database
  with rows in it.
- **A primary key that changes has exactly one hazard, and it is the caller
  holding the old value across the change.** `users.id` became the person's own
  number, which means it moves once — from `APP-2026-000001` to `ACC-KH-33001` —
  at approval. Every foreign key cascades, so the database is consistent the
  instant the statement commits, and every test over the database passed. What
  broke was a *browser*: the approvals screen approves, then immediately files
  the new member's documents at `/api/v1/admin/members/{id}/refile-documents`
  using the `id` it read from the queue before the approval. 404, silently, into
  a `void` promise. Nothing in the schema, the compiler or any unit test could
  see it; the end-to-end journey that spans the rename is what found it. If a key
  can move, the thing to audit is not the foreign keys — those look after
  themselves — it is every value already in flight when it moves.
- **`_prisma_migrations` is a table like any other, and emptying it turns a
  deploy into a replay from zero.** It can be cleared by hand in a database
  console, by a restore that did not include it, or by copying a database
  without it. Prisma then believes nothing has been applied and `migrate deploy`
  starts at the first migration, failing on `CREATE TABLE "users"` against a
  database that obviously has `users` — an error about a table, for a problem
  about history. The two-command diagnosis is `db:migrate:status` saying none are
  applied while `db:migrate:check` says "No difference detected": everything ran,
  nothing was recorded. `pnpm db:migrate:adopt` records them all and executes
  none, and refuses if the drift check disagrees — because marking migrations
  applied against a schema that is genuinely behind converts a loud failure into
  a database Prisma believes is current and that is missing columns.
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
- **`prisma migrate diff` cannot see a rename.** Renaming `users.memberId` to
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

---

[← all traps](../traps.md)
