# Testing

The standing guide: how the suites are split, where a new test goes, what the
fixtures guarantee, and what is deliberately not covered.

Nine phases (`TEST-01 … TEST-43`) built this and are all closed; what each found
is one line per phase in [changelog.md](changelog.md). This file is what you need
*before* writing a test, not the record of past ones.

---

## The suites

| Command | Needs | Covers |
|---|---|---|
| `pnpm test:unit` | nothing | pure TS: auth primitives, error classification, validation, formatting, ids, document numbers, the four document builders and both renderers, EN/BN message parity, the FR three-way check, and the source censuses |
| `pnpm test:go` | nothing | pure Go: money arithmetic (incl. 400k property iterations), utils, middleware, the email transport's timeout budget, chi-square uniformity of generated passwords and codes |
| `pnpm test:integration` | Postgres | repositories against real SQL, real transactions, real concurrency; the Go route contract and hostile-input sweeps. **CI runs this under `-race`** |
| `pnpm test:routes` | Postgres | the Next route methods driven directly — no browser, no server. Plus success paths: a real dispute, a real registration with Cloudinary stubbed, the support proxy's allow-list and per-member limit |
| `pnpm db:migrate:check` | Postgres | the migrated database still matches `schema.prisma`. CI runs it after `db:migrate` |
| `pnpm test:e2e` | full stack | browser specs: journeys, forms, registration, the layout matrix (phone/desktop × en/bn), accessibility |

**The split is load-bearing.** The first two must stay fast enough to run on
every save, so nothing needing a database belongs in them — which is why
`test:routes` is a second vitest project rather than an addition to the first.

### Running the database-backed ones

```bash
scripts/test-stack.sh up          # Postgres on :55433, migrated, seeded
eval "$(scripts/test-stack.sh env)"
pnpm test:integration && pnpm test:routes
scripts/test-stack.sh down        # destroys the volume
```

`up --serve` also builds and starts both apps, for `pnpm test:e2e`.
`pnpm test:stack` is the same thing through the package script.

**Never point this at a development database.** These suites truncate tables and
`down` destroys the volume — that is the point, not a hazard to work around.

**They share one database and run in any order**, deliberately: the Go suites
truncate every table between tests, so anything depending on rows another suite
left behind would pass or fail on package ordering.

---

## Where a new test goes

| What you are testing | Put it here | Needs |
|---|---|---|
| a pure function in `lib/` | `apps/web/lib/<module>.test.ts` | nothing |
| pure Go arithmetic | `apps/api/internal/<pkg>/*_test.go` | nothing |
| a cross-file invariant read off disk | `apps/web/test/unit/*.test.ts` | nothing |
| SQL, a transaction, a race | `apps/api/internal/repositories/*_integration_test.go` | Postgres |
| a Go HTTP contract | `apps/api/cmd/server/routes_integration_test.go` | Postgres |
| a Next route handler | `apps/web/test/routes/*.test.ts` | Postgres |
| a document builder or renderer | `apps/web/lib/documents/*.test.ts` | nothing |
| a screen, a form, a layout | `apps/web/e2e/*.spec.ts` | the full stack |

## The fixture contract

1. **Namespace everything you seed to your own suite** — ids, phones, emails,
   `memberId`. Both contract suites originally seeded `memberId = 'RT-MEMBER'`
   and whichever ran second died on `users_memberId_key`: invisible when either
   ran alone, therefore invisible until CI ran both.
2. **Seed what you need; never depend on what another suite left.**
3. **Upsert rather than truncate** in the browser fixtures — they share the
   database with the Go suites, and clearing it out from under them is the same
   ordering bug from the other direction.
4. **Never suppress stderr on a setup step.** A failed fixture insert that looks
   like success turns into an auth failure blamed on the token.
5. **The browser fixtures refuse a non-localhost `DATABASE_URL`**
   (`assertDisposableDatabase`). They write balances; the mistake is one pasted
   environment variable away.

## Writing an assertion that stays true

- **Enumerate, do not list.** Thirteen suites and one CI check derive their
  coverage from the source and fail the build when the code grows something they
  do not know about. The table of what each one demands is in
  [CLAUDE.md](../CLAUDE.md) — read it before adding a route, a balance writer, a
  notification, a message key or a schema field.
- **A regression test must be seen to fail first**, with the symptom it
  describes. And revert the *whole* fix to check — restore from
  `git show HEAD:<path>` rather than editing back what you remember changing.
- **A route contract proves who may call a route, not what it returns.** Every
  route in the contract table wants at least one row driving it to a 2xx;
  `success-paths.test.ts` is where those live.
- **Test behaviour at the boundary, not implementation.** A test that breaks when
  you rename a private helper is a liability.
- **A found bug is fixed in the same batch**, not filed.
- **If a test is hard to write, that is a finding** — usually the seam is in the
  wrong place. Extracting `mountRoutes` and `mountMiddleware` from `main()` is
  what made the routes and the middleware stack testable at all.
- **Flaky is failing.** Fix the cause or delete the test.
- **In a browser, use the retrying matchers.**

More failure modes, with the stories behind them: [traps.md](traps.md) —
especially *Tests and evidence* and *Browser suites*.

## When something fails and you cannot see why

- `.test-stack/api.log` and `.test-stack/web.log` hold the server output. Start
  with `grep -c 429 .test-stack/api.log`.
- `playwright-report/` and `test-results/` carry a screenshot, a video and a
  trace for every failed spec. Video is off by default (`PWVIDEO=1`) — it costs
  an ffmpeg process per test.
- Go integration failures print the seeded ids; query directly with
  `docker exec hn-test psql -U postgres -d hasnahena_test`.
- **Check `uptime` before believing a browser failure.** A Playwright run starved
  of CPU produces timeouts that read exactly like defects.

---

## What is deliberately not covered

Not everything absent is a gap. These are decisions:

| Not covered | Why |
|---|---|
| Brevo actually delivering mail | Testing a third party's SMTP proves nothing about this code. The message and the transport are both tested against stubs; delivery is an operational check on the go-live list |
| Load and stress testing | Out of scope in [product.md](product.md). 240 sustained postings is the ceiling this workload needs |
| A generic accessibility audit | See the reasoning in `e2e/accessibility.spec.ts` — four specific checks beat a long advisory list nobody actions |
| Cloudinary against the real account | It holds members' NID scans. The client is stubbed and the compensation path driven end to end |

**One known hole.** `e2e/admin-dashboard.spec.ts` skips unless
`E2E_ADMIN_IDENTIFIER` and `E2E_ADMIN_PASSWORD` are set, and neither
`test-stack.sh env` nor the CI e2e job sets them — so it has **never run in any
environment** and is the "1 skipped" in every report. `journeys.spec.ts` already
signs in as an admin through the fixtures and asserts more, so this is redundant
rather than missing coverage. Wire it to `ACCOUNTS.ADMIN` or delete it: a
permanently-skipped spec is worse than no spec, because it reads as covered.

## Measured, so a regression has something to compare against

Observations, not thresholds — a budget invented before anything is slow is a
number nobody trusts. Taken on the author's machine.

| | Measured |
|---|---|
| Sustained postings | ~180/s, six concurrent writers, four contended accounts, reconciling exactly |
| List read | 1–2 queries, flat in row count |
| Member dashboard read | 5 queries, flat in history length |
| Go integration suite | ~8 s; ~40 s under `-race` |
| Web unit suite | ~4 s for 429 tests across 23 files |
| Next route contracts | ~3 s |
| Browser suite | 145 passed + 1 skipped, 7.4 min, one worker, on an idle machine |
