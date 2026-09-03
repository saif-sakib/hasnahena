# ADR-030 — Staff pay a withdrawal when the member asks

**Status:** accepted · 2026-08-24. Supersedes
[ADR-016](adr-016-a-withdrawal-notice-is-the-members-request-not-a-field-on-the-payout.md).
Directed by the owner.

[ADR-016](adr-016-a-withdrawal-notice-is-the-members-request-not-a-field-on-the-payout.md)
turned a dead config key into an enforced policy: a member filed a notice from
their own dashboard, its `createdAt` started a clock, and neither the admin's
approval nor the worker's payout could move money until it ran out. That was the
right reading of FR-08 as written, and it was tested on both paths.

It does not match how the foundation works. A member does not open a dashboard to
give notice — they tell the field worker who visits them, usually while handing
over that month's deposit. Requiring a self-service filing put a step in front of
the money that no member was going to take, and the most common outcome of the
staff withdrawal screen became a refusal explaining a form the member had never
seen.

**Decision.**

1. **A payout needs no request behind it.** `AddMemberWithdrawal` writes its own
   `CONFIRMED` row when there is nothing outstanding to settle. The rule-4
   reading that a worker "never originates money movement" is satisfied by the
   member asking in person; it was never satisfied by the notice row, which only
   recorded that the asking had happened in a particular place.
2. **There is no notice period.** `ApproveWithdrawal` and `AddMemberWithdrawal`
   both lost their maturity gate, and `ErrNoWithdrawalNotice` and
   `ErrNoticePeriodNotElapsed` went with them.
3. **The member-side notice is gone.** `POST /v1/dashboard/member/requests/
   withdrawal`, `CreateMemberWithdrawalNotice` and the form on the member's
   savings screen were all removed.
4. **`loan.noticePeriodMonths` becomes `loan.noticePeriodDays`, and is
   informational.** Days because that is the unit the foundation quotes. It is
   read by the member's savings screen and by the FAQ answer, and by nothing in
   either backend.

**What did not change, and is the reason the settlement code survives.** A
member may still have an outstanding `PENDING` withdrawal — rows filed before
this change, and any left over from the member request flow. Paying one at the
desk *settles that row* rather than writing a second one, with `amount` rewritten
to what was actually paid. Two rows for one withdrawal would double it in every
total over `transactions`, which is ADR-016's own finding and still true.

**A setting nothing enforces is normally a defect.** `UNIMPLEMENTED_CONFIG_KEYS`
exists to name exactly that failure, and ADR-016 was written to fix an instance
of it. The distinction that keeps `loan.noticePeriodDays` out of that list is
that it is **read**: two screens render the number, so changing it changes what
members are told. What it no longer does is block a payout, and the admin control
says so in as many words — an admin who believes this gates money will not
understand why a withdrawal went through.

**Consequences.**

- **FR-08 changed meaning.** `docs/product.md` and `docs/tasks.md` describe the
  member's withdrawal as a request made in person and paid by staff.
- **Two tests assert an absence**, which is the only way to pin a rule that has
  been deleted: `TestWithdrawalWithNoRequestBehindItIsPaid` and
  `TestAFreshRequestIsPaidImmediately`. Without them the gate could be
  reintroduced and every remaining assertion would still pass.
- The three notification builders that named a maturity date are gone;
  `WithdrawalRequestReady` replaced the one that survives, and its test row
  asserts the word "notice" is **not** in the message.
- `loan.noticePeriodDays` moved into `PUBLIC_CONFIG_KEYS`, because `/faq` is a
  prerendered marketing page and reads only that tier.
- The guarantor lock and the active-loan rule are untouched. What was removed is
  the notice period, not FR-09.

---

[← all decisions](../decisions.md)
