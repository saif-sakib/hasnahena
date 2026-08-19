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
| [ADR-008](#adr-008--member-ids-are-acc-kh-) | Member IDs are `ACC-KH-#####` | accepted |
| [ADR-009](#adr-009--formal-specification-pdfs-retired) | Formal specification PDFs retired | accepted |
| [ADR-010](#adr-010--documents-are-rendered-in-the-browser-then-rasterised) | Documents are rendered in the browser, then rasterised | superseded |
| [ADR-011](#adr-011--one-trimmed-transparent-logo-asset-set) | One trimmed, transparent logo asset set | accepted |
| [ADR-012](#adr-012--official-documents-are-english-only-and-drawn-as-pdf-text) | Official documents are English only, and drawn as PDF text | accepted |
| [ADR-013](#adr-013--document-numbers-are-sequential-and-named) | Document numbers are sequential and named | accepted |
| [ADR-014](#adr-014--prisma-migrate-supersedes-db-push) | Prisma migrate supersedes `db push` | accepted |
| [ADR-015](#adr-015--a-balance-is-written-relatively-never-read-modify-written) | A balance is written relatively, never read-modify-written | accepted |
| [ADR-016](#adr-016--a-withdrawal-notice-is-the-members-request-not-a-field-on-the-payout) | A withdrawal notice is the member's request, not a field on the payout | accepted |
| [ADR-017](#adr-017--read-config-inside-the-transaction-never-from-the-pool) | Read config inside the transaction, never from the pool | accepted |
| [ADR-018](#adr-018--the-official-infos-history-is-not-purged) | The `Official Infos/` history is not purged | accepted |
| [ADR-019](#adr-019--one-function-decides-where-a-request-came-from) | One function decides where a request came from | accepted |
| [ADR-020](#adr-020--the-cloudinary-assets-have-no-backup-and-that-is-accepted-until-launch) | The Cloudinary assets have no backup, and that is accepted until launch | provisional |
| [ADR-021](#adr-021--the-support-proxy-limits-per-member-trusted_proxies-stays-at-one) | The support proxy limits per member; `TRUSTED_PROXIES` stays at one | accepted |
| [ADR-022](#adr-022--member-approval-waits-for-the-email-inside-a-ten-second-budget) | Member approval waits for the email, inside a ten-second budget | accepted |
| [ADR-023](#adr-023--one-member-identifier-usersmemberid) | One member identifier: `users.memberId` | accepted |
| [ADR-024](#adr-024--two-content-security-policies-chosen-per-route) | Two Content-Security-Policies, chosen per route | accepted |
| [ADR-025](#adr-025--the-rate-limiter-keys-on-the-verified-member) | The rate limiter keys on the verified member | accepted |

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

Account and member identifiers are human-readable and branch-prefixed (`ACC-KH-33001`) because they are read aloud and written into paper passbooks. Generation lives in `apps/api/internal/utils/member_id.go`. Primary keys remain `cuid()` — the member ID is a display identifier, never a foreign key.

`users.memberId` is the platform's **only** member identifier — see [ADR-023](#adr-023--one-member-identifier-usersmemberid).

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

**Status:** accepted · 2026-08-18 · implements FR-08.

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
sending garbage. Tracked in [production-readiness.md](production-readiness.md).

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

### ADR-023 — One member identifier: `users.memberId`

**Status:** accepted · 2026-08-18.

Reported by the owner: the statement prints "Member ID" and
"Account No" as two labelled rows holding the same string.

It was not a rendering mistake. `accounts.accountNumber` was **assigned the
owner's `memberId`** in both places an account could be created — `const
accountNumber = memberId` in the registration route, and the same `memberID`
parameter in `ApproveRegistration`, which additionally re-synced it on every
approval. Two columns, one value, kept equal by hand.

**`memberId` is the one that survives**, and the codebase had already half
decided this:

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
`users.memberId`; for the pool, the literal is replaced by the owner id.

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

That collides directly with [WO-73](work-orders.md), which had just made ten
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
same origin. What holds that down is that those pages have no XSS sink — there is
no `dangerouslySetInnerHTML`, no `innerHTML` and no `eval` anywhere in `app/`,
`components/` or `lib/`, so every admin-controlled string they render goes
through React's escaping — and `connect-src`/`img-src` deny the usual
exfiltration paths even if one appeared. This is a real tradeoff, not a free win,
and the day Next can nonce a prerendered page it should be revisited.

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
