# Decisions

Why the code looks the way it does. Each entry resolves a conflict that used to
exist between documents, or between documents and reality. **Append new entries;
do not rewrite old ones** — a superseded ADR keeps its reasoning and gains a
pointer, because the argument is what stops the idea coming back.

**This file is the index. Read one row, then open one file.** Each ADR is its own
file in [`decisions/`](decisions/) — the whole set is 110 KB and the largest
single entry is 7 KB, so opening the one you need costs about a sixtieth of
opening the set. A link that says `decisions.md` with no anchor lands here on
purpose.

Adding one: write `decisions/adr-0NN-<slug>.md` with an `# ADR-0NN — Title`
heading and a `**Status:**` line, then add its row below.

| | Decision | Status |
|---|---|---|
| [ADR-001](decisions/adr-001-go-api-owns-money-nextjs-owns-content.md) | Go API owns money; Next.js owns content | accepted |
| [ADR-002](decisions/adr-002-money-is-stored-as-whole-taka-in-bigint.md) | Money is stored as whole taka in `BigInt` | accepted |
| [ADR-003](decisions/adr-003-email-only-no-sms.md) | Email only, no SMS | accepted |
| [ADR-004](decisions/adr-004-prisma-db-push-no-migration-files.md) | `prisma db push`, no migration files | superseded |
| [ADR-005](decisions/adr-005-two-response-shapes-and-which-one-is-canonical.md) | Two response shapes, and which one is canonical | accepted |
| [ADR-006](decisions/adr-006-auth-is-self-hosted-jwt.md) | Auth is self-hosted JWT | accepted |
| [ADR-007](decisions/adr-007-no-redis-no-separate-cache-tier.md) | No Redis, no separate cache tier | accepted |
| [ADR-008](decisions/adr-008-member-ids-are-acc-kh-.md) | Account numbers are `ACC-KH-#####` | accepted |
| [ADR-009](decisions/adr-009-formal-specification-pdfs-retired.md) | Formal specification PDFs retired | accepted |
| [ADR-010](decisions/adr-010-documents-are-rendered-in-the-browser-then-rasterised.md) | Documents are rendered in the browser, then rasterised | superseded |
| [ADR-011](decisions/adr-011-one-trimmed-transparent-logo-asset-set.md) | One trimmed, transparent logo asset set | accepted |
| [ADR-012](decisions/adr-012-official-documents-are-english-only-and-drawn-as-pdf-text.md) | Official documents are English only, and drawn as PDF text | accepted |
| [ADR-013](decisions/adr-013-document-numbers-are-sequential-and-named.md) | Document numbers are sequential and named | accepted |
| [ADR-014](decisions/adr-014-prisma-migrate-supersedes-db-push.md) | Prisma migrate supersedes `db push` | accepted |
| [ADR-015](decisions/adr-015-a-balance-is-written-relatively-never-read-modify-written.md) | A balance is written relatively, never read-modify-written | accepted |
| [ADR-016](decisions/adr-016-a-withdrawal-notice-is-the-members-request-not-a-field-on-the-payout.md) | A withdrawal notice is the member's request, not a field on the payout | superseded by [ADR-030](decisions/adr-030-staff-pay-a-withdrawal-when-the-member-asks.md) |
| [ADR-017](decisions/adr-017-read-config-inside-the-transaction-never-from-the-pool.md) | Read config inside the transaction, never from the pool | accepted |
| [ADR-018](decisions/adr-018-the-official-infos-history-is-not-purged.md) | The `Official Infos/` history is not purged | accepted |
| [ADR-019](decisions/adr-019-one-function-decides-where-a-request-came-from.md) | One function decides where a request came from | accepted |
| [ADR-020](decisions/adr-020-the-cloudinary-assets-have-no-backup-and-that-is-accepted-until-launch.md) | The Cloudinary assets have no backup, and that is accepted until launch | provisional |
| [ADR-021](decisions/adr-021-the-support-proxy-limits-per-member-trusted_proxies-follows-the-chain.md) | The support proxy limits per member; `TRUSTED_PROXIES` follows the chain | accepted, amended |
| [ADR-022](decisions/adr-022-member-approval-waits-for-the-email-inside-a-ten-second-budget.md) | Member approval waits for the email, inside a ten-second budget | accepted |
| [ADR-023](decisions/adr-023-one-member-identifier-usersaccountno.md) | One member identifier: `users.accountNo` | accepted |
| [ADR-024](decisions/adr-024-two-content-security-policies-chosen-per-route.md) | Two Content-Security-Policies, chosen per route | accepted |
| [ADR-025](decisions/adr-025-the-rate-limiter-keys-on-the-verified-member.md) | The rate limiter keys on the verified member | accepted |
| [ADR-026](decisions/adr-026-a-disputed-posting-is-money-that-moved.md) | A disputed posting is money that moved | accepted |
| [ADR-027](decisions/adr-027-the-reconciliation-job-reports-and-never-repairs.md) | The reconciliation job reports and never repairs | accepted |
| [ADR-028](decisions/adr-028-a-public-page-renders-without-a-database.md) | A public page renders without a database | accepted |
| [ADR-029](decisions/adr-029-the-identifier-is-called-an-account-number.md) | The identifier is called an account number | accepted |
| [ADR-030](decisions/adr-030-staff-pay-a-withdrawal-when-the-member-asks.md) | Staff pay a withdrawal when the member asks | accepted |
| [ADR-031](decisions/adr-031-a-password-reset-is-one-transaction-and-the-table-behind-it-holds-no-secrets.md) | A password reset is one transaction, and the table behind it holds no secrets | accepted |
| [ADR-032](decisions/adr-032-the-auth-endpoints-answer-the-same-way-whoever-is-asked-about.md) | The auth endpoints answer the same way whoever is asked about | accepted |
| [ADR-033](decisions/adr-033-a-member-is-anonymised-a-rejected-applicant-expires.md) | A member is anonymised; a rejected applicant expires | accepted |
| [ADR-034](decisions/adr-034-english-is-the-default-locale-and-the-default-has-no-prefix.md) | English is the default locale, and the default has no prefix | accepted |
| [ADR-035](decisions/adr-035-idle-behaviour-is-a-line-item-not-a-performance-detail.md) | Idle behaviour is a line item, not a performance detail | accepted |
| [ADR-036](decisions/adr-036-a-member-with-no-email-resets-their-password-at-the-desk.md) | A member with no email resets their password at the desk | accepted |
| [ADR-037](decisions/adr-037-a-row-has-a-key-for-machines-and-an-identifier-for-people-and-a-view-for-reading.md) | A row has a key for machines and an identifier for people, and a view for reading | accepted |
| [ADR-038](decisions/adr-038-retention-is-tiered-by-what-the-data-is-not-by-one-clock.md) | Retention is tiered by what the data is, not by one clock | accepted |
| [ADR-039](decisions/adr-039-an-account-number-is-issued-on-admission-an-application-number-on-submission.md) | An account number is issued on admission, an application number on submission | accepted |
| [ADR-040](decisions/adr-040-a-persons-files-live-in-one-folder-named-after-them.md) | A person's files live in one folder, named after them | accepted |
| [ADR-041](decisions/adr-041-a-branchs-code-is-its-primary-key.md) | A branch's code is its primary key | accepted |
| [ADR-042](decisions/adr-042-admission-hands-out-a-number-a-password-is-issued-separately.md) | Admission hands out a number; a password is issued separately | accepted |
| [ADR-043](decisions/adr-043-a-persons-row-id-is-the-number-they-are-known-by.md) | A person's row id is the number they are known by | accepted, extended by [ADR-044](decisions/adr-044-every-row-is-keyed-by-what-it-is-already-called.md) |
| [ADR-044](decisions/adr-044-every-row-is-keyed-by-what-it-is-already-called.md) | Every row is keyed by what it is already called | accepted |
| [ADR-045](decisions/adr-045-office-expenses-are-a-flat-500-taka-outside-the-loan.md) | Office expenses are a flat ৳500, outside the loan | accepted |
