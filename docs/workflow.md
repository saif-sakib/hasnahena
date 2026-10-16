# Workflow

How a change reaches members without passing through their live data. The infrastructure exists; the habits are what is missing.

| | Should be | Today |
|---|---|---|
| The database your laptop talks to | a throwaway copy | **the production Neon branch** (`.env.local` and `apps/web/.env`) |
| Where a change runs first | a preview deploy | production, ~90 s after `git push` |
| What stands between a mistake and a member | CI on a pull request | `.githooks/pre-push`, skippable with `--no-verify` |

## 1. Stop developing against the production database

**Do this first.** On 2026-09-01 a shell loop checking that four scripts parsed imported one and deleted every member from the live database (recovered by Neon point-in-time restore). `runAsScript`, `requireConfirmation`, `refuseRemoteTarget` and the Cloudinary upload guard patch the *known* dangerous scripts — not `pnpm db:studio`, `prisma migrate dev`, a `node -e` one-liner, or the next script. The root cause is that a dev machine can reach production at all.

**Option A — a Neon branch (recommended).** Copy-on-write, resettable in seconds, a *different connection string*.

1. Neon console → Branches → New branch, parent the primary, name `dev`.
2. Copy its **pooled** (`-pooler`) connection string into `DATABASE_URL` in **both** `.env.local` and `apps/web/.env` — Next overwrites an inherited `DATABASE_URL` from `apps/web/.env`, so changing one leaves the web app on production (`apps/web/lib/prisma.ts`).
3. Scrub real members so a laptop leak is not an NID leak: `pnpm db:purge` (dry run), `pnpm db:purge:confirm`, `pnpm db:seed`.
4. `pnpm dev` and confirm you see seeded data.

Reset it from the console when it drifts; delete it during long breaks — it shares the free compute allowance ([ADR-035](decisions.md)).

**Option B — local Postgres.** Free, offline, cannot touch production; what `.env.example` and `refuseRemoteTarget` assume.

```bash
docker compose up -d postgres
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hasnahena_dev  — in BOTH files
pnpm db:migrate && pnpm db:seed
```

**Prove which database you are on** before anything that writes:

```bash
grep -h '^DATABASE_URL' .env.local apps/web/.env | sed -E 's#://[^@]*@#://***@#'
```

Two lines, same non-production host — otherwise stop. Need production data? Branch it and read the branch. Never open Prisma Studio on the primary: it is a writable grid over a live ledger.

## 2. Branch, pull request, merge

A push to `main` deploys to Vercel and Render immediately.

```bash
git switch -c fix/loan-schedule-date      # type/short-description
git push -u origin fix/loan-schedule-date # open a PR; merge only when CI is green
git switch main && git pull && git branch -d fix/loan-schedule-date
```

CI ([`ci.yml`](../.github/workflows/ci.yml)): typecheck/lint, Go vet and unit, Go integration on real Postgres, Playwright at phone size, a backup-and-restore drill, gitleaks over full history. You get a readable diff, a preview URL, CI that ran, and a one-button revert.

**It is also the biggest Actions saving**: `ci.yml` runs on `pull_request` and `push` to `main` only, so feature-branch commits with no PR cost nothing. Committing straight to `main` spent August's 2,000 minutes in seventeen days and stopped the nightly backup ([deployment.md](deployment.md#backups)).

**Enforcing it** ([T-29](tasks.md)): branch protection on a private repo needs GitHub Pro (~$4/mo). Settings → Branches → rule for `main`: require a PR and passing checks, **no self-exemption**. Until then: never `git push origin main`. Don't go public to get it free — this is a finance app for a real cooperative.

## 3. Preview deploys

Vercel builds every branch to its own URL, free.

- **Vercel → Environment Variables**: scope `DATABASE_URL` to **Production only**, with a different value for Preview. One value ticked for all three makes every (guessable) preview write to the live ledger.
- **Neon's Vercel integration** creates a database branch per preview and disposes of it on merge.
- `NEXT_PUBLIC_SITE_URL` already makes a preview claim its own hostname ([setup.md](setup.md)).
- The Go API has no previews: add a free Render service on a `staging` branch with its own `DATABASE_URL`, or accept web-only previews (most visual breakage is in `apps/web`).

## 4. Schema changes

Procedure: [deployment.md § Schema changes](deployment.md#schema-changes). The rule's shape:

- `pnpm db:migrate:dev` on a **development** database generates; `pnpm db:migrate` applies. Never `db:push` ([ADR-014](decisions.md)).
- Dropping a column has no overlap window — expand, ship, contract in a later release.
- A migration that rewrites *data* passes the suite for free (it builds from zero, before any row exists). Rehearse it on a Neon branch with rows.

## 5. Never losing data

| Layer | Covers | State |
|---|---|---|
| Neon point-in-time restore | anything within the history window (short on free) | on — recovered 2026-09-01 |
| Nightly encrypted dump ([`backup.yml`](../.github/workflows/backup.yml)) | whole DB, 24 h RPO; 01:00 Dhaka, 30 days (monthly 90) | on |
| Copy outside GitHub — Cloudflare R2 | losing the GitHub account; artifact expiry | on since 2026-09-03 (`database/`, `assets/`, lifecycle rule each) |
| Cloudinary export (`assets` job) | every NID scan, photo, signature | on since 2026-09-03; fails rather than skips without credentials |
| Paper passbook + append-only `audit_logs` | reconstructing money if all else fails | on — why 24 h RPO is tolerable |

Ongoing: confirm Actions → Backup is green daily with a `.dump.gpg` attached (a stopped pipeline looks like a working one); rehearse the restore quarterly (last 2026-09-03, [runbook.md §4](runbook.md)) and compare restored totals to the live dashboard; read the DMARC reports, then move `p=none` → `p=quarantine` ([deployment.md](deployment.md#dns-cloudflare)).

**Taking a backup now:**

```bash
# 1. GitHub: Actions → Backup → Run workflow (both archives, attached to the run)
# 2. Locally — the DIRECT Neon URL (no -pooler; pg_dump's session SETs are dropped by
#    PgBouncer; a pooled URL is converted with a notice):
BACKUP_DATABASE_URL='postgresql://…' BACKUP_PASSPHRASE='…' pnpm db:backup
BACKUP_PASSPHRASE='…' pnpm backup:assets   # Cloudinary only; works with the DB down
# 3. Neon console: Branches → New branch at a point in time (seconds, same account)
```

Option 3 answers "I broke the data", not "I lost the account"; 1 and 2 answer both. Keep `BACKUP_PASSPHRASE` outside this repo, this laptop and that GitHub account — losing it loses every backup.

## 6. When something breaks

[runbook.md](runbook.md). Read §1 and §4 once now, while nothing is wrong — at 2 a.m. an unrehearsed runbook is one you don't believe.

## Order

| | Task | Time | If skipped |
|---|---|---|---|
| 1 | Local dev on a Neon `dev` branch (§1) | 1 h | 2026-09-01 can recur, maybe past the restore window |
| 2 | `DATABASE_URL` Production-scoped in Vercel (§3) | 5 min | previews write to the live ledger |
| 3 | Confirm the nightly backup is green (§5) | 5 min | you find out the day you need it |
| 4 | Branch → PR → merge (§2) | per change | a red build reaches members first |
| 5 | GitHub Pro + branch protection (§2) | 10 min + $4/mo | §2 stays a promise |
