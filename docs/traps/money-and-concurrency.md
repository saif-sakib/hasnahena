# Money and concurrency

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
  or read it `FOR UPDATE` inside the same transaction ([ADR-015](../decisions.md)).
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
  ([ADR-016](../decisions.md)). Still true after [ADR-030](../decisions.md) removed the
  notice: staff can pay without a `PENDING` row, and a `PENDING` row can sit
  unpaid, so neither direction lets you skip the filter.
- **The same function can write one correct record and one wrong one.** Every
  posting wrote an audit line with `%d BDT` — correct — and a member
  notification with `BDT %.2f` from a `float64`. A test reading either alone
  would have passed the code. The int64 ceiling rendered as `…808.00`.
- **A ledger row is not proof that money moved, and money moving is not proof of a
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
- **A disputed posting is money that moved.** Disputing a `CONFIRMED` transaction
  flips its status and changes no balance. Any reconciliation, aggregate or report
  that treats status as a proxy for "did this happen" has to decide about
  `DISPUTED` explicitly — [ADR-026](../decisions.md).

---

[← all traps](../traps.md)
