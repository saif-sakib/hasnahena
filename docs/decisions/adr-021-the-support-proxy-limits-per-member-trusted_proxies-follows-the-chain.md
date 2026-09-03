# ADR-021 — The support proxy limits per member; `TRUSTED_PROXIES` follows the chain

**Status:** accepted · 2026-08-18 · closes WO-64. **Amended 2026-09-03:** the
title said *stays at one*, and one was never the principle — it was the number
of proxies in front of the API at the time. Putting `api.hasnahenafoundation.com`
behind Cloudflare's proxy made the chain `client → Cloudflare → Render`, so the
correct value became **2**. The reasoning below is unchanged and is what says
so; only the count moved. A number written into a decision as though it were the
decision is how a deployment change silently invalidates one.

Everything the browser calls goes cross-origin to the Go API except
`/v1/dashboard/support/*`, which `lib/api.ts` rewrites to a same-origin Next
proxy. That proxy joined the catch-all segments straight into the upstream URL,
and Next hands them over already percent-decoded, so `%2e%2e%2f` arrived as
`../` and `fetch` normalised it away before the request left. It is now an
allow-list of the six paths `main.go` actually mounts, method by method.

**It was never privilege escalation** and the record should say so: the Go API
authorises every route itself and gates `/admin` at the router, so a member's
token is refused there whichever door it arrives at. An unnecessary door, not an
open safe.

The order also asked the proxy to forward the member's address as an
`X-Forwarded-For` entry so the Go limiter could stop attributing all support
traffic to Vercel. **That does not work, and the reason is worth recording so
nobody tries it again.** `ClientIP` reads the header from the trusted end —
`parts[len(parts)-TRUSTED_PROXIES]` — because that is the only end a caller
cannot choose. Two paths reach the API with different depths:

| Path | Header at the API | The setting reads |
|---|---|---|
| browser → …edge… → Render | `member` | `member` ✓ |
| browser → …edge… → Render, member spoofing | `9.9.9.9, member` | `member` ✓ |
| browser → Vercel → …edge… → Render | `vercel` | `vercel` |
| browser → Vercel → …edge… → Render, proxy forwarding | `member, vercel` | `vercel` |

Forwarding puts the member's address at an index the setting does not read.
Raising the count by one would read the member on the proxied path and a
**spoofed entry** on the direct one — and it is one global number, so there is no
setting that is right for both. The proxy therefore sends no `X-Forwarded-For`
at all, and the per-member limit lives on the Next side instead.

**The table is written in hops rather than in a number on purpose**, because the
number moved: it was `1` when Render was the only thing in front, and became `2`
when `api.hasnahenafoundation.com` was put behind Cloudflare's proxy on
2026-09-03. Every row shifts by one and the conclusion is unchanged — what
matters is that the two paths differ in depth, not what the depth happens to be
this month. **Confirm the shape from a real access-log line rather than from this
table**: whether a given edge appends to `X-Forwarded-For` or replaces it is that
provider's behaviour, not something a document can promise, and the `ip` field
must come out as the caller's own address.

Measured on 2026-09-03, the header arrives with **three** entries — origin,
Cloudflare, Render — and the support path resolved to `52.221.235.153`, AWS
`ap-southeast-1`, which is Vercel's `sin1`. That is this ADR's fourth row
happening in production: the proxied path reads **Vercel**, the direct path reads
the member, one number serves both, and the per-member limit lives on the Next
side because no number could serve both.

So the per-member limit lives on the Next side, where the member's address is
known and Vercel sets it: 60 mutations per minute per caller, matching the Go
default, through the same `consumeRateLimit` the registration and lookup routes
use. Reads are not counted, exactly as `rateLimitExempt` does not count them
over there.

**What this does not fix:** the Go limiter still sees one address for all
proxied traffic, so enough abusive members can still exhaust that bucket between
them. The complete fix is a limiter keyed on the authenticated user rather than
the address, which needs verified identity in middleware — the token cannot be
trusted before it is checked, or an attacker mints a fresh bucket per request by
sending garbage. Tracked in [tasks.md](../tasks.md).

**Also changed:** `fetch` now carries `signal: req.signal`, so a member closing
their browser ends the upstream SSE stream instead of leaving it open for the
life of the process — RUN-02 ends streams first at shutdown precisely because
open streams eat the drain window. Note that nothing in the web client uses SSE
today: the dashboard polls. The leak was real in the code, not in production.

---

[← all decisions](../decisions.md)
