# An identifier issued too early

**A number is spent the moment it is issued, and a public form must not be able
to spend one.** Registration allocated the *membership* number `ACC-KH-33001`
when somebody submitted the form — before any admin had read the application —
so refusing the first applicant put a permanent hole in the foundation's own
register and made the next one `002`. Anybody who can open the registration page
could have pushed the series into the hundreds.

The fix is not to reuse the gap (two people would then be `ACC-KH-33001` in the
paper trail) and not to renumber on rejection (the number names their folder on
the image host). It is that **there are two numbers and there always were**: an
application number issued on submission, a membership number issued on admission
([ADR-039](../decisions.md)). The paper process this platform replaces already
worked that way.

The trap generalises: before allocating a scarce, human-readable, permanent
identifier, ask **what happens when this record is refused**. If the answer is "a
gap", it is being issued at the wrong moment.

Watch for the second half too. `ApproveRegistration` used to overwrite
`formNumber` with `FORM-<accountNo>` on approval, which destroyed the reference
the applicant was given and the name of the folder holding their four identity
documents. And the handler read `candidate.AccountNo` from a snapshot taken
*before* the approval that allocates it — an empty string in the one email that
tells a member their number.

---

[← all traps](../traps.md)
