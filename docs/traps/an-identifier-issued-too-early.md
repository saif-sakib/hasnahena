# An identifier issued too early

- **A number is spent the moment it is issued, and a public form must not be able
  to spend one.** Registration allocated the membership number `ACC-KH-33001` on
  submission, so each rejection left a permanent hole in the register and anyone
  could push the series into the hundreds. Reusing the gap or renumbering on
  rejection are both wrong; there are two numbers — an application number on
  submission, a membership number on admission ([ADR-039](../decisions.md),
  [ADR-043](../decisions.md)). Before allocating a scarce, human-readable,
  permanent identifier, ask what happens when the record is refused: "a gap"
  means the wrong moment.
- **Changing an identifier strands whoever held the old one.** Approval used to
  overwrite `formNumber`, destroying the reference the applicant was given and
  their documents folder's name; and the handler read the account number from a
  snapshot taken *before* the approval allocated it, so the welcome email
  carried an empty string.

---

[← all traps](../traps.md)
