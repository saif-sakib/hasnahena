# Workflow

How a change gets from this laptop to the foundation's members without passing
through their live data on the way.

Everything else in `docs/` describes a *system*. This file describes a *habit* —
and the habits are the half that is currently missing. The infrastructure to
support them is already built and mostly unused.

---

## The three rows that matter

| | What it should be | What it is today |
|---|---|---|
| The database your laptop talks to | a throwaway copy | **the production Neon branch** — `.env.local` and `apps/web/.env` both hold it |
| Where a change runs first | a preview deploy nobody depends on | production, about ninety seconds after `git push` |
| What stands between a mistake and a member | CI on a pull request | `.githooks/pre-push`, which `--no-verify` skips |

Fix them in that order. Row one is most of the risk and takes an afternoon; row
three is the smallest and needs a decision only the owner can make.

---

## 1. Stop developing against the production database

**Do this before anything else in this file.** On 2026-09-01 a shell loop
written to check that four scripts still parsed imported one of them and deleted
every member of the foundation from the live database; recovery was a Neon
point-in-time restore. Everything added since — `runAsScript`,
`requireConfirmation`, `refuseRemoteTarget`, the Cloudinary upload guard — is a
patch over one root cause, and the root cause is that a development machine can
reach production at all. Those guards cover the scripts that were *known* to be
dangerous. They do not cover `pnpm db:studio`, `prisma migrate dev`, a `node -e`
one-liner, a test you run by hand, or the next script nobody has thought of yet.

### Option A — a Neon branch (recommended)

A branch is a copy-on-write fork of the production database. It costs almost no
storage, it can be reset to production's current state in seconds, and it is a
*different connection string*, which is the whole point.

1. Neon console → your project → **Branches** → **New branch**. Parent:
   `production` (or whatever the primary is called). Name it `dev`.
2. Copy its connection string — the **pooled** one, ending `-pooler`.
3. Replace `DATABASE_URL` in **both** `.env.local` and `apps/web/.env`. Both,
   not one: Next overwrites an inherited `DATABASE_URL` from `apps/web/.env`
   before any of this repo's code runs, so changing only `.env.local` leaves the
   web app on production while everything else moves ([CLAUDE.md](../CLAUDE.md)
   § test stacks, `apps/web/lib/prisma.ts`).
4. Scrub the real members out of the copy, so a leak from your laptop is not a
   leak of anyone's NID:

   ```bash
   pnpm db:purge          # dry run — prints what it would do
   pnpm db:purge:confirm  # apply
   pnpm db:seed
   ```

5. `pnpm dev`, sign in, and confirm you are looking at seeded data.

Reset the branch from the Neon console whenever it drifts. Delete it when you
stop working for a few weeks: a second branch draws on the same free-tier
compute allowance, and idle cost on this project is a line item
([ADR-035](decisions.md)).

### Option B — Postgres on this machine

Free, offline, and completely unable to touch production. It holds no realistic
data, which is a drawback only when you are chasing a bug that needs it.

```bash
docker compose up -d postgres
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hasnahena_dev
#   — in BOTH .env.local and apps/web/.env
pnpm db:migrate && pnpm db:seed
```

This is what `.env.example` already assumes, and what `refuseRemoteTarget`
treats as the safe case.

### Prove which database you are on

Before any command that writes, and every time you have been away from the
project:

```bash
grep -h '^DATABASE_URL' .env.local apps/web/.env | sed -E 's#://[^@]*@#://***@#'
```

Two lines, both naming the same non-production host. If either still names the
production endpoint, stop.

### When you genuinely need production data

Branch it and read the branch. Never open Prisma Studio on the primary — it is a
writable grid over a live ledger, one keystroke from a balance that no longer
matches its transactions.

---

## 2. Branch, pull request, merge

A push to `main` deploys to Vercel and Render immediately. There is nothing
between your keyboard and the members but the pre-push hook, and the hook is
advisory.

The loop, every time:

```bash
git switch -c fix/loan-schedule-date     # type/short-description
# … work, commit as you go …
git push -u origin fix/loan-schedule-date
```

Open a pull request on GitHub. CI runs the six jobs in
[`ci.yml`](../.github/workflows/ci.yml) — typecheck and lint, Go vet and unit
tests, the Go integration suite against a real Postgres, Playwright at a phone
viewport, a backup-and-restore drill, and a gitleaks scan of full history.
**Merge only when they are green.** Then:

```bash
git switch main && git pull && git branch -d fix/loan-schedule-date
```

That is the entire change. It costs about a minute per piece of work and it
buys you: a diff you can read before it is permanent, a preview URL to look at,
CI that has actually run, and a revert that is one button rather than an
archaeology session.

### Making it enforced rather than remembered

[T-29](tasks.md) — branch protection on a private repository needs GitHub Pro
(about \$4/month). Worth it: it is the only thing that makes the paragraph above
true on the day you are tired. Settings → Branches → add a rule for `main`:
require a pull request, require the CI checks to pass, and do **not** grant
yourself an exemption, which is the entire point of the setting.

Until then the rule is unenforced but still the rule: never `git push origin
main`.

Do not make the repository public to get the feature free. It is a finance
application for a real cooperative.

---

## 3. Preview deploys

Vercel already builds every branch to its own URL, free. Two settings decide
whether that is useful or dangerous:

- **Vercel → Settings → Environment Variables.** Each variable is scoped to
  Production, Preview and Development independently. `DATABASE_URL` must be set
  for **Production only**, with a *different* value for Preview. If one value is
  ticked for all three environments, every preview deploy writes to the live
  ledger, and preview URLs are guessable.
- **Neon's Vercel integration** creates a database branch per preview and
  disposes of it on merge. It is the least manual way to keep the previous point
  true.

`NEXT_PUBLIC_SITE_URL` already handles this correctly — a preview claims its own
hostname rather than production's ([setup.md](setup.md)).

The Go API has no equivalent. Either add a second free Render service on a
`staging` branch with its own `DATABASE_URL`, or accept that preview deploys
exercise the web app only. The second is a reasonable place to start; most of
what breaks visually is in `apps/web`.

---

## 4. Schema changes

The procedure is [deployment.md § Schema changes](deployment.md#schema-changes)
and it does not need repeating here. What belongs in a workflow document is the
shape of the rule:

- `pnpm db:migrate:dev` on your **development** database generates the
  migration; `pnpm db:migrate` applies one that already exists. Never
  `db:push` ([ADR-014](decisions.md)).
- A migration that drops a column has no overlap window: the old code and the
  new schema are incompatible for the length of the deploy. Expand first, ship,
  then contract in a later release.
- A migration that rewrites *data* rather than shape passes the whole test suite
  for free, because the suite builds from zero and every migration runs before a
  single row exists. Rehearse those on a Neon branch that has rows.

---

## 5. Never losing data

Five layers, of which two do not exist yet.

| Layer | Covers | State |
|---|---|---|
| Neon point-in-time restore | anything, within the plan's history window | **on** — it is what recovered 2026-09-01. Check the retention window in the console; on the free plan it is short |
| Nightly encrypted dump | the whole database, 24-hour RPO | **on** — [`backup.yml`](../.github/workflows/backup.yml), 01:00 Dhaka, kept 30 days (90 for the monthly) |
| A copy outside GitHub | losing the GitHub account, and the 30-day artifact expiry | **missing** — five secrets, no code change: [deployment.md § Keeping a copy off GitHub](deployment.md#keeping-a-copy-off-github). Cloudflare R2's free tier holds 10 GB with no egress charge |
| Cloudinary export | every NID scan, member photograph and signature | **on** since 2026-09-03 — the `assets` job in the same workflow. It fails rather than skips if its credentials go missing |
| The paper passbook and the append-only `audit_logs` | reconstructing money after any of the above fails | **on**, and it is the reason a 24-hour RPO is tolerable at all |

Three things to do, in order:

1. **Confirm the backup is actually running.** GitHub → Actions → Backup. Green
   runs, daily, with a `.dump.gpg` artifact attached to each. A backup pipeline
   that has silently stopped looks exactly like one that is working.
2. **Rehearse a restore** ([T-25](tasks.md), [runbook.md §4](runbook.md)).
   Download the newest artifact, restore it into a Neon *branch*, count the
   members and the transactions. Then write the date into runbook.md § Last
   rehearsed. A restore you have never performed is a rumour.
3. **Read the aggregate DMARC reports**, then move the policy from `p=none` to
   `p=quarantine`. Until then the record is telling you about spoofing rather
   than stopping it ([deployment.md](deployment.md#email-authentication-spf-does-not-cover-brevo)).

### Taking a backup right now

Three ways to get a copy of the database, in order of how much you need to have
working:

```bash
# 1. From GitHub, no local setup: Actions → Backup → Run workflow.
#    Produces both archives and attaches them to the run.

# 2. From this machine, if you have the passphrase and a PostgreSQL client.
#    BACKUP_DATABASE_URL is the same value under the name the GitHub secret
#    has; either works. It is the DIRECT Neon endpoint — the one WITHOUT
#    `-pooler` in the hostname — because pg_dump issues session-level SET
#    statements that PgBouncer silently drops. Hand it the pooled URL and the
#    script converts it and says so.
BACKUP_DATABASE_URL='postgresql://…'  BACKUP_PASSPHRASE='…'  pnpm db:backup
BACKUP_PASSPHRASE='…'                                        pnpm backup:assets

# 3. From the Neon console, if the database is the only thing you need and you
#    need it as of a moment in the past: Branches → New branch → at a point in
#    time. Instant, free, and does not touch the primary.
```

The third is the one to reach for in an emergency — restoring an archive takes
minutes and a branch takes seconds — but it lives inside the same Neon account,
so it answers "I broke the data" and not "I lost the account". The first two
answer both.

`pnpm backup:assets` writes `backups/hasnahena-assets-<stamp>.tar.gz.gpg` and
reads nothing but Cloudinary, so it works on a day the database is down.

And keep `BACKUP_PASSPHRASE` somewhere that is not this repository, not your
laptop and not that GitHub account. Losing it loses every backup at once.

---

## 6. When something breaks

[runbook.md](runbook.md) is written for that night: which half is down, rollback,
a disputed posting, credential rotation in the right order, restore.

The one thing to do *in advance* is read §1 and §4 once, now, while nothing is
wrong. The failure mode of an unrehearsed runbook is not that it is wrong — it
is that at 2 a.m. you do not believe it.

---

## The order to do all this in

| | Task | Time | If skipped |
|---|---|---|---|
| 1 | Point local development at a Neon `dev` branch (§1) | 1 hour | The 2026-09-01 incident can recur, and next time the restore window may have closed |
| 2 | Check `DATABASE_URL` is Production-scoped in Vercel (§3) | 5 min | Every preview deploy writes to the live ledger |
| 3 | Confirm the nightly backup is green (§5) | 5 min | You discover the pipeline stopped on the day you need it |
| 4 | Adopt branch → PR → merge (§2) | per change | A red build reaches members before you see it |
| 5 | Copy the backups off GitHub (§5) | 20 min | One account holds the code, both archives and the key to them — and artifacts expire at 30 days |
| 6 | Rehearse one restore (§5) | 1 hour | The recovery procedure is untested |
| 7 | GitHub Pro and branch protection (§2) | 10 min + \$4/mo | The workflow above stays a promise rather than a rule |
