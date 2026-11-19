# Retention and recovery checks

This is the operational view of [ADR-033](decisions/adr-033-a-member-is-anonymised-a-rejected-applicant-expires.md) and [ADR-038](decisions/adr-038-retention-is-tiered-by-what-the-data-is-not-by-one-clock.md). It describes the application policy and the evidence needed to establish that production applies it.

| Record | Trigger and disposition |
| --- | --- |
| Refused applicant's identity images | Best-effort removal on rejection, with a scheduled sweep for missed files. Verify provider outcomes and restore copies separately. |
| Refused applicant's remaining identity text | Default **365 days from rejection**, configurable under `security.rejectedRetentionDays`. The sweep clears eligible identity data and retains the decision record. Confirm the live setting before quoting an individual removal date. |
| Member records | An authorized erasure is a separate action. Erasure anonymizes a member with postings and can delete the account if there are none. Account inactivity alone does not schedule erasure. |
| Financial records and consequential audit actions | Postings, loan history and accountability records that must be preserved stay in the ledger. |
| Other audit data | The documented short and long tiers expire after **180** and **730 days** respectively. |
| Backup archives, exports and invoices | Backups and copies use their own lifecycle. Compare the live R2 lifecycle to the documented policy. Check support exports and independently held copies. A live removal does not remove records from an earlier encrypted archive. |

Vercel declares a daily retention call at **01:00 Bangladesh time**. Production must have a working `CRON_SECRET`, matching route authorization and the intended database. Check timestamp, result and aggregate actions in secure logs. Rejecting an applicant has its own best-effort image step. Verify the scheduled backstop without manually invoking the production erasure action for this audit.

Before tightening the policy, prove it with an isolated dataset and a verified restore. Preserve the financial balances, approved audit evidence and any applicable hold. Establish how a restored archive will reconcile post-backup anonymizations before reopening service. Track the production checks under [T-51](tasks.md#phase-1--owner-actions).
