# Go

- **A `Scan` with more destinations than the SELECT has columns fails every row,
  silently.** `GetWorkerTransactions` listed twelve columns and scanned thirteen,
  and the loop's error branch was `continue` — so the endpoint answered `[]` with
  a 200, no log line, and two worker screens that had never shown anything looked
  exactly like a worker who had processed nothing. `continue` on a scan error is
  how a column-count bug becomes an empty page instead of a crash; if you write
  one, count the columns first.

- **A startup context is not a background context.** `main.go` had a bare `ctx`
  that was a 10-second startup timeout; anything long-lived handed it runs exactly
  once and returns, silently. It froze the business gauges immediately — and a
  frozen gauge is indistinguishable from a calm system. It is `startupCtx` now,
  and `wiring_test.go` fails if a loop is started with it.
- **JWT `iat` is whole seconds.** A revocation marker timestamped to the
  microsecond makes a token issued 200 ms later compare as *older* and be born
  revoked. Revocation compares at second precision.
- **`% ` over a random byte is not uniform.** 256 does not divide by 10 or 62, so
  `digits[b % 10]` makes 0–5 4% likelier than 6–9 and the 62-character alphabet
  skews 21%. Use `utils.RandomString`, which rejection-samples. Both suites keep
  the biased version to prove a chi-square can tell them apart.
- **A security mechanism can be built, enforced and wired to the wrong half of
  the problem.** Token revocation was correct on both backends and called from
  the logged-in password *change* — the path taken by someone who still controls
  the account — and not from the forgot-password *reset*, the path a member
  reaches because they have lost control of it. Every component passed its own
  test. When auditing a control, do not ask whether it works; ask which paths
  reach it, and whether those are the paths that need it.
- **An oracle closed at the status code can still run on the clock.** Making
  every login answer `401 AUTH_INVALID_CREDENTIALS` leaves an unknown identifier
  answering in microseconds and a real member's wrong password taking ~60 ms,
  because only one of them reaches bcrypt. Equalise the work, not just the words.

---

[← all traps](../traps.md)
