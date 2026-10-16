# Scaling

**When the free tiers run out, and what to do then.** Typeset copy: [`pdf/scaling-plan.pdf`](pdf/scaling-plan.pdf) (source `pdf/scaling-plan.tex`, `pdflatex` twice); this file is the maintained one — regenerate the PDF when it changes.

## The short answer

**Nothing needs paying for yet.** Today's two strains — Neon compute hours and Actions minutes — are configuration, not growth. The first real wall is **Neon's 0.5 GB storage at ~6,000 members** (nearer 4,000 after three years of `audit_logs`), and passing it costs **~$7/month**. Cloudinary's 25 credits carry to ~25,000 members; leaving it is a **privacy** task, not a cost one.

## Today's strains

**Neon compute** — 100 CU-h/month free; awake 24/7 at 0.25 CU is 182. It suspends after 5 idle minutes, so anything touching it more often pins it awake. The Go API is tuned ([ADR-035](decisions/adr-035-idle-behaviour-is-a-line-item-not-a-performance-detail.md): `DB_MIN_CONNS=0`, daily background jobs ≈ 4 CU-h/month). The leak to watch is any **UptimeRobot monitor on `/v1/ready`** (pings the pool): 5-minute default = 182 CU-h (the whole allowance), 30 min = 30, 6 h = 2.5. Uptime belongs on `/v1/health`, which touches nothing.

**Actions minutes** — 2,000/month: fixed scheduled cost ~420 (nightly backup ~240, monitor ~120, image builds), leaving room for ~45 full CI runs (~32 min each). Free remedies: (1) assets backup weekly and `images.yml` tags-only (~230 min); (2) a self-hosted runner; (3) a public repository (MIT already — review [runbook.md](runbook.md) first, it maps every credential). Pushing to feature branches costs nothing until a PR ([workflow.md](workflow.md)).

**Render cold starts** — free services sleep after 15 idle minutes (~60 s first request); 750 instance-hours vs a 730-hour month. Better: a **Cloudflare Worker cron** pinging `/v1/health` every 5 minutes 00:00–17:00 UTC (06:00–23:00 Dhaka) — ~510 hours, no database wake.

## When each free tier breaks

Assumptions: 20% of members active monthly · 4 sessions × ~5 page views · **0.8 MB stored images per member** (measured) · ~32 KB of rows per member in year one, ~28 KB/year after · traffic in a 14-hour window.

| Free tier | Limit | Binds at | Cost to pass |
|---|---|---|---|
| **Neon storage** | 0.5 GB | **~6,000 members** | Neon Launch, ~$7/mo |
| Neon compute | 100 CU-h | ~15,000 | same plan, metered |
| Vercel Hobby function CPU | 4 CPU-h | ~15,000–18,000 | Pro $20, or leave |
| R2 (backups) | 10 GB | ~10,000 | pennies |
| Cloudinary | 25 credits | ~25,000 | migrate to R2 |
| Vercel bandwidth | 100 GB | ~30,000 | — |
| Brevo | 300 emails/day | ~50,000 | most members have no email ([ADR-036](decisions/adr-036-a-member-with-no-email-resets-their-password-at-the-desk.md)) |
| Render Free | 750 instance-h | **now**, without care | $0 — warm selectively |
| GitHub Actions | 2,000 min | **now** | $0 — see above |
| **Vercel Hobby terms** | non-commercial only | **a judgment call** | $20, move, or their OSS programme |

| Admitting | 6,000 in | 15,000 in |
|---|---|---|
| 50/month | 10 years | 25 years |
| 100/month | 5 years | 12 years |
| **200/month** | **2.5 years** | **6 years** |
| 500/month | 1 year | 2.5 years |

## The options (per month)

| | Option | At 6k | At 15k | Ops | Verdict |
|---|---|---|---|---|---|
| **0** | **Free, fixed** — Neon Free, Vercel Hobby, Render warmed, Cloudinary | **$0** | breaks | none | **Now** |
| **1** | **+ Neon Launch** | **$7** | $15 | none | **First thing to pay for** — a dashboard toggle |
| 2 | + Fly.io for the Go API (Singapore) | $10 | $18 | very low | if Render hours get tight |
| **3** | **Both apps on Fly.io** | **$16** | **$25** | low | **Best answer to the Vercel question**; Dockerfiles work as-is |
| 4 | One VPS — Contabo Singapore (3 vCPU, 8 GB) | $12 | $20 | medium | best price/performance; you own an OS |
| 5 | One VPS — Hostinger Singapore (KVM 2) | $17 | $25 | medium | better support; renews higher |
| 6 | Fully managed (Vercel Pro + Render Standard + Neon) | $47 | $60 | none | only if your time is worth $40/mo |
| **7** | VPS + self-hosted Postgres | $5 | $12 | **high** | **No** |

- **Fly.io** runs the 27 MB distroless Go binary for $2–3 beside the database, with TLS — the cheapest way off Vercel/Render without a server to patch.
- **A VPS** gives one environment store instead of two, and stays safe because **no state lives on it** (Neon, R2/Cloudinary, GHCR) — rebuild in twenty minutes.
- **Never Postgres on the box**: it trades ~$8 for backups, PITR, failover, upgrades and vacuum on the foundation's books, and makes the machine non-disposable.

Rejected: **Namecheap VPS** (Phoenix only, ~250 ms from Dhaka); **Oracle Always Free** (allowance halved June 2026, idle reclamation — fine for a CI runner only); **Hetzner CX** (EU only, +150 ms; Singapore surcharged); **AWS/GCP/Azure** (5–10× for ~10 req/s peak, unless a funder requires it); **Kubernetes**; **Railway** (credit, not capacity).

## The staged plan

**Stage 0 — now, $0**: confirm no UptimeRobot monitor polls `/v1/ready` frequently (delete it or make it six-hourly); assets backup weekly + `images.yml` tags-only; the Cloudflare Worker warm-up cron; decide the Vercel terms question. Carries to ~6,000 members.

**Stage 1 — Neon storage past 0.4 GB or compute past 80 CU-h — ~$7**: Neon Free → **Launch** (no base fee, no migration; $0.106/CU-h, $0.35/GB-month, still scales to zero).

**Stage 2 — ~10,000 members or the Vercel decision — $16–25**: both apps to **Fly.io Singapore**, or one VPS if somebody will own it ([deployment.md](deployment.md#getting-off-the-free-tiers), [runbook.md §7](runbook.md)). **Re-measure `TRUSTED_PROXIES`** from a real log line (`ip` = the caller) — on Fly/VPS behind Cloudflare it is likely 2, not Render's 3, and both wrong directions are silent ([ADR-019](decisions/adr-019-one-function-decides-where-a-request-came-from.md)). Carry over: identical `JWT_SECRET`, stop grace > `SERVER_SHUTDOWN_TIMEOUT`, the `timezone=UTC` pin, pooled vs direct Neon URLs.

**Stage 3 — ~25,000 members, or sooner for privacy**: Cloudinary → **Cloudflare R2**. Today an NID scan is served from a URL needing no login ([ADR-038](decisions/adr-038-retention-is-tiered-by-what-the-data-is-not-by-one-clock.md) only mitigates); R2 is private with authenticated or short-lived signed access, removes the dynamic-folder bug class (`moveAsset`, `cloudinary-reconcile.mjs`) and a vendor with no export path. Cheapest while assets number in the hundreds.

## The bill

| Members | After Stage 0 | Recommended | Fully managed |
|---|---|---|---|
| ≤ 1,000 | **$0** | $0 | $47 |
| 6,000 | Neon full | **$7** | $47 |
| 10,000 | — | **$10–18** | $52 |
| 15,000 | — | **$15–25** (~BDT 2,400) | $60 |
| 25,000 | — | **$25–35** | $75 |

## Triggers

| When | Do |
|---|---|
| Now | Stage 0 (free) |
| Neon storage > 0.4 GB or compute > 80 CU-h | Neon Launch |
| Render hours tight | Go API to Fly.io (~$3) |
| ~10,000 members or the Vercel decision | both apps to Fly.io or one VPS |
| Any spare session | Cloudinary → R2, for privacy |
| VPS memory sustained > 70% | resize in place |
| A funder or regulator names a cloud | reopen "rejected" with their requirement written down |
| Anyone proposes self-hosting Postgres | the answer is no |

**Owner actions** (accounts I cannot reach; all free): check UptimeRobot for a `/v1/ready` monitor; create the Cloudflare Worker cron; decide the Vercel terms question; choose public repo vs self-hosted runner; set a billing alert on any account that becomes paid.
