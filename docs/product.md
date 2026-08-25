# Product Specification

Source of truth for domain rules. Supersedes the former BRD/SRS/FRD/Use-Case PDFs.

## Purpose

Hasnahena (হাসনাহেনা) is a community-run, interest-free cooperative in Vekutia, Sadar, Jessore, Bangladesh, operating on Qard al-Hasan. Members deposit savings that earn no interest, borrow with no interest or fees, guarantee each other's loans, and donate. The platform digitises a paper passbook workflow while keeping every taka traceable to a member request and a member confirmation.

Motto: সুদ ও দারিদ্রমুক্ত সমাজ গড়ি — "Building an interest-free and poverty-free society".

## Glossary

| Term | Meaning |
|---|---|
| Qard al-Hasan | Benevolent, interest-free loan |
| Riba | Interest — forbidden; the platform must never charge or pay it |
| Zakat / Sadaqah | Obligatory / voluntary charity, held separately from deposits |
| NID | Bangladesh National ID (10 or 17 digits) |
| BDT / ৳ | Bangladeshi Taka, the only currency |

## Roles

| Role | Can | Cannot |
|---|---|---|
| **Member** | Register, request deposit/withdrawal/loan/repayment, confirm or dispute postings, guarantee another member, donate, edit nominee | See another member's data |
| **Worker** | Process pending member requests, record deposits/withdrawals/disbursements/installments, record offline donations, publish the public site (gallery, page copy, brand images), read reports | Initiate money movement without a request; **decide** anything — a registration, a loan, a default; delete anything |
| **Admin** | Everything a worker can, plus approve/reject registrations and loans, mark defaults, run settlement, manage workers, configure policy, publish public page copy and brand assets, read audit log | Delete or alter audit history; create another admin from the application |

"Approve" was doing two jobs in this table. **Processing** a pending posting — a
member's deposit request, their matured withdrawal notice, their repayment — is
the worker's whole job under FR-07 and FR-08, and it moves money. **Deciding** —
admitting a member, granting a loan, declaring a default — is the admin's, and it
does not. The worker and admin dashboards render the same screens; what a worker
does not see is the deciding.

An **admin account is created directly in the database**, never through the
application. `/api/v1/admin/workers` accepts no `role` field on create or update,
and the Workers screen offers no Admin option: otherwise anyone holding an admin
session could mint a permanent one, recorded in `audit_logs` as ordinary staff
administration.

`SUPER_ADMIN` exists in the schema and is treated as ADMIN everywhere.

## Core lifecycle: Request → Process → Confirm

```
Member REQUEST  →  Worker PROCESS (money physically moves)  →  Member CONFIRM
                                     ↘ amount wrong → Member DISPUTE → Admin corrects
```

This three-step handshake replaces OTP. Statuses map to `TransactionStatus`: `PENDING → PROCESSED → CONFIRMED`, with `DISPUTED` / `REJECTED` / `REVERSED` as exits. Unconfirmed for 48h → flag for admin review (policy; not yet automated).

## Money rules

| Rule | Value | Configurable via |
|---|---|---|
| Minimum deposit for loan eligibility | ৳8,000 | `loan.minDepositForLoan` |
| Personal loan cap | 5 × current deposit | `loan.maxLoanMultiplier` |
| Max installment months | 24 | `loan.maxInstallmentMonths` |
| Withdrawal while loan active | blocked | `loan.allowActiveLoanWithdrawal` |
| Interest / processing fee | **zero, always** | not configurable |
| Withdrawal notice **asked for** (not enforced) | 90 days | `loan.noticePeriodDays` (`0` = say nothing) |
| Missed payments before a loan may be defaulted | 3 | `loan.missedPaymentsForDefault` |

Two further caps are specified but **not implemented** (see [tasks.md](tasks.md)):
- Fairness cap: 2 × (total pool ÷ active members)
- Solvency cap: total available lending funds

Effective max loan = min(all applicable caps).

### Loan lifecycle

`PENDING_GUARANTOR → PENDING_APPROVAL → ACTIVE → COMPLETED`, with `DEFAULTED` / `REJECTED` / `SETTLED` as terminals. A guarantor is required above an admin-set threshold; the guarantor approves from their own dashboard before admin review. A guarantor cannot withdraw their base deposit while the guarantee is live.

### Withdrawals (FR-08)

**A member asks a field worker, and staff pay at the desk.** There is no
self-service withdrawal request and no notice period ([ADR-030](decisions.md));
`AddMemberWithdrawal` writes a `CONFIRMED` posting when the money is handed over.

`loan.noticePeriodDays` is how much warning the foundation **asks** for. It is
published on the member's savings screen and in the FAQ answer, and it gates
nothing — a worker may pay whenever the member asks. Set it to `0` to say
nothing.

What still refuses a payout: a suspended member, a balance that does not cover
it, a member guaranteeing somebody else's active loan (FR-09), and a member with
an active loan of their own unless `loan.allowActiveLoanWithdrawal` is on.

**A member may still have an outstanding `PENDING` withdrawal** — rows filed
before ADR-030, and any left from the removed member request flow. Paying one
settles *that row*, with the amount rewritten to what was actually paid; it never
writes a second row beside it. So a `PENDING` withdrawal is still an intention
and a `CONFIRMED` one is still a payment, and **any total over `transactions`
must filter on status** — see [ADR-016](decisions.md).

### Adding to a loan that is already running

A member with an active loan is refused a second one. Staff may instead **add
principal to the existing loan** — the same emergency, the same loan number, the
same repayment history.

The added amount raises `principalAmount` and `remainingAmount` together, so the
loan never claims to owe more than was lent. `totalInstallments` does not change:
the outstanding balance is re-spread over the payments that are *left*, so the
schedule keeps its end date and each remaining instalment goes up. Zero interest,
zero fees — the amount added and the amount owed are the same money.

The borrowing ceiling is measured against the **total** owed afterwards, not
against the increment; otherwise five small top-ups would do what one large loan
is refused.

### Default settlement waterfall

A loan may only be marked defaulted once the borrower has missed at least
`loan.missedPaymentsForDefault` scheduled instalments — counted from
`installmentStartDate` against `paidInstallments`, so a loan that was never put
on a schedule can never be defaulted. On admin marking a loan defaulted, the
borrower is notified and recovery runs in strict order and is logged:

1. Borrower's own savings balance
2. Guarantor's savings balance (proportional)
3. Donation pool (written off as bad debt)

Residual debt stays on the loan.

### Donations

Non-refundable and never withdrawable. Intended fund buckets — Operating, Lending Pool, Zakat/Sadaqah — are specified but **not yet modelled**; donations currently post as `TransactionType.DONATION` with no category.

## Registration data

Collected on the public form, queued for admin approval, credentials emailed on approval, password change forced on first login.

| Section | Fields |
|---|---|
| Identity | গ্রাহক আই.ডি member ID (auto, `ACC-KH-33001`…), ফরম নং form no. |
| Personal | নাম name EN/BN, পিতার নাম father, মাতার নাম mother, mobile `01XXXXXXXXX`, email (optional), এন.আই.ডি NID (10/17 digits), gender, blood group, profession, DOB, marital status, সন্তানের সংখ্যা children count |
| Addresses | Permanent + present: বাড়ী নং house, রোড নং road, গ্রাম village, ইউনিয়ন union, থানা police station, জেলা district, country (default বাংলাদেশ) |
| Nominee | নমিনীর নাম name, সম্পর্ক relationship, NID, phone, photo |
| Documents | passport photo, NID front/back, nominee photo → Cloudinary |

Under-18 applicants supply parents' NIDs instead of their own.

### How long that data is kept, and what removes it

Owner decision, 2026-08-25. The foundation holds NID numbers, photographs, home
addresses and both parents' names for everyone who has ever *applied*, whether
or not they were admitted. Three rules govern how long.

**1. An approved member is anonymised, never deleted.** A member with any posting
against their account cannot be removed: the ledger is summed hourly against the
stored balances (`reconcile_repository.go`), and a posting whose owner has
vanished makes that sum permanently wrong. Erasure therefore strips the person
and keeps the money: NID number, photograph, addresses, nominee, parents' names,
date of birth, blood group and profession are cleared; email and phone are
tombstoned; `accountNo`, the account and every `Transaction` and `Loan` row stay
exactly as they were. A member with *no* postings at all — an approval nobody
ever used — is deleted outright, and the cascade takes the rest. Which of the two
happens is decided by counting references, not by asking the operator: the
database refuses the delete anyway (`ON DELETE RESTRICT` from `transactions` and
`loans`), so the count is what turns a constraint violation into an answer.

**2. A rejected applicant is told why, may apply again, and loses their identity
data after one year.** The rejection, its reason code and its `audit_logs` row
are kept permanently — a refusal is a decision the foundation may have to
justify. The applicant is **emailed** the outcome with the reason, from a list
the admin picks from and may add free text to (owner's ruling, 2026-08-26); a
rejection with no reason is refused by the API.

They may apply again with the same email, phone and NID. Uniqueness covers only
**live** rows, so a rejected application reserves nothing — which is also what
makes the email possible. Until 2026-08-26 rejection *overwrote* the applicant's
contact details on the spot to free the unique constraint, so nobody could be
told anything, and the entry point's most common bad outcome was silence.

The identity documents are not part of the justification a year later, so NID
number, addresses, parents' names, date of birth, blood group, profession,
photograph, the free-text rejection note **and the contact details** are cleared
by a scheduled sweep 365 days after rejection. The reason *code* and the date
survive, because they are the decision rather than the person.

**Minimum age.** An applicant must be at least `membership.minimumAgeYears` old
— a Settings value, defaulting to 18, the age of majority in Bangladesh and the
ordinary threshold for a binding contract. Enforced by the API as well as the
form.

**3. A member may ask to be erased; an admin decides.** The request goes through
the existing support thread — there is no self-service button, because erasure
while a loan or a guarantee is outstanding has consequences for other members.
An ADMIN, never a worker, approves it, and the approval is audit-logged by
account number.

What the audit row may contain is part of the policy rather than an
implementation detail: `audit_logs` is append-only, so anything written there
survives the erasure. The row names the account number, the approving admin and
the reason. It never names what was erased.

### Passbook (সঞ্চয় ও ঋণ পাস বই)

The printed member passbook maps to `Account` + `Transaction`: each row carries date, receipt no. (রশিদ নম্বর), deposit/withdrawal amount, and running savings/loan balance — which is why every `Transaction` stores `savingsAfter` / `loanAfter` snapshots. Receipt PDFs are generated in `apps/web/lib/documents/receipt-generator.ts`.

## Requirements register (FR-01…FR-22)

Stable IDs, kept for traceability. Live status lives in [tasks.md](tasks.md).

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | Login with phone or email + password | High |
| FR-02 | Forced password reset on first login after approval | High |
| FR-03 | RBAC on every sensitive action | Critical |
| FR-04 | Capture biodata, NID, address, nominee at registration | High |
| FR-05 | Admin approves/rejects registration with a stored reason, and the applicant is told | High |
| FR-06 | Member updates nominee, audit-logged | Medium |
| FR-07 | Deposit: member requests → worker processes → member confirms | Critical |
| FR-08 | Member withdrawal: asked for in person, paid and posted by staff | High |
| FR-09 | Block withdrawal violating collateral ratio or active guarantee | Critical |
| FR-10 | Max loan from configured caps and liquidity | High |
| FR-11 | Guarantor request + approval before admin review | High |
| FR-12 | Admin approves loan → worker disburses → member confirms | Critical |
| FR-13 | Record installments; no late fee is charged on a missed one | High |
| FR-14 | Default settlement waterfall (self → guarantor → donation pool) | Critical |
| FR-15 | Donations captured with fund type | High |
| FR-16 | Donation funds isolated from withdrawable deposits | Critical |
| FR-17 | Member raises dispute on incorrect processed amount | High |
| FR-18 | Freeze disputed transaction, notify admin | High |
| FR-19 | Append-only audit log for every material action | Critical |
| FR-20 | Member dashboard: balances, loan status, pending confirmations, guarantor actions | High |
| FR-21 | Worker dashboard: pending queues by SLA | High |
| FR-22 | Admin dashboard: approvals, liquidity alerts, disputes, settings, audit viewer | High |
| FR-23 | Erase a member's identity on request, and time-expire a rejected applicant's | High |

## Quality bars

- RBAC enforced server-side on every protected route; client checks are cosmetic.
- Every financial mutation is atomic (single DB transaction) and appends an audit row.
- Full EN/BN parity on all user-facing strings.
- Audit entries are never updated or deleted — corrections append new entries.
- Targets: page load < 3s, API p95 < 500ms, 99.5% availability.

## Out of scope (Phase 1)

Mobile app, eKYC/NID OCR (Porichoy), payment gateway settlement (bKash/SSLCommerz), SMS notifications, load/stress testing.
