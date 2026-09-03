# ADR-025 — The rate limiter keys on the verified member

**Status:** accepted · 2026-08-19 · closes WO-78 (RUN-09) · completes what [ADR-021](adr-021-the-support-proxy-limits-per-member-trusted_proxies-follows-the-chain.md) left open.

ADR-021 established that the Go limiter cannot see past the Next proxy: every
support request arrives from Vercel's address, all of it in one bucket, and no
value of `TRUSTED_PROXIES` is correct for both the proxied and the direct path.
It named the complete fix and deferred it: **key on the authenticated user
rather than on the address.**

The obstacle was ordering, and it is the whole difficulty. The limiter is global
middleware and runs before any handler's auth. Keying on an **unverified** token
would let an attacker mint a fresh bucket per request by sending garbage — the
WO-60 defect wearing a different header. So the token must be verified before the
limiter reads it.

**The decision:** a new `middleware.Identity`, mounted after `Logging` and before
`RateLimit`, verifies the bearer token's **signature and expiry** and puts the
subject in the request context. `RequestUserID(r)` reads it back. The limiter
keys on `user:<id>` when one is present and `ip:<addr>` when it is not.

This is [ADR-019](adr-019-one-function-decides-where-a-request-came-from.md)'s
shape deliberately reused: one place decides, everything else reads it back, and
nothing else may parse an `Authorization` header to answer a cross-cutting
question.

**Revocation is deliberately not checked here.** `ValidateToken` asks the
database whether a token is blacklisted and whether a password change revoked the
member's tokens wholesale, and every handler still does that. Repeating it in the
limiter would put two queries on the hot path of every request *including the
ones it is about to reject* — a rate limiter that queries the database is an
amplifier, not a defence. It is also unnecessary for this purpose: a revoked
token is still proof of **which member holds it**, since nobody else can produce
a signature for that subject, so attributing their traffic to them is exactly
right. The handler refuses the request a moment later on its own.

**What `RequestUserID` is not for:** authorisation. It knows nothing about
revocation, roles, or whether the account is still ACTIVE. Use it to attribute a
request, never to permit one.

**Consequences**

- Two members behind the proxy get separate buckets; one abusive member can no
  longer exhaust the quota for the rest.
- Anonymous traffic and a signed-in member from the same address are separate
  callers, so a burst of unauthenticated requests cannot spend a member's quota.
- With no verifier wired — which is how every existing middleware test builds
  the stack — behaviour is byte-for-byte what it was before, and a test asserts
  that so those tests keep meaning what they meant.

---

[← all decisions](../decisions.md)
