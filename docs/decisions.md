# Decisions

Why the code looks the way it does. Each entry resolves a conflict that used to
exist between documents, or between documents and reality. **Append new entries;
do not rewrite old ones** — a superseded ADR keeps its reasoning and gains a
pointer, because the argument is what stops the idea coming back.

Read the one row you need. Superseded entries are compressed to the part that is
still true.

| | Decision | Status |
|---|---|---|
| [ADR-001](#adr-001--go-api-owns-money-nextjs-owns-content) | Go API owns money; Next.js owns content | accepted |
| [ADR-002](#adr-002--money-is-stored-as-whole-taka-in-bigint) | Money is stored as whole taka in `BigInt` | accepted |
| [ADR-003](#adr-003--email-only-no-sms) | Email only, no SMS | accepted |
| [ADR-004](#adr-004--prisma-db-push-no-migration-files) | `prisma db push`, no migration files | superseded |
| [ADR-005](#adr-005--two-response-shapes-and-which-one-is-canonical) | Two response shapes, and which one is canonical | accepted |
| [ADR-006](#adr-006--auth-is-self-hosted-jwt) | Auth is self-hosted JWT | accepted |
| [ADR-007](#adr-007--no-redis-no-separate-cache-tier) | No Redis, no separate cache tier | accepted |
| [ADR-008](#adr-008--member-ids-are-acc-kh-) | Account numbers are `ACC-KH-#####` | accepted |
| [ADR-009](#adr-009--formal-specification-pdfs-retired) | Formal specification PDFs retired | accepted |
| [ADR-010](#adr-010--documents-are-rendered-in-the-browser-then-rasterised) | Documents are rendered in the browser, then rasterised | superseded |
| [ADR-011](#adr-011--one-trimmed-transparent-logo-asset-set) | One trimmed, transparent logo asset set | accepted |
| [ADR-012](#adr-012--official-documents-are-english-only-and-drawn-as-pdf-text) | Official documents are English only, and drawn as PDF text | accepted |
| [ADR-013](#adr-013--document-numbers-are-sequential-and-named) | Document numbers are sequential and named | accepted |
| [ADR-014](#adr-014--prisma-migrate-supersedes-db-push) | Prisma migrate supersedes `db push` | accepted |
| [ADR-015](#adr-015--a-balance-is-written-relatively-never-read-modify-written) | A balance is written relatively, never read-modify-written | accepted |
| [ADR-016](#adr-016--a-withdrawal-notice-is-the-members-request-not-a-field-on-the-payout) | A withdrawal notice is the member's request, not a field on the payout | superseded by [ADR-030](#adr-030--staff-pay-a-withdrawal-when-the-member-asks) |
| [ADR-017](#adr-017--read-config-inside-the-transaction-never-from-the-pool) | Read config inside the transaction, never from the pool | accepted |
| [ADR-018](#adr-018--the-official-infos-history-is-not-purged) | The `Official Infos/` history is not purged | accepted |
| [ADR-019](#adr-019--one-function-decides-where-a-request-came-from) | One function decides where a request came from | accepted |
| [ADR-020](#adr-020--the-cloudinary-assets-have-no-backup-and-that-is-accepted-until-launch) | The Cloudinary assets have no backup, and that is accepted until launch | provisional |
| [ADR-021](#adr-021--the-support-proxy-limits-per-member-trusted_proxies-stays-at-one) | The support proxy limits per member; `TRUSTED_PROXIES` stays at one | accepted |
| [ADR-022](#adr-022--member-approval-waits-for-the-email-inside-a-ten-second-budget) | Member approval waits for the email, inside a ten-second budget | accepted |
| [ADR-023](#adr-023--one-member-identifier-usersaccountno) | One member identifier: `users.accountNo` | accepted |
| [ADR-024](#adr-024--two-content-security-policies-chosen-per-route) | Two Content-Security-Policies, chosen per route | accepted |
| [ADR-025](#adr-025--the-rate-limiter-keys-on-the-verified-member) | The rate limiter keys on the verified member | accepted |
| [ADR-026](#adr-026--a-disputed-posting-is-money-that-moved) | A disputed posting is money that moved | accepted |
| [ADR-027](#adr-027--the-reconciliation-job-reports-and-never-repairs) | The reconciliation job reports and never repairs | accepted |
| [ADR-028](#adr-028--a-public-page-renders-without-a-database) | A public page renders without a database | accepted |
| [ADR-029](#adr-029--the-identifier-is-called-an-account-number) | The identifier is called an account number | accepted |
| [ADR-030](#adr-030--staff-pay-a-withdrawal-when-the-member-asks) | Staff pay a withdrawal when the member asks | accepted |
| [ADR-031](#adr-031--a-password-reset-is-one-transaction-and-the-table-behind-it-holds-no-secrets) | A password reset is one transaction, and the table behind it holds no secrets | accepted |
| [ADR-032](#adr-032--the-auth-endpoints-answer-the-same-way-whoever-is-asked-about) | The auth endpoints answer the same way whoever is asked about | accepted |
| [ADR-033](#adr-033--a-member-is-anonymised-a-rejected-applicant-expires) | A member is anonymised; a rejected applicant expires | accepted |
| [ADR-034](#adr-034--english-is-the-default-locale-and-the-default-has-no-prefix) | English is the default locale, and the default has no prefix | accepted |
| [ADR-035](#adr-035--idle-behaviour-is-a-line-item-not-a-performance-detail) | Idle behaviour is a line item, not a performance detail | accepted |
| [ADR-036](#adr-036--a-member-with-no-email-resets-their-password-at-the-desk) | A member with no email resets their password at the desk | accepted |
| [ADR-037](#adr-037--a-row-has-a-key-for-machines-and-an-identifier-for-people-and-a-view-for-reading) | A row has a key for machines and an identifier for people, and a view for reading | accepted |
| [ADR-038](#adr-038--retention-is-tiered-by-what-the-data-is-not-by-one-clock) | Retention is tiered by what the data is, not by one clock | accepted |
| [ADR-039](#adr-039--an-account-number-is-issued-on-admission-an-application-number-on-submission) | An account number is issued on admission, an application number on submission | accepted |
| [ADR-040](#adr-040--a-persons-files-live-in-one-folder-named-after-them) | A person's files live in one folder, named after them | accepted |
| [ADR-041](#adr-041--a-branchs-code-is-its-primary-key) | A branch's code is its primary key | accepted |
| [ADR-042](#adr-042--admission-hands-out-a-number-a-password-is-issued-separately) | Admission hands out a number; a password is issued separately | accepted |
| [ADR-043](#adr-043--a-persons-row-id-is-the-number-they-are-known-by) | A person's row id is the number they are known by | accepted |

---

### ADR-001 — Go API owns money; Next.js owns content

**Status:** accepted · supersedes the "Go gateway + Java Spring Boot ledger" design.

A separate Java ledger service was specified and never built, and it is not justified for this scale. Instead: the Go API is the single writer for anything that moves a balance, and Next.js route handlers keep the CMS-style surfaces (registration intake, gallery, settings, worker CRUD, audit viewer) plus pure status transitions.

The split is real duplication and the cost is accepted for now. The rule that keeps it safe: **if it changes a balance, it belongs in Go.** New financial endpoints must not be added to Next.

---

### ADR-002 — Money is stored as whole taka in `BigInt`

**Status:** accepted · migrated in commits `8a402f0` and `93191ff`.

Balances were originally minor units (paisa) with ×100 conversions scattered across the frontend, backend, and PDF generation. Bangladeshi cooperative practice does not transact in paisa, and the conversions were a recurring source of 100× display bugs.

All amounts are now whole taka in `BigInt` columns. Never reintroduce a ×100 or ÷100, never use `float` for money, never store paisa.

---

### ADR-003 — Email only, no SMS

**Status:** accepted · supersedes the "SMS primary via SSL Wireless" requirement.

SMS gateways in Bangladesh need a paid contract and sender registration. Brevo transactional email is free at this volume and already integrated in the Go API (`internal/services/email_service.go`). Notifications for approval, rejection, credentials, and password reset go by email; in-app `Notification` rows cover the rest.

SMS remains a Phase 2 option. Until then no code should reference an SMS provider, and `FEATURE_SMS_NOTIFICATIONS` style flags should not exist.

---

### ADR-004 — `prisma db push`, no migration files

**Status:** superseded by [ADR-014](#adr-014--prisma-migrate-supersedes-db-push) · 2026-08-16.

With one developer and a Neon branch per environment, `db push` was faster and
avoided drift-repair ceremony, at the cost of no schema history and no safe
rollback. To be revisited "when a second developer joins or production data
cannot be rebuilt" — the second condition arrived first.

---

### ADR-005 — Two response shapes, and which one is canonical

**Status:** accepted, with a known inconsistency.

The Go API returns `{success, data}` / `{success, error}` and `lib/api.ts` depends on that envelope. Older Next route handlers return bare JSON or `{ok, error}`. Normalising them all is not worth a breaking sweep right now.

Canonical for anything new: the Go envelope. Do not add new Next handlers with a third shape.

---

### ADR-006 — Auth is self-hosted JWT

**Status:** accepted · supersedes Clerk / Auth.js / Keycloak.

Clerk was specified but never wired, and its pricing plus a Bengali-first, phone-based membership flow made it a poor fit. Auth is HS256 JWT minted by the Go API, bcrypt password hashes, revocation through the `token_blacklist` table, and lockout through `rate_limits`.

Consequence: web and API **must** share one `JWT_SECRET`. The Next middleware only checks token expiry for redirects; signature verification always happens server-side.

---

### ADR-007 — No Redis, no separate cache tier

**Status:** accepted.

Redis/Valkey appeared in the stack table for caching and background jobs; neither is in use. PostgreSQL carries rate limiting, the token blacklist, and support-chat retention. Support chat streams over SSE straight from the Go API rather than through a broker.

Revisit only when a real background-job need appears (installment reminders, timeout sweeps).

---

### ADR-008 — Member IDs are `ACC-KH-#####`

**Status:** accepted · commit `5db86b7`.

Account numbers are human-readable and branch-prefixed (`ACC-KH-33001`) because they are read aloud and written into paper passbooks. Generation lives in `apps/api/internal/utils/account_no.go`. Primary keys remain `cuid()` — the account number is a display identifier, never a foreign key.

`users.accountNo` is the platform's **only** member identifier — see [ADR-023](#adr-023--one-member-identifier-usersaccountno) and [ADR-029](#adr-029--the-identifier-is-called-an-account-number) for why it is spelled that way.

The one-off backfill (`scripts/migrate-member-ids.sql`) was deleted 2026-08-19 once it had run everywhere: it renumbers every member in one transaction, which is destructive against a live database and useful to nobody now. Recover it from `5db86b7` if it is ever needed again.

---

### ADR-009 — Formal specification PDFs retired

**Status:** accepted · 2026-08-14.

Nine LaTeX/PDF specification documents (BRD, SRS, FRD, API contract, DB schema,
architecture, use cases, test plan, roadmap) described a system that was never
built and contradicted the code on stack, currency, auth and notifications.
Their durable content is compressed into [product.md](product.md),
[architecture.md](architecture.md), [data-model.md](data-model.md) and
[tasks.md](tasks.md). The originals remain in git history at `a8f7517`.

---

### ADR-010 — Documents are rendered in the browser, then rasterised

**Status:** superseded by [ADR-012](#adr-012--official-documents-are-english-only-and-drawn-as-pdf-text) · 2026-08-15.

Documents were built as standalone HTML, rendered by the browser and captured
with html2canvas, because **jsPDF cannot shape complex scripts** — Bengali
conjuncts and matras come out reordered, and `jspdf-autotable` is unusable for
the same reason. ADR-012 removed the constraint by making documents English
only. The shaping problem is real and unchanged: if Bengali documents are ever
required again, the fix is an embedded Unicode font with shaping, **not** a
return to screenshotting the page.

---

### ADR-011 — One trimmed, transparent logo asset set

**Status:** accepted · 2026-08-14.

The delivered logo was a 1366×768 video frame on an opaque black background, which renders as a black box on the site header and in white documents. Shipping it directly was not viable, so the source is keyed (alpha from the max channel, unpremultiplied to keep edges clean), trimmed to content, and published as three derived assets in `apps/web/public/images/logo/`:

`logo.png` (transparent lockup — UI and documents) · `logo-mark.png` (square leaf mark — favicon, avatars, tight spaces) · `logo-og.png` (1200×630 on white — social cards, because transparent PNGs render black in most social clients). `logo-print.png` was added by [ADR-012](#adr-012--official-documents-are-english-only-and-drawn-as-pdf-text) for PDF mastheads.

Masters live in `apps/web/assets/brand/`, **not** `public/`: `logo-source.png` (untouched original), `logo.mp4` (animated version, unused), `dashboard-logo.png` (superseded by the `branding.dashboardLogo` setting). Anything under `public/` is served to the internet and shipped in every deploy, and these three were 2.3 MB of files nothing links to. `assets/` is not a Next.js convention directory — it is never bundled or served.

Regenerate derived assets from `assets/brand/logo-source.png` rather than editing them by hand.

---

### ADR-012 — Official documents are English only, and drawn as PDF text

**Status:** accepted · 2026-08-15 · supersedes [ADR-010](#adr-010--documents-are-rendered-in-the-browser-then-rasterised).

Statements, receipts, loan agreements and certificates were generated in both
Bengali and English. Official and financial paperwork is now English only: it is
the language the records are audited, filed and presented in, and one version
means one thing to review when the layout changes. The UI stays bilingual —
this applies to generated documents, not to the app.

That removes the constraint ADR-010 was built around. Bengali conjuncts and
matras cannot be shaped by jsPDF's standard fonts, which is why documents used
to be rendered as HTML and captured with html2canvas. With no Bengali to shape,
the PDF is drawn with real text primitives instead, which fixes what
rasterisation cost us:

- **Text is selectable, searchable and copyable.** A raster PDF is a picture.
- **Output is vector-sharp** at any zoom, instead of fixed-resolution JPEG.
- **Pagination is explicit** — a block that will not fit before the content
  bottom starts a new page, and the footer is painted per page once the page
  count is known. Slicing a tall bitmap could and did cut the last line in half.
- **Files are ~6× smaller** (a 3-page statement is ~33 kB, not ~200 kB).

`html2canvas` and `jspdf-autotable` were dropped as dependencies.

One document model now feeds two renderers — `render/html.ts` for preview and
print, `render/pdf.ts` for download — so the two outputs cannot drift apart.
Amounts print as `BDT 1,25,000`: the `৳` sign lives in the Bengali Unicode block
and cannot be encoded by the PDF's standard fonts. Values that arrive in Bengali
anyway (letterhead from `system_config`, member-typed notes) are stripped before
drawing, so an unrenderable string shows as a dash rather than mojibake.

If Bengali documents are ever required again, the fix is an embedded Unicode
font with shaping — not a return to screenshotting the page.

---

### ADR-013 — Document numbers are sequential and named

**Status:** accepted · 2026-08-15.

Receipts, withdrawals, loans and repayments were numbered
`RCP-20260815-A3F2B1` — a cryptic prefix plus six random hex characters. That is
hard to read aloud at the counter or copy into a paper passbook, carries no
ordering, and offered no uniqueness guarantee for `loans.loanNumber`, which is
`@unique`: a collision would have failed a money-moving transaction.

Numbers are now `SERIES-YYYY-NNNNNN` with a spelled-out series —
`DEP-2026-000123`, `WDR-2026-000045`, `LOAN-2026-000012`, `REP-2026-000234` —
matching the readability rationale of the `ACC-KH-#####` member IDs (ADR-008).

The counter comes from the `document_sequences` table, one row per series per
year, incremented by an atomic upsert. The Go API allocates inside the same
transaction as the posting, so concurrent postings can never share a number and
a rolled-back posting releases its number instead of leaving a gap. Next.js
route handlers that create request-stage records (loan applications, deposit and
withdrawal requests) allocate from the same table, so a document type has one
series regardless of which backend created the record.

Existing records keep their old numbers; both formats are readable and the
document layer treats a value that already looks like a reference as-is.

---

### ADR-014 — Prisma migrate supersedes `db push`

**Status:** accepted · 2026-08-16 · supersedes [ADR-004](#adr-004--prisma-db-push-no-migration-files).

ADR-004 deferred migrations until "a second developer joins or production data cannot be rebuilt". The second condition arrived: the database holds real member savings and loan balances, and no amount of re-running `db push` reconstructs a taka.

Two concrete failures pushed this over the line:

- `db push` is a diff against the live database, so **the schema has no history**. When a `document_sequences` column turned out to have no usable default in production, there was no record of when it changed or what it replaced — the only way to answer was to inspect the running database.
- `db push` will silently drop a column to make the database match the schema. On `transactions` or `accounts` that is unrecoverable member data, and nothing in the workflow asks twice.

The current schema is baselined as `0_init`, generated with `prisma migrate diff --from-empty`, so it is byte-identical to what `db push` had produced. Nothing changed shape at the cutover.

**What did not change:** an `@updatedAt` column still gets **no database default** under migrations either — Prisma applies those in the client. SQL written by hand in the Go API must set both `"createdAt"` and `"updatedAt"` itself. Migrations make that visible in a reviewable file rather than discoverable in production; they do not fix it. See [data-model.md](data-model.md).

**Consequences**

- Every environment runs `pnpm db:migrate`. Databases predating this ADR need `pnpm db:migrate:baseline` once.
- `pnpm db:push` survives for throwaway local databases. Pointed at production it reintroduces exactly the drift this ADR removes.
- Migrations need a **direct** (non-pooled) connection; `pnpm db:migrate` derives one from the pooled URL and logs that it did. See [deployment.md](deployment.md#neon).
- CI applies migrations rather than pushing, so the integration suite tests the schema that actually deploys.

---

### ADR-015 — A balance is written relatively, never read-modify-written

**Status:** accepted · 2026-08-17 · implemented the same day (WO-41).

Two of the three ways this codebase changes a savings balance were
read-modify-write: fetch the balance, add in Go, write the total back. One of
them fetched from the connection pool, before the transaction had even begun.

Measured against a real Postgres 17: twenty concurrent ৳1,000 deposits into an
empty account left a **৳1,000 balance and ৳20,000 of transaction rows**, and ten
concurrent ৳5,000 withdrawals against ৳10,000 of savings all succeeded. The
ledger and the balance disagreed, which for a cooperative that reprints paper
passbooks from `savingsAfter` snapshots is the worst available outcome: the
document handed to the member becomes evidence against the account.

**The rule.** Balance mutations are expressed as relative SQL and Postgres does
the arithmetic:

```sql
UPDATE accounts SET "savingsBalance" = "savingsBalance" + $1
WHERE id = $2 RETURNING "savingsBalance"::bigint
```

Guards move into the statement rather than sitting in front of it — `AND
"savingsBalance" >= $1` for a withdrawal, with no rows returned meaning
insufficient funds. Where a value genuinely must be read before it is written,
the read happens inside the transaction with `FOR UPDATE`.

**What this rules out**, and why they were considered: `SERIALIZABLE` isolation
would work but imposes a retry loop on every posting for a problem one statement
solves; an advisory lock per account adds a second lock ordering to reason about
next to the `FOR UPDATE` on `transactions`. Neither is needed.

`loan_repository.go` already followed this — which is why the default waterfall
was never affected — so the fix was convergence on existing practice, not a new
pattern. Recorded as an ADR because the wrong version is the intuitive one, and
it was written twice independently.

The guard against it coming back a third time is a test, not this document:
`TestConcurrentDepositsAllLand` and `TestConcurrentWithdrawalsCannotOverdraw` in
[`ledger_integrity_integration_test.go`](../apps/api/internal/repositories/ledger_integrity_integration_test.go)
fail loudly against a read-modify-write. Both were confirmed to fail against the
pre-fix code before they were allowed to pass.

---

### ADR-016 — A withdrawal notice is the member's request, not a field on the payout

**Status:** superseded 2026-08-24 by
[ADR-030](#adr-030--staff-pay-a-withdrawal-when-the-member-asks) · accepted
2026-08-18 · implemented FR-08.

**Superseded in its conclusion, not in its findings.** The notice period is gone;
the two facts this ADR discovered on the way to it are not, and both are load
bearing. *A `transactions` row is not necessarily money that moved* is now
CLAUDE.md rule 6a and the reason four aggregates filter on status. *A payout
settles the member's row rather than inserting a second one beside it* is still
exactly what `AddMemberWithdrawal` does with an outstanding request. Read the
Consequences below for those; read ADR-030 for what replaced the gate.

`loan.noticePeriodMonths` existed as a config key, was editable in the admin
settings page, and **was read by nothing**. The screen said "3 months" and the
system applied no notice period at all — the settings page even carried a label
saying so. A control that reports a policy the system does not apply is worse
than no control, because it eventually gets trusted.

Two shapes were considered. [go-live.md](go-live.md) suggested a *policy field
on the withdrawal*: `noticeGivenAt` and the applied period stamped on each
`transactions` row. That is a migration plus a place for a worker to type a date
somebody told them.

**The chosen shape needs no schema change, because the record already exists.**
A member requesting a withdrawal *is* giving notice. `CreateMemberWithdrawalNotice`
files a `PENDING` `WITHDRAWAL` row; its `createdAt` starts the clock; the payout
settles that same row rather than inserting a second one.

**The gate is on both paths that can move the money.** `ApproveWithdrawal`
(admin) and `AddMemberWithdrawal` (the worker at the desk) each refuse until the
notice matures. A check on the approval alone would have been bypassable by the
payout, which is the shape of half-enforcement this ADR exists to avoid.

It also closes a standing rule-4 gap. `AddMemberWithdrawal` could previously
originate a withdrawal from nothing — a worker moving a member's money with no
request behind it. It now requires a notice to settle, so the worker is always
settling something the member asked for.

**Consequences**

- **A `transactions` row is no longer necessarily money that moved.** A
  `WITHDRAWAL` row is either a notice (`PENDING`) or a payout (`CONFIRMED`).
  Four aggregates were summing every row regardless of status and are now scoped
  to `CONFIRMED` — they had the same latent error for `PENDING` deposit
  requests, which they were already counting as income. **Any new aggregate over
  `transactions` must filter on status.**
- A notice covers *up to* the amount announced. Withdrawing less than you gave
  notice for is allowed; more needs its own notice.
- Outstanding notices count against the balance, or three separate notices for
  the whole balance could all be presented once matured.
- `0` is a legitimate value and means no notice period. It is written, not
  deleted — deleting the key restores the 3-month default silently.
- Members need a way to give notice, so the member deposits screen carries the
  form. Without it, FR-08 would simply have stopped withdrawals.

---

### ADR-017 — Read config inside the transaction, never from the pool

**Status:** accepted · 2026-08-18.

Adding one unconditional `getWithdrawalNoticePeriodMonths(ctx)` call inside
`AddMemberWithdrawal` hung `TestConcurrentWithdrawalsCannotOverdraw`
**permanently** — not slowly, not flakily. Nothing errored and nothing timed out
on its own.

The cause is that the plain config readers use `r.db`, the pool. Called while
holding a transaction, each one takes a *second* connection. With N goroutines
and a pool of N, every connection is held by an open transaction and every
transaction is waiting for a free connection to read a config key. The pool is
empty and stays empty, and no participant is doing anything wrong.

**This was already latent.** `AddMemberWithdrawal` read
`loan.allowActiveLoanWithdrawal` from the pool inside its transaction and
escaped only because `activeLoan > 0 &&` short-circuits it away in the common
case. The test that exposed it had been green for weeks over code one boolean
away from deadlocking.

So the readers come in pairs: `getSystemConfigInt64` for callers outside a
transaction, `getSystemConfigInt64Tx(ctx, tx, …)` for callers inside one. The
pool-based variants that no longer had a caller were **deleted** rather than
left available, because `unused` flags them and a dead-but-callable helper is an
invitation to reintroduce the deadlock. The Tx variants also read what the
transaction can see, which is the correct answer rather than an incidentally
similar one.

**Consequence:** inside a repository transaction, use the `…Tx` reader. If you
add a new one, add it in both forms only when both are actually called.

---

### ADR-018 — The `Official Infos/` history is not purged

**Status:** accepted · 2026-08-18 · closes WO-28, supersedes SEC-06 and SEC-10.

`git rev-list` over all refs finds 39 files under `Official Infos/` (~40 MB,
added in `f152f0c`, deleted in `9306120`) with names like
`Hasnahena Member Details.docx` and `Loan Member Detail.docx`, plus three stray
binaries — `react` (24.6 MB), `apps/api/server` (17.5 + 16.4 MB) and
`apps/api/seed` (13.6 MB).

WO-28 treated this as a data incident on the strength of those filenames, and
specified a `git filter-repo` purge plus a force-push of every ref plus a GitHub
Support ticket to garbage-collect the unreachable blobs.

**The repository owner reviewed the contents and determined that none of it is
live member data** — the platform has never held real member records. On that
finding the purge is not warranted: it rewrites every commit hash in the
repository, is irreversible, and its entire justification was the sensitivity of
those files.

**What this decision rests on, stated plainly so it can be revisited:** an
owner's inspection of files a script cannot classify (the largest is an
image-only PDF scan). If that assessment is ever found to be wrong, the runbook
is in this file's history at the commit that removed WO-28 — `git log -- docs/work-orders.md`
— and it gets more expensive with every clone taken.

**Consequences**

- Roughly 100 MB of dead weight stays in history. Clone size is the cost, and
  the repository is private with no other collaborators.
- `.gitignore` carries `Official Infos/` so a re-add is not one `git add -A`
  away, and the binaries are covered by the existing rules.
- **The exemption is for these specific files only.** Real member data
  committed after launch is a different question with a different answer, and
  the cheapest moment to rewrite history is always now rather than later.

---

### ADR-019 — One function decides where a request came from

**Status:** accepted · 2026-08-18 · closes WO-60 · removes chi's `middleware.RealIP`.

Four places in the Go API answered "which address is this caller?" and three of
them read the **leftmost** `X-Forwarded-For` entry — the end the caller writes:

- chi's `middleware.RealIP`, which overwrote `r.RemoteAddr` with it for every
  request in the process, so the access log recorded an address the caller chose
  and, at the default `TRUSTED_PROXIES=0`, the rate limiter keyed on it too;
- `getClientIP` in `auth_handler.go`, which is what the **login lockout** counts
  failed attempts against;
- three inline header reads in `dashboard_handler.go`, which store the result in
  an `audit_logs` row as evidence of who changed a password.

`middleware.clientIP` was the only one that was right, and it was already
unit-tested with a comment explaining exactly why the leftmost entry cannot be
trusted. It made no difference: `RealIP` had destroyed its input three
middlewares earlier.

**The decision:** there is now exactly one resolver, `middleware.ClientIP(r,
trustedProxies)`, counting entries from the trusted end. `Logging` calls it once
per request and puts the answer in the request context; `RequestClientIP(r)`
reads it back, and every handler uses that. `RealIP` is not mounted, and
`mountMiddleware` carries a comment saying why so it is not re-added as an
obvious improvement.

`TRUSTED_PROXIES` is the single knob and it is a deployment fact, not a request
one: **set it to the number of proxies in front of the process, and to 0 only
when nothing is.** Too low and real members share one bucket; too high and the
header is believed. Render is 1.

That first failure is new, and it is the price of this change: `RealIP` used to
give every caller a distinct — if forgeable — identity, so nobody noticed the
setting. Without it, a process behind a proxy with `TRUSTED_PROXIES=0` sees the
proxy's address on every request and throttles the whole membership as one
client. **`main.go` therefore logs a warning at boot** when the count is 0
outside development, because a silent misconfiguration here is a rate limiter
that rejects real members.

**Consequences**

- The access log gains a `peer` field whenever the attributed address and the
  TCP peer differ. With a proxy in front they differ on every request; with none
  configured, a difference means someone sent a header claiming otherwise.
- A handler must never read `X-Forwarded-For` itself. `RequestClientIP` falls
  back to the TCP peer for a request that did not pass through `Logging`, which
  is the safe direction to fail.
- The middleware stack moved out of `main()` into `mountMiddleware`, for the
  same reason `mountRoutes` did: the defect lived in the composition, and a
  stack built inline cannot be exercised by a test.

---

### ADR-020 — The Cloudinary assets have no backup, and that is accepted until launch

**Status:** accepted, provisional · 2026-08-18 · closes the WO-55 half of DATA-06 · **needs the owner's confirmation**.

Registration documents — NID front and back, member photo, signature — live only
in Cloudinary. There is no export, no second copy, and the account is a free tier
with a quota. The database has an encrypted nightly `pg_dump` drilled on every
push (DATA-01 → 05); the images have nothing.

WO-55 asked for a decision "even if the answer is *accept the risk until
launch*". This is that answer, with the reasoning written down so it can be
revisited rather than forgotten:

- **There is nothing to lose yet.** The platform holds no real member documents;
  every asset in the account today came from a test.
- **The failure is bounded and recoverable while that is true.** A lost image is
  a member asked to photograph their NID again — not a lost balance, and not a
  record that cannot be reconstructed.
- **The cost of building it now is a script that cannot be tested**, because
  testing it means real credentials and real assets. An export job written
  against an empty account is a hypothesis, and this repository has already paid
  for one of those (see the Dockerfile trap).

**The trigger is the first real member document**, not a date. From that moment
the exposure is a regulatory record held in one place by one third party, and
the job has to exist before the account does anything unexpected.

**What it will need when it is built:** list `hasnahena/registrations/**` via the
Admin API, download to the same encrypted destination the `pg_dump` backup uses,
and — because the `documents` table holds the URLs — reconcile the two so a
missing asset is *detected* rather than discovered by an approver opening a
blank image.

---

### ADR-021 — The support proxy limits per member; `TRUSTED_PROXIES` stays at one

**Status:** accepted · 2026-08-18 · closes WO-64.

Everything the browser calls goes cross-origin to the Go API except
`/v1/dashboard/support/*`, which `lib/api.ts` rewrites to a same-origin Next
proxy. That proxy joined the catch-all segments straight into the upstream URL,
and Next hands them over already percent-decoded, so `%2e%2e%2f` arrived as
`../` and `fetch` normalised it away before the request left. It is now an
allow-list of the six paths `main.go` actually mounts, method by method.

**It was never privilege escalation** and the record should say so: the Go API
authorises every route itself and gates `/admin` at the router, so a member's
token is refused there whichever door it arrives at. An unnecessary door, not an
open safe.

The order also asked the proxy to forward the member's address as an
`X-Forwarded-For` entry so the Go limiter could stop attributing all support
traffic to Vercel. **That does not work, and the reason is worth recording so
nobody tries it again.** `ClientIP` reads the header from the trusted end —
`parts[len(parts)-TRUSTED_PROXIES]` — because that is the only end a caller
cannot choose. Two paths reach the API with different depths:

| Path | Header at the API | `TRUSTED_PROXIES=1` reads |
|---|---|---|
| browser → Render | `member` | `member` ✓ |
| browser → Render, member spoofing | `9.9.9.9, member` | `member` ✓ |
| browser → Vercel → Render | `vercel` | `vercel` |
| browser → Vercel → Render, proxy forwarding | `member, vercel` | `vercel` |

Forwarding puts the member's address at an index the setting does not read.
Raising it to 2 would read the member on the proxied path and a **spoofed entry**
on the direct one — and it is one global number, so there is no setting that is
right for both. `TRUSTED_PROXIES` stays at **1**, and the proxy deliberately
sends no `X-Forwarded-For` at all.

So the per-member limit lives on the Next side, where the member's address is
known and Vercel sets it: 60 mutations per minute per caller, matching the Go
default, through the same `consumeRateLimit` the registration and lookup routes
use. Reads are not counted, exactly as `rateLimitExempt` does not count them
over there.

**What this does not fix:** the Go limiter still sees one address for all
proxied traffic, so enough abusive members can still exhaust that bucket between
them. The complete fix is a limiter keyed on the authenticated user rather than
the address, which needs verified identity in middleware — the token cannot be
trusted before it is checked, or an attacker mints a fresh bucket per request by
sending garbage. Tracked in [tasks.md](tasks.md).

**Also changed:** `fetch` now carries `signal: req.signal`, so a member closing
their browser ends the upstream SSE stream instead of leaving it open for the
life of the process — RUN-02 ends streams first at shutdown precisely because
open streams eat the drain window. Note that nothing in the web client uses SSE
today: the dashboard polls. The leak was real in the code, not in production.

---

### ADR-022 — Member approval waits for the email, inside a ten-second budget

**Status:** accepted · 2026-08-18 · closes WO-62.

`sendWithRetry` made three attempts against a 12-second client with a 1.5-second
sleep between them: **39 seconds**, synchronous, inside the handler that approves
a member. `SERVER_SHUTDOWN_TIMEOUT` is 30. A deploy landing during a slow Brevo
call was a `SIGKILL` mid-request — the failure RUN-02 exists to prevent,
reintroduced through a dependency's latency.

The order asked whether approval should block on delivery at all, given that the
handler reports `emailDelivered` and `deliveryError` separately and returns the
temporary password in the response.

**It should block.** Those two fields are the argument *for* waiting, not
against it: they exist so the admin knows, while the member is still in front of
them, whether to read the password out instead. Send it after the response and
that signal becomes either absent or a guess, and the admin learns nothing.
Ten seconds is a tolerable spinner for the one action in the system that hands
someone their credentials.

What made the old code dangerous was that it had no bound, not that it blocked.
So: a 10-second budget for the whole sequence, 4 seconds per attempt so one hung
connection cannot spend all of it, and an interruptible backoff.

**The caller's context is taken for its values and not for its cancellation**,
which is deliberate and is the part most likely to be "tidied up" later:

- **A client disconnect must not cancel it.** The approval has already
  committed, and the response carrying the password is exactly what was lost —
  so the email is now the only way the member will ever receive it.
- **A shutdown need not cancel it.** In-flight requests are allowed to finish;
  that is what the drain is for, and ten seconds fits inside thirty with room.

`TestTheCallersCancellationDoesNotCancelTheSend` and
`TestTheWorstCaseFitsInsideTheShutdownDrain` hold both halves, the second
against the real constants so the budget and the drain cannot drift apart.

**Unchanged, and load-bearing:** `ApproveRegistration` has already committed
before the send. A member's approval is never rolled back because an email
failed.

---

### ADR-023 — One member identifier: `users.accountNo`

**Status:** accepted · 2026-08-18.

Reported by the owner: the statement prints "Member ID" and
"Account No" as two labelled rows holding the same string.

It was not a rendering mistake. `accounts.accountNumber` was **assigned the
owner's identifier** in both places an account could be created — `const
accountNumber = memberId` in the registration route, and the same parameter in
`ApproveRegistration`, which additionally re-synced it on every approval. Two
columns, one value, kept equal by hand.

**One of the two survives**, and the codebase had already half decided which:

- It is the **member's** identity, not an account's, and it exists before any
  account does — a `PENDING` registration has one.
- It has a format members read aloud, a sequence allocator behind an advisory
  lock, and a parser, in both languages ([ADR-008](decisions.md)).
- The **receipt and the loan agreement already used it alone.** Only the
  statement and the membership certificate printed the account number, which is
  what made the duplication visible on exactly two documents out of four.

Nothing ever read `accountNumber` to find a member's account — every lookup is
`WHERE "userId" = $1` — so outside those two documents and one chip on the
profile page, the column was write-only.

**`accounts.userId` is now unique.** That is not tidying: it is required by the
removal. The donation pool was the one row whose account number meant something
(`HN-ACC-DONATION`), and it is now found by its owner, the fixed id
`system_donation_fund` that `pnpm db:seed` assigns. `RecordDonation` takes
`FOR UPDATE` on that row, on a money path, so the predicate has to name exactly
one — a unique constraint is what makes that true rather than merely likely. It
also states the invariant every query already assumed, and the Prisma relation
becomes `User.account Account?` instead of a list nothing ever put two things in.

**No information is lost.** For a member account the value is still in
`users.accountNo` (called `users.memberId` when this was written — see
[ADR-029](#adr-029--the-identifier-is-called-an-account-number)); for the pool,
the literal is replaced by the owner id.

**What this does not do:** it does not rule out a future where one member holds
several accounts (a separate zakat fund, say — FR-15/16 contemplates per-fund
accounting). If that arrives, the unique constraint is the thing to reconsider,
and an account would then need an identifier **of its own** rather than a second
copy of its owner's.

---

### ADR-024 — Two Content-Security-Policies, chosen per route

**Status:** accepted · 2026-08-19 · closes WO-76 (SEC) · shipped report-only behind `CSP_ENFORCE`.

The web app had seven security headers and no CSP, while the Go API — which no
member's browser loads — had one. CSP is the control that turns a successful XSS
from account takeover into nothing happening; every other header on that list is
narrower.

WO-76 asked for a nonce-based policy. **A nonce-based policy and a prerendered
page are mutually exclusive**, and that is a property of Next rather than a
configuration mistake: Next stamps the nonce onto its script tags while
*rendering a request*, by parsing the `Content-Security-Policy` request header. A
page generated at build time has no request, so it has no nonce, and a strict
`script-src` then blocks its own hydration bootstrap.

That collides directly with [WO-73](changelog.md), which had just made ten
marketing routes static because reading `system_config` on every visit was the
largest performance item in the repository.

**The documented escape hatch does not work here, and it was measured rather than
reasoned about.** Next offers `experimental.sri` as the way to keep static
generation under a strict CSP. Enabled against this app it added `integrity` to
**8 of 14** external scripts and left all **6 inline scripts** untouched — and
those six are the RSC flight payload, which is what a strict `script-src`
actually blocks. Their content is the page's own data, so their hashes differ per
page and per build and cannot go in a global header either.

**The decision:** the policy is chosen per route by what the route can defend.

| Tier | Routes | `script-src` |
|---|---|---|
| session | `/dashboard/**` and the four auth pages | `'self' 'nonce-…' 'strict-dynamic'` |
| content | the ten marketing routes | `'self' 'unsafe-inline'` |

Every other directive is **identical** between them, and a test asserts that:
`connect-src` names only this origin and the Go API, `img-src` only
`res.cloudinary.com` plus `data:`/`blob:`, and `frame-ancestors`, `object-src`,
`base-uri` and `form-action` are locked in both.

The auth pages were moved to `force-dynamic` for this. They are where a password
is typed and where a session begins, so they belong in the strict tier; the cost
is four `noindex` routes that read no database rendering per request.

**The residual risk, stated plainly rather than buried.** An inline XSS on a
marketing page would execute, and the session token is in `localStorage` on the
same origin. What holds that down is that those pages have almost no XSS sink —
there is no `innerHTML` and no `eval` anywhere in `app/`, `components/` or
`lib/`, so every admin-controlled string they render goes through React's
escaping — and `connect-src`/`img-src` deny the usual exfiltration paths even if
one appeared. This is a real tradeoff, not a free win, and the day Next can nonce
a prerendered page it should be revisited.

**"Almost" is WO-79.** Structured data cannot be written as a text child: React
HTML-escapes it, entities are not decoded inside a `<script>` element, and the
JSON reaches the crawler unparseable — Next's own JSON-LD guide specifies
`dangerouslySetInnerHTML` for exactly this reason. So there is now one sink, in
`components/seo/structured-data.tsx`. It takes an object rather than a string,
builds the graph itself, and serialises through a function that escapes `<`, so
an admin who types `</script>` into the organisation name produces inert text.
`test/unit/csp.test.ts` counts the occurrences across all three directories and
fails on a second one — the claim in this paragraph is a test, not a sentence.

**Rollout.** Report-only by default; `CSP_ENFORCE=1` on Vercel switches the
header name and nothing else. A policy that breaks the dashboard gets removed in
a hurry rather than fixed, so the enforcing form was verified first: a real
browser, a production build, zero violations and zero hydration failures across
every public page and both dashboards.

**One directive is dropped in report-only mode**: `upgrade-insecure-requests`
does nothing there and Chromium says so in the console on every page load, which
a console-scraping test cannot distinguish from a violation.

---

### ADR-025 — The rate limiter keys on the verified member

**Status:** accepted · 2026-08-19 · closes WO-78 (RUN-09) · completes what [ADR-021](#adr-021--the-support-proxy-limits-per-member-trusted_proxies-stays-at-one) left open.

ADR-021 established that the Go limiter cannot see past the Next proxy: every
support request arrives from Vercel's address, all of it in one bucket, and no
value of `TRUSTED_PROXIES` is correct for both the proxied and the direct path.
It named the complete fix and deferred it: **key on the authenticated user
rather than on the address.**

The obstacle was ordering, and it is the whole difficulty. The limiter is global
middleware and runs before any handler's auth. Keying on an **unverified** token
would let an attacker mint a fresh bucket per request by sending garbage — the
WO-60 defect wearing a different header. So the token must be verified before the
limiter reads it.

**The decision:** a new `middleware.Identity`, mounted after `Logging` and before
`RateLimit`, verifies the bearer token's **signature and expiry** and puts the
subject in the request context. `RequestUserID(r)` reads it back. The limiter
keys on `user:<id>` when one is present and `ip:<addr>` when it is not.

This is [ADR-019](#adr-019--one-function-decides-where-a-request-came-from)'s
shape deliberately reused: one place decides, everything else reads it back, and
nothing else may parse an `Authorization` header to answer a cross-cutting
question.

**Revocation is deliberately not checked here.** `ValidateToken` asks the
database whether a token is blacklisted and whether a password change revoked the
member's tokens wholesale, and every handler still does that. Repeating it in the
limiter would put two queries on the hot path of every request *including the
ones it is about to reject* — a rate limiter that queries the database is an
amplifier, not a defence. It is also unnecessary for this purpose: a revoked
token is still proof of **which member holds it**, since nobody else can produce
a signature for that subject, so attributing their traffic to them is exactly
right. The handler refuses the request a moment later on its own.

**What `RequestUserID` is not for:** authorisation. It knows nothing about
revocation, roles, or whether the account is still ACTIVE. Use it to attribute a
request, never to permit one.

**Consequences**

- Two members behind the proxy get separate buckets; one abusive member can no
  longer exhaust the quota for the rest.
- Anonymous traffic and a signed-in member from the same address are separate
  callers, so a burst of unauthenticated requests cannot spend a member's quota.
- With no verifier wired — which is how every existing middleware test builds
  the stack — behaviour is byte-for-byte what it was before, and a test asserts
  that so those tests keep meaning what they meant.

---

## ADR-026 — A disputed posting is money that moved

**Context.** [ADR-016](#adr-016--a-withdrawal-notice-is-the-members-request-not-a-field-on-the-payout)
established that only `CONFIRMED` moved money: a `PENDING` withdrawal is a
member's notice and a `PENDING` deposit is a request, and four aggregates were
counting intentions as income.

WO-82's reconciliation needed the same question answered for the *other*
statuses, and found that `PATCH /api/v1/member/transactions/{id}/dispute` flips a
**CONFIRMED** posting to `DISPUTED` and changes no balance. The dispute is the
member's claim that the amount was wrong; it is the first step of a correction,
not the correction.

**Decision.** For reconciliation, money moved when the status is `CONFIRMED`
**or** `DISPUTED`. `PENDING`, `PROCESSED`, `REJECTED` and `REVERSED` are not
money that moved.

This does not weaken ADR-016. An aggregate over *requests* — pending deposits
awaiting a worker, income this month — still filters on `CONFIRMED` alone; a
disputed posting is not new income. The two questions are different and now have
different answers written down.

**Consequences.** `repositories.settledStatuses` is the single place the list
lives, and `TestADisputedPostingIsStillMoneyThatMoved` pins it. Had the job
counted `CONFIRMED` alone, every open dispute would have raised a drift alarm —
an alert that is always firing, which is the same as no alert.

---

## ADR-027 — The reconciliation job reports and never repairs

**Context.** WO-82 (OPS-07) sums the ledger and compares it to the stored
balances. The obvious next step, once drift is detected, is to correct it.

**Amended 2026-08-27: the pass runs daily, not hourly.** The cadence was never
part of this decision and is a cost one. The database this runs against suspends
its compute when nothing is connected and bills for the time it is awake, so an
hourly pass is twenty-four wakes a day — each holding the compute up for its
whole idle timer — to answer a question that, by the rest of this ADR, *nobody
acts on automatically anyway*. Drift is corrected by a human appending a posting,
the paper passbook is the reconciling record ([product.md](product.md)), and a
day's latency on a check whose output is an audit row and a gauge changes nothing
operationally. `RECONCILE_INTERVAL` still overrides it, and
`internal/config/idle_cost_test.go` fails if the default creeps back under six
hours without the reasoning being revisited.

**Decision.** It never does. On drift it writes an `audit_logs` row, logs a
`slog` error, and sets the `hasnahena_ledger_drift_*` gauges. A human decides
what to do.

**Why.** An automated correction to a ledger is a second defect written on top of
the first, and it destroys the evidence needed to understand the first. If the
drift came from a lost update, the surviving value and the missing one are the
only record of what happened; overwriting the balance to match a sum erases the
question of which posting was lost and who is owed money. `audit_logs` is
append-only for the same reason (rule 6), and corrections append.

There is a practical argument too: a repair loop that is subtly wrong corrupts
every account it touches on a schedule, at night, with nobody watching.

**Consequences.** `cmd/server/wiring_test.go` reads the source of
`startReconciliationLoop` and `reconcile_repository.go` and fails on any
`UPDATE accounts`, `UPDATE loans`, `UPDATE transactions` or balance assignment,
so this stays true rather than being remembered. The one write the job is
allowed is the append-only audit row.

The job's first pass also found two live defects in `waterfallRecoveryTx` that no
existing test caught — recovery rows written `PENDING` while the savings had
already been deducted, and `accounts."loanBalance"` never reduced — which is the
argument for the whole order in one sentence.

---

## ADR-028 — A public page renders without a database

**Context.** [WO-73](changelog.md) moved the marketing pages' `system_config`
and `galleryItem` reads from request time to **build** time by prerendering them.
The Docker image is built with `DATABASE_URL` pointing at a placeholder that does
not exist — the Dockerfile says so, and says why — so the next image build failed
with `Export encountered an error on /[locale]/donate/page`.

Six of the eight pages had no `try` of their own; the two that did survived,
which made it look like a bug in two pages rather than a missing contract on one
function.

**Decision.** `getPublicSettings()` and `getPublicGalleryItems()` never reject.
An unreachable database yields an empty map and an empty gallery, and the page
renders its fallback copy. Each page carries `revalidate = 3600`, so a build
without data self-heals within an hour of the first request.

The `catch` sits **outside** `unstable_cache`, not inside it. `unstable_cache`
stores resolved values and never rejections, so catching inside would memoise the
empty map and pin every public page to its hardcoded fallback for the whole
revalidate window after one transient Neon blip.

**Consequences.** `test/unit/public-content-fallback.test.ts` asserts both
halves, and asserts them against a mocked `next/cache` — the real
`unstable_cache` throws `Invariant: incrementalCache missing` outside a Next
server, and the very `catch` under test swallows it, so the first version of that
file passed with the query never running.

---

## ADR-029 — The identifier is called an account number

**Status:** accepted · 2026-08-19.

[ADR-023](#adr-023--one-member-identifier-usersaccountno) settled that there is
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

## ADR-030 — Staff pay a withdrawal when the member asks

**Status:** accepted · 2026-08-24. Supersedes
[ADR-016](#adr-016--a-withdrawal-notice-is-the-members-request-not-a-field-on-the-payout).
Directed by the owner.

[ADR-016](#adr-016--a-withdrawal-notice-is-the-members-request-not-a-field-on-the-payout)
turned a dead config key into an enforced policy: a member filed a notice from
their own dashboard, its `createdAt` started a clock, and neither the admin's
approval nor the worker's payout could move money until it ran out. That was the
right reading of FR-08 as written, and it was tested on both paths.

It does not match how the foundation works. A member does not open a dashboard to
give notice — they tell the field worker who visits them, usually while handing
over that month's deposit. Requiring a self-service filing put a step in front of
the money that no member was going to take, and the most common outcome of the
staff withdrawal screen became a refusal explaining a form the member had never
seen.

**Decision.**

1. **A payout needs no request behind it.** `AddMemberWithdrawal` writes its own
   `CONFIRMED` row when there is nothing outstanding to settle. The rule-4
   reading that a worker "never originates money movement" is satisfied by the
   member asking in person; it was never satisfied by the notice row, which only
   recorded that the asking had happened in a particular place.
2. **There is no notice period.** `ApproveWithdrawal` and `AddMemberWithdrawal`
   both lost their maturity gate, and `ErrNoWithdrawalNotice` and
   `ErrNoticePeriodNotElapsed` went with them.
3. **The member-side notice is gone.** `POST /v1/dashboard/member/requests/
   withdrawal`, `CreateMemberWithdrawalNotice` and the form on the member's
   savings screen were all removed.
4. **`loan.noticePeriodMonths` becomes `loan.noticePeriodDays`, and is
   informational.** Days because that is the unit the foundation quotes. It is
   read by the member's savings screen and by the FAQ answer, and by nothing in
   either backend.

**What did not change, and is the reason the settlement code survives.** A
member may still have an outstanding `PENDING` withdrawal — rows filed before
this change, and any left over from the member request flow. Paying one at the
desk *settles that row* rather than writing a second one, with `amount` rewritten
to what was actually paid. Two rows for one withdrawal would double it in every
total over `transactions`, which is ADR-016's own finding and still true.

**A setting nothing enforces is normally a defect.** `UNIMPLEMENTED_CONFIG_KEYS`
exists to name exactly that failure, and ADR-016 was written to fix an instance
of it. The distinction that keeps `loan.noticePeriodDays` out of that list is
that it is **read**: two screens render the number, so changing it changes what
members are told. What it no longer does is block a payout, and the admin control
says so in as many words — an admin who believes this gates money will not
understand why a withdrawal went through.

**Consequences.**

- **FR-08 changed meaning.** `docs/product.md` and `docs/tasks.md` describe the
  member's withdrawal as a request made in person and paid by staff.
- **Two tests assert an absence**, which is the only way to pin a rule that has
  been deleted: `TestWithdrawalWithNoRequestBehindItIsPaid` and
  `TestAFreshRequestIsPaidImmediately`. Without them the gate could be
  reintroduced and every remaining assertion would still pass.
- The three notification builders that named a maturity date are gone;
  `WithdrawalRequestReady` replaced the one that survives, and its test row
  asserts the word "notice" is **not** in the message.
- `loan.noticePeriodDays` moved into `PUBLIC_CONFIG_KEYS`, because `/faq` is a
  prerendered marketing page and reads only that tier.
- The guarantor lock and the active-loan rule are untouched. What was removed is
  the notice period, not FR-09.

---

### ADR-031 — A password reset is one transaction, and the table behind it holds no secrets

**Status:** accepted · WO-85, WO-86, WO-87 (2026-08-24).

Three defects shared one cause: `password_reset_tokens` and the password write
were treated as bookkeeping rather than as the credential path they are.

**1. The reset did not revoke anything.** Token revocation is built, wired and
enforced on both backends — `services.IsUserTokensRevoked` and
`apps/web/lib/auth-revocation.ts` — and it was called from the *logged-in*
password change and not from the forgot-password reset. That is the wrong way
round. The logged-in change is made by someone who still controls the account;
the reset is the path a member reaches **because they cannot get in**, which
includes "somebody else is using my account". A member whose password was stolen
did the only thing available to them and left the attacker signed in for up to 24
hours, with nothing telling them it had not worked.

**2. The table was a set of working credentials.** `token` held the raw secret
from the email and the lookup was `WHERE token = $1`. Anything that could read
one row — a backup, the Neon console, a support screenshot, an injection
anywhere in either backend — could take over the account. `token_blacklist` has
stored `sha256(token)` since SEC-01 and says why in the schema comment; reset
tokens simply never got the same treatment.

**3. One reset could set two accounts' passwords.**
`UPDATE users SET "passwordHash" = $1 WHERE email = $2 OR phone = $3`, with no
row-count check. When the email on a token belonged to one row and the phone to
another — reachable through a rejection tombstone, an admin phone edit, or any
contact change — it reset a stranger's password to the requester's. Zero rows
returned `nil`, so the API answered "password reset" to a member whose password
had not changed.

**Decision.**

1. **One method, one transaction.** `UserRepository.CompletePasswordReset` spends
   the link, writes the hash, retires the first-login marker and writes the
   revocation marker, or none of them happens. The password write is scoped to
   `id` and must affect exactly one row; spending the link requires exactly one
   row with `"usedAt" IS NULL`, which is what makes it single-use under
   concurrency rather than only in the happy path.
2. **The secret is hashed on the way in.** `CreateResetToken` takes the plaintext
   and hashes it itself, so no call site can store a secret by forgetting to.
   SHA-256, not bcrypt: the forgot-password secret is 32 bytes from
   `crypto/rand`, the lookup is *by* the hash, and a per-row salt would make that
   a table scan.
3. **The purpose moved to a `scope` column.** A hash has no prefix, so
   `first-login-…` and `pwd-change:<userId>:…` could not survive as conventions
   on the secret. Uniqueness is `(scope, tokenHash)` rather than the hash alone,
   because a `pwd-change` secret is six digits and two members can hold the same
   one.
4. **The revoke-all *write* lives in `repositories`.** It has to run inside a
   password's transaction, `services` imports `repositories` and not the reverse,
   and two copies of one INSERT is the shape that disagrees eventually. The read
   side stays in `SecurityService`.
5. **The marker's lifetime is derived from `JWT_EXPIRY_SECONDS`.** It was
   `INTERVAL '24 hours'`, which is exactly that variable's default and was safe
   only by coincidence. Raising the variable past 86400 would have brought
   revoked tokens back to life, silently, on both backends at once.

**Consequences.**

- The migration deletes `reset` and `pwd-change` rows and **migrates**
  `first-login` rows in place. WO-86 said to delete everything on the grounds
  that plaintext cannot be recovered from a hash; nothing needs recovering —
  hashing runs forward from the column — and deleting the first-login markers
  would have switched off `mustChangePassword` for every already-approved member
  with no message anywhere.
- Both languages write this table, so `apps/web/lib/reset-tokens.ts` holds the
  Next half and `test/unit/reset-token-scopes.test.ts` reads the Go source and
  fails if either side moves.
- Retiring the first-login marker belongs to the reset now. It used to happen as
  a side effect of `ForgotPassword` deleting every row for the address, so asking
  for a link and never clicking it cleared the forced password change.

---

### ADR-032 — The auth endpoints answer the same way whoever is asked about

**Status:** accepted · WO-88, WO-89 (2026-08-24).

For a religious-finance cooperative in one town, **membership itself is the
sensitive fact** — a list of who banks here is worth more to the wrong person
than any single balance. That reasoning is written out in
`apps/web/app/api/v1/registrations/route.ts`, which throttles the registration
availability check for exactly this reason. `POST /v1/auth/forgot-password`
answered the same question more precisely and carried no throttle at all: `404`
meant *not a member*, `400 AUTH_EMAIL_REQUIRED` meant *a member, and here is a
fact about their record*, `200` meant *a member*.

**Decision.**

1. **One reply.** Always `200`, always the same body, for a member, a suspended
   member, a member with no email address, and a phone number nobody here has.
   The lookup and the send happen behind it and every failure is logged rather
   than returned. The two refusals that survive are true of every caller alike:
   the throttle counts what *this* caller has asked for, and an unconfigured
   email service is decided **before** any lookup runs.
2. **The attempts that find nothing get an audit row.** That is the signal an
   enumeration is under way, and it used to be a 404 nobody keeps.
3. **Two throttles.** One on the identifier, one on the address — the second is
   what stops one address cycling through numbers, at the 20-per-10-minutes the
   registration endpoint already settled on.
4. **The login lockout escalates on the identifier *and the address*, and stays
   flat on the identifier alone.** This is the load-bearing half. The counter has
   always keyed on the identifier, which means anybody who knows a member's phone
   number can keep them out of their own savings by guessing; at 30 seconds that
   is a nuisance and at an hour it is a weapon. So the pair escalates — 30 s, 2
   m, 10 m, 1 h — and a member signing in from their own phone is untouched by an
   attack from somewhere else. An escalation past the first step writes an audit
   row, because a flat lockout looks identical on the fifth failed attempt and on
   the five-hundredth.
5. **`ErrUserInactive` is answered only after the password verifies.** A
   suspended member needs to be told why they cannot get in; an anonymous caller
   with the wrong password does not get to learn that the account is real. The
   ordering already held; it is pinned by a test now, because it is a one-line
   move away from being wrong.
6. **An unknown identifier still pays for a bcrypt comparison.** Otherwise the
   oracle simply moves from the status code to the stopwatch.

**Consequences.**

- The forgot-password screen no longer says "Email Sent!". It says "if an account
  exists…", in both languages, because a screen that confirms delivery hands back
  the fact the endpoint stopped disclosing.
- Rate limits are per-action policies (`rateLimitPolicies`) rather than three
  package constants. `TestEveryRateLimitedActionIsDeclared` reads every `.go`
  file in the API and fails on a bare string literal at a call site, because an
  undeclared action silently gets the default policy; a second test refuses a
  declared action with no policy.
- `CheckRateLimit` no longer refuses on `attempts >= MaxAttempts` alone. That
  branch made the `RetryAfterSecs` it reported a number nothing enforced, and
  made a lockout impossible to *serve* — which is what an escalation escalates
  from.

---

### ADR-033 — A member is anonymised; a rejected applicant expires

**Status:** accepted · owner decision 2026-08-25 · WO-93 · implements FR-23.

Workers could be deleted. Members could not — there was no endpoint, no screen
and no repository method — and a rejected applicant's row was kept forever with
their address, both parents' names, their NID number and their photo URL, under a
tombstoned email and phone. Keeping the *decision* is defensible; keeping the
identity documents of somebody the foundation refused, permanently and with
nothing that could ever remove them, is a different question, and it was the
owner's to answer.

Three rules came out of it, and each one exists because the obvious alternative
is wrong in a specific way.

**1. A member with postings is anonymised, never deleted.** The ledger is summed
hourly and compared to the stored balances ([ADR-027](#adr-027--the-reconciliation-job-reports-and-never-repairs)).
A posting whose owner has vanished does not make the sum *smaller*; it makes it
permanently wrong, and it makes every past `audit_logs` row point at nobody. So
erasure strips the person and keeps the money: the identity columns are cleared,
contact is tombstoned, and `accountNo`, the `Account`, every `Transaction` and
every `Loan` are untouched. A member with no postings is deleted outright and
the cascade takes the rest.

Which of the two happens is decided by counting references, not by asking. The
database would refuse the delete regardless — `transactions.userId` and
`loans.borrowerId` are `ON DELETE RESTRICT`, because neither declares a cascade —
so without the count the answer to "delete this member" is a 500 with a foreign
key in it. The count is what turns a constraint into an answer, which is the same
shape as [rule 2b](../CLAUDE.md).

**2. Erasure ends the session in the same transaction.** The revoke-all marker is
written beside the anonymisation, for the reason
[ADR-031](#adr-031--a-password-reset-is-one-transaction-and-the-table-behind-it-holds-no-secrets)
gives about the password: a member whose identity has been removed but whose
token still works is a live session belonging to an account that no longer
describes anybody.

**3. The audit row names the account number, never what was erased.**
`audit_logs` is append-only (FR-19, DATA-08). An erasure that recorded its
`oldValue` the way `WORKER_UPDATED` does would copy the NID number, the parents'
names and the address into a table nothing can delete from — erasure that
preserves what it erases. The row carries the account number, the approving
admin, the reason and the counts; the worker handler's `oldValue` pattern is
deliberately *not* followed here, and that is the one place WO-93's "follow the
worker handler exactly" had to be disobeyed.

**Where each half runs.** The erasure endpoint is a Next route, not a Go one.
This is not a balance change, so [ADR-001](#adr-001--go-api-owns-money-nextjs-owns-content)
does not send it to Go — and the deciding factor is Cloudinary: the photograph is
the second most sensitive item after the NID number, `deleteImage` exists only in
`apps/web/lib/cloudinary.ts`, and an erasure that cleared `avatarUrl` while
leaving the image served from a public CDN would be theatre. The retention sweep
for rejected applications runs in the Go API instead, on the same ticker pattern
as reconciliation, because it needs an always-on process and it needs no
Cloudinary at all: `avatarUrl` is only ever written by a signed-in member on
their own profile page, and a rejected applicant has never signed in. The sweep
logs an error rather than silently clearing the column if it ever meets one, so
the assumption fails loudly instead of leaking.

**One year, not ninety days and not immediately.** A rejection can be
re-examined — an applicant re-applies, a family disputes what was submitted — and
the window is what makes that possible. It is a `system_config` key
(`security.rejectedRetentionDays`) rather than a constant, so shortening it is an
admin decision rather than a deploy.

---

### ADR-034 — English is the default locale, and the default has no prefix

**Status:** accepted · owner decision 2026-08-24 · WO-94, WO-95 · supersedes the
`defaultLocale = 'bn'` / `localePrefix: 'always'` scheme.

Owner review: *"You can keep the en as default. Anyone can use bn if he wants.
Also the primary language should be en… do which one is the best practice."*

**What was wrong was not the default; it was the redirect.** `/` 307'd to a
locale chosen from `Accept-Language`. Google merges a redirecting root with
whatever it lands on and keeps the shorter URL, which is exactly what Search
Console reported: *"Duplicate, Google chose different canonical than user"* on
`/bn`, Google-selected canonical `https://hasnahenafoundation.com/`. Flipping
`defaultLocale` on its own would have moved that report from `/bn` to `/en` and
left the cause untouched. Google's own guidance is against automatic language
redirects for this reason.

So `/` is a real, self-canonical English page. `localePrefix: 'as-needed'` with
`localeDetection: false`: the path is the only input to the locale decision, and
`/` does not negotiate at all.

| URL | Serves |
|---|---|
| `/`, `/about`, `/faq`, `/dashboard/admin` | English |
| `/bn`, `/bn/about`, `/bn/dashboard/admin` | Bengali |
| `/en/*` | **301** to the unprefixed form |

**Four decisions inside that, each of which could have gone the other way.**

1. **The dashboard loses its prefix too.** WO-95 offered keeping
   `/en/dashboard/...` prefixed as the smaller change, and it would have been —
   but two URL rules is the shape that drifts, and every URL in the application
   is built by `localePath()`, which has no reason to know whether a page has
   SEO value. One rule, no exceptions.

2. **301, not next-intl's own 307.** next-intl's `as-needed` mode redirects
   `/en/faq` on its own, temporarily. That is correct for a browser and useless
   as a canonical signal — Google treats a temporary redirect as reversible and
   may keep the old URL indexed. `proxy.ts` answers 301 before next-intl runs.
   301 rather than 308 because these are GET pages: method preservation buys
   nothing, and 301 is what every crawler, cache and ops tool reads without a
   second thought.

3. **`localeDetection: false`, so a Bengali browser is not redirected off `/`.**
   Leaving detection on would rebuild the old behaviour through a different
   door. A reader who wants Bengali chooses it — from the header toggle or a
   `/bn` link — which is a choice rather than a guess, and it is what keeps `/`
   a single URL with a single meaning.

4. **`Vary: Accept-Language` was deleted, not kept "just in case".** It was added
   because the negotiating root was cacheable and un-Varied, which was a real
   cache-poisoning defect. Nothing negotiates now, and a `Vary` that is not true
   costs a CDN cache entry per distinct header value on the busiest pages the
   site has. `e2e/locale-negotiation.spec.ts` asserts its absence over HTTP,
   because that is the only place a middleware header can be trusted.

**`x-default` still points at English and is still written out rather than as
`defaultLocale`,** even though the two are now equal. They answer different
questions — *what this site is primarily in* versus *what to serve a reader the
site was not built for* — and collapsing the line would make a future change to
one silently change the other.

**What did not change:** `app/[locale]/` is still the file-system shape, so
`generateStaticParams` still yields both locales and the prerender manifest keys
are still `/en/...`. `localePrefix` is a routing rule, not a directory rule, and
`assert-static-routes.mjs` reads the manifest rather than the public URLs.

---

## ADR-035 — Idle behaviour is a line item, not a performance detail

**Status:** accepted · 2026-08-27.

**Context.** The database is Neon on a free plan: the compute **suspends when
nothing is connected** and is billed for the time it is awake, against an
allowance measured in compute-hours. The platform is a village cooperative's
office — genuinely idle overnight and for much of the day.

It was nonetheless awake 100% of the time, and had been since deployment. Nothing
was misconfigured in any way that shows up in a review; four separately
reasonable decisions each held it open:

| Cause | Why it looked fine |
|---|---|
| `DB_MIN_CONNS=2` with a 1-minute health check | "Keep two warm connections so the first request is fast" |
| UptimeRobot on `/v1/ready` every minute | `/v1/ready` is *the* readiness endpoint — that is what it is for |
| `METRICS_REFRESH_INTERVAL=1m` | "Do not let a stranger's scrape interval drive database load" (ADR on OBS-02's ticker) |
| Cleanup and reconciliation hourly | Both are cheap queries |

Measured cost: roughly **182 compute-hours a month against an allowance of 100**,
on a platform nobody was using for most of them.

**Decision.** The idle cost of a running process is a first-class constraint on
this project, and every recurring database touch has to justify itself against
it. Concretely:

1. **The pool must be able to empty.** `DB_MIN_CONNS=0`, and
   `DB_MAX_CONN_IDLE_TIME` strictly shorter than the host's suspend timer so
   connections are gone before it would have started rather than resetting it.
2. **Uptime monitoring pings `/v1/health`, which touches nothing.** Keeping the
   *API* warm and keeping the *database* warm are different problems with
   different answers, and conflating them is what made a monitor into the
   largest line on the bill. `/v1/ready` remains correct for a load balancer,
   and is checked slowly (half-hourly) by the monitor.
3. **Metrics refresh on scrape, with a floor.** The original argument — that
   database load must not depend on somebody else's scrape interval — is kept by
   the floor. What it missed is that the alternative it chose tied load to
   *nothing at all*: 43,000 aggregate queries a month to answer 60 scrapes.
4. **Background jobs are measured in wakes per day, not queries per pass.** A
   tick is a wake whatever it costs to run, and a wake is billed for the whole
   idle timer.

**Why not just pay for it.** The foundation is a Qard al-Hasan fund in Jessore
running on free tiers by necessity, and every one of these changes costs a few
hundred milliseconds on a cold first request — paid once, by one person, when
nobody has used the platform for minutes. That is a good trade at this size. It
stops being one if the platform ever becomes busy enough that the compute never
idles anyway, at which point none of this has any effect and all of it can stay.

**Consequences.** `internal/config/idle_cost_test.go` asserts each of these as a
*ceiling on eagerness* rather than an exact value, so an operator may tune them
and a future default cannot silently drift back. The failure this prevents is
invisible in code review by construction — nothing here is a bug, and each value
is defensible alone — which is exactly why it is written down rather than
remembered.

---

## ADR-036 — A member with no email resets their password at the desk

**Status:** accepted · 2026-08-27 · the owner's ruling.

**Context.** `forgot-password` sends a link. **Most members of this cooperative
have no email address at all** — of the foundation's own register, a handful had
one and two of those were phone numbers typed into the wrong box. For those
people the self-service path did not exist, and no other one did either: a
forgotten password was permanent lockout, remediable only by somebody with SQL
access.

**Options.** SMS through a Bangladeshi gateway was the obvious answer and is
what a commercial product would do. It needs a paid account, credentials, a spend
limit and a new failure mode, and it reverses [ADR-003](#adr-003--email-only-no-sms).

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
password ([ADR-031](#adr-031--a-password-reset-is-one-transaction-and-the-table-behind-it-holds-no-secrets)) —
because a member asking for a reset may be asking precisely because somebody else
has their phone, and answering half of that is SEC-17 in a new place. The
temporary password is returned once and stored nowhere; the audit row names the
account number and never the password. This does not close the door on SMS: if
the volume of desk resets ever justifies the bill, this route stays and SMS
becomes an additional path rather than a replacement.

## ADR-037 — A row has a key for machines and an identifier for people, and a view for reading

**Status:** accepted · 2026-08-27.

**Context.** Every table in this schema is keyed on a `cuid()`, and every join is
between two of them. Opening `users` in the Neon console shows a column of
`cmob97efh00003zynz0as5knq`; answering "what did this member deposit last week"
by hand means copying opaque strings between three queries. The reasonable
reaction — and the one that prompted this — is that `users.id` and
`users.accountNo` look like the same fact stored twice.

**They are not the same fact.**

- `accountNo` is **null until an application is approved.** A pending applicant
  already has a row, an address, a nominee and four uploaded documents. A primary
  key cannot be null, so the key cannot be this.
- `accountNo` is a *business* identifier: `ACC-KH-33001`, continuing the
  foundation's paper register, read aloud and written into passbooks
  ([ADR-008](#adr-008--account-numbers-follow-the-foundations-own-series), [ADR-023](#adr-023--one-member-one-identifier)).
  Business identifiers get **corrected** — a wrong branch prefix, a duplicate
  found in the paper register. A key that changes has to cascade through every
  foreign key that points at it, and through the Cloudinary folder named after it.
- One column holds two series and a null: `ACC-…` for members, `STF-…` for staff,
  nothing at all for an applicant. That is not a key, it is three things.

So: **the surrogate key is for machines and never shown; the account number is
for people and never joined on.** That is the standard split, and this schema
already had it right.

**Decision.** Keep both, and fix the *ergonomics* instead, which is what was
actually missing. `prisma/migrations/20260827120100_readable_views` adds five
read-only views — `v_people`, `v_transactions`, `v_loans`, `v_audit`,
`v_pending_applications` — each leading with the identifier a human has and
joining the names in. Nothing writes through them, no application code reads them,
and Prisma's `migrate diff` does not model views, so they cost no drift.

**Why a view rather than a change of key.** A view is the only answer here that
is free to be denormalised. It can put the borrower's name, the guarantor's name
and the approver's name on one row of `v_loans` precisely because it stores
nothing and can never disagree with the table it reads. Every other way of making
the database readable — a name column copied onto `transactions`, an account
number copied onto `loans` — is [ADR-023](#adr-023--one-member-one-identifier)
again, and this repository has paid for that shape at least four times.

**Consequences.** `apps/web/test/unit/database-views.test.ts` reads the view
bodies and fails when one names a column `schema.prisma` no longer has — because
a view is checked by neither the compiler nor `pnpm db:migrate:check`, and the
next place it would be noticed is a migration failing at deploy time. A rename
must update the view in the same migration, the way a foreign key must.

The views are a debugging tool, not an API. Nothing in `apps/api` or `apps/web`
may select from one: the moment application code depends on a view, the view
stops being free to change and becomes a second schema.

## ADR-038 — Retention is tiered by what the data is, not by one clock

**Status:** accepted · 2026-08-27.

**Context.** [ADR-033](#adr-033--a-member-is-anonymised-a-rejected-applicant-expires)
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

## ADR-039 — An account number is issued on admission, an application number on submission

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
which makes true a claim [ADR-037](#adr-037--a-row-has-a-key-for-machines-and-an-identifier-for-people-and-a-view-for-reading)
already relied on and is why it cannot be the primary key. `ApproveRegistration`
returns the number it allocated, because the handler reads the candidate row
*before* approval and would otherwise put an empty string into the one email that
tells a member their number — and the approvals screen shows the number on
success rather than only on email failure, since most members have no email at
all ([ADR-036](#adr-036--a-member-with-no-email-resets-their-password-at-the-desk)).
It shows the **number** and not the password; see
[ADR-042](#adr-042--admission-hands-out-a-number-a-password-is-issued-separately).

Approval must **not** touch `formNumber`. It used to overwrite it with
`FORM-<accountNo>`, destroying the reference the applicant had been given and the
name of the folder holding their documents.

---

## ADR-040 — A person's files live in one folder, named after them

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
([ADR-039](#adr-039--an-account-number-is-issued-on-admission-an-application-number-on-submission)).
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
decision ([ADR-038](#adr-038--retention-is-tiered-by-what-the-data-is-not-by-one-clock)).

---

## ADR-041 — A branch's code is its primary key

**Status.** accepted · 2026-08-27

**Context.** `branches` carried a `cuid()` id *and* a unique, required `code`.
Two columns, each uniquely identifying a branch, one of them typed in by an admin
and printed beside the office name, the other never used for anything except
being the target of one foreign key. `users.assignedBranchId` therefore read
`cmob97efh00003zynz0as5knq` in a console, which is the complaint that started the
schema audit.

**Decision.** The code **is** the key. `branches.id = 'KH'`, and the `code`
column is dropped. The request body of the admin API still calls it `code`,
because that is the word for the thing a person types; the row calls it `id`,
because that is what it is.

**Why this is safe here and is not safe for `users`.** A branch has exactly one
inbound foreign key, a handful of rows, and its id has never been written into an
audit row, a document, a Cloudinary folder or a token. A member's id has all
four. That asymmetry is the whole decision: `users.id` stays a cuid and the `v_*`
views exist instead
([ADR-037](#adr-037--a-row-has-a-key-for-machines-and-an-identifier-for-people-and-a-view-for-reading)).

**Consequences.** The foreign key is `ON UPDATE CASCADE`, so correcting a typo in
an office code rewrites every member and worker attached to it in the same
statement — a capability the surrogate key did not have, because the code could
be changed freely and then named a row nobody could find by it.

`v_people` selected `b.code`, and a view depends on the columns it names, so the
migration replaces the view in the same file. That dependency is invisible to
`pnpm db:migrate:check` — Prisma's `migrate diff` does not model views — and it
was invisible to `test/unit/database-views.test.ts` too, which checked only
*quoted* identifiers on the argument that a bare lowercase column would break
every other query as well. `branches.code` disproved it: nothing else selected
it, so dropping it broke exactly one thing, at `prisma migrate deploy`, during a
deployment. That test now checks the unquoted half, and reads the **latest**
definition of each view rather than the migration that first created them.

---

## ADR-042 — Admission hands out a number; a password is issued separately

**Status.** accepted · 2026-08-27

**Context.** Approving a registration generates a temporary password, hashes it,
emails it if there is an address, and forgets it. It also returned it, and the
approvals screen printed it — on the reasoning that most members of this
cooperative have no email address at all
([ADR-036](#adr-036--a-member-with-no-email-resets-their-password-at-the-desk)),
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

## ADR-043 — A person's row id is the number they are known by

**Status.** accepted · 2026-08-27

**Context.** `users.id` was a `cuid()`, and every foreign key in the schema
points at it — so `transactions.userId` read `cmob97efh00003zynz0as5knq` in the
column an operator reading the ledger by hand looks at most, beside a
`receiptNumber` and an `accountNo` that are both perfectly readable. The owner
raised it three times. Twice it was refused, and the refusals were right about
the reasons they gave and wrong about the conclusion.

**What the refusals actually said.** That an account number cannot be a key
because it is null until approval; that renumbering a live row orphans a
Cloudinary folder; that a surrogate key is what lets a business identifier be
corrected. All three are about *changing an id after it has been handed out*.
None of them is about the id being unreadable, which was the complaint.

**Decision.** The id holds the number the person already has:

| | |
|---|---|
| staff | `STF-0001`, allocated when the account is created |
| an applicant | `APP-2026-000001`, allocated when the form is submitted |
| a member | `ACC-KH-33001`, allocated when they are admitted |
| the donation pool | `system_donation_fund`, which it already was |

So `users.id = users.accountNo` for everybody who has been admitted, and the
two-columns-for-one-fact that started the schema audit is gone. There is **no
`@default`**: every writer names the id, and one that forgets fails on a NOT NULL
primary key rather than quietly inventing an opaque one. The TypeScript compiler
enumerates the writers for free, which is why this needed no census test.

**Why it is safe, checked rather than assumed.** All sixteen foreign keys
referencing `users.id` are `ON UPDATE CASCADE`, verified against the live
catalogue. Four columns hold a user id *without* a foreign key. Two —
`token_blacklist.userId` and `notifications.data->>'userId'` — are rewritten, by
the migration and again by `renameUser` in the Go approval.

The other two are `audit_logs.entityId` and `audit_logs.performedBy`, and they
are **not touched**. The first version of this migration rewrote them and the
database refused it on live data: `audit_logs` carries an append-only trigger
(DATA-08) whose comment says UPDATE is never allowed *under any circumstances*,
and whose escape hatch covers DELETE only. That refusal is correct, and weakening
it to make a rename tidy would have spent the guarantee the table exists for on
cosmetics. An audit row saying who the subject was called **at the time** is the
better record anyway.

So the reader resolves instead. `user_id_history` records that one id became
another — one hop by construction, because a rename re-points any mapping that
already pointed at the retired id — and the audit endpoint consults it for any
`entityId` that resolves to nobody. Searching an account number also reaches the
rows written before admission, which is exactly the period somebody investigating
a registration wants to read.

The id changes **once**, at approval, and that moment is the whole argument: an
applicant's password hash is a sentinel bcrypt can never match, so they have
never signed in. There is no token carrying the old value, no session to break,
no third party holding it. After admission it is fixed for ever, which is what
keeps the earlier refusals' reasoning intact — a member is never renumbered, and
their Cloudinary folder is never orphaned.

**Consequences.** Anything holding a user id *across* the rename must re-read it.
There is exactly one such caller — the approvals screen, which files the new
member's documents immediately afterwards — and it answered 404 until it used
the account number the approval returns. `e2e/entry-path.spec.ts` walks the
rename and asserts the cascade: the member is addressable by their account
number, their `Account` followed, the application reference survived, and the old
id addresses nobody.

`transactions.id` was considered for the same treatment and refused:
`receiptNumber` is nullable and not unique, and four inserts in
`loan_repository.go` write none. Making it a key would mean issuing receipt
numbers for the default-recovery legs, which is a change to what a receipt
*means* rather than to how a row is named. `loans.loanNumber` would work and was
left alone as out of scope.

The seeded admin now gets a staff number too. It had none — nothing failed,
because the column is nullable, but it meant the foundation's first account was
the one account with no number, and only the cutover purge noticed.
