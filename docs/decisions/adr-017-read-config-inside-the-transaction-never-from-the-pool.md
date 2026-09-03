# ADR-017 — Read config inside the transaction, never from the pool

**Status:** accepted · 2026-08-18.

Adding one unconditional `getWithdrawalNoticePeriodMonths(ctx)` call inside
`AddMemberWithdrawal` hung `TestConcurrentWithdrawalsCannotOverdraw`
**permanently** — not slowly, not flakily. Nothing errored and nothing timed out
on its own.

The cause is that the plain config readers use `r.db`, the pool. Called while
holding a transaction, each one takes a *second* connection. With N goroutines
and a pool of N, every connection is held by an open transaction and every
transaction is waiting for a free connection to read a config key. The pool is
empty and stays empty, and no participant is doing anything wrong.

**This was already latent.** `AddMemberWithdrawal` read
`loan.allowActiveLoanWithdrawal` from the pool inside its transaction and
escaped only because `activeLoan > 0 &&` short-circuits it away in the common
case. The test that exposed it had been green for weeks over code one boolean
away from deadlocking.

So the readers come in pairs: `getSystemConfigInt64` for callers outside a
transaction, `getSystemConfigInt64Tx(ctx, tx, …)` for callers inside one. The
pool-based variants that no longer had a caller were **deleted** rather than
left available, because `unused` flags them and a dead-but-callable helper is an
invitation to reintroduce the deadlock. The Tx variants also read what the
transaction can see, which is the correct answer rather than an incidentally
similar one.

**Consequence:** inside a repository transaction, use the `…Tx` reader. If you
add a new one, add it in both forms only when both are actually called.

---

[← all decisions](../decisions.md)
