# Testing

How the suites split, where a new test goes, what fixtures guarantee, and what is deliberately uncovered. The guard map (what fails when you add X) is [guardrails.md](guardrails.md); past test phases (TEST-01…43) are one line each in [changelog.md](changelog.md).

## The suites

| Command | Needs | Covers |
|---|---|---|
| `pnpm test:unit` | nothing | pure TS (auth, validation, formatting, ids, documents and both renderers, CSP, SEO/JSON-LD) and the source **censuses** — FR three-way check, message parity, FK indexes, settings keys, every form posting a money `amount`, the single raw-HTML sink |
| `pnpm test:go` | nothing | money arithmetic (incl. 400k property iterations), utils, middleware, email transport budget, chi-square uniformity of generated secrets, lockout escalation, the rate-limit action census |
| `pnpm test:integration` | Postgres | repositories with real transactions and concurrency, CHECK constraints, the ledger reconciliation (a drift planted per invariant), the Go route contract, hostile input, every SQL literal PREPAREd. **CI runs it under `-race`** |
| `pnpm test:routes` | Postgres | Next route methods driven directly (no browser or server), plus success paths: a real dispute, a registration with Cloudinary stubbed, the support proxy |
| `pnpm db:migrate:check` | Postgres | the migrated DB still matches `schema.prisma` |
| `pnpm test:e2e` | full stack | journeys, forms, registration, the phone/desktop × en/bn matrix, accessibility, **zero CSP violations**, background requests per dashboard tab |
| `node apps/web/scripts/assert-static-routes.mjs` | a `pnpm build` | marketing routes prerendered; no dashboard/auth route is |
| `pnpm test:bundle` | a `pnpm build` | first-load JS per route vs `bundle-budget.json` (>10%, unrecorded or vanished route fails; accept a real cost with `pnpm test:bundle:update`) |

The first two must stay fast enough to run on every save — nothing needing a database goes in them (hence `test:routes` is a separate vitest project).

Auth suites: `securityRouter` (`cmd/server/auth_security_integration_test.go`) has a **configured** stub email service (otherwise every identifier gets the same 503 and an oracle test passes without the fix), and `answerOf` drops `meta.timestamp` before comparing responses.

### Running the database-backed ones

```bash
scripts/test-stack.sh up          # Postgres on :55433, migrated, seeded (up --serve adds both apps)
eval "$(scripts/test-stack.sh env)"
pnpm test:integration && pnpm test:routes
scripts/test-stack.sh down        # destroys the volume
```

- **One suite at a time**: `test:integration` truncates under a running `test:e2e`, and it looks like unrelated specs failing ([traps.md](traps.md) § Test stacks).
- **The `eval` is required for e2e too**: it exports the seeded admin's credentials and **`TEST_DATABASE_URL`, which decides the web app's database** (Next re-applies `apps/web/.env` over `DATABASE_URL` — `lib/prisma.ts`).
- **Never point it at a development database.** Suites share one database in any order; each Go suite truncates between tests.

## Where a new test goes

| What you are testing | Put it here | Needs |
|---|---|---|
| a pure function in `lib/` | `apps/web/lib/<module>.test.ts` | nothing |
| pure Go arithmetic | `apps/api/internal/<pkg>/*_test.go` | nothing |
| a cross-file invariant / a rule across the whole tree | `apps/web/test/unit/*.test.ts` (a census that walks the source) | nothing |
| SQL, a transaction, a race | `apps/api/internal/repositories/*_integration_test.go` | Postgres |
| a Go HTTP contract | `apps/api/cmd/server/routes_integration_test.go` | Postgres |
| what an auth endpoint discloses | `apps/api/cmd/server/auth_security_integration_test.go` | Postgres |
| a Next route handler | `apps/web/test/routes/*.test.ts` | Postgres |
| contact ownership; what a deletion takes | `apps/web/test/routes/identity-integrity.test.ts` | Postgres |
| where a member's files go | `test/routes/document-filing.test.ts` (Cloudinary stubbed) + `test/unit/image-uploads.test.ts` ([ADR-040](decisions.md)) | Postgres / nothing |
| what an approval hands out | `test/unit/approval-credentials.test.ts` — account number, never a password, both directions ([ADR-042](decisions.md)) | nothing |
| retention | `retention_integration_test.go` (text) + `test/unit/audit-actions.test.ts` (tiers, [ADR-038](decisions.md)) | Postgres / nothing |
| an `audit_logs` action | `test/unit/audit-actions.test.ts` — both backends, both directions | nothing |
| a document builder or renderer | `apps/web/lib/documents/*.test.ts` | nothing |
| a screen, a form, a layout | `apps/web/e2e/*.spec.ts` | full stack |
| a journey crossing roles | `e2e/entry-path.spec.ts` (apply → decision → told → first login, 412 px, both languages — the gaps between screens, which per-screen specs cannot see) | full stack |
| a URL shape, redirect or middleware header | `e2e/locale-negotiation.spec.ts` — never a unit test | full stack |
| what a reader in one language sees | `e2e/locale-content.spec.ts` (rendered text, settings values stripped; the language toggle) | full stack |
| an admin edit reaching a visitor | `e2e/public-content.spec.ts` (cache, tier and language; restores `system_config` after) | full stack |
| that a control does anything | `test/unit/settings-keys-read.test.ts` (a reader in either backend) | nothing |
| a measurement of the rendered page | `e2e/matrix.spec.ts` (overflow, clipping, keys, logo vs header) | full stack |
| a journey touching a third party | **cannot run in CI** (no `CLOUDINARY_*` there — real NID scans). Stub at the module boundary (`test/routes/registration.test.ts`) or seed the row the journey would create (`entry-path.spec.ts`). A spec needing the real service skips loudly | — |

## The fixture contract

1. **Namespace everything you seed** (ids, phones, emails, `accountNo`) — collisions appear only when suites share a run, i.e. in CI.
2. **Seed what you need; never depend on another suite's rows.**
3. **Upsert, never truncate,** in browser fixtures.
4. **Never suppress stderr on a setup step** — a silent fixture failure is later blamed on the token.
5. **Browser fixtures refuse a non-localhost `DATABASE_URL`** (`assertDisposableDatabase`).
6. **Assert a delta of `audit_logs`, never an absolute count** — the trigger keeps every previous run's rows.

## Writing an assertion that stays true

- **A regression test must be seen to fail first** against the pre-fix code — revert the whole fix from `git show HEAD:<path>`, watch it go red, restore. (Two green tests here once checked nothing: a census matching its own docs, and a spec clicking the logo because Playwright matches names by substring.) If a test genuinely cannot fail, say so in the test.
- **Some questions only an artifact answers** — "is this route static?", "does the CSP break the app?" — prefer the build output or a real browser.
- **Enumerate, do not list** ([guardrails.md](guardrails.md)).
- **A route contract proves who may call a route, not what it returns** — drive at least one 2xx in `success-paths.test.ts`.
- Test behaviour at the boundary, not private helpers. A hard-to-write test is a finding (a seam in the wrong place). A found bug is fixed in the same batch. Flaky is failing. Use retrying matchers in a browser.

More failure modes: [traps.md](traps.md) — *Tests and evidence*, *Browser suites*.

## When something fails and you cannot see why

- `.test-stack/api.log` and `.test-stack/web.log` — start with `grep -c 429 .test-stack/api.log`.
- `playwright-report/` and `test-results/` have a screenshot and trace per failed spec (video with `PWVIDEO=1`).
- Query the test database: `docker exec hn-test psql -U postgres -d hasnahena_test`.
- **Check `uptime` first** — a CPU-starved Playwright run times out like a defect.

## Deliberately not covered

| Not covered | Why |
|---|---|
| Brevo actually delivering mail | proves nothing about this code; message and transport are tested against stubs; delivery is a launch-day check |
| Load/stress testing | out of scope ([product.md](product.md)); 240 sustained postings is the needed ceiling |
| A generic accessibility audit | four specific checks in `accessibility.spec.ts` beat an advisory list nobody actions |
| Cloudinary against the real account | real NID scans; the client is stubbed and the compensation path driven |

A spec that can only skip is worse than none — wire it up or delete it.

## Measured (observations, not thresholds)

| | Measured |
|---|---|
| Sustained postings | ~180/s, six writers, four contended accounts, reconciling exactly |
| List read / member dashboard | 1–2 queries / 5 queries, flat in row count |
| Go integration suite | ~15 s; slower under `-race` |
| Next route contracts | 528 tests, a few seconds |
| Web unit suite | 849 tests, ~6 s |
| Largest client bundle | `/[locale]/dashboard/worker/transactions`, ~1.44 MB first-load JS (see `bundle-budget.json`) |
