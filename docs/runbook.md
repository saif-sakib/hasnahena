# Runbook

**One person can currently deploy this.** That person is also the one who would
be unavailable in the scenario where this file matters. WO-84 exists because
every other item in the plan is worth less than it looks if nobody but Saif can
act on a Sunday morning.

Written for someone who is not the author, in a hurry, at night. Each section is
**symptom → check → act**, in the order a person actually needs them. Nothing
here is theory: every command has been run against this project.

> **Rule zero.** `audit_logs` is append-only and money never moves outside the
> Go API. Nothing in this document tells you to `UPDATE accounts`. If you find
> yourself about to, stop and read [§2](#2-a-disputed-or-wrong-transaction).

---

## Who to reach

| | |
|---|---|
| Owner | Saif Ahmed — repository owner, holds every credential below |
| Hosting | Vercel (web) · Render (Go API) · Neon (Postgres) |
| Email | Brevo · Media: Cloudinary |

If you cannot reach the owner, everything you need is in [§6](#6-where-every-credential-lives) —
but most of it needs their account, which is the honest state of things today
and the reason CI-09 and OPS-01 are still open.

---

## 1. The site is down

### 1a. Which half?

The web app and the API are separate deployments. A member seeing "something
went wrong" tells you nothing about which one.

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://hasnahenafoundation.com/en
curl -sS -o /dev/null -w '%{http_code}\n' https://<render-service>.onrender.com/health
```

| Web | API | Meaning |
|---|---|---|
| 200 | 200 | Not down. Look at Sentry and at one specific member's report |
| 200 | ✗ | API or database. Go to 1b |
| ✗ | 200 | Vercel deploy or build. Go to 1c |
| ✗ | ✗ | Neon, or a credential both share (`DATABASE_URL`, `JWT_SECRET`) |

The marketing pages are **prerendered** (WO-73), so `/en` can answer 200 from
cache while everything behind it is broken. Check `/en/dashboard/member` — it is
`force-dynamic` and cannot be served from a cache.

### 1b. The API is down or the database is unreachable

```bash
# Render → the service → Logs. What you are looking for, in order:
#   "cannot connect to database"        → Neon; see below
#   "api server listening"              → it started; the problem is downstream
#   nothing at all since the last deploy → the deploy failed; see 1c
```

Neon first, because it is the most common and the fastest to confirm:

1. Neon console → the project → **Operations**. A suspended or migrating
   compute answers nothing and logs nothing on our side.
2. Free-tier computes **suspend when idle** and take a few seconds to wake.
   A single slow first request is not an outage.
3. Connection limit reached: `DB_MAX_CONNS` on Render times the number of
   instances must stay under Neon's ceiling. The whole integration suite passes
   at `pool_max_conns=2`, so lowering this to buy time costs correctness
   nothing (ADR-017).

If Neon is healthy and the API still cannot connect, the credential is wrong —
`DATABASE_URL` was rotated in one host and not the other. See [§3](#3-a-suspected-credential-leak).

### 1c. A bad deploy → rollback

**Roll back first. Diagnose after.** Both hosts keep previous builds.

```
Vercel  → Deployments → the last known-good one → ⋯ → Promote to Production
Render  → the service → Events → the previous deploy → Rollback
```

Roll back **both** if the release changed both, even when only one looks broken:
the web app and the API share `JWT_SECRET` and the API contract, and a
half-rolled-back pair fails in ways neither log explains.

If the failure was a **migration**, rolling back the code does not roll back the
database. Read [§4](#4-restore-from-backup) before touching it — a forward fix is
almost always right, and a `DROP COLUMN` is not reversible.

---

## 2. A disputed or wrong transaction

A member says a posting is wrong. It may be a data-entry error, a duplicate, or
a genuine dispute about the amount.

**`audit_logs` is append-only, and corrections append (rule 6).** There is no
edit. The record of what happened must survive the correction, because the
record is what makes the correction defensible.

### What has already happened, mechanically

`PATCH /api/v1/member/transactions/{id}/dispute` sets the transaction to
`DISPUTED` and writes a `TRANSACTION_DISPUTED` audit row with the member's
reason. **It changes no balance.** A dispute is a claim about the amount, not a
reversal — which is why the reconciliation job counts a `DISPUTED` posting as
money that moved.

### What to do

1. **Read the trail before deciding.**
   ```sql
   SELECT action, "performedBy", details, "createdAt"
   FROM audit_logs WHERE "entityId" = '<transaction id>' ORDER BY "createdAt";
   ```
2. **Decide with a second person.** A correction to a member's balance made by
   one person at night is the thing this whole system exists to prevent.
3. **Post the correction through the application**, as a new posting, by the
   normal Request → Process → Confirm route (rule 4). A deposit that was 500 too
   high is corrected by a withdrawal of 500 with a description naming the
   original receipt number — not by editing the row.
4. **Never `UPDATE accounts` directly.** Balances are written relatively, inside
   one transaction, with an audit row, in the Go API and nowhere else (rules 2
   and 2a). A manual `UPDATE` skips the audit row, skips the `savingsAfter`
   snapshot every receipt is built from, and can silently lose a concurrent
   posting — which is LEDGER-01, exactly.
5. **Confirm the ledger still balances** after the correcting posting:
   the reconciliation job runs hourly, or check
   `hasnahena_ledger_drift_rows` on `/metrics`.

### If the ledger does not balance

`hasnahena_ledger_drift_rows{check=...}` is non-zero, or the log has
`ledger drift` lines.

The job **reports and never repairs** (WO-82), deliberately: an automated
correction to a ledger is a second defect on top of the first, and it destroys
the evidence needed to understand the first. What to do:

```sql
-- What the job wrote, one row per check that disagreed:
SELECT "entityId" AS check, details, "createdAt"
FROM audit_logs WHERE action = 'LEDGER_DRIFT_DETECTED'
ORDER BY "createdAt" DESC LIMIT 20;
```

| check | What it means |
|---|---|
| `savings_balance` | An account holds money no posting created, or is missing money a posting recorded. **This is the LEDGER-01 shape.** |
| `loan_balance` | The account's `loanBalance` disagrees with what its open loans owe |
| `loan_remaining` | A loan owes more than principal minus everything paid against it — interest by another name (rule 3) |
| `savings_snapshot` | A `savingsAfter` snapshot disagrees with the running total. **Receipts already in members' hands are wrong** |
| `transaction_owner` | A posting is attributed to someone who does not own the account it moved |

Do not correct it until you know **when** it started: the audit log's first
`LEDGER_DRIFT_DETECTED` row for that check bounds the window, and everything
posted since is suspect. Then correct by appending, as above.

---

## 3. A suspected credential leak

**Order matters.** Rotating one half of a shared secret is an outage.

### `JWT_SECRET` — rotate in Vercel and Render *together*

The Go API signs tokens with it and the Next route handlers verify with it
(`lib/server-auth.ts`). Change it in one host and every signed-in member gets
401s from half the application until the other catches up.

1. Generate: `openssl rand -base64 48`
2. Set it in **Render** → Environment, and in **Vercel** → Settings →
   Environment Variables, **before redeploying either**.
3. Redeploy both. Render restarts on save; Vercel needs a redeploy for the new
   value to reach the build.
4. **Every session is now invalid.** Members must sign in again. Say so
   somewhere before doing it, unless the leak makes that a luxury.

### `DATABASE_URL`

1. Neon → Roles → reset the password. This kills existing connections.
2. Update **Render** and **Vercel** — both connect directly.
3. Update the `BACKUP_DATABASE_URL` GitHub secret, or the nightly backup starts
   failing silently the next evening.

### The rest

| Secret | Where it lives | Rotate at | Breaks if stale |
|---|---|---|---|
| `BREVO_API_KEY` | Render | Brevo → SMTP & API | Password resets and every notification email |
| `CLOUDINARY_API_SECRET` | Vercel | Cloudinary → Settings → Access Keys | Document and gallery uploads |
| `METRICS_TOKEN` | Render | anything random | `/metrics` stops answering the monitor |
| `SENTRY_AUTH_TOKEN` | Vercel | Sentry → Auth Tokens | Source maps only; the build still succeeds |
| `BACKUP_PASSPHRASE` | GitHub secret | **do not rotate casually** | **Every existing backup becomes unreadable** |

`BACKUP_PASSPHRASE` is the one to think hardest about: it is symmetric, and
rotating it does not re-encrypt what is already stored. Keep the old one until
every archive encrypted with it has aged out.

### After any rotation

- Sign in as a member. A green health check does not prove the token path works.
- Trigger one password-reset email.
- Upload one document.

---

## 4. Restore from backup

**A restore you have not performed is a rumour.** This is why the procedure is a
script that executes rather than a document that rots.

### The backup

`.github/workflows/backup.yml` runs at 19:00 UTC (01:00 Dhaka) daily, plus a
monthly copy kept three times as long. It dumps, encrypts with
`BACKUP_PASSPHRASE`, and uploads as a workflow artifact — and to S3-compatible
storage if `BACKUP_S3_BUCKET` is set.

Neon's own point-in-time restore is **not** this. It is bounded by the plan's
retention window and every branch dies with the account.

### Verify a backup (do this on a schedule, not in an emergency)

```bash
# 1. Download the newest artifact from the Backup workflow run.
# 2. Restore it into a scratch database and prove it is intact:
BACKUP_PASSPHRASE='...' scripts/restore-check.sh ./hasnahena-2026-08-19.dump.gpg \
  postgresql://postgres:postgres@localhost:5432/restore_scratch
```

The script does four things, in increasing order of usefulness: `pg_restore`
completes, every declared table exists, row counts match the archive's own
catalog, and **the money invariants still hold** — no negative balance, and every
account reconciles against its transactions.

Against a **Neon branch** rather than a local scratch database, it refuses to run
unless you say so:

```bash
# Neon console → Branches → New branch (from the primary, at a point in time).
ALLOW_NEON_TARGET=yes BACKUP_PASSPHRASE='...' \
  scripts/restore-check.sh ./archive.dump.gpg 'postgresql://...branch.../neondb'
```

It refuses a `neon.tech` host without that variable because the scratch database
is **truncated and rewritten**. Restore into a branch, never the primary.

### Last rehearsed

**Never.** See [§Action still required](#action-still-required).

### Restoring for real

1. **Stop writing first.** Render → the API service → suspend. A restore
   underneath a live application produces a database that matches neither.
2. Create a Neon branch from before the damage and restore into **that**.
3. Verify with `restore-check.sh`, then by reading a handful of real balances
   and comparing them to what members report.
4. Point `DATABASE_URL` at the branch in **both** Render and Vercel, or promote
   the branch in Neon.
5. Resume the API. Watch `hasnahena_ledger_drift_rows` on the first
   reconciliation pass — it runs once at boot.

---

## 5. A member's data was erased and an asset was left behind

Erasing a member (FR-23, [ADR-033](decisions.md)) deletes their documents and
avatar from Cloudinary **after** the database transaction commits, deliberately:
a third-party API that will not answer must not roll back an erasure that has
already succeeded. So a Cloudinary failure leaves the row erased and the image
still served publicly, and the only record is this log line:

```
[Admin/EraseMember] N Cloudinary asset(s) for ACC-KH-33001 were not deleted and
are still served publicly.
```

The URLs are gone from the database by then, so they cannot be recovered from
it. Find the assets in the Cloudinary console by folder and date — uploads are
foldered per document type — and delete them by hand. The `MEMBER_ERASED` audit
row records `assetsFound` and `assetsDeleted`, so the gap is the count to look
for; it does not record the URLs, and must not.

The same log line at **error** level from the Go API means something different:

```
retention sweep cleared an avatarUrl it cannot delete from Cloudinary
```

That is supposed to be impossible — `avatarUrl` is written only by a signed-in
member on their own profile page, and a rejected applicant has never signed in.
If it appears, some upload path now reaches an applicant, the sweep has cleared
the column it would have needed to find the image, and the fix is in the code as
well as in the console.

---

## 5c. The asset tree does not match the database

Symptoms, any of which means the same thing: an application folder for a member
who was admitted months ago; a folder naming an application number that no row
has; a folder showing `nid-front` **twice**; a member with documents whose
folder does not appear in the Media Library at all.

```bash
cd apps/web
node scripts/cloudinary-reconcile.mjs            # prints the plan, changes nothing
node scripts/cloudinary-reconcile.mjs --confirm  # applies exactly that plan
```

It reads every asset under `hasnahena/` and every URL the database stores —
`documents`, `users.avatarUrl`, `gallery_items`, and every `system_config` value
— and then:

- **re-homes** an asset whose `asset_folder` disagrees with its own public id.
  `uploader.rename` moves the URL and not the folder anybody opens, so this is
  the drift every approval used to leave behind;
- **deletes** an asset under `applications/` that no stored URL mentions —
  a rolled-back submission, or a test pixel;
- **removes** an `applications/` folder that is left empty and does not belong to
  an application still awaiting a decision;
- **creates** the missing `people/` folder entry for a member who has documents
  but has never uploaded an avatar.

It will not delete anything under `people/`, `gallery/` or `settings/`, whatever
the database says. Those are reported at the end under **NOT TOUCHED** and are a
question for a person: an unreferenced file in a member's own folder usually
means the *row* is what went missing.

Read the plan before confirming. Every line names the size, the dimensions and
the upload date, which is what tells a 70-byte 1×1 test pixel apart from a
member's identity card at a glance.

---

## 5b. `migrate deploy` says a table already exists

The symptom is a deploy failing on `CREATE TABLE "users"` — or on any early
migration — against a database that plainly has that table. Prisma is not
confused about the schema; it has lost its **history**. `_prisma_migrations` is
a plain table and can be emptied by hand in a database console, by a restore
that did not include it, or by copying a database without it. With no rows in it
Prisma believes nothing has been applied and starts from the beginning.

Check before doing anything:

```bash
pnpm db:migrate:status   # "12 migrations found ... none applied" against a full schema
pnpm db:migrate:check    # "No difference detected" — the schema IS current
```

Those two answers together are the whole diagnosis: everything has run, nothing
is recorded. Repair it with

```bash
pnpm db:migrate:adopt
```

which marks every migration in `prisma/migrations` as applied and **executes
none of them** — each step is a row inserted into `_prisma_migrations`. It runs
the drift check itself first and refuses if the schema is genuinely behind,
because marking migrations applied against a database that is missing columns
turns a loud failure into a silent one.

If the drift check *does* report a difference, stop. Some of those migrations
really do still need to run, and the fix is to restore `_prisma_migrations` from
a backup (§4) rather than to guess which ones.

## 6. Where every credential lives

| Store | Holds | Who can reach it |
|---|---|---|
| **Vercel** project settings | `DATABASE_URL`, `JWT_SECRET`, `CLOUDINARY_*`, `SENTRY_*`, `NEXT_PUBLIC_*`, `CSP_ENFORCE` | Vercel account owner |
| **Render** service environment | `DATABASE_URL`, `JWT_SECRET`, `BREVO_API_KEY`, `METRICS_TOKEN`, `SENTRY_DSN`, every tuning knob | Render account owner |
| **GitHub** repository secrets | `BACKUP_DATABASE_URL`, `BACKUP_PASSPHRASE`, `BACKUP_S3_*`, `AWS_*` | Repository admins |
| **Neon** console | The database itself, roles, branches, PITR window | Neon account owner |
| **Brevo** / **Cloudinary** / **Sentry** | Their own keys | Their account owners |

`.env.vercel.example` and `.env.render.example` are the authoritative lists of
*which* variables each host needs. They carry no values and never will (rule 7).

**Three variables must agree across two hosts**, and every one of them is an
outage when they disagree: `JWT_SECRET`, `DATABASE_URL`, `NEXT_PUBLIC_APP_URL`.

---

## Action still required

Two things in this file are written and unproven, and both need an account only
the owner has:

- **The restore has never been rehearsed.** [§4](#4-restore-from-backup) is
  correct as written and has been run against a local scratch database; it has
  not been run against a Neon branch with a real archive. Do that once, and
  record the date here. A restore you have not performed is a rumour.
- **One person can still reach every credential.** [§6](#6-where-every-credential-lives)
  is a map of single points of failure, not a solution to them. OPS-01.

---

## Phase 7 — Steady-state operations

What makes it *stay* production-ready after you stop looking at it daily.
The open ones are tasks in [tasks.md](tasks.md); the rest are recurring.

| ID | Task | Cadence |
|---|---|---|
| OPS-01 | Incident runbooks | `[x]` [runbook.md](runbook.md) — API down, database unreachable, bad deploy → rollback, a disputed transaction against an append-only log, credential rotation in the right order, restore from backup, and where every credential lives |
| OPS-02 | Secret rotation | Every 6 months, and immediately after any exposure. `JWT_SECRET` must change in Vercel and Render **together** or every session breaks |
| OPS-03 | Dependency updates | Monthly, on a branch, with CI green |
| OPS-04 | Restore drill | Quarterly |
| OPS-05 | Access review | Quarterly: who holds admin, Neon, Vercel, Render, Cloudinary and DNS credentials |
| OPS-06 | Bus-factor documentation | `[~]` [runbook.md §6](runbook.md#6-where-every-credential-lives) maps every credential store and who can reach it. It is a map of single points of failure, not a fix for them — **one person can still reach all of them** |
| OPS-07 | **Financial reconciliation job** | `[x]` WO-82. Five invariants summed hourly against the stored balances — savings, loan balance, loan remaining, every `savingsAfter` snapshot against the running total, and WO-72's owner pairs. On drift: an `audit_logs` row, a `slog` error and `hasnahena_ledger_drift_*`. **It never corrects anything** ([ADR-027](decisions.md)). It found two live defects in the default-recovery waterfall on its first run |
| OPS-08 | 48-hour unconfirmed-transaction sweep | Product gap in [tasks.md](tasks.md); needs the scheduler this phase provides |
| OPS-09 | Uptime/incident log | A dated file. Turns "it feels slow lately" into evidence |

---
