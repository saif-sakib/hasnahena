# Workflow

Keep development and previews on synthetic data. Production deploys are reviewed through GitHub and use the host's production environment.

## 1. Stop developing against the production database

Configure this before running migrations, tests, seeds or mutating scripts. The local configuration was previously pointed at Neon production and a destructive script required point-in-time recovery. Confirm the current target instead of relying on the filename or a command prompt.

1. Use a new local PostgreSQL database via Docker or a separate empty authorized development project. Use synthetic fixtures. A branch copied from primary can contain real member records.
2. Update `DATABASE_URL` in `.env.local` and verify what `apps/web/.env` resolves to. Next reads its local environment for Prisma. Use separate direct/pooled development URLs if needed.
3. Confirm the host, database name and role of the development connection privately. Do not paste full DSNs into a terminal log, issue or screenshot.
4. Apply migrations and seed the new development database only. Start `pnpm dev` and confirm the synthetic data. Use the owned [isolated test stack](testing.md) for destructive regression tests.

For a maintenance query against production, use an explicitly approved read-only tool and only the smallest required result. Keep Prisma Studio and writable scripts on development databases.

## 2. Branch, pull request, merge

A push to `main` deploys to Vercel and Render immediately.

```bash
git switch -c fix/loan-schedule-date      # type/short-description
git push -u origin fix/loan-schedule-date # open a PR; merge only when CI is green
git switch main && git pull && git branch -d fix/loan-schedule-date
```

CI ([`ci.yml`](../.github/workflows/ci.yml)): typecheck/lint, Go vet and unit, Go integration on real Postgres, Playwright at phone size, a backup-and-restore drill, gitleaks over full history. You get a readable diff, a preview URL, CI that ran, and a one-button revert.

`ci.yml` runs on `pull_request` and `push` to `main` only, so feature-branch commits with no PR run nothing. While the repository was private, committing straight to `main` spent August's 2,000 minutes in seventeen days and stopped the nightly backup ([deployment.md](deployment.md#backups)); public, the minutes are unmetered.

**Enforcing it** ([T-29](tasks.md)): the active main ruleset requires the published Go, web and dependency graph checks and rejects deletion and force pushes. In Settings → Rules → Rulesets, verify the PR requirement and bypass permissions. Merge through reviewed PRs with green CI.

## 3. Preview deploys

Vercel can build PR previews. Verify deployment protection and the target services before opening a preview.

- **Vercel → Environment Variables**: scope `DATABASE_URL` to **Production only**, with a different value for Preview. Confirm preview credentials cannot read or write primary ledger data.
- If using Neon's Vercel integration, verify branch contents and disposal before relying on it. Use an empty separate target or synthetic seed for browser acceptance.
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
| Nightly encrypted dump ([`backup.yml`](../.github/workflows/backup.yml)) | whole DB, 24 h RPO; 01:00 Dhaka, kept 365 days in R2 | on |
| Copy outside GitHub — Cloudflare R2 | losing the GitHub account | on since 2026-09-03 (`database/`, `assets/`, lifecycle rule each); the **only** copy — no workflow artifacts on a public repository |
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
