# SQL that no compiler reads

A dropped column referenced from a Go string is invisible to `go build`,
`go vet`, `gofmt`, `pnpm typecheck`, `pnpm db:migrate:check` and every test in
both suites — because none of them reads a string. ADR-044 dropped
`accounts.id`, `documents.id`, `nominees.id` and `addresses.id`; three
statements went on naming them, through a green pipeline of 1,332 tests:

- `worker_repository.go` selected `d.id` — **every member detail screen**, for
  workers and admins, answered `Failed to load member details`
- `admin_repository.go` did the same inside the approvals queue's `jsonb_agg`
- `transaction_repository.go` wrote `UPDATE accounts … WHERE id = $2` in the leg
  that confirms a **loan instalment**, which is money

and `scripts/restore-check.sh` joined on `t."accountId"`, so the nightly
backup's own integrity check had been failing since the migration — the check
that exists to notice exactly this kind of damage.

`TestEverySQLLiteralMatchesTheSchema` closes the class. It parses every Go
source with `go/ast`, takes each raw-string literal that begins a statement, and
asks Postgres to `PREPARE` it: parsing and planning validate every table and
column reference without executing anything. 344 statements, named by file and
line on a miss.

Two things it deliberately skips, both of which produced false failures in the
first version: a literal that is an operand of `+` is a **fragment** of
something assembled at runtime, and a literal inside a composite literal is a
**table of examples** feeding some other test's parser (`selectsEveryColumn` is
checked against `SELECT id FROM t`, and `t` is fictional on purpose). It parses
rather than greps because a backtick inside a doc comment is not code — the
grep version reported this test's own comment as a defect.

Skipping by *message* rather than by shape is the version that hides a real
error, which is why neither is filtered out of the results afterwards.

---

[← all traps](../traps.md)
