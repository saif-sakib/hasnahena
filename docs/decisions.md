# Decisions

Why the code looks the way it does. Each entry resolves a conflict that used to exist between documents, or between documents and reality. Append new entries; do not rewrite old ones.

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

`apps/web/prisma/migrations/` is deliberately empty. With one developer and a Neon branch per environment, `db push` is faster and avoids drift-repair ceremony. The trade-off is no schema history and no safe rollback.

Adopt `prisma migrate` when a second developer joins or when production data cannot be rebuilt. *(The second condition arrived first.)*

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

**Status:** accepted · commit `5db86b7`, backfill in `scripts/migrate-member-ids.sql`.

Account and member identifiers are human-readable and branch-prefixed (`ACC-KH-33001`) because they are read aloud and written into paper passbooks. Generation lives in `apps/api/internal/utils/member_id.go`. Primary keys remain `cuid()` — the member ID is a display identifier, never a foreign key.

---

### ADR-010 — Documents are rendered in the browser, then rasterised

**Status:** superseded by [ADR-012](#adr-012--official-documents-are-english-only-and-drawn-as-pdf-text) · `apps/web/lib/documents/`.

jsPDF cannot shape complex scripts: Bengali conjuncts and matras come out reordered, so drawing statements with PDF text primitives is not an option, and `jspdf-autotable` is unusable for the same reason. Documents are therefore built as standalone HTML, rendered by the browser, and captured with html2canvas.

Two output paths, deliberately:
- **Print** (`openPrintWindow`) — native pagination and real selectable text. The better output; prefer it when the user just wants a file.
- **Download** (`downloadAsPDF`) — the canvas is sliced into A4 pages at blank pixel rows so a page break never cuts through a line, then each slice is placed with uniform margins and a page counter. Non-selectable text is the accepted cost of correct Bengali.

Do not "improve" this by switching to jsPDF text output without solving Bengali shaping first.

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

### ADR-009 — Formal specification PDFs retired

**Status:** accepted · 2026-08-14.

Nine LaTeX/PDF specification documents (BRD, SRS, FRD, API contract, DB schema, architecture, use cases, test plan, roadmap) described a system that was never built and contradicted the code on stack, currency, auth, and notifications. Their durable content — business rules, roles, FR-01…FR-22, use cases, test priorities, quality bars — is compressed into [product.md](product.md), [architecture.md](architecture.md), [data-model.md](data-model.md), and [tasks.md](tasks.md).

The originals remain in git history at commit `a8f7517` if a formal deliverable is ever needed again.

---

### ADR-015 — A balance is written relatively, never read-modify-written

**Status:** accepted · 2026-08-17.

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
was never affected — so the fix is convergence on existing practice, not a new
pattern. Recorded as an ADR because the wrong version is the intuitive one, and
it was written twice independently.

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
