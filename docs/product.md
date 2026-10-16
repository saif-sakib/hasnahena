# Product Specification

Source of truth for domain rules.

## Purpose

Hasnahena (হাসনাহেনা) is a community-run, interest-free cooperative in Vekutia, Sadar, Jessore, Bangladesh, operating on Qard al-Hasan. Members deposit savings that earn no interest, borrow with no interest or markup, guarantee each other's loans, and donate. The platform digitises a paper passbook workflow, keeping every taka traceable to a member request and a member confirmation. Motto: সুদ ও দারিদ্রমুক্ত সমাজ গড়ি — "Building an interest-free and poverty-free society".

| Term | Meaning |
|---|---|
| Qard al-Hasan | benevolent, interest-free loan |
| Riba | interest — never charged or paid |
| Zakat / Sadaqah | obligatory / voluntary charity, held separately from deposits |
| NID | Bangladesh National ID (10 or 17 digits) |
| BDT / ৳ | Bangladeshi Taka, the only currency |

## Roles

| Role | Can | Cannot |
|---|---|---|
| **Member** | register; request deposit/loan/repayment; confirm or dispute postings; guarantee another member; donate; edit nominee | see another member's data |
| **Worker** | **process** pending requests and record deposits, withdrawals, disbursements, instalments and offline donations; publish the public site (gallery, copy, brand images); read reports | initiate money movement without a request; **decide** anything (a registration, a loan, a default); delete anything |
| **Admin** | everything a worker can, plus approve/reject registrations and loans, mark defaults, run settlement, manage workers, configure policy, read the audit log | alter audit history; create another admin from the application |

Processing moves money (FR-07, FR-08) and is a worker's job; deciding is an admin's. Both dashboards render the same screens; a worker does not see the deciding. **Admin accounts are created directly in the database** — `/api/v1/admin/workers` accepts no `role`. `SUPER_ADMIN` is treated as ADMIN.

## Core lifecycle: Request → Process → Confirm

```
Member REQUEST  →  Worker PROCESS (money physically moves)  →  Member CONFIRM
                                     ↘ amount wrong → Member DISPUTE → Admin corrects
```

Replaces OTP. Statuses: `PENDING → PROCESSED → CONFIRMED`, exits `DISPUTED`/`REJECTED`/`REVERSED`. Unconfirmed for 48 h → flag for admin review (policy; not yet automated). Withdrawals are the exception (below).

## Money rules

| Rule | Value | Configurable via |
|---|---|---|
| Minimum deposit for loan eligibility | ৳8,000 | `loan.minDepositForLoan` |
| Personal loan cap | 5 × current deposit | `loan.maxLoanMultiplier` |
| Max instalment months | 24 | `loan.maxInstallmentMonths` |
| Withdrawal while a loan is active | blocked | `loan.allowActiveLoanWithdrawal` |
| Guarantor required above | ৳20,000 | `loan.guarantorThresholdAmount` |
| Interest / markup / late fee | **zero, always** | not configurable |
| Office expenses at registration and at a loan application | **৳500 flat, non-refundable, never added to the loan** ([ADR-045](decisions.md)) | not configurable; paid in cash, not recorded |
| Withdrawal notice **asked for** (not enforced) | 90 days | `loan.noticePeriodDays` (`0` = say nothing) |
| Missed payments before a loan may be defaulted | 3 | `loan.missedPaymentsForDefault` |

Specified but **not implemented** ([tasks.md](tasks.md)): fairness cap 2 × (pool ÷ active members); solvency cap = available lending funds. Effective max loan = min(all caps).

**Loan lifecycle**: `PENDING_GUARANTOR → PENDING_APPROVAL → ACTIVE → COMPLETED`, terminals `DEFAULTED`/`REJECTED`/`SETTLED`. Above the threshold a guarantor approves from their own dashboard before admin review; a guarantor cannot withdraw their base deposit while the guarantee is live.

**Withdrawals (FR-08)**: a member asks a field worker and staff pay at the desk — no self-service request, no notice period ([ADR-030](decisions.md)); `AddMemberWithdrawal` writes a `CONFIRMED` posting. `loan.noticePeriodDays` is only what the foundation *asks*, shown on the savings screen and FAQ. Refused: a suspended member, an uncovered balance, a member guaranteeing another's active loan (FR-09), or one with their own active loan unless `loan.allowActiveLoanWithdrawal`. An outstanding `PENDING` withdrawal (pre-ADR-030) is settled — rewritten to the amount paid — never duplicated; so **every total over `transactions` filters on status** ([ADR-016](decisions.md)).

**Adding to a running loan (top-up)**: an active borrower is refused a second loan, but staff may add principal to the existing one (same loan number and history). `principalAmount` and `remainingAmount` rise together; `totalInstallments` stays, so the remaining instalments rise and the end date holds. The ceiling is measured on the **total** owed. No interest, no markup.

**Default settlement waterfall**: only after `loan.missedPaymentsForDefault` missed instalments (counted from `installmentStartDate` against `paidInstallments`; an unscheduled loan cannot be defaulted). The borrower is notified, then recovery runs in order and is logged: (1) borrower's savings, (2) guarantor's savings (proportional), (3) donation pool (written off as bad debt). Residual debt stays on the loan.

**Donations**: non-refundable, never withdrawable. Fund buckets (Operating, Lending Pool, Zakat/Sadaqah) are specified but **not yet modelled** — untyped `DONATION`.

## Registration data

Collected on the public form, queued for admin approval, the account number issued at approval, a forced password change at first login.

| Section | Fields |
|---|---|
| Identity | ফরম নং application no. (`APP-2026-000001`, at submission); গ্রাহক আই.ডি account no. (`ACC-KH-33001`, at approval) |
| Personal | নাম name EN/BN, পিতার নাম father, মাতার নাম mother, mobile `01XXXXXXXXX`, email (optional), এন.আই.ডি NID (10/17 digits), gender, blood group, profession, DOB, marital status, সন্তানের সংখ্যা children |
| Addresses | permanent + present: বাড়ী নং house, রোড নং road, গ্রাম village, ইউনিয়ন union, থানা police station, জেলা district, country (default বাংলাদেশ) |
| Nominee | নমিনীর নাম name, সম্পর্ক relationship, NID, phone |
| Documents | passport photo, NID front/back, nominee photo → Cloudinary |

Minimum age: `membership.minimumAgeYears` (default 18), enforced by the API as well as the form.

### Retention (owner decision, 2026-08-25; [ADR-033](decisions.md), [ADR-038](decisions.md))

1. **An approved member is anonymised, never deleted** if they have any posting (a vanished owner makes the reconciliation permanently wrong): NID, photo, addresses, nominee, parents' names, DOB, blood group and profession cleared; email and phone tombstoned; `accountNo`, the account, transactions and loans unchanged. With no postings they are deleted outright. Which happens is **counted**, not chosen (`ON DELETE RESTRICT` backs it).
2. **A rejected applicant is told why** (an emailed reason from the admin's list, plus optional text — a rejection without a reason is refused), **may reapply** with the same details (uniqueness covers live rows only), and **loses identity data after `security.rejectedRetentionDays`** (365): NID, addresses, parents' names, DOB, blood group, profession, photo, the free-text note and contact details. The decision, reason code and date are kept.
3. **A member may ask to be erased; an admin decides** (via the support thread; never a worker, because outstanding loans and guarantees affect others). The audit row names the account number, the admin and the reason — never what was erased.

| Tier | What | Kept |
|---|---|---|
| Permanent | every posting, loan and balance; audit rows about money, decisions about a person, and data destruction | forever |
| Long | security history (password changes, resets, lockouts), profile edits | 730 days |
| Short | sign-ins/outs, verification codes, reset requests for non-members | 180 days |
| Immediate | a **refused applicant's identity photographs** | deleted at the decision |

Erasure records are permanent — they prove the policy was applied. **All of it is published** on `/privacy` in both languages (wording in `messages/{en,bn}.json` under `legal.privacy.*`, inside the fee-promise census), including that members with postings are anonymised rather than deleted, the three processors (Cloudinary, Brevo, Neon), and the live `security.rejectedRetentionDays`.

### Passbook (সঞ্চয় ও ঋণ পাস বই)

Maps to `Account` + `Transaction`: date, receipt no. (রশিদ নম্বর), amount, running savings/loan balance — hence the `savingsAfter`/`loanAfter` snapshots. Receipt PDFs: `apps/web/lib/documents/`.

## Requirements register (FR-01…FR-25)

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
| FR-24 | An admin can read the audit trail: searchable, filterable by category, severity and date, grouped as a timeline | High |
| FR-25 | Tiered retention — the ledger and every decision kept permanently, security history 730 days, operational noise 180 days, a refused applicant's identity photographs deleted at the decision | High |

## Quality bars

- RBAC server-side on every protected route; client checks are cosmetic.
- Every financial mutation is atomic and appends an audit row; audit entries are never updated or deleted.
- Full EN/BN parity on user-facing strings.
- Targets: page load < 3 s, API p95 < 500 ms, 99.5% availability.

## Out of scope (Phase 1)

Mobile app, eKYC/NID OCR (Porichoy), payment-gateway settlement (bKash/SSLCommerz), SMS, load/stress testing.
