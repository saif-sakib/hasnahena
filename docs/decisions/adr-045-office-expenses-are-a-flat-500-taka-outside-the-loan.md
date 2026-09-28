# ADR-045 — Office expenses are a flat ৳500, outside the loan

**Status:** accepted · 2026-09-29. Directed by the owner. Narrows rule 3.

**Context.** Rule 3 read *"zero interest, zero fees"*, and the Terms of Service
said, in both languages, that a loan carries *"no administrative or processing
fee"*. The foundation's own terms say otherwise: a new member pays five hundred
taka, non-refundable, towards office expenses at registration, and a borrower
pays the same sum once at the time of a loan application. The website was
promising members something the foundation does not do.

Rule 3 exists because a charge on a loan can be riba. The line most scholars
draw — AAOIFI's standard on Qard among them — is between a charge that grows
with the loan (a rate, a markup, a percentage "fee") and a flat charge that
recovers the actual cost of administering it. The wording is the foundation's
own, and the owner confirmed it is the second kind.

**Decision.**

1. **Two charges exist, and only two:** ৳500 at registration and ৳500 at a loan
   application. Both are non-refundable, both are for office expenses.
2. **The loan charge is flat and outside the loan.** It is the same for every
   amount, it is never added to `principalAmount` or `remainingAmount`, and the
   borrower still repays exactly what was borrowed. Every piece of copy that
   mentions it says those three things, because a charge stated without them
   reads as a markup — and `messages.test.ts` requires them in the Terms.
3. **Interest, markup, a percentage fee and a late fee remain forbidden.** Rule
   3 is narrowed, not dropped. The census that refuses an open-ended *"fees may
   apply"* keeps running.
4. **The platform does not record the payment.** `loans."applicationFee"`
   stays `0` and its CHECK constraint stays: nothing is posted against the loan.
   The ৳500 is received in cash at the office, outside the ledger.

**Consequences.** The Terms, the loan-application form's intro, the home page's
"repay" step and the printed loan agreement state the charge. Whether the
platform should *record* the receipt — the `FEE` transaction type exists and is
unused — is a separate decision, not taken here.
