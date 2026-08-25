# Go-Live Plan

The sequence from where the platform is today — **deployed, working, holding fake
data** — to real members' savings, with as little to fix afterwards as possible.

[production-readiness.md](production-readiness.md) is the operational backlog;
this file is the **order and the timing**, which is a different question.

## The organising principle

Not "what is most urgent". **What gets more expensive once real member data
exists.** That is the only thing distinguishing work done now from work done
later, and it decides whether launch is boring.

| Kind of change | Cost today | Cost after go-live |
|---|---|---|
| Schema and enum changes | a migration on an empty table | a migration plus a data backfill, plus a plan for rows written in between |
| Rewriting git history | one force-push, one person affected | still one force-push, but now it is an audit event and any clone anyone took is a copy |
| Rotating a secret | nobody notices | `JWT_SECRET` signs every member out mid-session |
| Deleting test data | `pnpm db:clear` | never again — the ledger is append-only and irreplaceable |
| Fixing a money bug | a test and a commit | a correction entry, an audit trail, and a conversation with a member |

Everything in Stage 1 is on the expensive-later list. Everything in Stage 4 is
deliberately deferred *because* it stays the same price forever.

---

## Stage 1 — Do while the data is still fake

**This is the whole point of the plan.** Each of these is cheap exactly once.

**Closed already:** the ledger defects (Batch L), the known-broken registration
and settings paths, and the git-history question ([ADR-018](decisions.md) — the
files are not live member data, so the purge is not warranted; the exemption
covers those files only, and anything committed from here on is a different
question with a different answer).

One thing from the ledger work still applies to the data: **balances written
before 2026-08-17 may be wrong.** Any account that received overlapping postings
under the old code can hold a figure that does not match its transaction rows.
That does not matter if you clear the database at Stage 2.1 — which is the plan —
but **no balance from the current data should be carried forward by hand.**

### 1.1 Settle the data model — nothing here survives contact with real rows

All schema changes. On an empty database they are a migration and nothing else;
afterwards every one needs a backfill.

| Change | Why now |
|---|---|
| **Collapse the legacy `LoanStatus` values** (`PENDING`, `APPROVED`) | Two vocabularies for one concept. With real loans in flight you cannot drop enum values without rewriting rows, and Postgres will not remove a label that is still referenced |
| **Donation fund types** (FR-15/16) | Every donation posted before this exists becomes an untyped row somebody classifies by hand later. Zakat funds especially cannot be reconstructed after the fact |
| ~~**Decide DATA-07** (retention and erasure)~~ | **Decided 2026-08-25, [ADR-033](decisions.md), and built (FR-23).** No `deletedAt` column was needed: a member with postings is anonymised in place and one without is deleted, and a rejected application expires on the sweep's clock. What is left here is a *setting*, not a schema change — confirm `security.rejectedRetentionDays` in Settings before real applications exist, because the sweep starts counting from the rejection |

`pnpm db:migrate:check` runs in CI, so a schema edit without a generated
migration fails the build rather than a production query.

### 1.2 ~~Build the reconciliation job (OPS-07)~~ — done, WO-82

Five invariants, summed hourly against the stored balances, reporting to
`audit_logs`, `slog` and `hasnahena_ledger_drift_*`. It never corrects anything
([ADR-027](decisions.md)).

**It earned its place before it ever ran in production.** Writing the invariants
down was enough to find two live defects in `waterfallRecoveryTx` that no existing
test caught: recovery rows written `PENDING` while the savings had already been
deducted, and `accounts."loanBalance"` never reduced, so a member whose savings
were taken to settle a default kept seeing the whole debt. That is the argument
for this item, restated as a fact.

**What is left here is operational, not code:** alert on
`hasnahena_ledger_drift_rows > 0`, and on
`hasnahena_ledger_reconciled_timestamp_seconds` going stale — a drift gauge
reading zero is indistinguishable from a job that has not run since the last
deploy, and the second is the more likely failure. That needs the monitoring in
1.4 switched on first. [runbook.md §2](runbook.md#2-a-disputed-or-wrong-transaction)
is what to do when it fires.

### 1.3 Prove the backup works, on data you can afford to lose

The single most valuable thing you can do in this window. Run the full drill
against the real production database while it holds nothing that matters:

```bash
# 1. Actions → Backup → Run workflow. Check the Diagnostics step prints
#    majors: client=N server=M   with N >= M
# 2. Download the artifact.
# 3. Restore it into a Neon *branch*, never the primary.
BACKUP_PASSPHRASE='…' scripts/restore-check.sh hasnahena-<stamp>.dump.gpg \
  'postgresql://…neon.tech/…'   # needs ALLOW_NEON_TARGET=yes
```

If any step is awkward, fix the awkwardness now. The first time you do this for
real will be the worst day, and it must be a procedure you have already executed
rather than one you are reading.

**Also confirm the restore is possible without you.** Write down where
`BACKUP_PASSPHRASE` lives. A backup nobody else can decrypt is a backup that
depends on one person being reachable.

The procedure is now written out step by step in
[runbook.md §4](runbook.md#4-restore-from-backup), together with what to do when
restoring for real — suspend the API first, restore into a branch, verify, then
repoint `DATABASE_URL` in **both** hosts. **It has never been rehearsed against a
Neon branch**, and the runbook says so on its own line until somebody does it and
dates it.

### 1.4 Switch the monitoring on — it is built and it is off

This belongs in Stage 1 for an unusual reason: it does not get more expensive
later, it gets *less useful* later. The window where you most need to see an
exception is the first week of real member traffic, and a monitoring stack
switched on during that week is one you are also debugging during that week.

The variables, the hosts, and what skipping each one means:
[production-readiness.md](production-readiness.md#the-monitoring-is-built-and-switched-off).
Then prove each end to end rather than assuming a set variable is a working one —
Stage 3 below.

### 1.5 Set `TRUSTED_PROXIES=1` on Render

One variable, five minutes. At the default `0` the API attributes every member to
Render's address: one rate-limit bucket and one login lockout for the whole
membership. It logs a warning at boot when the value is `0` outside development —
check the Render log after the next deploy. **Do not set it to 2** even though
Vercel proxies the support routes ([ADR-021](decisions.md)).

**This one now also decides whether a member can be locked out of their own
savings.** The login lockout escalates on the identifier *and the address* and
stays flat on the identifier alone, precisely so that an attack from somewhere
else cannot hold a member out for an hour ([ADR-032](decisions.md)). At
`TRUSTED_PROXIES=0` every caller has the same address, the two buckets collapse
into one, and the escalation applies to the member as well as to the attacker.
The mechanism is correct and the variable is what makes it true.

### 1.6 Confirm the retention window before there is anything to retain

`security.rejectedRetentionDays` defaults to **365** and is edited in
Settings. It is what decides how long a refused applicant's NID number,
photograph, addresses and both parents' names stay in the database
([ADR-033](decisions.md)); the rejection decision and its audit row are kept for
ever regardless. Set it to what the foundation actually intends *now*, because
the sweep counts from each rejection and shortening it later applies to
applications already stored.

Two things to check on Render at the same time, both one line each:

- `RETENTION_SWEEP_INTERVAL` is unset (24h) rather than `0`. At `0` the sweep
  never runs, and the log says so once, at boot.
- `JWT_EXPIRY_SECONDS` is at its default, or set to the **same** value on Vercel.
  Only Render mints tokens, but Vercel sizes the revoke-all marker from it, and a
  marker shorter than the tokens it revokes brings them back to life.

---

## Stage 2 — The cutover

One deliberate session, not spread over a week.

### 2.1 Freeze and clear

```bash
pnpm db:clear     # keeps admin + gallery + system_config + the donation pool
```

Then confirm what survived is what you expect — members, accounts, transactions,
loans and audit rows should all be zero:

```sql
SELECT 'users', count(*) FROM users WHERE role='MEMBER'
UNION ALL SELECT 'accounts', count(*) FROM accounts
UNION ALL SELECT 'transactions', count(*) FROM transactions
UNION ALL SELECT 'loans', count(*) FROM loans
UNION ALL SELECT 'audit', count(*) FROM audit_logs;
```

**Reset `document_sequences` too.** Reference numbers are sequential and visible
to members (`DEP-2026-000123`). Starting real operations at 000247 because of
testing is harmless but looks like something is missing, and it generates a
question you cannot answer later.

### 2.2 Rotate every secret

Test credentials must not become production credentials. This is the step most
likely to cause an outage.

| Secret | Render | Vercel | Note |
|---|---|---|---|
| `JWT_SECRET` | ✅ | ✅ | **Must be identical.** Different values = every login fails with a valid password. Change both in one sitting |
| `METRICS_TOKEN` | ✅ | — | Also a GitHub secret. Unset ⇒ `/metrics` 404s |
| `BACKUP_PASSPHRASE` | — | — | GitHub secret. **Rotating it makes older backups undecryptable** — keep the old value as long as you keep the old dumps |
| Database URL | ✅ | ✅ | If you rotate the Neon password, both |
| Brevo / Cloudinary keys | ✅ | ✅ | Whichever app uses each |

After rotating, log in as the seeded admin before announcing anything. A
mismatched `JWT_SECRET` presents exactly as "the password is wrong".

### 2.3 Create the real first admin

```bash
SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… pnpm db:seed
```

`seed.mjs` refuses to invent a password and will not reset an existing admin's,
so this is safe to run more than once. Use a password manager — this account can
default loans.

### 2.4 Take the first real backup by hand

Before the first member is added, not after. It gives you a known-good empty state
to restore to, and proves the pipeline works against the post-rotation credentials.

---

## Stage 3 — Launch day

Run the release checklist in [deployment.md](deployment.md), then:

- [ ] `/v1/health` 200 and `/v1/ready` 200 on the real hostname
- [ ] Log in as admin, worker and member — all three roles, **both locales**
- [ ] Drive **one real deposit** end to end: request → process → confirm. Check
      the `audit_logs` row exists and the balance moved by exactly the amount
- [ ] Generate one receipt PDF and read it. Documents are English-only by design
      ([ADR-012](decisions.md)) — confirm that is what the foundation expects to
      hand a member
- [ ] Confirm `/metrics` answers with the token and 404s without it
- [ ] Confirm Sentry receives a test error from **both** apps, tagged with the
      right environment and release. If nothing arrives the DSN is unset — the
      integration is deliberately silent without one
- [ ] Confirm UptimeRobot is actually monitoring `/v1/ready`
- [ ] Run the Monitor workflow by hand and confirm it passes rather than exiting 1
- [ ] Check the Render log for the `TRUSTED_PROXIES` warning — it should be absent
- [ ] Check **Render's stop grace period exceeds `SERVER_SHUTDOWN_TIMEOUT`**
      (30 s default) or a deploy will `SIGKILL` mid-transaction

Then stop and watch for a day before adding members in bulk.

---

## Stage 4 — Deliberately after go-live

These cost the same whenever they are done, so they should not delay launch.

| Item | Why it can wait |
|---|---|
| Log aggregation, dashboard, audit viewer (OBS-05/07/08) | You have metrics and Sentry — *once switched on*. These make them nicer to read |
| **Cloudinary asset backup (DATA-06)** | **The exception — do it as soon as real NID images exist.** Stage 1 work that simply cannot be done before there is anything to back up ([ADR-020](decisions.md)) |
| Host move (INF-01 → INF-12) | Only once everything above is quiet |

---

## What "no hassle after production" actually requires

Four things, and none of them is a feature:

1. **A ledger that is arithmetically correct under concurrency.** Fixed — but the
   durable part is not the patches, it is OPS-07 above.
2. **A restore you have performed**, not one you have written down. Stage 1.3.
3. **A data model you are not going to change.** Stage 1.1 is the difference
   between a migration and a migration plus a backfill plus an apology.
4. **Somebody other than you being able to do it.** [runbook.md](runbook.md) is
   now written for exactly that person. OPS-06 — where the secrets
   live, which host owns which variable, how to restore. One person can currently
   deploy this, and that person is also the one who would be unavailable in the
   scenario where it matters.

The security work, the tests, the CI, the backups and the containers are done.
What is left before launch is small, and it is almost entirely Stage 1.
