# ADR-039 — An account number is issued on admission, an application number on submission

**Status:** accepted · 2026-08-27 · reported by the owner.

**Context.** The owner rejected the first application and watched the next
applicant become `ACC-KH-33002`. The registration route was allocating a
**membership number** at the moment a public form was submitted — before anybody
had read the application — so every refusal punched a permanent hole in the
foundation's own register, and anybody who can open the registration page could
push the series wherever they liked.

**Options considered.**

- *Reuse the gap.* Allocate the lowest unused number instead of the highest
  issued. Rejected: two people would then appear as `ACC-KH-33001` in the paper
  trail, months apart, which is worse than a gap by a long way.
- *Renumber on rejection.* Rejected: the number is also the name of a folder on
  the image host, and re-sequencing live rows to close a hole is the kind of
  operation that is correct exactly once.
- *Issue nothing until approval.* Correct, but it takes away the reference the
  applicant is told to write down and leaves their four identity documents with
  no meaningful folder to go in.

**Decision.** Two numbers, which is what the paper world this platform is
replacing already does: you are given a **form number** when you apply, and a
**membership number** when you are admitted.

- `users.formNumber` — `APP-2026-000001`, allocated at submission from
  `document_sequences`, the same gapless per-year allocator behind every receipt
  and loan number. It costs nothing to burn, it is what the confirmation screen
  shows (under the heading it already had — "your application reference"), and it
  names the Cloudinary folder holding the four submitted documents.
- `users.accountNo` — `ACC-KH-33001`, allocated by `ApproveRegistration` and by
  nothing else. `ACC-KH-33001` now means *the first member*, rather than the
  first person who opened the form.

**Consequences.** `accountNo` is **null on a pending or rejected application**,
which makes true a claim [ADR-037](adr-037-a-row-has-a-key-for-machines-and-an-identifier-for-people-and-a-view-for-reading.md)
already relied on and is why it cannot be the primary key. `ApproveRegistration`
returns the number it allocated, because the handler reads the candidate row
*before* approval and would otherwise put an empty string into the one email that
tells a member their number — and the approvals screen shows the number on
success rather than only on email failure, since most members have no email at
all ([ADR-036](adr-036-a-member-with-no-email-resets-their-password-at-the-desk.md)).
It shows the **number** and not the password; see
[ADR-042](adr-042-admission-hands-out-a-number-a-password-is-issued-separately.md).

Approval must **not** touch `formNumber`. It used to overwrite it with
`FORM-<accountNo>`, destroying the reference the applicant had been given and the
name of the folder holding their documents.

---

[← all decisions](../decisions.md)
