# ADR-008 — Member IDs are `ACC-KH-#####`

**Status:** accepted · commit `5db86b7`.

Account numbers are human-readable and branch-prefixed (`ACC-KH-33001`) because they are read aloud and written into paper passbooks. Generation lives in `apps/api/internal/utils/account_no.go`. Primary keys remain `cuid()` — the account number is a display identifier, never a foreign key.

`users.accountNo` is the platform's **only** member identifier — see [ADR-023](adr-023-one-member-identifier-usersaccountno.md) and [ADR-029](adr-029-the-identifier-is-called-an-account-number.md) for why it is spelled that way.

The one-off backfill (`scripts/migrate-member-ids.sql`) was deleted 2026-08-19 once it had run everywhere: it renumbers every member in one transaction, which is destructive against a live database and useful to nobody now. Recover it from `5db86b7` if it is ever needed again.

---

[← all decisions](../decisions.md)
