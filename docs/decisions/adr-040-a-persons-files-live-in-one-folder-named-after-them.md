# ADR-040 — A person's files live in one folder, named after them

**Status:** accepted

**Status.** accepted · 2026-08-27

**Context.** A member's images were in two trees. Their avatar was
`hasnahena/people/ACC-KH-33001/avatar`; the four identity documents they
submitted when applying were `hasnahena/applications/APP-2026-000001/nid-front`
and its siblings. Both names are meaningful and neither says the two belong to
the same human being.

That split is only visible when it matters. "Delete everything you hold about
this member" has to reach both, so the erasure needs the join between the
account number and the application number — which lives in the database, which
is the thing the erasure destroys. The same is true of a migration off
Cloudinary, of an audit of what is stored about somebody, and of anyone staring
at a bucket trying to work out what they are looking at.

They cannot simply be uploaded to the right place. The documents arrive from a
**public form**, before anybody is a member and therefore before an account
number exists at all — it is issued at approval and nowhere else
([ADR-039](adr-039-an-account-number-is-issued-on-admission-an-application-number-on-submission.md)).
The upload can only name the folder after the application; the folder can only
be named after the person once there is a person.

**Options considered.**

- *Leave them split and join in code.* This is what it was. Every consumer then
  has to know both trees, and an erasure is correct only while the database row
  survives long enough to tell it where to look.
- *Copy at approval.* Rejected: two copies of an NID scan is strictly worse than
  one in the wrong place.
- *Re-upload from the stored URL.* Rejected: the documents are uploaded with
  `preserveOriginal` precisely so an identity card is never re-encoded, and a
  round trip through the uploader would undo that silently.

**Decision.** Approval **moves** them. A Cloudinary rename is a metadata
operation — the bytes are not touched — and `applications/APP-2026-000001/*`
becomes `people/ACC-KH-33001/*`, beside the avatar, with `documents.url`
rewritten per row as each asset actually lands. The emptied application folder is
removed, but only when nothing failed: `deleteEmptyFolder` refuses a folder with
contents, so a half-finished move can never be "finished" by deleting the half
that did not move.

It is a separate call from the approval itself
(`POST /api/v1/admin/members/{id}/refile-documents`), for the same reason the
member erasure is a Next route: the approval is the transaction that flips the
status, issues the number and writes the audit row, and it must not acquire a
dependency on a third-party image host. A failure there changes nothing anybody
can see — the stored URLs still resolve — so it must not make a successful
approval look like a failed one.

**Consequences.** The call is idempotent and has a backstop: the nightly
retention sweep files anything whose `documents.url` still names
`/applications/`, which covers the browser that was closed between the two
requests. The approvals screen also *waits* for it and says so in its notice —
it was fire-and-forget at first, on the correct observation that a failure
changes nothing anybody can see, which is precisely why nobody would ever find
out. The only person who can tell is the admin in front of the screen, and only
while they are still looking at it. Erasing a member is then one prefix, `hasnahena/people/ACC-KH-33001`,
and the application prefix is kept in the erasure only for rows filed before this.
A **refused** application's documents are not moved — they are deleted at the
decision ([ADR-038](adr-038-retention-is-tiered-by-what-the-data-is-not-by-one-clock.md)).

---

[← all decisions](../decisions.md)
