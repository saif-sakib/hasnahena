# Tests and evidence

- **A truncated read of a file is a claim about the file, and it will be believed
  as one.** The served `robots.txt` was read through `head`, the app's
  `Disallow` lines were not in it, and the confident conclusion was that
  Cloudflare had *replaced* the app's file. Cloudflare prepends: the app's group
  was at lines 64–69 of 69. `head`, `grep -c`, a first page and a summary are
  samples — they support "I saw X", never "there is no X". Before concluding
  something is missing, read the whole file and say how long it was.
- **The site's own domain is in the repository; do not take it from a
  screenshot.** A whole diagnosis ran against `hasnahena.com`, read from a
  reference design pasted for its style. The site is `hasnahenafoundation.com` —
  `NEXT_PUBLIC_SITE_URL`, `lib/contact-details.ts` and `org.email` settle it in a
  second.
- **`next dev` can serve a stale route handler, and a browser test will believe
  it.** After adding `totalPages` to `/api/v1/admin/audit-logs`, curl still
  returned the old shape; touching the file did nothing, restarting the server
  fixed it. A suite started before an edit keeps running through it, half old
  code and half new, so its result describes no version of the tree. When a
  response disagrees with its source, `curl` it and restart before debugging.
- **A helper that throws fails the tests rather than the code, and the failure
  looks like the suite's fault.** `registration.spec.ts` filled the date of birth
  with `page.fill('#dateOfBirth', '1990-04-12')`. When that control became three
  selects — a calendar is the wrong widget for a birthday — the id resolved to
  the **day** select and Playwright answered *"Element is not an `<input>`"*.
  Eight assertions went red at once: every phone-registration guarantee that has
  to reach the documents step first. All eight stayed red, because the form was
  demonstrably fine and a red suite over working code gets read as "the suite is
  broken" exactly once before it stops being read at all. When a cluster of tests
  in one file fails on the same line of one helper, the helper is the suspect,
  and the guarantees it gates have been unenforced since the day it broke.
- **A source-reading census anchored on an incidental detail goes blind the day
  that detail is removed, and passes.** The audit-action census found every
  action by matching `VALUES (gen_random_uuid()::text, 'ACTION'` — anchoring on
  the id every writer supplied. ADR-044 made those ids a sequence, so no writer
  passes one any more, so the census matched nothing and reported ten catalogued
  actions as *written by nothing* — the opposite of the truth, in a test whose
  whole job is to tell those two apart. It cannot distinguish "nothing writes
  this" from "I can no longer see the writes", so it needs a `WRITTEN.size` floor
  and an anchor on something the writers still have.
- **Red-check a new census by planting the defect, not by reading the regex.**
  `TestPostingsAndLoansAreNumbered` was written to fail on a `gen_random_uuid()`
  in a posting insert. It passed against one, because
  `INSERT INTO transactions .*?\)\s*VALUES` stops at the `)` that closes the
  **column list** — so the values, which is where the id actually comes from,
  were never in the matched text. Reading to the end of the enclosing backtick
  literal fixed it. A census that scans the right files and matches nothing looks
  exactly like a codebase with no defects.
- **A regression test can be green before the fix because the defect was already
  fixed by somebody else.** WO-90 said the workers route answered 500 on a
  concurrent duplicate. The concurrency test written to see that 500 passed
  against the unmodified code: `routeErrorStatus` had routed `P2002 → 409` since
  the TEST-18 work, and the order was written from a reading of the file that
  predated it. A work order is a hypothesis; the red run is what confirms it.
  What *was* wrong turned out to be one line the order never mentioned — the
  message did not say which field collided.
- **A guard that two independent clauses enforce cannot be red-checked by
  deleting one.** The retention sweep excludes an approved-then-deactivated
  member by `approvedAt IS NULL` *and* by the tombstoned phone. Removing either
  alone left the test green, which is the point of defence in depth and also
  means the red check has to remove both to prove the test discriminates. Say so
  in the test rather than deleting the redundant clause to make the check
  simpler.
- **`audit_logs` is append-only, so every assertion about it is a delta.** A test
  asserting exactly one `MEMBER_ERASED` row passed on a clean database and found
  three after two red-check runs, because `t.Cleanup` cannot delete from that
  table. Count before, count after, and read the newest row.
- **The defects that moved money were found by running the code, not by reading
  it.** Every audit that reviewed those files by eye passed them. A green suite
  bounds only the cases it contains — 17 integration tests were green while two
  defects destroyed money, because the suite never ran two postings concurrently
  and never seeded a loan without a guarantor. Coverage measures what was
  *executed*, never what was *checked*.
- **A green secret scan is not evidence that history is clean.** gitleaks looks
  for credential *patterns*, not for documents that should never have been
  committed. It has always passed on this repository, which has 39 member-record
  files in its history.
- **A route contract proves who may call a route, not what it returns.** The
  worst finding of the 2026-08-18 audit sat behind a test that drove the route
  with a non-existent id and asserted the 404. Every authorization case passed;
  the success path had never run.
- **A list of things to cover goes stale the day it is written; an enumeration
  does not.** Prefer a census derived from the source over any list a human
  maintains — see the table in [CLAUDE.md](../../CLAUDE.md).
- **"Revert the fix and watch it fail" only counts if you reverted the whole
  fix.** Removing one guard left the new `FOR UPDATE` in place and the test still
  passed, which briefly looked like a weak test rather than a partial revert.
  Restore from `git show HEAD:<path>`, not by editing back what you remember.
- **Some defects cannot be reproduced by a test, and saying so is part of the
  fix.** A floating `prisma.notification.create(...)` settles anyway under Node,
  so the obvious test passes against the broken code. The *regression* guard is a
  source census; write the note in the test, or the next reader will trust it.
- **An `httptest` handler that does not drain the request body cannot tell that
  the client has gone**, so `r.Context()` stays live and `Server.Close` blocks on
  it — the suite hangs with no failure and no output. `net/http` learns of the
  peer's departure from a read on the connection, and an unread body is what that
  read returns instead. `io.Copy(io.Discard, r.Body)` first, then block.
- **`golangci-lint` compiles the test files too, with `build-tags: integration`.**
  A new `_test.go` helper colliding with one in a tagged file in the same package
  is green under `go test` and `go build`, and shows up as a `typecheck` finding
  that reads like a configuration problem. It is a real redeclaration only the
  tagged build sees.
- **A detector must search code, not prose.** A rule forbidding the word "markup"
  in the money paths flagged `loan_repository.go` for its own header comment,
  which states the rule. A check that fires on its own documentation teaches
  people to delete the documentation. Strip comments first.
- **Suppressing stderr on a setup step turns a broken fixture into a passing
  test.** A failed `INSERT` of test users looked like success, and the resulting
  auth failure was blamed on the token.
- **A dead endpoint can look healthy in a test log.** A guarantor route's "invalid
  vs valid id" discrimination was cited as proof the handler worked — but the
  check read ids through a UUID regex that rejects every `cuid()`, so a fully dead
  endpoint passed. When a test discriminates, check *what* it is discriminating on.
- **A green test that never reached the code proves nothing.** The first
  `public-content-fallback.test.ts` asserted `getPublicSettings()` returns `{}`
  with the database down, and passed with `findMany` called **zero** times:
  outside a Next server `unstable_cache` throws `Invariant: incrementalCache
  missing` and the `catch` under test swallowed it. Mock `next/cache` to a
  pass-through and assert the mock **was called** — an error-path test must prove
  it reached the thing meant to fail.
- **A budget recorded from a build is a fact; a budget maintained by hand is a
  wish.** `assert-bundle-budget.mjs` reads the bundler's
  `.next/diagnostics/route-bundle-stats.json`; no test over the source can know
  what a route ships. Same for `assert-static-routes.mjs` and
  `prerender-manifest.json`.
- **An ordinary refusal reported as a 500 reads as a broken feature.**
  `WorkerAddWithdrawal` classified errors with `strings.Contains(err.Error(), …)`;
  the screen's two commonest refusals matched no branch and answered
  `500 WITHDRAWAL_FAILED` ("withdrawal is not working"), and `"active loan"`,
  checked before `"guarantor"`, also matched `"is guarantor for active loan"`, so
  a guarantor was told they had a loan. Classify with `errors.Is` over sentinels
  (Rule 2b) and test the error → HTTP translation itself: every repository test
  passed while the endpoint answered 500.
- **A test cannot clean up after itself in `audit_logs`.** The DATA-08 trigger
  refuses `DELETE` unless the transaction has set `hasnahena.allow_audit_purge`,
  so a `t.Cleanup` deleting audit rows fails, is ignored because the cleanup
  discards the error, and the next run counts two where it expected one. Assert
  on a **delta**: read the count before, read it after. The same applies to any
  assertion over a table something else has appended to.
- **A hardcoded unique value in a shared-database suite passes until another
  suite runs first.** `withdrawal_status_integration_test.go` seeded its fixture
  with phone `01955500001`, which is the number `apps/web/test/routes` gives
  `nextroute-member`. Both suites use the same database, so the whole file failed
  on `users_phone_key` when the route suite had run first and passed when it had
  not — and `pnpm test:integration` alone always passed. Namespace every unique
  column to the suite that owns it, and prove it by running the two suites in
  **both** orders.
- **Comparing whole response bodies compares the clock.** The API envelope
  carries `meta.timestamp`, so a test asserting two responses are byte-identical
  — which is the only way to state "this endpoint is not an oracle" — passes when
  both land in the same second and fails when they do not. Normalise the envelope
  first; the fingerprint that matters is the status and everything except `meta`.
- **A red run for the wrong reason is not evidence.** Reverting WO-87's fix to
  prove its test could fail produced `unused argument: 0`, because the
  reconstructed statement no longer referenced `$1` — the test went red on a pgx
  error rather than on the cross-account write it exists to catch. Read *why* the
  red run failed, not just that it did.

---

[← all traps](../traps.md)
