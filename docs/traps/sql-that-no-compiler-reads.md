# SQL that no compiler reads

- **A dropped column referenced from a Go string is invisible to every build
  step.** After ADR-044 dropped `accounts.id`, `documents.id`, `nominees.id` and
  `addresses.id`, three statements still named them through 1,332 green tests:
  every member-detail screen failed to load, the approvals queue's `jsonb_agg`
  broke, and a loan-instalment confirmation wrote `WHERE id = $2`. The nightly
  `restore-check.sh` had been failing on the same kind of join.
  `TestEverySQLLiteralMatchesTheSchema` (`sql_schema_census_test.go`) parses
  every Go file with `go/ast` and `PREPARE`s each statement literal against
  Postgres, naming file and line on a miss.
- **Skip by shape, never by message.** The census skips a literal that is an
  operand of `+` (a runtime fragment) and one inside a composite literal (a table
  of examples for another test). It parses rather than greps because a backtick
  in a doc comment is not code; filtering failures by message text is the
  version that hides a real error.

---

[← all traps](../traps.md)
