# ADR-027 — The reconciliation job reports and never repairs

**Status:** accepted

**Context.** WO-82 (OPS-07) sums the ledger and compares it to the stored
balances. The obvious next step, once drift is detected, is to correct it.

**Amended 2026-08-27: the pass runs daily, not hourly.** The cadence was never
part of this decision and is a cost one. The database this runs against suspends
its compute when nothing is connected and bills for the time it is awake, so an
hourly pass is twenty-four wakes a day — each holding the compute up for its
whole idle timer — to answer a question that, by the rest of this ADR, *nobody
acts on automatically anyway*. Drift is corrected by a human appending a posting,
the paper passbook is the reconciling record ([product.md](../product.md)), and a
day's latency on a check whose output is an audit row and a gauge changes nothing
operationally. `RECONCILE_INTERVAL` still overrides it, and
`internal/config/idle_cost_test.go` fails if the default creeps back under six
hours without the reasoning being revisited.

**Decision.** It never does. On drift it writes an `audit_logs` row, logs a
`slog` error, and sets the `hasnahena_ledger_drift_*` gauges. A human decides
what to do.

**Why.** An automated correction to a ledger is a second defect written on top of
the first, and it destroys the evidence needed to understand the first. If the
drift came from a lost update, the surviving value and the missing one are the
only record of what happened; overwriting the balance to match a sum erases the
question of which posting was lost and who is owed money. `audit_logs` is
append-only for the same reason (rule 6), and corrections append.

There is a practical argument too: a repair loop that is subtly wrong corrupts
every account it touches on a schedule, at night, with nobody watching.

**Consequences.** `cmd/server/wiring_test.go` reads the source of
`startReconciliationLoop` and `reconcile_repository.go` and fails on any
`UPDATE accounts`, `UPDATE loans`, `UPDATE transactions` or balance assignment,
so this stays true rather than being remembered. The one write the job is
allowed is the append-only audit row.

The job's first pass also found two live defects in `waterfallRecoveryTx` that no
existing test caught — recovery rows written `PENDING` while the savings had
already been deducted, and `accounts."loanBalance"` never reduced — which is the
argument for the whole order in one sentence.

---

[← all decisions](../decisions.md)
