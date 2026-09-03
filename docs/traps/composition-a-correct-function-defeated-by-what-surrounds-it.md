# Composition — a correct function defeated by what surrounds it

- **chi's `RealIP` destroyed the rate limiter's input three middlewares before it
  ran.** `clientIP` was right, was unit-tested, and carried a comment explaining
  exactly why the leftmost `X-Forwarded-For` entry must never be trusted — and
  the limiter still keyed on that entry, because `RealIP` had already written it
  into `r.RemoteAddr`. **Nothing about the function was wrong; the stack around
  it was.** The test that catches this had to drive the whole stack, which is why
  `mountMiddleware` was extracted from `main()` ([ADR-019](../decisions.md)).
- **Three handlers had their own copy of the same decision.** The login lockout
  counted failed attempts against the caller-supplied end, so varying one header
  stepped around it entirely. When a fact about a request is security-relevant,
  resolve it **once**, in middleware, and put it in the context.
- **A guard was invalidated by a row added later in the same file.** `seedAdmin`
  refuses to skip on a database with no admin, testing `role IN (ADMIN,
  SUPER_ADMIN)`. Then `seedDonationPool` was added below it, creating an owner
  with `role: ADMIN` — INACTIVE, with a password hash bcrypt can never match.
  From that day the guard passed on exactly the databases it existed to catch.
  **A role is not a capability**: if the question is "can somebody log in as an
  admin", the predicate has to say so.
- **Watch for a safety net positioned where it can never be reached.** SEC-11's
  `fetchUserFromApi` fallback *would* have been blacklist-checked — it only ran
  when `JWT_SECRET` was unset, i.e. never in a correct deployment.

---

[← all traps](../traps.md)
