# ADR-036 — A member with no email resets their password at the desk

**Status:** accepted · 2026-08-27 · the owner's ruling.

**Context.** `forgot-password` sends a link. **Most members of this cooperative
have no email address at all** — of the foundation's own register, a handful had
one and two of those were phone numbers typed into the wrong box. For those
people the self-service path did not exist, and no other one did either: a
forgotten password was permanent lockout, remediable only by somebody with SQL
access.

**Options.** SMS through a Bangladeshi gateway was the obvious answer and is
what a commercial product would do. It needs a paid account, credentials, a spend
limit and a new failure mode, and it reverses [ADR-003](adr-003-email-only-no-sms.md).

**Decision.** An admin resets it in person. The member comes to the office and is
recognised the same way they are before being paid a withdrawal — which is an
identity check this foundation already performs daily and trusts with money. The
admin issues a temporary password from the member's own page, reads it to them,
and the application forces a change at first login.

**Why this is not a weaker answer than SMS.** The thing SMS proves is control of
a phone number. The thing a field worker proves is that the person in front of
them is the member — which is strictly stronger, and is the check the foundation
already stakes cash on. What SMS buys is *convenience at a distance*, and for a
platform whose members walk in anyway, that is not worth a running bill and a
vendor.

**Consequences.** `POST /api/v1/admin/members/[id]/reset-password`, admins only,
members only. It revokes every live session in the same transaction as the
password ([ADR-031](adr-031-a-password-reset-is-one-transaction-and-the-table-behind-it-holds-no-secrets.md)) —
because a member asking for a reset may be asking precisely because somebody else
has their phone, and answering half of that is SEC-17 in a new place. The
temporary password is returned once and stored nowhere; the audit row names the
account number and never the password. This does not close the door on SMS: if
the volume of desk resets ever justifies the bill, this route stays and SMS
becomes an additional path rather than a replacement.

---

[← all decisions](../decisions.md)
