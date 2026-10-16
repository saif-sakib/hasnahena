# ADR-016 — A withdrawal notice is the member's request, not a field on the payout

**Status:** superseded 2026-08-24 by
[ADR-030](adr-030-staff-pay-a-withdrawal-when-the-member-asks.md) · accepted
2026-08-18 · implemented FR-08.

**Superseded in its conclusion, not in its findings.** The notice period is gone;
the two facts this ADR discovered on the way to it are not, and both are load
bearing. *A `transactions` row is not necessarily money that moved* is now
CLAUDE.md rule 6a and the reason four aggregates filter on status. *A payout
settles the member's row rather than inserting a second one beside it* is still
exactly what `AddMemberWithdrawal` does with an outstanding request. Read the
Consequences below for those; read ADR-030 for what replaced the gate.

`loan.noticePeriodMonths` existed as a config key, was editable in the admin
settings page, and **was read by nothing**. The screen said "3 months" and the
system applied no notice period at all — the settings page even carried a label
saying so. A control that reports a policy the system does not apply is worse
than no control, because it eventually gets trusted.

Two shapes were considered. The go-live plan (since folded into [runbook.md](../runbook.md)) suggested a *policy field
on the withdrawal*: `noticeGivenAt` and the applied period stamped on each
`transactions` row. That is a migration plus a place for a worker to type a date
somebody told them.

**The chosen shape needs no schema change, because the record already exists.**
A member requesting a withdrawal *is* giving notice. `CreateMemberWithdrawalNotice`
files a `PENDING` `WITHDRAWAL` row; its `createdAt` starts the clock; the payout
settles that same row rather than inserting a second one.

**The gate is on both paths that can move the money.** `ApproveWithdrawal`
(admin) and `AddMemberWithdrawal` (the worker at the desk) each refuse until the
notice matures. A check on the approval alone would have been bypassable by the
payout, which is the shape of half-enforcement this ADR exists to avoid.

It also closes a standing rule-4 gap. `AddMemberWithdrawal` could previously
originate a withdrawal from nothing — a worker moving a member's money with no
request behind it. It now requires a notice to settle, so the worker is always
settling something the member asked for.

**Consequences**

- **A `transactions` row is no longer necessarily money that moved.** A
  `WITHDRAWAL` row is either a notice (`PENDING`) or a payout (`CONFIRMED`).
  Four aggregates were summing every row regardless of status and are now scoped
  to `CONFIRMED` — they had the same latent error for `PENDING` deposit
  requests, which they were already counting as income. **Any new aggregate over
  `transactions` must filter on status.**
- A notice covers *up to* the amount announced. Withdrawing less than you gave
  notice for is allowed; more needs its own notice.
- Outstanding notices count against the balance, or three separate notices for
  the whole balance could all be presented once matured.
- `0` is a legitimate value and means no notice period. It is written, not
  deleted — deleting the key restores the 3-month default silently.
- Members need a way to give notice, so the member deposits screen carries the
  form. Without it, FR-08 would simply have stopped withdrawals.

---

[← all decisions](../decisions.md)
