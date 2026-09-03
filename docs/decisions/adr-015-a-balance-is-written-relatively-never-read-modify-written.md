# ADR-015 — A balance is written relatively, never read-modify-written

**Status:** accepted · 2026-08-17 · implemented the same day (WO-41).

Two of the three ways this codebase changes a savings balance were
read-modify-write: fetch the balance, add in Go, write the total back. One of
them fetched from the connection pool, before the transaction had even begun.

Measured against a real Postgres 17: twenty concurrent ৳1,000 deposits into an
empty account left a **৳1,000 balance and ৳20,000 of transaction rows**, and ten
concurrent ৳5,000 withdrawals against ৳10,000 of savings all succeeded. The
ledger and the balance disagreed, which for a cooperative that reprints paper
passbooks from `savingsAfter` snapshots is the worst available outcome: the
document handed to the member becomes evidence against the account.

**The rule.** Balance mutations are expressed as relative SQL and Postgres does
the arithmetic:

```sql
UPDATE accounts SET "savingsBalance" = "savingsBalance" + $1
WHERE id = $2 RETURNING "savingsBalance"::bigint
```

Guards move into the statement rather than sitting in front of it — `AND
"savingsBalance" >= $1` for a withdrawal, with no rows returned meaning
insufficient funds. Where a value genuinely must be read before it is written,
the read happens inside the transaction with `FOR UPDATE`.

**What this rules out**, and why they were considered: `SERIALIZABLE` isolation
would work but imposes a retry loop on every posting for a problem one statement
solves; an advisory lock per account adds a second lock ordering to reason about
next to the `FOR UPDATE` on `transactions`. Neither is needed.

`loan_repository.go` already followed this — which is why the default waterfall
was never affected — so the fix was convergence on existing practice, not a new
pattern. Recorded as an ADR because the wrong version is the intuitive one, and
it was written twice independently.

The guard against it coming back a third time is a test, not this document:
`TestConcurrentDepositsAllLand` and `TestConcurrentWithdrawalsCannotOverdraw` in
[`ledger_integrity_integration_test.go`](../../apps/api/internal/repositories/ledger_integrity_integration_test.go)
fail loudly against a read-modify-write. Both were confirmed to fail against the
pre-fix code before they were allowed to pass.

---

[← all decisions](../decisions.md)
