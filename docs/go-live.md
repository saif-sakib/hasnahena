# Go-Live Plan

The sequence from where the platform is today — **deployed, working, holding fake
data** — to real members' savings, with as little to fix afterwards as possible.

[tasks.md](tasks.md) is everything left to do; this file is the **cutover
itself** — the order and the timing, which is a different question.

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

That table is why [tasks.md](tasks.md) is ordered the way it is: Phases 0–4 are
the expensive-later list, and the work deferred to Phases 6 and 8 is deferred
*because* it stays the same price forever.

---

## Before the cutover

**Everything that has to be true first is in [tasks.md](tasks.md), Phases 0–4.**
That is where the work lives now — the rest of the monitoring switch,
`TRUSTED_PROXIES`, two `system_config` confirmations, the restore rehearsal and
the last schema change that is cheap only while the donation table is empty.

This file is the cutover itself, and it starts once those are done.

One thing from the ledger work still applies to the data: **balances written
before 2026-08-17 may be wrong.** Any account that received overlapping postings
under the old code can hold a figure that does not match its transaction rows.
That does not matter if you clear the database at 1.1 — which is the plan — but
**no balance from the current data may be carried forward by hand.**

---

## Stage 1 — The cutover

One deliberate session, not spread over a week.

### 1.1 Freeze and clear

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

### 1.2 Rotate every secret

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

### 1.3 Create the real first admin

```bash
SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… pnpm db:seed
```

`seed.mjs` refuses to invent a password and will not reset an existing admin's,
so this is safe to run more than once. Use a password manager — this account can
default loans.

### 1.4 Take the first real backup by hand

Before the first member is added, not after. It gives you a known-good empty state
to restore to, and proves the pipeline works against the post-rotation credentials.

---

## Stage 2 — Launch day

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
- [ ] **Read the public site in both languages, as a stranger.** Every box on
      Admin → Content & Media → Public Pages is a **pair**, and the English half
      of each is empty on a database seeded before 2026-08-26 — so the Bengali
      text shows to English readers until it is written. The four hero figures
      (*Total Members*, *Total Deposits*, *Loans Distributed*, *Charitable
      Fund*) are seeded blank **on purpose**: they used to be invented numbers
      compiled into the source, and the hero omits a figure that has no value.
      Write the foundation's true ones or leave the panel off — do not launch
      with numbers nobody can defend
- [ ] **Read `/privacy` and `/terms` end to end.** They describe what the
      platform actually does with a member's national ID, including the parts
      that are limits rather than rights. They are legal documents the
      foundation is publishing under its own name, and nobody outside the
      foundation can approve them

Then stop and watch for a day before adding members in bulk.

---

## After the deploy — resubmit the sitemap, then leave Search Console alone

WO-95 changed every English URL: `/` is a real page rather than a redirect, and
`/en/*` 301s to its unprefixed form ([ADR-034](decisions.md)). That is the fix
for the *"Duplicate, Google chose different canonical than user"* report on
`/bn`, and it is the last SEO change that needs an action outside the code.

1. Deploy.
2. Spot-check over HTTP, not in a browser tab — a browser follows the redirect
   and shows you the destination either way:
   ```bash
   curl -sI https://hasnahenafoundation.com/       | head -1   # 200
   curl -sI https://hasnahenafoundation.com/en/faq | head -1   # 301
   curl -s  https://hasnahenafoundation.com/sitemap.xml | grep -c '/en/'  # 0
   ```
3. Resubmit the sitemap in Search Console.
4. **Expect one to three weeks, and do not re-inspect daily.** Repeatedly
   requesting indexing does not make it faster and costs the quota.

---


---

## After go-live

Log aggregation, the operations dashboard, the audit viewer and the host move
cost the same whenever they are done, so they must not delay launch — they are
Phases 6 and 8 in [tasks.md](tasks.md).

**One exception.** Backing up the Cloudinary assets (T-26) is Stage-1 work that
simply cannot be done before there is anything to back up ([ADR-020](decisions.md)).
**Its trigger is the first real member document, not a date** — from that moment
the NID images and member photographs are regulatory documents living in one
third-party account with no export, and the nightly dump covers the database and
nothing else.

---

## What "no hassle after production" actually requires

Four things, and none of them is a feature:

1. **A ledger that is arithmetically correct under concurrency.** Done — and the
   durable part is not the patches but the hourly reconciliation that would have
   turned LEDGER-01 into an alert instead of an audit finding ([ADR-027](decisions.md)).
2. **A restore you have performed**, not one you have written down. T-25.
3. **A data model you are not going to change.** The difference between a
   migration and a migration plus a backfill plus an apology.
4. **Somebody other than you being able to run it.** [runbook.md](runbook.md) is
   written for exactly that person. One person can currently reach every
   credential, and that person is also the one who would be unavailable in the
   scenario where it matters.
