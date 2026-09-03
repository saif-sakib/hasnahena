# ADR-038 — Retention is tiered by what the data is, not by one clock

**Status:** accepted · 2026-08-27.

**Context.** [ADR-033](adr-033-a-member-is-anonymised-a-rejected-applicant-expires.md)
established *that* data expires. It did not say what, and in practice one clock
was doing all the work: `security.rejectedRetentionDays` cleared a refused
application's identity **text**, and nothing at all governed the **photographs**,
the audit trail, or anything else. So a national identity card scanned by a
nineteen-year-old whose application was turned down in an afternoon stayed on a
public Cloudinary URL for as long as the account existed, which was for ever.

Meanwhile the opposite mistake was available and would have been worse: sweeping
everything on one clock deletes the ledger.

**Decision.** Four tiers, and the tier is a property of *what the record is*.

| Tier | What | Kept |
|---|---|---|
| **Permanent** | Every posting, loan and balance. Every audit row about money, about a decision made concerning a person, and about data being destroyed. | For ever |
| **Long** | Security history — password changes, resets, lockouts. Profile edits. | 730 days |
| **Short** | Operational noise — sign-ins, sign-outs, verification codes, reset requests for identifiers that are not members. | 180 days |
| **Immediate** | A refused applicant's identity **photographs**. | Deleted at the decision |

**Why the photographs go first and not last.** They are the highest-consequence
item this platform holds: an NID scan is enough on its own to open an account
somewhere else in that person's name, it is served from a URL that needs no
login, and it is not needed by any of the purposes that justify keeping anything
after a rejection. Those purposes are: explaining the decision, recognising a
re-applicant, and answering a complaint — and the reason code, the date and the
contact details serve all three. Deleting the *text* on a 90-day clock while
keeping the *images* indefinitely had the tiering exactly upside down.

**Why the erasure records are permanent.** `MEMBER_ERASED`,
`APPLICATION_DOCUMENTS_ERASED`, `RETENTION_SWEEP` and `AUDIT_LOG_EXPIRED` are the
evidence that the policy was applied. A retention rule that expired them would be
a policy destroying the proof of its own compliance, which is the one thing a
policy cannot do and remain one.

**Why the tier lives beside the action.** In `lib/audit-actions.ts`, on the same
line as the label and the severity — not in the job that applies it. "May this be
deleted" is a property of what happened, and a new action added without a tier
now fails `audit-actions.test.ts` rather than silently inheriting a default.

**Why days in code and not a `system_config` key.** The privacy notice states
these periods. A dial an admin can turn makes the notice a description of the
current setting rather than a commitment, and shortening a retention period is
exactly the change that should require a review — unlike
`security.rejectedRetentionDays`, which stays configurable because it is the one
period the foundation genuinely tunes.

**Consequences.** The Cloudinary half of this cannot live in the Go retention
sweep, because the image host is configured in the Next app and in one place —
the same split as the member erasure. `POST /api/v1/admin/retention` does it, and
is called twice over: by the approvals screen the moment an application is
refused, and by a Vercel Cron `GET` every night. The immediate call is best
effort by design; the nightly one is what makes it safe for a browser to be the
trigger, because a closed tab then costs a delay rather than the deletion.

An unset `CRON_SECRET` accepts **nobody**, rather than being treated as "no check
configured" — a missing environment variable must not turn an erasure endpoint
into an open one.

---

[← all decisions](../decisions.md)
