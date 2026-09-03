# ADR-035 — Idle behaviour is a line item, not a performance detail

**Status:** accepted · 2026-08-27.

**Context.** The database is Neon on a free plan: the compute **suspends when
nothing is connected** and is billed for the time it is awake, against an
allowance measured in compute-hours. The platform is a village cooperative's
office — genuinely idle overnight and for much of the day.

It was nonetheless awake 100% of the time, and had been since deployment. Nothing
was misconfigured in any way that shows up in a review; four separately
reasonable decisions each held it open:

| Cause | Why it looked fine |
|---|---|
| `DB_MIN_CONNS=2` with a 1-minute health check | "Keep two warm connections so the first request is fast" |
| UptimeRobot on `/v1/ready` every minute | `/v1/ready` is *the* readiness endpoint — that is what it is for |
| `METRICS_REFRESH_INTERVAL=1m` | "Do not let a stranger's scrape interval drive database load" (ADR on OBS-02's ticker) |
| Cleanup and reconciliation hourly | Both are cheap queries |

Measured cost: roughly **182 compute-hours a month against an allowance of 100**,
on a platform nobody was using for most of them.

**Decision.** The idle cost of a running process is a first-class constraint on
this project, and every recurring database touch has to justify itself against
it. Concretely:

1. **The pool must be able to empty.** `DB_MIN_CONNS=0`, and
   `DB_MAX_CONN_IDLE_TIME` strictly shorter than the host's suspend timer so
   connections are gone before it would have started rather than resetting it.
2. **Uptime monitoring pings `/v1/health`, which touches nothing.** Keeping the
   *API* warm and keeping the *database* warm are different problems with
   different answers, and conflating them is what made a monitor into the
   largest line on the bill. `/v1/ready` remains correct for a load balancer,
   and is checked slowly (half-hourly) by the monitor.
3. **Metrics refresh on scrape, with a floor.** The original argument — that
   database load must not depend on somebody else's scrape interval — is kept by
   the floor. What it missed is that the alternative it chose tied load to
   *nothing at all*: 43,000 aggregate queries a month to answer 60 scrapes.
4. **Background jobs are measured in wakes per day, not queries per pass.** A
   tick is a wake whatever it costs to run, and a wake is billed for the whole
   idle timer.

**Why not just pay for it.** The foundation is a Qard al-Hasan fund in Jessore
running on free tiers by necessity, and every one of these changes costs a few
hundred milliseconds on a cold first request — paid once, by one person, when
nobody has used the platform for minutes. That is a good trade at this size. It
stops being one if the platform ever becomes busy enough that the compute never
idles anyway, at which point none of this has any effect and all of it can stay.

**Consequences.** `internal/config/idle_cost_test.go` asserts each of these as a
*ceiling on eagerness* rather than an exact value, so an operator may tune them
and a future default cannot silently drift back. The failure this prevents is
invisible in code review by construction — nothing here is a bug, and each value
is defensible alone — which is exactly why it is written down rather than
remembered.

---

[← all decisions](../decisions.md)
