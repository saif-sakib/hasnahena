# ADR-042 — Admission hands out a number; a password is issued separately

**Status:** accepted

**Status.** accepted · 2026-08-27

**Context.** Approving a registration generates a temporary password, hashes it,
emails it if there is an address, and forgets it. It also returned it, and the
approvals screen printed it — on the reasoning that most members of this
cooperative have no email address at all
([ADR-036](adr-036-a-member-with-no-email-resets-their-password-at-the-desk.md)),
so for them that screen was the only delivery there was.

The problem is right and the place is wrong. An account number is a **name**: it
is read aloud at the counter for the rest of a membership, this is the moment it
is allocated, and the admin who allocated it is the only person who can see it. A
password is a **key**. Putting a working key for a brand-new account on a queue
screen in a shared office, in a response body every proxy between here and there
can hold, at a moment when its owner is usually not in the room, is a different
act from showing somebody a number.

**Decision.** The approval response carries `accountNo` and not
`temporaryPassword`, and the screen shows the number and the office. The member
with no email is served deliberately instead, from
`POST /api/v1/admin/members/{id}/reset-password` — the staff-assisted reset
(ADR-036) — which an admin runs from that member's own page, which revokes every
session in the same transaction as the password, and which shows it once on a
screen that is about one person.

**Consequences.** For a member with an email nothing changes: the password is in
the approval email as it always was. For a member without one, admission and
credential become two deliberate steps, and the success panel says so rather than
leaving an admin looking at an account nobody can sign in to. Both halves are
pinned by `test/unit/approval-credentials.test.ts`, in both directions — a
handler that returns the field again with no screen to show it is a secret in a
response nobody reads, and a screen reaching for a field the handler no longer
sends is an empty box under the heading "Temporary password".

The same dialog is where the member's **office** is now chosen. Registration used
to assign the sole active branch and assign nothing once a second office existed,
so a member's branch was either an inference or blank — neither of them anybody's
decision, and per-branch reporting counted from it.

---

[← all decisions](../decisions.md)
