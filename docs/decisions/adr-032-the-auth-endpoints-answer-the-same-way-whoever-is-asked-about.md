# ADR-032 — The auth endpoints answer the same way whoever is asked about

**Status:** accepted · WO-88, WO-89 (2026-08-24).

For a religious-finance cooperative in one town, **membership itself is the
sensitive fact** — a list of who banks here is worth more to the wrong person
than any single balance. That reasoning is written out in
`apps/web/app/api/v1/registrations/route.ts`, which throttles the registration
availability check for exactly this reason. `POST /v1/auth/forgot-password`
answered the same question more precisely and carried no throttle at all: `404`
meant *not a member*, `400 AUTH_EMAIL_REQUIRED` meant *a member, and here is a
fact about their record*, `200` meant *a member*.

**Decision.**

1. **One reply.** Always `200`, always the same body, for a member, a suspended
   member, a member with no email address, and a phone number nobody here has.
   The lookup and the send happen behind it and every failure is logged rather
   than returned. The two refusals that survive are true of every caller alike:
   the throttle counts what *this* caller has asked for, and an unconfigured
   email service is decided **before** any lookup runs.
2. **The attempts that find nothing get an audit row.** That is the signal an
   enumeration is under way, and it used to be a 404 nobody keeps.
3. **Two throttles.** One on the identifier, one on the address — the second is
   what stops one address cycling through numbers, at the 20-per-10-minutes the
   registration endpoint already settled on.
4. **The login lockout escalates on the identifier *and the address*, and stays
   flat on the identifier alone.** This is the load-bearing half. The counter has
   always keyed on the identifier, which means anybody who knows a member's phone
   number can keep them out of their own savings by guessing; at 30 seconds that
   is a nuisance and at an hour it is a weapon. So the pair escalates — 30 s, 2
   m, 10 m, 1 h — and a member signing in from their own phone is untouched by an
   attack from somewhere else. An escalation past the first step writes an audit
   row, because a flat lockout looks identical on the fifth failed attempt and on
   the five-hundredth.
5. **`ErrUserInactive` is answered only after the password verifies.** A
   suspended member needs to be told why they cannot get in; an anonymous caller
   with the wrong password does not get to learn that the account is real. The
   ordering already held; it is pinned by a test now, because it is a one-line
   move away from being wrong.
6. **An unknown identifier still pays for a bcrypt comparison.** Otherwise the
   oracle simply moves from the status code to the stopwatch.

**Consequences.**

- The forgot-password screen no longer says "Email Sent!". It says "if an account
  exists…", in both languages, because a screen that confirms delivery hands back
  the fact the endpoint stopped disclosing.
- Rate limits are per-action policies (`rateLimitPolicies`) rather than three
  package constants. `TestEveryRateLimitedActionIsDeclared` reads every `.go`
  file in the API and fails on a bare string literal at a call site, because an
  undeclared action silently gets the default policy; a second test refuses a
  declared action with no policy.
- `CheckRateLimit` no longer refuses on `attempts >= MaxAttempts` alone. That
  branch made the `RetryAfterSecs` it reported a number nothing enforced, and
  made a lockout impossible to *serve* — which is what an escalation escalates
  from.

---

[← all decisions](../decisions.md)
