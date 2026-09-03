# Scaling

**When the free tiers actually run out, and what to do then.**

A typeset version of this analysis is [`pdf/scaling-plan.pdf`](pdf/scaling-plan.pdf)
(source: `pdf/scaling-plan.tex`, build with `pdflatex scaling-plan.tex` twice).
This file is the maintained one; regenerate the PDF when it changes.

Supersedes "Phase 6 — VPS or AWS" in [deployment.md](deployment.md), which
described a destination without pricing it or ordering it.

---

## The short answer

**Nothing needs to be paid for yet, and the two problems on the platform today
are both free to fix.**

The compute-hour shortage is almost certainly a **misconfigured uptime monitor**,
not growth. The Actions shortage is a scheduling problem with three free
remedies. The first genuine capacity wall is **Neon's 0.5 GB of storage, at
roughly 6,000 members** — years away at any realistic growth rate — and passing
it costs about **$7/month**, not $57.

> **This corrects an earlier version of this file**, which put a $99 Cloudinary
> cliff at 8,000 members and a $57 bill at 15,000. Measured against the actual
> free-tier terms, Cloudinary's 25 credits carry to ~25,000 members and Neon's
> metered plan is far cheaper than assumed. The migration off Cloudinary is still
> worth doing — for **privacy**, not for cost.

---

## The two problems you have today

Both are configuration, not scale.

### Neon compute hours — something is holding the database awake

The free plan gives 100 CU-hours a month. The compute autoscales at 0.25 CU, so
being awake 24/7 costs `730 × 0.25 = 182` CU-hours — **almost twice the whole
allowance**. The database suspends only after five minutes with no connection, so
anything touching it more often than that pins it awake permanently.

The Go API is already tuned correctly ([ADR-035](decisions/adr-035-idle-behaviour-is-a-line-item-not-a-performance-detail.md)):
`DB_MIN_CONNS=0`, and cleanup, reconciliation and the retention sweep all on
24-hour intervals. Together those cost about **4 CU-hours a month**. The budget
is not going there.

**The leak.** [deployment.md](deployment.md) documents a **second UptimeRobot
monitor pointed at `/v1/ready`**, which pings the pool by design. UptimeRobot's
free tier defaults to **five-minute** checks:

| Interval | Wakes/day | CU-hours/month |
|---|---|---|
| 5 min (UptimeRobot's default) | 288 | **182 — the entire allowance** |
| 30 min (as documented) | 48 | 30 — a third of it |
| 6 hours | 4 | 2.5 |

**Fix, free:** check that monitor's interval. Delete it, or set it to six-hourly.
`/v1/health` already answers "is the API up?" and touches nothing; Sentry already
answers "is it erroring?". Nothing is lost.

`.github/workflows/monitor.yml` carried a stale comment saying uptime checking
hits `/v1/ready`, contradicting the corrected checklist in `deployment.md` — that
is probably how the monitor came to be configured, and it has been fixed.

### GitHub Actions minutes — 2,000 against a heavy suite

| What runs | Per run | Per month |
|---|---|---|
| Nightly backup (dump + assets, 2 jobs) | ~8 min | 240 |
| Monitor workflow (twice daily) | ~2 min | 120 |
| Weekly container image build | ~15 min | 60 |
| **Fixed scheduled cost** | | **~420** |
| **Left for CI** | | **~1,580** |
| A full CI run (7 jobs incl. Playwright, 2 Postgres services, restore drill) | ~32 min | — |
| **Full CI runs affordable** | | **~45/month, or 2 per working day** |

Three free remedies, in the order to apply them:

1. **Trim the schedule** — ~230 min/month, ten minutes of work. The *assets* half
   of the backup can run weekly (photographs change far less often than the
   ledger; the database dump stays nightly), and `images.yml`'s weekly build
   produces artefacts nothing deploys — its own header says so. Tags only until
   the host move.
2. **Add a self-hosted runner** — free, unlimited minutes, repository stays
   private. Any always-on machine. The right answer to keep pushing freely.
3. **Make the repository public** — free, unlimited minutes. Already MIT-licensed
   with a README inviting contributions, so this may match the intent anyway.
   **Review [runbook.md](runbook.md) first** — it describes where every
   credential lives, which is a map worth withholding even though it holds no
   secrets.

### Render cold starts — worth fixing while you are in there

Free services spin down after 15 minutes idle, so the first member each morning
waits ~60 s. Render gives 750 free instance-hours a month and a month is 730, so
always-warm *just* fits with no margin.

**Better:** warm it only during waking hours. A **Cloudflare Worker cron** (free;
100,000 requests/day, this uses 288) pinging `/v1/health` every five minutes
between 00:00 and 17:00 UTC — 06:00 to 23:00 in Dhaka — costs about **510 of the
750 hours**, leaves headroom, and **wakes no database**. Members never meet a
cold start; the service sleeps overnight.

---

## When each free tier actually breaks

**Assumptions**, stated so they can be argued with: 20% of members active in a
given month · 4 sessions each, ~5 dashboard page views per session · **0.8 MB of
stored images per member** (measured — the 6-member nightly asset archive is
4.8 MB) · ~32 KB of database rows per member in year one, ~28 KB per year after ·
traffic concentrated in a 14-hour window.

| Free tier | Hard limit | Binds at | Cost to pass |
|---|---|---|---|
| **Neon storage** | 0.5 GB | **~6,000 members** | Neon Launch, ~$7/mo |
| Neon compute | 100 CU-h/mo | ~15,000 | same plan, metered |
| Vercel Hobby function CPU | 4 CPU-h/mo | ~15,000–18,000 | Pro $20, or leave |
| R2 (the backups) | 10 GB | ~10,000 | $0.015/GB — pennies |
| Cloudinary | 25 credits/mo | ~25,000 | migrate to R2 |
| Vercel bandwidth | 100 GB/mo | ~30,000 | — |
| Brevo | 300 emails/day | ~50,000 | most members have no email ([ADR-036](decisions/adr-036-a-member-with-no-email-resets-their-password-at-the-desk.md)) |
| Render Free | 750 instance-h | **now**, without care | $0 — warm it selectively |
| GitHub Actions | 2,000 min/mo | **now** | $0 — see above |
| **Vercel Hobby terms** | non-commercial only | **a judgment call** | $20, move, or apply to their OSS programme |

**The first real wall is Neon storage at ~6,000 members** — nearer 4,000 once
three years of history have accumulated, because `audit_logs` only grows.
Everything binding before it is a config bug or a policy decision; everything
after it is far away.

### Which is how many years?

About six members today.

| If you admit | 6,000 in | 15,000 in |
|---|---|---|
| 25/month | 20 years | 50 years |
| 50/month | 10 years | 25 years |
| 100/month | 5 years | 12 years |
| **200/month** | **2 yr 6 mo** | **6 years** |
| 500/month | 1 year | 2 yr 6 mo |
| 1,000/month | 6 months | 1 yr 3 mo |

---

## The options

Per month, at two scales. "Ops" is the honest answer to *who has to understand
this when it breaks at 2am.*

| | Option | At 6k | At 15k | Ops | Verdict |
|---|---|---|---|---|---|
| **0** | **Free, but fixed** — Neon Free · Vercel Hobby · Render Free warmed · Cloudinary | **$0** | breaks | none | **Do this now.** Buys years |
| **1** | **+ Neon Launch** | **$7** | $15 | none | **The first thing to pay for.** A dashboard toggle, no migration |
| 2 | + Fly.io for the Go API (Singapore, 256–512 MB) | $10 | $18 | very low | If Render's 750 h get tight |
| **3** | **+ Fly.io for both apps** — leaves Vercel entirely | **$16** | **$25** | low | **Best answer to the Vercel terms question.** The Dockerfiles already work |
| 4 | One VPS — Contabo Singapore (3 vCPU, 8 GB, €4.95, no renewal rise) | $12 | $20 | medium | Best price/performance. You own an OS |
| 5 | One VPS — Hostinger Singapore (KVM 2, 2 vCPU, 8 GB) | $17 | $25 | medium | Better support and disks; renews at $11.99 |
| 6 | Fully managed — Vercel Pro + Render Standard + Neon | $47 | $60 | none | Only if your time is worth more than $40/mo |
| **7** | VPS + self-hosted Postgres | $5 | $12 | **high** | **Not recommended** |

### Why Fly.io is the quiet winner

The Go API is a 27 MB static binary on a distroless base. It does not need four
cores; it needs ~128 MB of RAM and a Singapore address. Fly.io sells exactly that
for **$2–3/month**, runs the existing Dockerfile unchanged, terminates TLS, and
has a Singapore region beside the database.

That makes option 3 — **both apps on Fly.io, Neon for the database, ~$16–25** —
the cheapest way to leave Vercel and Render *without acquiring a server to
patch*. Operational burden stays near zero, which matters more here than the $4 a
VPS saves.

### Why a VPS is still worth knowing about

Option 4 is cheaper per unit of compute and gives **one environment store instead
of two** — a real benefit, since this project's own history records the two
drifting apart. Good *if* somebody will own an operating system.

What makes it safe is that **no state lives on the box**: the database is Neon's,
the files are Cloudinary's or R2's, the images are in GHCR. If it dies you
rebuild in twenty minutes from a script rather than restoring anything.

### Why Postgres must not go on that box

Option 7 saves ~$8/month and costs you backups, point-in-time recovery, failover,
major-version upgrades and vacuum tuning — for a database that **is** the
foundation's books. Nightly dumps mean a hardware failure loses up to a day of
member transactions; continuous WAL archiving fixes that and is another system to
run correctly.

It also destroys the property above: once the ledger is on the machine, the
machine stops being disposable, and a rebuild becomes a restore performed under
pressure by whoever is available. **Managed Postgres is the best $7–15 on this
bill.**

### Considered and rejected

| Option | Why not |
|---|---|
| **Namecheap VPS** | **Phoenix, Arizona is their only datacentre** — ~250 ms from Dhaka on every dashboard request. Good value, wrong hemisphere |
| **Oracle Cloud Always Free** | Genuinely free, but the ARM allowance was **halved in June 2026**, idle instances are reclaimed on a rolling 7-day assessment, and regional capacity is a lottery. Fine as a free self-hosted CI runner; not for a platform holding members' money |
| **Hetzner's cheap CX line** | €5.49 for 2 vCPU/4 GB is the best price anywhere, but **CX is Germany and Finland only**. Serving Jessore from Falkenstein adds ~150 ms to every signed-in request and undoes the reason `sin1` was pinned. Their Singapore line carries a 20–40% surcharge after the 2026 rises |
| **AWS, GCP, Azure** | 5–10× the cost and complexity for a workload peaking around 10 req/s. Only if a funder or regulator names it |
| **Kubernetes, anywhere** | A control plane is a second system to operate. There is one service and one database |
| **Railway** | Fine platform, but $5/month buys usage credit rather than capacity, and Fly.io is cheaper at this size |

---

## The staged plan

### Stage 0 — this week — $0

| | Do | Recovers |
|---|---|---|
| 1 | Check the UptimeRobot monitor on `/v1/ready`. Delete it, or set it six-hourly | Most of 100 CU-hours |
| 2 | ~~Correct the stale `monitor.yml` comment~~ **done** | — |
| 3 | Assets backup weekly instead of nightly; `images.yml` to tags only | ~230 Actions minutes |
| 4 | Cloudflare Worker cron on `/v1/health`, every 5 min, 00:00–17:00 UTC | No more morning cold starts |
| 5 | Decide the Vercel terms question | Removes a real risk |

**After Stage 0: $0/month, no cold starts, a database that sleeps when the office
is closed, and CI you can actually run. This carries you to ~6,000 members.**

### Stage 1 — trigger: Neon storage past 0.4 GB, or compute past 80 CU-h — $7

Switch Neon from Free to **Launch**. No base fee, no migration — a plan change in
a dashboard. $0.106/CU-hour, $0.35/GB-month, scale-to-zero still works, so a
quiet night still costs nothing. ~$7 at 6,000 members, ~$15 at 15,000.

### Stage 2 — trigger: ~10,000 members, or the Vercel decision — $16–25

Both apps to **Fly.io Singapore** (option 3), or **one VPS** (option 4) if
somebody will own it. The Dockerfiles, `docker-compose.yml` and per-commit GHCR
images already exist for this, so it is configuration, not a project.

**`TRUSTED_PROXIES` changes and both failure directions are silent.** On Render
behind Cloudflare it is `3`; on Fly.io or a VPS behind Cloudflare it is `2`. **Do
not take that from this page — measure it** from a real request's log line, where
the `ip` field must be the caller's own address. Too low and the rate limiter,
access log, login lockout and every audit row key on the proxy; too high and a
forged header is trusted ([ADR-019](decisions/adr-019-one-function-decides-where-a-request-came-from.md)).
This has already cost two wrong guesses here.

Also carried into any move: `JWT_SECRET` identical on both sides, a stop grace
period longer than `SERVER_SHUTDOWN_TIMEOUT`, `timezone=UTC` pinned on every
connection, and Neon's pooled vs direct endpoints kept distinct.

### Stage 3 — trigger: ~25,000 members — still under $30

Cloudinary → Cloudflare R2. **On cost alone this is not urgent** — 25 credits
carry to roughly 25,000 members.

**But there is a reason to do it sooner that has nothing to do with money.**
Today a member's **NID scan is served from a Cloudinary URL that needs no login**
— anyone with the link has the document, and [ADR-038](decisions/adr-038-retention-is-tiered-by-what-the-data-is-not-by-one-clock.md)
works around this by deleting refused applicants' photographs quickly, which is a
mitigation rather than a fix. On R2 the bucket is genuinely private and documents
are served through an authenticated route or a short-lived signed link.

The migration also deletes a whole bug class — Cloudinary's dynamic folder mode,
which is why `moveAsset` and `scripts/cloudinary-reconcile.mjs` had to be written
— and removes a vendor with **no export path**. Cheapest while the asset count is
in the hundreds. Treat it as a security task with a cost benefit attached.

---

## The bill

| Members | Today | After Stage 0 | Recommended | Fully managed |
|---|---|---|---|---|
| 6 (now) | $0 *(strained)* | **$0** | $0 | $47 |
| 1,000 | — | **$0** | $0 | $47 |
| 6,000 | — | *Neon full* | **$7** | $47 |
| 10,000 | — | — | **$10–18** | $52 |
| 15,000 | — | — | **$15–25** | $60 |
| 25,000 | — | — | **$25–35** | $75 |

At 15,000 members the recommended path is roughly **$20/month — about BDT 2,400.**

---

## Triggers, in one table

| When | Do |
|---|---|
| **Today** | Stage 0. All of it is free |
| Neon storage past 0.4 GB *or* compute past 80 CU-h | Neon Launch, ~$7 |
| Render's 750 instance-hours get tight | Move the Go API to Fly.io, ~$3 |
| ~10,000 members, or the Vercel terms decision | Both apps to Fly.io or one VPS |
| Any spare session | Cloudinary → R2, **for privacy** |
| ~25,000 members | Cloudinary → R2 becomes a cost matter too |
| VPS memory sustains >70% | Resize in place |
| A funder or regulator names a cloud | Re-open "considered and rejected" with their requirement written down |
| **Anyone proposes self-hosting Postgres** | Re-read "Why Postgres must not go on that box." The answer is no |

---

## Action required from you

Everything here needs an account or a dashboard I cannot reach. **All of Stage 0
is free.**

1. **UptimeRobot** — open the monitor on `/v1/ready` and check its interval.
   Delete it, or set it to six-hourly. *If skipped:* at the default five minutes
   it alone spends 182 CU-hours against an allowance of 100, and no amount of
   application tuning can offset it.
2. **Cloudflare → Workers → Cron Triggers** — a Worker fetching
   `https://api.hasnahenafoundation.com/v1/health` every 5 minutes between 00:00
   and 17:00 UTC. *If skipped:* the first member each morning waits ~60 s.
3. **Decide the Vercel terms question.** Pay $20/month, apply to Vercel's
   open-source programme (the project is MIT-licensed and may qualify), or plan
   Stage 2 now. *If skipped:* the platform runs on a plan whose terms forbid it,
   and suspension is an outage with no rollback.
4. **Decide public vs. self-hosted runner** for the Actions shortage — I can do
   the schedule trim (item 3 of Stage 0) on request; the other two are yours.
5. **Set a billing alert** on any account that ever becomes paid.

**Not required, and deliberately so:** no VPS yet, no paid database, no AWS
account, no Kubernetes, and no change to any money rule.
