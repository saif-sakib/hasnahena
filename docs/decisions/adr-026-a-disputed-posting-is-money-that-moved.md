# ADR-026 — A disputed posting is money that moved

**Status:** accepted

**Context.** [ADR-016](adr-016-a-withdrawal-notice-is-the-members-request-not-a-field-on-the-payout.md)
established that only `CONFIRMED` moved money: a `PENDING` withdrawal is a
member's notice and a `PENDING` deposit is a request, and four aggregates were
counting intentions as income.

WO-82's reconciliation needed the same question answered for the *other*
statuses, and found that `PATCH /api/v1/member/transactions/{id}/dispute` flips a
**CONFIRMED** posting to `DISPUTED` and changes no balance. The dispute is the
member's claim that the amount was wrong; it is the first step of a correction,
not the correction.

**Decision.** For reconciliation, money moved when the status is `CONFIRMED`
**or** `DISPUTED`. `PENDING`, `PROCESSED`, `REJECTED` and `REVERSED` are not
money that moved.

This does not weaken ADR-016. An aggregate over *requests* — pending deposits
awaiting a worker, income this month — still filters on `CONFIRMED` alone; a
disputed posting is not new income. The two questions are different and now have
different answers written down.

**Consequences.** `repositories.settledStatuses` is the single place the list
lives, and `TestADisputedPostingIsStillMoneyThatMoved` pins it. Had the job
counted `CONFIRMED` alone, every open dispute would have raised a drift alarm —
an alert that is always firing, which is the same as no alert.

---

[← all decisions](../decisions.md)
