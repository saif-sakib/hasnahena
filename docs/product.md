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
| **Worker** | Process pending member requests, record deposits/withdrawals/disbursements/installments, record offline donations | Initiate money movement without a request; approve anything; delete anything |
| **Admin** | Everything a worker can, plus approve/reject registrations and loans, mark defaults, run settlement, manage workers, configure policy, read audit log | Delete or alter audit history |

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
| Withdrawal notice | 3 months | `loan.noticePeriodMonths` (`0` = no notice period) |
| Missed payments before a loan may be defaulted | 3 | `loan.missedPaymentsForDefault` |

Two further caps are specified but **not implemented** (see [tasks.md](tasks.md)):
- Fairness cap: 2 × (total pool ÷ active members)
- Solvency cap: total available lending funds

Effective max loan = min(all applicable caps).

### Loan lifecycle

`PENDING_GUARANTOR → PENDING_APPROVAL → ACTIVE → COMPLETED`, with `DEFAULTED` / `REJECTED` / `SETTLED` as terminals. A guarantor is required above an admin-set threshold; the guarantor approves from their own dashboard before admin review. A guarantor cannot withdraw their base deposit while the guarantee is live.

### Withdrawal notice period (FR-08)

**A member's withdrawal request *is* their notice.** It files a `PENDING`
withdrawal that moves no money; the money is paid at the desk once
`loan.noticePeriodMonths` has elapsed since the request. Both paths that can
move it — the admin's approval and the worker's payout — refuse before then.

A notice covers any amount *up to* the one announced; taking more needs a new
notice. Outstanding notices count against the balance, so a member cannot give
several notices for the whole balance and present them all once matured. The
guarantor lock and the active-loan rule are checked when notice is given as well
as when it is paid, so a member finds out now rather than in three months.

Since a `PENDING` withdrawal is a notice and a `CONFIRMED` one is a payment,
**any total over `transactions` must filter on status** — see
[ADR-016](decisions.md).

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
| FR-05 | Admin approves/rejects registration with stored reason | High |
| FR-06 | Member updates nominee, audit-logged | Medium |
| FR-07 | Deposit: member requests → worker processes → member confirms | Critical |
| FR-08 | Withdrawal request with notice-period validation | High |
| FR-09 | Block withdrawal violating collateral ratio or active guarantee | Critical |
| FR-10 | Max loan from configured caps and liquidity | High |
| FR-11 | Guarantor request + approval before admin review | High |
| FR-12 | Admin approves loan → worker disburses → member confirms | Critical |
| FR-13 | Record installments and late-fee flags per policy | High |
| FR-14 | Default settlement waterfall (self → guarantor → donation pool) | Critical |
| FR-15 | Donations captured with fund type | High |
| FR-16 | Donation funds isolated from withdrawable deposits | Critical |
| FR-17 | Member raises dispute on incorrect processed amount | High |
| FR-18 | Freeze disputed transaction, notify admin | High |
| FR-19 | Append-only audit log for every material action | Critical |
| FR-20 | Member dashboard: balances, loan status, pending confirmations, guarantor actions | High |
| FR-21 | Worker dashboard: pending queues by SLA | High |
| FR-22 | Admin dashboard: approvals, liquidity alerts, disputes, settings, audit viewer | High |

## Quality bars

- RBAC enforced server-side on every protected route; client checks are cosmetic.
- Every financial mutation is atomic (single DB transaction) and appends an audit row.
- Full EN/BN parity on all user-facing strings.
- Audit entries are never updated or deleted — corrections append new entries.
- Targets: page load < 3s, API p95 < 500ms, 99.5% availability.

## Out of scope (Phase 1)

Mobile app, eKYC/NID OCR (Porichoy), payment gateway settlement (bKash/SSLCommerz), SMS notifications, load/stress testing.
