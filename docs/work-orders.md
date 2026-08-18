# Work Orders

Execution specs. [production-readiness.md](production-readiness.md) says *why* a
task exists; this file says *exactly what to change*, so a future session can act
without re-exploring the codebase.

Prompt with just the ID: **`do WO-28`** · `do WO-27 and WO-40`.

Line numbers are anchors, not guarantees — match on the quoted code, not the
number.

**Nine orders are open** — three carried over, six opened 2026-08-18 by the
documentation pass. Everything finished is one line per batch in
[changelog.md](changelog.md). What was *learned* doing them is in
[Traps](#traps-that-cost-a-session) below — read that before any work touching
Docker, Prisma, migrations or the build config. Every entry there cost at least
one session to find.

| Order | What | Size |
|---|---|---|
| [WO-27](#wo-27--react-compiler-lint-cleanup---9-of-31-done) | React Compiler lint cleanup | deferred — needs a data-fetching library |
| [WO-28](#wo-28--purge-member-data-and-binaries-from-git-history-) | **Purge member data from git history** | ½ day + GitHub Support |
| [WO-40](#wo-40--enable-errcheck-and-staticcheck-) | Enable `errcheck` and `staticcheck` | half a day |
| [WO-51](#wo-51--pin-enbn-message-parity-) | Pin EN/BN message parity | under an hour |
| [WO-52](#wo-52--test-what-a-notification-actually-says-) | Test what a notification actually *says* | half a day |
| [WO-53](#wo-53--prove-the-cleanup-loop-sweeps-) | Prove the cleanup loop sweeps | 2 hours |
| [WO-54](#wo-54--fail-ci-on-prisma-schema-drift-) | Fail CI on Prisma schema drift | 1 hour |
| [WO-55](#wo-55--cover-the-cloudinary-paths-) | Cover the Cloudinary paths | half a day |
| [WO-56](#wo-56--loan-repayment-presets-must-be-whole-taka-) | Loan repayment presets must be whole taka | 20 minutes |

Testing work is tracked separately in [testing.md](testing.md) as `TEST-01 …
TEST-43`. **TEST-39 → 43 are open** and are WO-51 → WO-55 above.

### Standing rules for every order

- `pnpm typecheck` must exit clean, zero errors.
- `pnpm lint` must exit 0. It reports **26 warnings** — 20 are the
  `set-state-in-effect` findings WO-27 owns, 6 are pre-existing `@next/next`
  ones. Do not let that count grow.
- A regression test must be seen to **fail against the pre-fix code** before it
  is allowed to pass. A test written after the fix, never observed red, proves
  only that today's code passes it.
- Money changes stay in the Go API, one transaction, with an `audit_logs` row
  (CLAUDE.md rules 1, 2, 6).
- Update [tasks.md](tasks.md) and tick the order here in the same commit.

---

# Open

## WO-27 · React Compiler lint cleanup `[~]` — 9 of 31 done

**The React Compiler is not enabled.** There is no `experimental.reactCompiler`
in `next.config.js` and no `babel-plugin-react-compiler` in any manifest. These
rules report "this component would bail out of optimisation *if* you turned the
compiler on" — they are not defect reports, and fixing them changes nothing that
runs today.

| Rule | Count | Verdict |
|---|---|---|
| `static-components` | 4 | **Was a real bug. Fixed.** `StatCard` was declared inside `admin/page.tsx`'s body, so React saw a new component *type* every render and remounted all four cards on every state change, throwing away their animations mid-flight. Hoisted to module scope |
| `immutability` | 5 | **Zero-risk. Fixed.** A mount `useEffect` placed *above* the `const` loaders it calls — legal, but temporal-dead-zone fragile |
| `set-state-in-effect` | 20 | **Deferred, deliberately** |

Fixing the 5 `immutability` findings *revealed* 3 new `set-state-in-effect` ones
in the same files: the compiler bails at the first error per component, so the
TDZ errors were masking them. 32 → 26, not 32 → 23.

**Why the remaining 20 are deferred.** The dominant shape is a data-loading
`refresh()` whose synchronous prefix calls `setIsLoading(true)` on a state that
already initialises to `true` — a redundant render on mount, not a bug. None
marks a behaviour change, and clearing them means restructuring the data-loading
of 15 screens that move members' money, for no runtime benefit while the
compiler is off.

**The obvious fix does not work — tried and measured.** Splitting each loader
into a `fetch*` that writes no state before its first `await` still fires the
rule: the compiler follows the call graph into the callee and cannot prove
`apiGet` will not throw *synchronously* into the `finally`. The attempt also
introduced a fresh `exhaustive-deps` warning.

Clearing these needs the effect body to contain no reachable setState at all —
React Query/SWR or `use()` with Suspense. That is Stage 4 work in
[go-live.md](go-live.md), not a lint cleanup. **Do it as part of enabling the
React Compiler**, when the rules mean something.

**When you pick it up:** work screen by screen, not rule by rule — these files
move money and have no fixtures, so a batch rewrite cannot be verified. A
`set-state-in-effect` finding usually marks an effect that should be derived
state or an event handler; deleting the effect is normally correct, adding a
guard normally hides it from the rule instead of fixing it.
## WO-28 · Purge member data and binaries from git history `[ ]`

**Why:** SEC-06 and **SEC-10**. This is the highest-value item in the file.

The audit found far more in history than SEC-06 recorded. `git rev-list` over all
refs turns up:

| Path in history | Size | What it is |
|---|---|---|
| `Official Infos/…` — **39 files** | ~40 MB | Added in `f152f0c`, deleted in `9306120`. Includes `Hasnahena Member Details.docx`, `Hasnahena Member Details 01.pdf` (4-page scan), `Loan Member Detail.docx`, three ledger books, check books and the membership forms |
| `react` | 24.6 MB | Stray binary, commit `3ef0a91` |
| `apps/api/server` | 17.5 + 16.4 MB | The Go binary SEC-06 named |
| `apps/api/seed` | 13.6 MB | Second Go binary, never recorded anywhere |

**The `Official Infos/` tree is the reason this is urgent, and it is not a size
problem.** Those filenames describe real member records — names, ledgers, loan
details — for a cooperative holding people's savings. Deleting them in a later
commit removed them from the working tree and from nothing else. They are in
every clone, and recoverable by anyone with read access in one command. SEC-06
framed this as ~59 MB of clone weight; the weight is the least of it.

**Change**
1. **Confirm first, decide second.** Extract
   `Official Infos/Hasnahena/Hasnahena Member Details 01.pdf` from history and
   look at it. It is an image-only scan, so no script can tell you whether it
   holds live member records — a person has to. If it does, this is a data
   incident and the purge is not optional.
2. `git filter-repo --invert-paths` over `Official Infos/`, `react`,
   `apps/api/server`, `apps/api/seed`. Use `filter-repo`, not `filter-branch`.
3. Force-push every ref. **Coordinate**: this rewrites every commit hash.
4. Ask GitHub Support to garbage-collect the unreachable objects — until they do,
   the blobs stay fetchable by SHA on the remote even after a force-push.
5. Add `Official Infos/` to `.gitignore` so a re-add is not one `git add -A` away.

**Runbook.** Prepared and dry-checked on 2026-08-16; the rewrite itself was not
run, because it is irreversible and rewrites every commit hash in the repository.
Run it from a clean tree with everything pushed.

```bash
# 0. Two safety nets. Do not skip; the rewrite cannot be undone.
git bundle create ~/hasnahena-pre-purge.bundle --all
cp -r .git ~/hasnahena-git-backup

# 1. Get filter-repo. It is a single Python script; pacman has it as
#    `git-filter-repo`, or:
curl -sSfL -o /tmp/git-filter-repo \
  https://raw.githubusercontent.com/newren/git-filter-repo/v2.47.0/git-filter-repo
chmod +x /tmp/git-filter-repo

# 2. Drop the pre-coauthor backup branches FIRST. They exist only to preserve the
#    history being discarded, and while they live every purged blob stays
#    reachable — the purge would appear to do nothing.
git branch -D backup/pre-coauthor-rewrite-main backup/pre-coauthor-rewrite-wo23

# 3. The rewrite.
/tmp/git-filter-repo --invert-paths \
  --path 'Official Infos' \
  --path react \
  --path apps/api/server \
  --path apps/api/seed \
  --force

# 4. filter-repo removes `origin` deliberately, so a stale push cannot happen.
git remote add origin https://github.com/Saif-Sakib/hasnahena.git

# 5. Verify BEFORE pushing — see the done-when test below.

# 6. Publish. Every hash changed, so this must be a force-push of everything.
git push --force origin --all
git push --force origin --tags
```

**Then two things that are not optional.** `git gc --prune=now --aggressive`
locally, and **open a GitHub Support ticket asking them to garbage-collect
unreachable objects**. Until they do, every purged blob stays fetchable by SHA on
the remote — the force-push makes them unreferenced, not gone.

**Watch:** the repository has no other collaborators today, which is exactly why
this is cheap now. Anyone holding a clone afterwards must re-clone; `git pull`
will not reconcile a rewritten history and will produce a confusing merge.

**Verify:** `git rev-list --objects --all | git cat-file --batch-check` shows no
blob over 2 MB except `apps/web/assets/brand/logo.mp4`. A fresh clone is under
15 MB. `git log --all --diff-filter=A -- 'Official Infos/*'` returns nothing.

## WO-40 · Enable `errcheck` and `staticcheck` `[ ]`

WO-37 configured both and left them off, because they reported 44 findings and a
pipeline that is red on arrival gets switched off. **Re-measured 2026-08-17:
18 remain** — Batch L cleared the two unchecked `tx.Exec` calls, which were the
exact shape of the donation-pool waterfall bug that made debt vanish with no
ledger row behind it.

```
GOTOOLCHAIN=go1.25.3 golangci-lint run --default=none --enable=errcheck,staticcheck ./...
```

| Finding | Count | Why it matters |
|---|---|---|
| Unchecked `CreateAuditLog` | 6 | An audit row that silently fails to write is a rule-6 problem. `auth_service.go` ×3, `dashboard_handler.go` ×3 |
| Unchecked `InvalidateAllUserTokens` | 2 | A password change that revokes nothing. `dashboard_handler.go:1200,1425` |
| Unchecked `ClearRateLimit` | 1 | `auth_service.go:87` |
| `config.go` file and env handling | 3 | `f.Close`, `os.Setenv`, one unnamed return |
| `SA1019 middleware.RealIP` | 1 | staticcheck independently flags it as spoofable — it mutates `r.RemoteAddr` to the leftmost `X-Forwarded-For` entry. Related to `TRUSTED_PROXIES` |
| Style (`ST1005`, `ST1023`, `QF1003`) | 5 | Cosmetic |

Fix the first three groups, decide on `RealIP` against `TRUSTED_PROXIES`, then
flip both linters on in `apps/api/.golangci.yml`. The 23 conventional findings
(`defer tx.Rollback()`, `Close()`) are already excluded there.

## WO-51 · Pin EN/BN message parity `[ ]`

**Why:** [product.md](product.md) states "Full EN/BN parity on all user-facing
strings" as a quality bar. Nothing enforces it. The two files hold **300 keys
each and are identical today** — which is exactly the moment to pin it, because
the check costs nothing to add and everything to add later once they have
drifted.

The browser matrix (`e2e/matrix.spec.ts`) does catch an untranslated key, but
only on a page it happens to visit, in a locale it happens to render, and only
once the key has already reached a screen. This catches it at `pnpm test:unit`,
in under a second, without a database or a browser.

**Change** — one new file, `apps/web/test/unit/messages.test.ts`:

1. Flatten both `messages/en.json` and `messages/bn.json` to dotted key paths.
2. Assert the two key sets are equal, and **name the missing keys in the failure
   message** on both sides. "283 !== 284" is not a bug report.
3. Assert no value in `bn.json` is byte-identical to its `en.json` counterpart
   *and* longer than ~25 characters — a long untranslated string is a copy-paste
   that passed review. Keep an explicit allowlist for the ones that are correctly
   identical (`BDT`, brand names, `Hasnahena`), because there will be some.
4. Assert every `{placeholder}` in an `en` value appears in the `bn` one. A
   dropped `{amount}` renders the literal braces to a member.

**Watch:** this is an enumerating suite, so it will fail the build the first time
someone adds a key to one file only. That is the point — say so in the file
header, the way the other four enumerating suites do, or the next person will
"fix" it by deleting the assertion.

**Done when:** `pnpm test:unit` covers it; deleting one key from `bn.json` fails
with that key named; restoring it passes.

## WO-52 · Test what a notification actually *says* `[ ]`

**Why:** `apps/api/internal/services/email_service.go` is 488 lines and has
**zero tests**. Every member-facing notification passes through it carrying an
amount, and **LEDGER-03 was a wrong amount in a notification** — a `÷100` that
told a member their ৳50,000 loan was "BDT 500.00". The current suites assert a
notification row **exists** (`failure_injection_integration_test.go` counts them);
nothing reads what it says.

This is the last unguarded surface where money is rendered to a member. The
document renderers got TEST-23→25; the screens got TEST-26→30; notifications got
a row count.

**Change**

1. Extract the body-building from the sending, if it is not already separable —
   a pure `func(…) (subject, body string)` per notification type is what makes
   this testable without a mail server. **Do not add a mock SMTP.**
2. Table test over every notification type, asserting for each:
   - the amount appears **exactly once**, formatted as whole taka, equal to the
     `int64` passed in — no `/100`, no `*100`, no decimal point;
   - no other number in the body is mistakable for the amount;
   - required member-identifying fields are present, and nothing else is (the
     same PII discipline the Sentry scrubbers apply);
   - both an `int64` boundary value and `0` render sensibly.
3. Add the same census discipline the balance writers have: enumerate the
   notification-building functions **from the source**, and fail if one has no
   test. That is what caught LEDGER-05, and this file has the same shape — a set
   of similar functions where the next one gets added without the test.

**Watch:** rule 1. If any part of the pipeline takes a `float64` or formats with
a fraction, that is the defect, not the test.

**Done when:** a deliberate `/100` reintroduced anywhere in the body builders
fails the suite, verified by making the change and seeing it red before reverting.

## WO-53 · Prove the cleanup loop sweeps `[ ]`

**Why:** RUN-06's `startCleanupLoop` in `cmd/server/main.go` sweeps expired
tokens and rate limits every `CLEANUP_INTERVAL` (default 1 h). It has no test.
**A sweep that stops sweeping is completely silent** — no error, no log line
worth noticing, just `token_blacklist` and `rate_limits` growing until a query
gets slow months later. It is also the exact shape RUN-06 was written to fix:
`CleanupExpiredTokens` and `CleanupExpiredRateLimits` sat written-and-never-called
for months and looked like working code.

**Change** — an integration test in `internal/repositories`:

1. Seed `token_blacklist` and `rate_limits` rows with expiries in the past and in
   the future.
2. Call the sweep functions directly and assert **only** the expired rows are
   gone. A sweep that deletes too much is worse than one that deletes nothing.
3. Assert the sweep is bounded: the loop wraps each pass in a 1-minute context, so
   a cancelled context must return without deleting a partial set or panicking.
4. Separately, assert in `cmd/server` that `startCleanupLoop` is **wired** — the
   same enumeration idea as the route contract. A loop nobody starts is the
   original defect.

**Watch:** the loop ties itself to the shutdown context. A test that starts the
real loop must cancel it, or the package hangs.

**Done when:** deleting the `startCleanupLoop(...)` call from `main.go` fails the
suite.

## WO-54 · Fail CI on Prisma schema drift `[ ]`

**Why:** CI applies `prisma/migrations/` and never compares the result to
`schema.prisma`. The two can disagree — an edit to the schema with no generated
migration is one keystroke away — and **nothing notices until a column is missing
in production**, which surfaces as a runtime error on a money path.

This is cheap and it is the guard for [ADR-014](decisions.md): `db push` is
retired precisely so the migrations are the truth, and that only holds if
something checks.

**Change** — one step in `.github/workflows/ci.yml`, in the `integration` job
after `pnpm db:migrate`:

```bash
pnpm --filter @hasnahena/web exec prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code
```

`--exit-code` returns 2 when there is a difference, so the job fails with the
diff printed. Add the same as a `db:migrate:check` script in `package.json` so it
is runnable locally.

**Watch:** the `audit_logs` immutability trigger (DATA-08) is **not modelled by
Prisma** — it lives in a migration only. Confirm `migrate diff` does not report
it as drift; if it does, the check has to compare schema-to-schema rather than
database-to-schema, and the trigger's absence from `schema.prisma` needs the
comment above `model AuditLog` to say so even more loudly.

**Done when:** adding a field to `schema.prisma` without generating a migration
fails CI, verified locally before pushing.

## WO-55 · Cover the Cloudinary paths `[ ]`

**Why:** upload, transform and delete have no test on either surface, and
**DATA-06 means the assets have no backup either**. NID front/back, passport
photos and nominee photos are regulatory documents. The combination — untested
write path, no export, single third-party account — is the weakest link in the
data story now that the database is drilled on every push.

**Change**

1. Unit-test the pure parts with no network: the signature/params builder, the
   public-id derivation, the transformation string, and the file-type and
   size validation. A NID image that silently uploads as the wrong resource type
   is unrecoverable in the same way a wrong balance is.
2. Test the **failure** path, which is the one that matters: a rejected upload
   must not leave a member row referencing a URL that does not exist. Assert the
   registration path either commits both or neither.
3. Do **not** test against the real Cloudinary account from CI. Stub the HTTP
   client at the boundary.
4. Then do DATA-06 — an export job — because a covered upload path to an
   unbackupable store is still one deletion away from being unrecoverable.

**Done when:** the validation and failure paths are covered, and DATA-06 has a
decision recorded even if the answer is "accept the risk until launch".

## WO-56 · Loan repayment presets must be whole taka `[ ]`

**Why:** rule 1 — money is whole taka, no paisa. `getLoanRepaymentPresets` in
`apps/web/lib/utils.ts` computes:

```ts
const weekly = Math.round((installmentAmount / 4) * 100) / 100;
```

so the "weekly" quick-fill offers a member `1141.75` for a ৳4,567 installment. It
is used on three money screens — `member/loans`, `worker/loans` and
`admin/members/[id]`. All three call `Math.round()` before submitting, so nothing
wrong is *posted*; the defect is that **the member is shown a figure that is not
the one that gets recorded**, and a fractional taka appears in the UI of a
platform whose first rule says it cannot.

**Change**

1. `const weekly = Math.round(installmentAmount / 4);` — one line.
2. Add it to `apps/web/lib/utils.test.ts` (create it): assert every preset is an
   integer for a range of installment amounts including ones not divisible by 4,
   and that each is clamped to `[0, remainingAmount]`.
3. While there, check the three call sites still round on submit. They should
   become no-ops, not be removed — defence in depth on a money path is not
   duplication.

**Watch:** `formatCurrency` already truncates for display, which is why nobody
saw this. The presets write into a text input, not through the formatter.

**Done when:** the new unit test fails against the current line and passes after
the change.

---

# Completed work

Moved to [changelog.md](changelog.md) — one line per batch, for WO-01 → WO-50
and TEST-01 → TEST-43. The lessons that outlived the work are below.

# Traps that cost a session

Each of these was found by something breaking, most of them at runtime rather
than at build time. They are grouped by what you have to be touching to hit them.

### Prisma and migrations

- **`@updatedAt` emits no database default.** Neither `db push` nor a generated
  migration writes one — Prisma applies it client-side. Hand-written SQL in the
  Go API must set both timestamps itself, or the first insert fails a NOT NULL
  check. This broke *all four* money flows once, as a generic 500.
- **`prisma migrate` needs a direct, non-pooled Neon connection.** PgBouncer
  cannot hold the session advisory lock and the failure looks like a **hang**,
  not a wrong-host error. `pnpm db:migrate` derives the direct host and logs it.
- **Timestamps are `timestamp without time zone`.** `NOW()` stores the session's
  wall clock; pgx reads it back as UTC. On a non-UTC server a revocation marker
  reads hours in the future and every new token is born revoked. The pool pins
  `timezone=UTC`. Neon defaults to UTC — a VPS will not.
- **Triggers are invisible to Prisma.** `migrate diff` will not see one, so a
  later `--from-empty` baseline drops it silently (relevant to WO-33).

### PostgreSQL clients

- **`/usr/bin/pg_dump` is not a binary.** On Debian and Ubuntu it is
  `pg_wrapper`, which resolves to the version of the **configured cluster** and
  only falls back to "newest installed" when there is no cluster. GitHub's
  `ubuntu-latest` ships a PostgreSQL 16 *server*, so installing
  `postgresql-client-18` changes nothing and `pg_dump --version` keeps answering
  16 — which is how the nightly backup failed against a 17.11 Neon server with a
  new-enough client already on disk. Resolved by absolute path in
  [scripts/lib/pg-client.sh](../scripts/lib/pg-client.sh) and on `PATH` by
  [.github/actions/postgres-client](../.github/actions/postgres-client). **A bare
  container with no cluster does not reproduce this** — the wrapper picks
  correctly there, which is what makes the bug look like a failed install.

### Docker

- **`.dockerignore` does not use git's matching rules.** Docker matches each
  pattern against the full path from the context root, so a bare `.env` covers
  only the repository root. `apps/web/.env` stayed in the context. Every pattern
  needs an explicit `**/`. This is a **secret-containment** control, not tidiness:
  a file that reaches an image layer is not removed by a later `RM`.
- **`node:*-slim` ships no OpenSSL.** Prisma cannot detect a version, warns, and
  falls back to `openssl-1.1.x` — wrong for bookworm. Install `openssl` in both
  the deps and runtime stages.
- **`@swc/helpers` is only half-traced.** Next 16 resolves it through the
  package's `exports` map at `./esm/*`; the tracer follows the CommonJS entry and
  copies `cjs/` only. The container dies at startup, before serving one request.
  Named explicitly in `outputFileTracingIncludes`.
- **`NEXT_PUBLIC_*` is baked at build time** — including for server-side route
  handlers. A value supplied at `docker run` is too late.
- **`docker compose --env-file` must come before the subcommand.**
  `docker compose --env-file .env.local up`, never `... up --env-file ...`.
- **Compose interpolates the entire file** even for `up -d postgres`, so a `:?`
  default on an unrelated service fails a command that does not use it. Use `:-`.
- **`DATABASE_URL` is hard-coded to the `postgres` service in `docker-compose.yml`
  on purpose.** `.env.local` holds the production Neon URL; interpolating it would
  point the one-shot migrate container at production and run `db:seed` against
  real member data.
- **A Dockerfile that has never been built is a hypothesis.** Static review
  caught none of the three defects above.

### Next, React and the build

**`next-env.d.ts` churns on every run and must not be tracked.** `next dev`
writes `import "./.next/dev/types/routes.d.ts"`; `next build` writes
`import "./.next/types/routes.d.ts"`. A tracked copy therefore shows up modified
after whichever command you ran last, forever. Next's own docs say to gitignore
it and remove it from Git if tracked
(`node_modules/next/dist/docs/01-app/03-api-reference/05-config/02-typescript.md`).
Untracked 2026-08-17. It stays in the tsconfig `include` array — tsc tolerates a
listed file that does not exist, and `.next/types/**/*.ts` is included directly,
so `pnpm typecheck` passes on a fresh clone with no build (verified from a
clean tree).

- **`outputFileTracingIncludes` must stay top-level.** Next 15 promoted it out of
  `experimental` and only *warns* if you leave it behind — which silently ships an
  image with no Prisma engine that dies on the first query.
- **The Tailwind 4 codemod deletes `tailwind.config.ts` and does not carry
  `plugins:` across.** `tailwindcss-animate` stopped loading and Tailwind compiles
  unknown utilities away without complaint — 81 classes across 17 files, every
  Radix dialog, dropdown, select and toast animation, would have become dead
  strings. Restored with `@plugin` in `globals.css`.
- **Next 16 removed `next lint`** and does not fail usefully: it reads `lint` as a
  directory name and reports "no such directory .../lint".
- **`output: 'standalone'` is gated behind `DOCKER_BUILD=1`** so a Docker concern
  cannot change what `pnpm build` emits for Vercel.

### Tests and evidence

- **A dead endpoint can look healthy in a test log.** WO-23 cited the guarantor
  route's "invalid vs valid id" discrimination as proof that `await params`
  worked. It did prove that — but the check was read through a UUID regex that
  rejects every id the database can produce (`cuid()`), so a fully dead endpoint
  passed. When a test discriminates, check *what* it is discriminating on.
- **Suppressing stderr on a setup step turns a broken fixture into a passing
  test.** A failed `INSERT` of test users looked like success, and the resulting
  auth failure was blamed on the token.
- **A list of things to cover goes stale the day it is written; an enumeration
  does not.** The ADR-015 fix was applied to the four balance writers someone
  thought of. The fifth — loan repayment — kept the bug for months and was found
  only once a test re-derived the list from the source. Three suites now do this:
  `chi.Walk` for the Go routes, a filesystem walk for the Next ones, and a regex
  census for balance writers. Each fails the build when the code grows something
  the table does not know about. Prefer that over any list a human maintains.
- **"Revert the fix and watch it fail" only counts if you reverted the whole
  fix.** Removing the `WHERE "remainingAmount" >= $1` guard from the repayment
  fix left the new `FOR UPDATE` in place, and the test still passed — which
  briefly looked like the test being weak rather than the revert being partial.
  Restore the method from `git show HEAD:<path>`, not by editing back what you
  remember changing.
- **A detector must search code, not prose.** A rule forbidding the word
  "markup" in the money paths flagged `loan_repository.go` — for its own header
  comment, which states the rule. A check that fires on its own documentation
  teaches people to delete the documentation. Strip comments first.
- **Measure a layout, do not look at it.** The statement's Reference column was
  0.44 mm too narrow, so every 15-character receipt number wrapped mid-digit on
  every printed statement. Nobody spotted it in a PDF viewer; a test computing
  the rendered text width against the column width found it immediately, and
  found a second overflowing column on its first run.
- **A config key nothing reads is worse than a missing one.**
  `loan.noticePeriodMonths` is declared and editable in the admin settings page,
  and no code path consults it — so the UI reports a policy the system does not
  apply. When checking whether a feature exists, search the *enforcement*
  surface, not the settings.
- **Never initialise a money figure to zero.** The member dashboard's initial
  state was four zeros, so it displayed "Current Balance: BDT 0" for the second
  and a half before the fetch resolved — and its `catch` discarded the error and
  kept those zeros permanently on failure. "Your balance is 0" is the most
  alarming thing this application can say and is indistinguishable from the
  truth. Use a placeholder and a `loading | ready | error` status.
- **`nextjs-portal` is in the DOM and in the tab order, and is not the
  application.** `next dev` injects a dev-tools overlay that is absent from a
  production build. It has now cost two sessions: once by matching a `"Next"`
  button locator, once by absorbing Tab presses and reporting no focus ring.
  Exclude it explicitly in any DOM sweep.
- **Reading `innerText` once races every page that fills in its figures.** Use
  Playwright's retrying matchers (`await expect(locator).toContainText(x)`).
  Reading once made four working specs fail — and, usefully, is what surfaced the
  fabricated `BDT 0` above.
- **A spec that passes alone and fails in the suite is shared state or a
  limit, not luck.** The e2e run tripped the API's 60-requests-per-minute
  limiter partway through, so the *later* specs rendered empty pages. It read as
  flaky ordering; `grep -c 429 .test-stack/api.log` said 91. A retry would have
  buried it permanently. `test-stack.sh` raises the limit now.
- **Radix `Select` renders a hidden native `<select aria-hidden tabindex="-1">`**
  for plain-form submission. An accessibility sweep must respect `aria-hidden`,
  or it reports a false positive on every page with a filter — and a suite that
  cries wolf is a suite people stop reading.
- **Generous per-page waits multiply.** A browser helper that waits up to 25 s
  for a page to settle is fine once and fatal in a loop: a spec walking ten
  admin pages blew the 30 s test timeout and reported as a broken page rather
  than a slow one. Keep the helper's waits short and let the *retrying
  assertions* do the waiting, then raise `test.setTimeout()` on the sweeps.
  `next dev` compiles each route on first visit, so the first pass is slow in a
  way a production build never is — that is a harness allowance, not a budget.

### Go

- **A startup context is not a background context.** `main.go` had a bare `ctx`
  that was a 10-second startup timeout; anything long-lived handed it runs exactly
  once and returns, silently. It froze the new business gauges immediately — and a
  frozen gauge is indistinguishable from a calm system. It is now `startupCtx`
  with a comment.
- **Integer division loses money.** `amount / installments` stored 3,333 for a
  10,000 taka loan over 3 months. The PDF already printed an adjusted final
  installment, so the signed contract and the stored schedule disagreed and the
  loan could never reach zero. `money.InstallmentPlan` returns both figures and
  the "repays principal exactly" invariant is a test.
- **JWT `iat` is whole seconds.** A revocation marker timestamped to the
  microsecond makes a token issued 200 ms later compare as *older* and be born
  revoked. Revocation compares at second precision.

---
