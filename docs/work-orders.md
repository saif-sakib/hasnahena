# Work Orders

Execution specs. [production-readiness.md](production-readiness.md) says *why* a
task exists; this file says *exactly what to change*, so a future session can act
without re-exploring the codebase.

Prompt with just the ID: **`do WO-28`** · `do WO-27 and WO-40`.

Line numbers are anchors, not guarantees — match on the quoted code, not the
number.

**Three orders are open.** Everything else is in
[Completed](#completed--wo-01--wo-50), one line each. What was *learned* doing
them is in [Traps](#traps-that-cost-a-session) — read that before any work
touching Docker, Prisma, migrations or the build config. Every entry there cost
at least one session to find.

Testing work is tracked separately in [testing.md](testing.md) as `TEST-01 …
TEST-38`.

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

---
---

# Completed — WO-01 → WO-50

Full narratives were compressed once each order was verified. The durable parts
are in [Traps](#traps-that-cost-a-session); decisions in
[decisions.md](decisions.md); *why* each existed in
[production-readiness.md](production-readiness.md) under its SEC/RUN/CI/DATA/
OBS/PKG id.

| Batch | Orders | Outcome |
|---|---|---|
| **A** Security | WO-01 → 05 | SEC-01→05, SEC-07. Token revocation actually revokes; `/v1/dashboard/admin` gated at the router, so a new handler is protected by *where it is mounted*; gallery writes admin-only; one origin-checked CORS helper; `?access_token=` replaced by 60 s single-purpose SSE tickets; bodies bounded at 1 MB |
| **B** Hardening | WO-06 → 09 | RUN-01→06. Real `http.Server` timeouts, drained `SIGTERM` shutdown, `/v1/ready` against the pool, hourly cleanup sweeps, `log/slog` JSON with member emails replaced by user IDs |
| **C** Tests + CI | WO-10 → 13 | CI-01/02/03/05/07/08. `internal/money` extracted and table-tested, 17 integration tests on real Postgres, GitHub Actions, gitleaks, Dependabot. **Found: no money method wrote an `audit_logs` row, and the donation-pool waterfall leg was broken two ways** |
| **D** Data safety | WO-14 → 16 | DATA-01→05. Encrypted nightly `pg_dump`, a restore *script* rather than a procedure, drilled on every push. `db push` retired (ADR-014), `pnpm db:seed` |
| **E** Observability | WO-17 → 19 | OBS-01→04, OBS-06, RUN-08. Token-gated `/metrics` with business gauges, Sentry both apps, alerting split across UptimeRobot/Sentry/Actions on cost grounds |
| **F** Containers | WO-20 → 22 | PKG-01→05, 07. API image 26.9 MB, web 488 MB. Verified by **running** them — three defects survived static review, all in [Traps](#traps-that-cost-a-session) |
| **G** Stack | WO-23 → 26 | Next 14 → 16.3.1, React 18 → 19.2.8, next-intl 3 → 4.13.6, ESLint 8 → 9, Tailwind 3 → 4.3.3, `middleware.ts` → `proxy.ts`. **`pnpm audit` 41 → 0.** WO-25 had to run before WO-24 — next-intl 3's peers end at Next ^15, so the documented order was backwards. Merged to `main` |
| **H** Live defects | WO-29 | Guarantor approval validated loan ids against a **UUID regex while every id is `cuid()`**, so FR-11 had never worked for any loan. WO-27 and WO-28 from this batch are still open, above |
| **I** Security | WO-30 → 33 | Registration-enumeration oracle rate-limited (20/10 min per address), `ENABLE_HSTS`, global rate limiting at the router, `audit_logs` made append-only by a database trigger |
| **J** Artifacts | WO-34 → 35 | Images built and pushed by CI tagged by commit SHA; the env-var contract in `.env.render.example` and `.env.vercel.example` |
| **K** Code health | WO-36 → 39 | Vitest wired into CI; `golangci-lint` with `govet`/`ineffassign`/`unused` clean; `user_repository.go` 4,894 lines → nine domain files, **verified as a pure move** by hashing all 91 declarations brace-to-brace; the `system_config` allow-list |
| **L** Ledger integrity | WO-41 → 45 | **Four defects that destroyed or misreported money.** Balance writes made relative and locked (ADR-015) — 20 concurrent ৳1,000 deposits used to leave ৳1,000; the default waterfall fixed for loans with **no guarantor**, which previously marked a loan DEFAULTED and recovered nothing; the last `÷100`; donation numbering. Plus the loan-application and guarantor UI (FR-10/11), and SEC-13 — `availableGuarantors` returned the 50 wealthiest members' names and savings balances to any signed-in member |
| **M** Admin + registration | WO-46 → 50 | **The settings page could not save anything** — 48 keys posted against a 21-key allow-list, and the endpoint rejects the whole request on one unknown key. **No loan application could ever be created** — the TypeScript document-number allocator omitted a `NOT NULL` column, so the first `INSERT` of a series each year failed and the `ON CONFLICT` branch was never reached. Three settings tabs controlled nothing. `minDepositForLoan = 0` meant different things to the two backends. Registration rebuilt for Android |

### What each batch is remembered for

- **C, L and M were all found by running the code, not reading it.** Every audit
  that reviewed these files by eye passed them.
- **A green suite bounds only the cases it contains.** 17 integration tests were
  green while two defects destroyed money, because the suite never ran two
  postings concurrently and never seeded a loan without a guarantor.
- **Two backends over one schema drift.** WO-49 was a fix applied to the Go
  allocator months earlier and never carried to the TypeScript one. Grep both.
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
