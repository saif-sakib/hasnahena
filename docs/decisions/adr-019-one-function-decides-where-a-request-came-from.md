# ADR-019 — One function decides where a request came from

**Status:** accepted · 2026-08-18 · closes WO-60 · removes chi's `middleware.RealIP`.
**Amended 2026-09-03 (T-34):** the *one function* stands; what it counts no
longer has to be a number of hops.

`ClientIP` now takes a `ClientIPConfig` rather than a bare integer, and with
`TRUST_CLOUDFLARE_CLIENT_IP=true` it prefers **`CF-Connecting-IP`**, falling back
to the count when that header is absent or unparseable. The reason is
operational rather than theoretical: the count was wrong **twice in one week**
after DNS moved to Cloudflare — `1`, then `2`, before `3` proved correct — and
both wrong answers were silent, because a miscount does not produce an error. It
produces a well-formed address belonging to the wrong party, which the limiter
keys on, the lockout counts and `audit_logs` stores as evidence.

Two properties make the header safe *here* and are the whole of the trust
argument. Cloudflare sets it to the address it accepted the connection from, and
it **strips any copy the caller supplied** — so on a route that genuinely passes
through the zone it cannot be forged. Nothing about the header itself proves the
request came that way, which is why it is behind an explicit deployment flag,
defaulting to off: a process reachable another way would be believing a value
anyone can type. The value is also **parsed** rather than merely checked for
emptiness, because it becomes a rate-limit key and an audit row and neither
should be able to hold arbitrary text.

The count remains the fallback and remains correct at `3`. This is not a
replacement for understanding the chain; it is a way for the answer to survive
somebody adding a hop to it.

Four places in the Go API answered "which address is this caller?" and three of
them read the **leftmost** `X-Forwarded-For` entry — the end the caller writes:

- chi's `middleware.RealIP`, which overwrote `r.RemoteAddr` with it for every
  request in the process, so the access log recorded an address the caller chose
  and, at the default `TRUSTED_PROXIES=0`, the rate limiter keyed on it too;
- `getClientIP` in `auth_handler.go`, which is what the **login lockout** counts
  failed attempts against;
- three inline header reads in `dashboard_handler.go`, which store the result in
  an `audit_logs` row as evidence of who changed a password.

`middleware.clientIP` was the only one that was right, and it was already
unit-tested with a comment explaining exactly why the leftmost entry cannot be
trusted. It made no difference: `RealIP` had destroyed its input three
middlewares earlier.

**The decision:** there is now exactly one resolver, `middleware.ClientIP(r,
trustedProxies)`, counting entries from the trusted end. `Logging` calls it once
per request and puts the answer in the request context; `RequestClientIP(r)`
reads it back, and every handler uses that. `RealIP` is not mounted, and
`mountMiddleware` carries a comment saying why so it is not re-added as an
obvious improvement.

`TRUSTED_PROXIES` is the single knob and it is a deployment fact, not a request
one: **set it to the number of proxies in front of the process, and to 0 only
when nothing is.** Too low and real members share one bucket; too high and the
header is believed. Render is 1.

That first failure is new, and it is the price of this change: `RealIP` used to
give every caller a distinct — if forgeable — identity, so nobody noticed the
setting. Without it, a process behind a proxy with `TRUSTED_PROXIES=0` sees the
proxy's address on every request and throttles the whole membership as one
client. **`main.go` therefore logs a warning at boot** when the count is 0
outside development, because a silent misconfiguration here is a rate limiter
that rejects real members.

**Consequences**

- The access log gains a `peer` field whenever the attributed address and the
  TCP peer differ. With a proxy in front they differ on every request; with none
  configured, a difference means someone sent a header claiming otherwise.
- A handler must never read `X-Forwarded-For` itself. `RequestClientIP` falls
  back to the TCP peer for a request that did not pass through `Logging`, which
  is the safe direction to fail.
- The middleware stack moved out of `main()` into `mountMiddleware`, for the
  same reason `mountRoutes` did: the defect lived in the composition, and a
  stack built inline cannot be exercised by a test.

---

[← all decisions](../decisions.md)
