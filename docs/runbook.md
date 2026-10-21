# Runbook

Written for someone who is not the author, in a hurry, at night: **symptom → check → act**. Every command has been run against this project. One person can currently deploy this — and is the one who would be unavailable when it matters (WO-84).

> **Rule zero.** `audit_logs` is append-only and money never moves outside the Go API. Nothing here tells you to `UPDATE accounts`; if you are about to, read [§2](#2-a-disputed-or-wrong-transaction).

## Who to reach

| | |
|---|---|
| Owner | Saif Ahmed — repository owner, holds every credential below |
| Hosting | Vercel (web) · Render (Go API) · Neon (Postgres) |
| Email · media | Brevo · Cloudinary |

Without the owner, [§6](#6-where-every-credential-lives) maps every credential — but most need their account.

---

## 1. The site is down

### 1a. Which half?

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://hasnahenafoundation.com/
curl -sS -o /dev/null -w '%{http_code}\n' https://api.hasnahenafoundation.com/v1/health
```

| Web | API | Meaning |
|---|---|---|
| 200 | 200 | Not down — check Sentry and the member's specific report |
| 200 | ✗ | API or database → 1b (if the custom domain fails but `hasnahena-api.onrender.com/v1/health` works, it is DNS/Cloudflare) |
| ✗ | 200 | Vercel deploy or build → 1c |
| ✗ | ✗ | Neon, or a shared credential (`DATABASE_URL`, `JWT_SECRET`) |

Marketing pages are prerendered and can answer 200 from cache while everything behind them is broken — check `/dashboard/member` (always dynamic).

### 1b. The API is down or the database is unreachable

Render → the service → Logs: `cannot connect to database` → Neon; `api server listening` → it started, the problem is downstream; nothing since the last deploy → the deploy failed (1c).

1. Neon console → the project → **Operations**: a suspended or migrating compute answers nothing.
2. Free-tier computes suspend when idle and take seconds to wake — one slow first request is not an outage.
3. Connection limit: `DB_MAX_CONNS` × instances must stay under Neon's ceiling; lowering it costs only latency (the suite passes at 2, ADR-017).

Neon healthy but no connection → `DATABASE_URL` rotated in one host and not the other ([§3](#3-a-suspected-credential-leak)).

### 1c. A bad deploy → rollback

**Roll back first, diagnose after.** Vercel → Deployments → last good → ⋯ → Promote to Production. Render → Events → previous deploy → Rollback. Roll back **both** if the release changed both (they share `JWT_SECRET` and the API contract). Rolling back code does not roll back a **migration** — read [§4](#4-restore-from-backup) first; a forward fix is almost always right, and a `DROP COLUMN` is irreversible.

---

## 2. A disputed or wrong transaction

`POST /api/v1/member/transactions/{id}/dispute` sets the posting to `DISPUTED` and writes `TRANSACTION_DISPUTED` with the reason. **It changes no balance** — reconciliation counts a disputed posting as money that moved (ADR-026). There is no edit: corrections append (rule 6).

1. **Read the trail:** `SELECT action, "performedBy", details, "createdAt" FROM audit_logs WHERE "entityId" = '<receipt number>' ORDER BY "createdAt";`
2. **Decide with a second person.**
3. **Post the correction through the application** as a new posting (a deposit 500 too high → a withdrawal of 500 naming the original receipt).
4. **Never `UPDATE accounts`** — it skips the audit row and the `savingsAfter` snapshot, and can lose a concurrent posting (LEDGER-01).
5. Confirm the ledger balances: the next reconciliation pass (daily, and at boot), or `hasnahena_ledger_drift_rows` on `/metrics`.

### If the ledger does not balance

`hasnahena_ledger_drift_rows{check=…}` is non-zero or the log says `ledger drift`. The job **reports and never repairs** (ADR-027).

```sql
SELECT "entityId" AS check, details, "createdAt" FROM audit_logs
WHERE action = 'LEDGER_DRIFT_DETECTED' ORDER BY "createdAt" DESC LIMIT 20;
```

| check | Meaning |
|---|---|
| `savings_balance` | an account holds money no posting created, or lacks money one recorded (the LEDGER-01 shape) |
| `loan_balance` | `loanBalance` disagrees with what its open loans owe |
| `loan_remaining` | a loan owes more than principal minus everything paid — interest by another name (rule 3) |
| `savings_snapshot` | a `savingsAfter` snapshot disagrees with the running total — **receipts in members' hands are wrong** |

Find **when** it started (the first `LEDGER_DRIFT_DETECTED` row for that check bounds the window; everything since is suspect), then correct by appending.

---

## 3. A suspected credential leak

**Order matters** — rotating one half of a shared secret is an outage.

**`JWT_SECRET`** (Go signs, Next verifies): `openssl rand -base64 48` → set it in **Render and Vercel before redeploying either** → redeploy both (Vercel needs a redeploy) → every session is now invalid; members sign in again.

**`DATABASE_URL`**: Neon → Roles → reset the password (kills connections) → update Render **and** Vercel → update the `BACKUP_DATABASE_URL` GitHub secret, or the nightly backup fails the next evening.

| Secret | Lives in | Rotate at | Stale breaks |
|---|---|---|---|
| `BREVO_API_KEY` | Render | Brevo → SMTP & API | password resets, every email |
| `CLOUDINARY_API_SECRET` | Vercel + GitHub | Cloudinary → Access Keys | uploads; the asset backup |
| `METRICS_TOKEN` | Render + GitHub | any random string | the monitor workflow |
| `CRON_SECRET` | Vercel | any random string | the nightly retention sweep (silently) |
| `SENTRY_AUTH_TOKEN` | Vercel | Sentry → Auth Tokens | source maps only |
| `BACKUP_PASSPHRASE` | GitHub | **not casually** | **every existing backup becomes unreadable** — keep the old value until its archives age out |

After any rotation: sign in as a member (a green health check proves nothing about tokens), trigger one reset email, upload one document.

---

## 4. Restore from backup

**A restore you have not performed is a rumour.** `.github/workflows/backup.yml` runs daily at 19:00 UTC (01:00 Dhaka) plus monthly, producing two encrypted archives — the database dump and the assets (`hasnahena-assets-<stamp>.tar.gz.gpg`: every NID scan, photo and signature, readable without the database because public ids name people) — to Cloudflare R2 only (never workflow artifacts: the repository is public). Neon's own PITR is bounded and dies with the account. **Restore the pair together**, or documents 404 or belong to nobody.

### Verify a backup (on a schedule, not in an emergency)

```bash
BACKUP_PASSPHRASE='…' scripts/restore-check.sh ./hasnahena-<stamp>.dump.gpg postgresql://postgres:postgres@localhost:5432/restore_scratch
# Against a Neon branch (Console → Branches → New branch, from the primary at a point in time):
ALLOW_NEON_TARGET=yes BACKUP_PASSPHRASE='…' scripts/restore-check.sh ./archive.dump.gpg 'postgresql://…branch…/neondb'
```

It checks `pg_restore` completes, every table exists, row counts match the archive's catalog, and the money invariants hold. The target is **truncated** — a branch, never the primary. Then the assets:

```bash
gpg --decrypt hasnahena-assets-<stamp>.tar.gz.gpg > assets.tar.gz && mkdir -p /tmp/assetcheck && tar -xzf assets.tar.gz -C /tmp/assetcheck
python3 -c "import json;print(json.load(open('/tmp/assetcheck/manifest.json'))['count'])"
find /tmp/assetcheck/files -type f | wc -l                     # must match
file /tmp/assetcheck/files/hasnahena/people/*/nid-front.jpg | head   # readable, not just present
rm -rf /tmp/assetcheck assets.tar.gz                           # plaintext ID documents — delete them
```

**Compare the restored totals against the live dashboard** — the only step that proves the rows are this foundation's.

**Last rehearsed 2026-09-03**: database into a Neon branch (PG 18.6 client, 10 s, every invariant held, ৳6,700 savings / ৳26,000 loan balance matching the dashboard); assets decrypted and checked against the manifest. **Next drill 2026-12-03** (OPS-04, quarterly).

### Restoring for real

1. **Stop writing**: Render → the API → suspend.
2. Create a Neon branch from before the damage; restore into it.
3. Verify with `restore-check.sh`, then a handful of real balances against what members report.
4. Point `DATABASE_URL` at the branch on **both** Render and Vercel, or promote the branch.
5. Resume the API and watch `hasnahena_ledger_drift_rows` on the boot-time reconciliation pass.

---

## 5. A member's data was erased and an asset was left behind

Erasure (FR-23, [ADR-033](decisions.md)) deletes Cloudinary assets **after** the transaction commits, so a Cloudinary failure leaves the row erased and the image public, logged as `[Admin/EraseMember] N Cloudinary asset(s) for ACC-KH-33001 were not deleted and are still served publicly.` The URLs are gone from the database; find the assets in the Cloudinary console under `people/<accountNo>/` and `applications/<APP-number>/` and delete them by hand (or run §5c). The `MEMBER_ERASED` audit row records `assetsFound`/`assetsDeleted` — the gap is the count to look for.

`retention sweep cleared an avatarUrl it cannot delete from Cloudinary` at **error** level from the Go API should be impossible (a rejected applicant never signed in): some upload path now reaches applicants — fix the code as well as the console.

## 5b. `migrate deploy` says a table already exists

Prisma has lost its **history**: `_prisma_migrations` was emptied (by hand, a partial restore, a copy). Diagnose:

```bash
pnpm db:migrate:status   # "… migrations found … none applied" against a full schema
pnpm db:migrate:check    # "No difference detected" — the schema IS current
```

Both together → `pnpm db:migrate:adopt` marks every migration applied and **runs none** (it re-runs the drift check and refuses if the schema is behind). If the drift check reports a difference, stop: restore `_prisma_migrations` from a backup (§4) rather than guess.

## 5c. The asset tree does not match the database

Symptoms: an application folder for a long-admitted member, a folder for a nonexistent application, `nid-front` twice in a folder, a member's documents with no visible folder.

```bash
cd apps/web
node scripts/cloudinary-reconcile.mjs            # prints the plan, changes nothing
node scripts/cloudinary-reconcile.mjs --confirm  # applies exactly that plan
```

It re-homes assets whose `asset_folder` disagrees with their public id, deletes unreferenced assets and dead folders **under `applications/` only**, and creates missing `people/` folder entries. Anything unreferenced under `people/`, `gallery/` or `settings/` is reported as **NOT TOUCHED** — usually the row is what went missing. Read the plan first: each line names size, dimensions and date (a 70-byte test pixel vs an ID card).

## 6. Where every credential lives

| Store | Holds | Who can reach it |
|---|---|---|
| **Vercel** | `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRY_SECONDS`, `CLOUDINARY_*`, `CRON_SECRET`, `SENTRY_*`, `NEXT_PUBLIC_*`, `CSP_ENFORCE` | Vercel account owner |
| **Render** | `DATABASE_URL`, `JWT_SECRET`, `BREVO_API_KEY`, `METRICS_TOKEN`, `SENTRY_DSN`, the tuning knobs | Render account owner |
| **GitHub** secrets | `BACKUP_DATABASE_URL`, `BACKUP_PASSPHRASE`, `BACKUP_S3_*`, `AWS_*`, `CLOUDINARY_*`, `METRICS_TOKEN` | repository admins |
| **Neon** | the database, roles, branches, PITR | Neon account owner |
| **Cloudflare** | DNS, Email Routing, R2 | Cloudflare account owner (2FA on) |
| **Brevo** / **Cloudinary** / **Sentry** | their own keys | their account owners |

**One person can reach every credential** (OPS-06): this table maps the single points of failure, it does not fix them ([T-45](tasks.md); 2FA on each is [T-39](tasks.md)). The `.env.*.example` files list which variables each host needs (never values, rule 7). **Must agree across both hosts:** `JWT_SECRET`, `DATABASE_URL`, `NEXT_PUBLIC_APP_URL` (and `JWT_EXPIRY_SECONDS` if changed).

---

## 7. Re-cutting onto a new host (the go-live procedure)

Executed once, on 2026-08-27; repeat it for a host move ([T-30](tasks.md)).
The principle: do first whatever gets more expensive once real member data
exists (schema changes, history rewrites, secret rotation, test-data deletion).
**No balance from pre-2026-08-17 data may be carried forward by hand** — clear it.

### 7.1 Freeze, back up, clear

Take a backup first (`scripts/backup.sh`) — none of this is reversible. Then:

```bash
pnpm db:purge           # dry run: prints what it would change, field by field
pnpm db:purge:confirm   # does it
```

`apps/web/scripts/go-live-purge.mjs` — **not** `pnpm db:clear`, which keeps
whichever admin it finds. The purge NAMES its survivors (`PURGE_KEEP_ADMINS`),
keeps `system_config`, `gallery_items`, `branches` and the donation pool (at
zero), deletes everything else, resets `document_sequences` (so the first
receipt is `DEP-YYYY-000001`), and deletes the Cloudinary folders of everyone it
deletes (named from their rows; printed instead without credentials). Reused
admin rows are **scrubbed**: a fresh `STF-####` number, the sole active branch,
every member-shaped field cleared — an invented NID on an admin would one day
refuse a real member. Id, email, phone and display name are never touched.

| Flag | For |
|---|---|
| `--confirm` | apply; otherwise a dry run |
| `--reset-passwords` | new password per admin + forced change. Off by default — admins keep theirs |
| `--admins-only` | scrub the admin rows, delete nothing (safe any time) |
| `--keep-images` | leave Cloudinary alone |

Confirm members, accounts, transactions, loans and audit rows are all zero:

```sql
SELECT 'users', count(*) FROM users WHERE role='MEMBER'
UNION ALL SELECT 'accounts', count(*) FROM accounts
UNION ALL SELECT 'transactions', count(*) FROM transactions
UNION ALL SELECT 'loans', count(*) FROM loans
UNION ALL SELECT 'audit', count(*) FROM audit_logs;
```

### 7.2 Rotate every config secret

Per §3: `JWT_SECRET` on Render **and** Vercel in one sitting (a mismatch looks
like "wrong password"), `METRICS_TOKEN` (Render + GitHub secret), the database
password (both hosts), Brevo/Cloudinary keys. `BACKUP_PASSPHRASE`: rotating it
makes older backups undecryptable — keep the old value as long as the old dumps.
Then sign in as an admin before announcing anything. With no admin row at all:
`SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… pnpm db:seed` (safe to re-run). Take
the first real backup by hand before the first member is added.

### 7.3 Launch-day checks

Run the release checklist in [deployment.md](deployment.md), then:

- [ ] `/v1/health` and `/v1/ready` 200 on the real hostname
- [ ] Sign in as admin, worker and member, in **both** locales
- [ ] One real deposit end to end (request → process → confirm); the audit row exists, the balance moved exactly
- [ ] One receipt PDF read through (English only, ADR-012)
- [ ] `/metrics` answers with the token and 404s without it; Sentry receives a test error from **both** apps
- [ ] UptimeRobot monitors `/v1/health`; the Monitor workflow passes when run by hand
- [ ] No `TRUSTED_PROXIES` warning in the Render log; Render's stop grace exceeds `SERVER_SHUTDOWN_TIMEOUT`
- [ ] The public site read as a stranger in both languages — the hero figures are published under the foundation's name; `/privacy` and `/terms` read end to end

Then watch for a day before adding members in bulk.

### 7.4 Search engines after a URL change

Spot-check over HTTP (a browser hides redirects), resubmit the sitemap in Search
Console, then wait one to three weeks without re-inspecting:

```bash
curl -sI https://hasnahenafoundation.com/       | head -1   # 200
curl -sI https://hasnahenafoundation.com/en/faq | head -1   # 301
curl -s  https://hasnahenafoundation.com/sitemap.xml | grep -c '/en/'  # 0
```

Bing Webmaster Tools has held the property since 2026-09-03 (imported from
Search Console; use `https://www.hasnahenafoundation.com` — the apex is a
different site to Bing). `BING_SITE_VERIFICATION` on Vercel only if an import is
refused. Announce changes with IndexNow **after** the deploy —
`cd apps/web && pnpm seo:indexnow [paths…]` (the key file `public/<key>.txt` is
public by design). Ranking for the foundation's own name will need inbound links
and the name in a visible heading — a content decision, not a bug.

## Steady-state cadences

| ID | Task | Cadence |
|---|---|---|
| OPS-02 | Secret rotation | every 6 months and after any exposure (`JWT_SECRET` on both hosts together) |
| OPS-03 | Dependency updates | monthly, on a branch, CI green |
| OPS-04 | Restore drill | quarterly (next 2026-12-03) |
| OPS-05 | Access review | quarterly — who holds admin, Neon, Vercel, Render, Cloudinary, DNS; first one is [T-45](tasks.md), due dates in [tasks.md § Recurring](tasks.md#recurring) |
| OPS-07 | Ledger reconciliation | automatic, daily ([§2](#2-a-disputed-or-wrong-transaction), ADR-027) |
| OPS-08 | 48-hour unconfirmed-transaction sweep | product gap in [tasks.md](tasks.md) |
| OPS-09 | Uptime/incident log | a dated file — turns "it feels slow" into evidence; not started ([T-48](tasks.md)) |
