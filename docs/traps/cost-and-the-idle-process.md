# Cost, and the idle process

- **An idle connection pool is not free when the database bills for being
  awake.** Neon suspends the compute when nothing is connected. `DB_MIN_CONNS=2`
  with a one-minute health check therefore held it open for ever — a 100% duty
  cycle, every night, on a platform nobody was using. Roughly 182 compute-hours a
  month against an allowance of 100, and **not one line of it looks wrong in
  review**: warm connections are a performance practice, and the reason they are
  the wrong one here is a property of the host rather than of the code. The
  general form: **when the platform charges for wall-clock time, the idle
  behaviour of a process is a line item.** [ADR-035](../decisions.md), pinned by
  `internal/config/idle_cost_test.go`.
- **An uptime check on a readiness endpoint keeps the database awake.**
  `/v1/ready` pings the pool, which is exactly right for a load balancer and
  exactly wrong for a robot calling it every sixty seconds. `/v1/health` touches
  nothing and answers the question an uptime monitor is actually asking. The two
  needs look like one — *is it up?* — and separating them is what lets the API
  stay warm on Render while the database sleeps.
- **A ticker ties load to nothing at all, which is not obviously better than
  tying it to a scraper.** The business gauges refreshed every minute so that
  "database load does not depend on how often somebody else's scraper runs". The
  endpoint is scraped **twice a day**: 43,000 aggregate queries a month to answer
  60 questions, and enough on its own to stop the compute suspending. Refresh
  lazily *with a floor* — the floor keeps the original argument's teeth, and the
  laziness restores the connection between load and demand.
- **Count background jobs in wakes per day, not in queries per pass.** A tick
  against a scale-to-zero database is a wake, and a wake is billed for the whole
  idle timer whatever the query cost. Hourly cleanup and hourly reconciliation
  were forty-eight wakes a day to delete a few expired rate-limit buckets and
  add up a ledger nobody reads within the hour.
- **A build that nothing consumes is a bill nothing notices.** `images.yml` built
  two Docker images on every push to `main` — one a full Next.js production
  build — and `deployment.md` states plainly that nothing in production uses
  them: Vercel and Render build from source. It was the largest consumer of a
  metered Actions allowance, spent on artefacts nobody pulled. Moved to tags and
  manual runs, with a note to put it back when the VPS move makes the images the
  deployment.

---

[← all traps](../traps.md)
