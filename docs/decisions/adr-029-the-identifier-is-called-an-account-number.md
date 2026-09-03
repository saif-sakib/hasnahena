# ADR-029 — The identifier is called an account number

**Status:** accepted · 2026-08-19.

[ADR-023](adr-023-one-member-identifier-usersaccountno.md) settled that there is
exactly **one** identifier a member is given. It did not settle what to call it,
and it kept the name the surviving column happened to have: `memberId`.

That name was the weaker half of the pair it replaced. The values have always
begun `ACC-`; the two documents that showed both labels showed the *other* one,
"Account No", against the same string; and a member at a desk asks for their
account number, not their member ID.

**Decision.** The column is `users.accountNo`, the Go helpers are
`utils.FormatAccountNo` and friends in `internal/utils/account_no.go`, the
TypeScript is `lib/account-no.ts`, the JSON field on every API response is
`accountNo`, and every document, screen and email says **Account No** /
**অ্যাকাউন্ট নং**.

**What did not change.** The value, its format (`ACC-KH-33001`), the
advisory-locked sequence allocator behind it, and ADR-023's rule that nothing may
print it under a second name. `apps/web/lib/documents/builders.test.ts` still
asserts every generated document labels it exactly once, and now asserts that
label is "Account No".

**The migration is hand-written and has to be.** `prisma migrate diff` cannot
see a rename: it emits `DROP COLUMN` + `ADD COLUMN`, which discards every
member's number. `ALTER TABLE … RENAME COLUMN` carries the data, the unique
index and the constraint across untouched. This is the third migration in this
project that had to be written by hand for the same class of reason, and the
first two are named in `20260819130000_rename_member_id_to_account_no`.

**One ambiguity the rename exposed rather than created.** `memberId` also named
the *route parameter* and the handler locals on
`/v1/dashboard/worker/members/{…}`, where it has always meant the member's row
id — a cuid, not an account number. Those are `{memberUserId}` now. The URLs are
unchanged; a chi pattern placeholder is not part of the path.

---

[← all decisions](../decisions.md)
