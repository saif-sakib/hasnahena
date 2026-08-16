# Go-Live Plan

The sequence from where the platform is today — **deployed, working, holding fake
data** — to real members' savings, with as little to fix afterwards as possible.

Written 2026-08-16. [production-readiness.md](production-readiness.md) is the
operational backlog and [work-orders.md](work-orders.md) is how to execute each
item; this file is the **order and the timing**, which is a different question.

## The organising principle

Not "what is most urgent". **What gets more expensive once real member data
exists.**

That is the only thing that distinguishes work done now from work done later, and
it is the thing that decides whether launch is boring. Three costs rise sharply
the moment the first real deposit is posted:

| Kind of change | Cost today | Cost after go-live |
|---|---|---|
| Schema and enum changes | a migration on an empty table | a migration plus a data backfill, plus a plan for rows written in between |
| Rewriting git history | one force-push, one person affected | still one force-push, but now it is an audit event and any clone anyone took is a copy |
| Rotating a secret | nobody notices | `JWT_SECRET` signs every member out mid-session |
| Deleting test data | `pnpm db:clear` | never again — the ledger is append-only and irreplaceable |
| Fixing a money bug | a test and a commit | a correction entry, an audit trail, and a conversation with a member |

Everything in Stage 1 below is on the expensive-later list. Everything in Stage 3
is deliberately deferred *because* it stays the same price forever.

---

## Stage 1 — Do while the data is still fake

**This is the whole point of the plan.** Each of these is cheap exactly once.

### 1.1 Purge git history — [WO-28](work-orders.md)

39 files of foundation records plus three stray binaries. The repository is
private, which lowers the severity a great deal — but not the cost of waiting.
A rewrite affects one person today. After launch it affects every clone anyone
has taken, and "we rewrote history" becomes something you have to explain rather
than something you just did.

Do it first, because every other commit below lands on top of it.

### 1.2 Settle the data model — nothing here survives contact with real rows

These are all schema changes. On an empty database they are a migration and
nothing else. Afterwards, every one of them needs a backfill.

| Change | Why now |
|---|---|
| **Collapse the legacy `LoanStatus` values** (`PENDING`, `APPROVED`) | Two vocabularies for one concept. With real loans in flight you cannot drop enum values without rewriting rows, and Postgres will not remove an enum label that is still referenced |
| **Donation fund types** (FR-15/16) | Every donation posted before this exists becomes an untyped row somebody has to classify by hand later. Zakat funds especially cannot be reconstructed after the fact |
| **`audit_logs` immutability trigger** ([WO-33](work-orders.md)) | Adding a `BEFORE UPDATE OR DELETE` guard is trivial on an empty table. It is also the point: the guarantee is worth much more if it was in place from the first row, because then "the log was never rewritten" is provable rather than asserted |
| **Withdrawal notice period** (FR-08) | It is a policy field on withdrawals. Add it before there are withdrawals that predate it and are exempt for no recorded reason |

**Decide DATA-07 (retention and erasure) in the same pass.** It determines
whether you need a `deletedAt`, an anonymisation path, or nothing — and that is a
schema question. Deciding it after launch means discovering you needed a column.

### 1.3 Fix what is known broken — **done 2026-08-16**

All four shipped. Kept here because each was Stage 1 work for a reason, and that
reasoning is what to reuse when the next one appears.

- **Guarantor approval** ([WO-29](work-orders.md)) — validated loan ids against a
  UUID regex while every id is `@default(cuid())`, so FR-11 had never worked for
  any loan. Verified end to end: a real cuid returns 200 and moves the loan
  `PENDING_GUARANTOR` → `PENDING_APPROVAL`.
- **Settings key allow-list** ([WO-39](work-orders.md)) — `PUT /api/v1/settings`
  accepted any key, so a typo became a permanent row that looked like a real
  setting while the code read the correctly-spelled one. Config typos made before
  launch are the ones nobody remembers making.
- **SEC-08 / SEC-09** ([WO-30](work-orders.md), [WO-31](work-orders.md)) — the
  registration enumeration oracle and HSTS. Both are about *members*, so they
  needed to exist before there were any.
- **RUN-07** ([WO-32](work-orders.md)) — rate limiting on every mutating route,
  not just login.

### 1.4 Prove the backup works, on data you can afford to lose

The single most valuable thing you can do in this window. Run the full drill
against the real production database while it holds nothing that matters:

```bash
# 1. Take a real backup from the real host
#    Actions → Backup → Run workflow, and check the Diagnostics step prints
#    majors: client=N server=M   with N >= M
# 2. Download the artifact
# 3. Restore it into a Neon *branch*, not the primary
BACKUP_PASSPHRASE='…' scripts/restore-check.sh hasnahena-<stamp>.dump.gpg \
  'postgresql://…neon.tech/…' # needs ALLOW_NEON_TARGET=yes
```

If any step of that is awkward, fix the awkwardness now. The first time you do
this for real will be the worst day, and it must be a procedure you have already
executed rather than one you are reading.

**Also confirm the restore is possible without you.** Write down where
`BACKUP_PASSPHRASE` lives. A backup nobody else can decrypt is a backup that
depends on one person being reachable.

---

## Stage 2 — The cutover

Do this as one deliberate session, not spread over a week.

### 2.1 Freeze and clear

```bash
pnpm db:clear     # keeps admin + gallery + system_config, drops everything else
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
testing is harmless but looks like something is missing, and it is the kind of
thing that generates a question you cannot answer later.

### 2.2 Rotate every secret

Test credentials must not become production credentials. In **both** hosts where
the variable exists — this is the step most likely to cause an outage:

| Secret | Render (Go API) | Vercel (web) | Note |
|---|---|---|---|
| `JWT_SECRET` | ✅ | ✅ | **Must be identical.** Different values = every login fails with a valid password. Change both in one sitting |
| `METRICS_TOKEN` | ✅ | — | Unset ⇒ `/metrics` 404s, which is a safe default but disables monitoring |
| `BACKUP_PASSPHRASE` | — | — | GitHub secret. **Rotating it makes older backups undecryptable** — keep the old value as long as you keep the old dumps |
| Database URL | ✅ | ✅ | If you rotate the Neon password, both |
| Brevo / Cloudinary keys | ✅ | ✅ | Whichever app uses each |

After rotating, log in as the seeded admin before announcing anything. A mismatched
`JWT_SECRET` presents exactly as "the password is wrong".

### 2.3 Create the real first admin

```bash
SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… pnpm db:seed
```

`seed.mjs` refuses to invent a password and will not reset an existing admin's,
so this is safe to run more than once. Use a password manager — this account can
default loans.

### 2.4 Take the first real backup by hand

Before the first member is added, not after. It gives you a known-good empty
state to restore to, and it proves the pipeline works against the post-rotation
credentials.

---

## Stage 3 — Launch day

Run the release checklist in [deployment.md](deployment.md), then:

- [ ] `/v1/health` 200 and `/v1/ready` 200 on the real hostname
- [ ] Log in as admin, as a worker, and as a member — all three roles, **both
      locales**
- [ ] Drive **one real deposit** end to end: request → process → confirm. Check
      the `audit_logs` row exists and the balance moved by exactly the amount
- [ ] Generate one receipt PDF and read it. Documents are English-only by design
      ([ADR-012](decisions.md)) — confirm that is what the foundation expects to
      hand a member
- [ ] Confirm `/metrics` answers with the token and 404s without it
- [ ] Confirm Sentry receives a test error from both apps
- [ ] Confirm UptimeRobot is actually monitoring `/v1/ready`
- [ ] Check **Render's stop grace period exceeds `SERVER_SHUTDOWN_TIMEOUT`**
      (30 s default) or a deploy will `SIGKILL` mid-transaction

Then stop and watch for a day before adding members in bulk.

---

## Stage 4 — Deliberately after go-live

These cost the same whenever they are done, so they should not delay launch.

| Item | Order | Status / why it can wait |
|---|---|---|
| React Compiler lint cleanup | [WO-27](work-orders.md) | **Still deferred.** The compiler is not enabled, so the 20 remaining findings change nothing at runtime, and the obvious fix was tried and measured — it does not clear the rule. Needs these screens moved onto a data-fetching library |
| Enable `errcheck` + `staticcheck` | [WO-40](work-orders.md) | **The one to do first.** 21 of the 44 findings are real, including 2 unchecked `tx.Exec` of the exact shape that made debt vanish once already |
| ~~Build and push images in CI~~ | [WO-34](work-orders.md) | **Done 2026-08-16** — GHCR, tagged by commit SHA |
| ~~Split `user_repository.go`~~ | [WO-38](work-orders.md) | **Done 2026-08-16** — nine files by domain, verified byte-identical |
| ~~Web unit tests~~ | [WO-36](work-orders.md) | **Done 2026-08-16** — 32 tests, ~1s, in CI |
| Log aggregation, dashboard, audit viewer | OBS-05/07/08 | You have metrics and Sentry. These make them nicer to read |
| Cloudinary asset backup | DATA-06 | **The exception — do this as soon as real NID images exist.** It is Stage 1 work that simply cannot be done before there is anything to back up |
| Host move | INF-01 → INF-12 | Only once everything above is quiet |

---

## What "no hassle after production" actually requires

Three things, and none of them is a feature:

1. **A restore you have performed**, not one you have written down. Stage 1.4.
2. **A data model you are not going to change.** Stage 1.2 is the difference
   between a migration and a migration plus a backfill plus an apology.
3. **Somebody other than you being able to do it.** OPS-06 in
   [production-readiness.md](production-readiness.md) — where the secrets live,
   which host owns which variable, and how to restore. Currently one person can
   deploy this, and that person is also the one who would be unavailable in the
   scenario where it matters.

The security work, the tests, the CI, the backups and the containers are done.
What is left before launch is small, and it is almost entirely Stage 1.
