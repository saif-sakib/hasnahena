# Work Orders

Execution specs. [production-readiness.md](production-readiness.md) says *why* a
task exists; this file says *exactly what to change*, so a future session can act
without re-exploring the codebase.

## How to use this

Prompt with just the ID:

> `do WO-28`  ·  `do WO-28 and WO-29`  ·  `do batch H`

Each open order below is self-contained — files, anchors, the change, the
verification command, and the done-when test. Line numbers are anchors, not
guarantees; match on the quoted code, not the number.

Finished batches are compressed to one line each under
[Completed](#completed-wo-01--wo-26). What was *learned* doing them is in
[Traps](#traps-that-cost-a-session) — read that section before any work touching
Docker, Prisma, migrations or the build config. Every entry cost at least one
session to find.

## Batches

| Batch | Orders | Theme | State |
|---|---|---|---|
| A–G | WO-01 → WO-26 | Security, hardening, tests, CI, backups, observability, containers, stack modernisation | **Done** |
| **H** | WO-27 → WO-29 | Live defects found in the 2026-08-16 audit | **WO-29 done · WO-28 open · WO-27 part-done** |
| I | WO-30 → WO-33 | Remaining security + hardening | Open |
| J | WO-34 → WO-35 | Deployable artifacts | Open |
| K | WO-36 → WO-39 | Code health and product gaps | Open |

### Standing rules for every order

- `pnpm typecheck` must exit clean, zero errors.
- `pnpm lint` must exit 0. It currently reports **32 warnings** — 26 of them are
  the React Compiler findings WO-27 owns. Do not let that count grow.
- No Go toolchain is installed system-wide. Unpack a pinned Go 1.25 tarball into
  the session scratchpad and put it on `PATH`; `go build`, `go vet` and `go test`
  then all work, so Go orders can be verified here rather than handed back.
- Money changes stay in the Go API, one transaction, with an `audit_logs` row
  (CLAUDE.md rules 1, 2, 6).
- Update [tasks.md](tasks.md) and tick the order here in the same commit.

---

# Batch H — Live defects `[ ]`

Found by auditing the code on **2026-08-16**, not by reading the docs. Two of
these are things the docs recorded as smaller than they are.

## WO-27 · React Compiler lint cleanup `[~]` — 9 of 31 done

**Update 2026-08-16 — the premise was wrong, and it changes the order.**

**The React Compiler is not enabled.** There is no `experimental.reactCompiler`
in `next.config.js` and no `babel-plugin-react-compiler` in any manifest. These
rules report "this component would bail out of optimisation *if* you turned the
compiler on" — they are not defect reports, and fixing them changes nothing that
runs today. That reframes the work into three very different piles:

| Rule | Count | Verdict |
|---|---|---|
| `static-components` | 4 | **Real bug today. Fixed.** `StatCard` was declared inside `admin/page.tsx`'s body, so React saw a new component *type* every render and unmounted/remounted all four cards on every state change — throwing away the `transition-all` and `animate-in` animations mid-flight. Hoisted to module scope; it closes over nothing |
| `immutability` | 5 | **Zero-risk. Fixed.** A mount `useEffect` placed *above* the `const` loaders it calls. Legal (effects run after the body) but temporal-dead-zone fragile. Effects moved below their declarations in `admin/gallery`, `admin/settings` and `worker/deposits` |
| `set-state-in-effect` | 20 | **Deferred, deliberately — see below** |

**Total went 32 → 26 warnings, not 32 → 23.** Fixing the 5 `immutability`
findings *revealed* 3 new `set-state-in-effect` ones in the same three files: the
compiler bails at the first error per component, so the TDZ errors were masking
them. That is worth knowing before someone reads the count as a regression.

**Why the remaining 20 are deferred.** The dominant shape is a data-loading
`refresh()` whose synchronous prefix calls `setIsLoading(true)` on a state that
already initialises to `true` — a redundant render on mount, not a bug. The
others (`dashboard-layout:402`, `profile-editor:97`) are conditional setState
responding to a URL or prop, which is ordinary React. **None marks a behaviour
change**, and clearing them means restructuring the data-loading of 15 screens
that move members' money, with no fixtures, for no runtime benefit while the
compiler is off.

**Do them as part of enabling the React Compiler, not before it.** At that point
the rules mean something and the risk buys a real optimisation. Doing it now is
the trade this batch was structured to avoid.

**Files still reporting:** `pnpm lint` — 20 `set-state-in-effect` across 13 pages
and 2 components.

**Files:** run `pnpm lint` for the current list. The rules are
`set-state-in-effect`, `immutability` and `static-components`, configured in
[apps/web/eslint.config.mjs](../apps/web/eslint.config.mjs) with the rationale.

**Change:** work **screen by screen**, not rule by rule. Each of these files
renders or moves members' money and there are no fixtures for them, so a batch
rewrite cannot be verified. For each screen: fix, then load it against a seeded
database and drive the flow it owns.

**Watch:** `set-state-in-effect` findings are usually a `useEffect` that should
be derived state or an event handler. Deleting the effect is normally correct;
adding a guard is normally the wrong fix and hides the problem from the rule.

**Verify:** `pnpm lint` warning count drops to 6 and no rule is silenced. Manual
walk of each touched screen in both locales.

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

**Watch:** take a `git bundle --all` backup first. The rewrite is irreversible
and the last one in this repo needed exactly that safety net.

**Verify:** `git rev-list --objects --all | git cat-file --batch-check` shows no
blob over 2 MB except `apps/web/assets/brand/logo.mp4`. A fresh clone is under
15 MB. `git log --all --diff-filter=A -- 'Official Infos/*'` returns nothing.

## WO-29 · Guarantor approval is dead — a UUID check against cuid ids `[ ]`

**Why:** FR-11. **Guarantor approval cannot succeed for any loan that has ever
existed**, and guarantors are not a side feature of Qard al-Hasan lending.

✅ *Researched, and the numbers are unambiguous.*
[guarantor-approval/route.ts:18](../apps/web/app/api/v1/loans/[id]/guarantor-approval/route.ts#L18)
validates the loan id against a UUID regex. `schema.prisma` declares
`@default(cuid())` **14 times and `@default(uuid())` zero times** — so the regex
matches nothing the database can produce. Every request 400s with
"Invalid loan ID format" before it reaches the loan lookup.

This is the only place in `apps/web` using that regex, so the blast radius is one
file.

**Change:** delete the regex block at lines 18–21. It buys nothing the code below
does not already do better — `prisma.loan.findUnique` on line 30 returns `null`
for a malformed id and line 36 already answers 404. If a shape check is wanted,
match cuid (`/^c[a-z0-9]{20,30}$/`), but 404-on-lookup is the honest answer and
does not have to be revised when the id strategy next changes.

**Watch:** the WO-23 verification cited this route's "invalid vs valid id"
discrimination as evidence that `await params` worked. That evidence was sound —
it proved `id` was populated — but it was read through a regex that always
rejects real ids, which is how a fully dead endpoint looked healthy in a test
log. When this is fixed, that check no longer discriminates; use a real cuid.

**Verify:** `POST /api/v1/loans/<real cuid>/guarantor-approval` as the loan's
guarantor with `{"accepted":true}` → 200 and the loan moves
`PENDING_GUARANTOR` → `PENDING_APPROVAL`. A junk id → **404**, not 400. Then walk
the guarantor flow end to end: request a loan naming a guarantor, approve as that
guarantor, confirm it reaches admin approval. **No test covers this route** —
integration coverage stops at the Go API — so a manual pass is the only evidence.

---

# Batch I — Remaining security and hardening `[ ]`

## WO-30 · Close the registration-enumeration oracle `[ ]`

**Why:** SEC-08. `GET /api/v1/registrations?email=…`
([route.ts:74](../apps/web/app/api/v1/registrations/route.ts#L74)) answers
whether an address or phone is registered. Unauthenticated and unthrottled —
verified: the file contains **zero** rate-limiting references. For a
religious-finance cooperative in one town, that is a bulk membership-disclosure
oracle, and membership is the sensitive fact.

**Change:** it exists for the signup form's live validation, so it cannot simply
be closed. Rate-limit per IP through the existing `rate_limits` table (the login
path already uses it — copy that shape), and return a uniform response shape and
timing so the two cases are indistinguishable to a caller measuring latency.

**Verify:** 20 rapid lookups from one IP → 429. A registered and an unregistered
address return the same shape.

## WO-31 · Enable HSTS on the Go API `[ ]`

**Why:** SEC-09.
[cors.go:31](../apps/api/internal/middleware/cors.go#L31) has the header written
and **commented out**. Next sends it; the API does not.

**Change:** uncomment behind an `ENABLE_HSTS` env flag — off locally (it would
poison `localhost` in the developer's browser for two years), on in production.
Document the var in [setup.md](setup.md) and both `.env.*.example` files.

**Watch:** required before any VPS move, where you own TLS termination rather
than Render.

**Verify:** `curl -I` with the flag on shows the header; off shows none.
`go build ./...`.

## WO-32 · Global rate limiting `[ ]`

**Why:** RUN-07. Login is throttled; **nothing else is**. Confirmed: `main.go`
references rate limiting only in the cleanup sweep.

**Change:** per-IP limits on all mutating routes via the existing `rate_limits`
table, as chi middleware on the `/v1` router. Money-moving routes should be
tighter than the rest.

**Verify:** a loop against a POST route hits 429. Confirm the SSE stream is
exempt — it is one long-lived connection, not many requests.

## WO-33 · Make `audit_logs` append-only in the database `[ ]`

**Why:** DATA-08. CLAUDE.md rule 6 is enforced by **convention**. Confirmed: no
trigger exists in any migration. The integration tests prove the application
appends; nothing stops an `UPDATE` from a console.

**Change:** a `BEFORE UPDATE OR DELETE ON audit_logs` trigger that
`RAISE EXCEPTION`s, shipped as a Prisma migration. Prisma does not model
triggers, so this is hand-written SQL in a `migrate dev --create-only`
migration — the schema file cannot express it and will not drift because of it.

**Watch:** `prisma migrate diff` will not see the trigger. Say so in a comment in
the migration, or a later `--from-empty` baseline silently drops it.

**Verify:** `UPDATE audit_logs SET action='x' WHERE id=…` raises. The append path
and `pnpm test:integration` still pass. `scripts/restore-check.sh` must still
succeed — confirm the trigger survives a `pg_restore`, and that it does not block
the restore itself.

---

# Batch J — Deployable artifacts `[ ]`

## WO-34 · Build and push images in CI `[ ]`

**Why:** PKG-06. The Dockerfiles exist and are proven to run, but nothing builds
them on a commit. **A deployable artifact per commit is what turns a rollback
into one command** — and it is the prerequisite for the host move.

**Change:** a workflow building both images on push to `main`, pushed to GHCR
tagged with the commit SHA and `latest`. Use `docker/build-push-action` with
layer caching; the web image is ~2 minutes cold.

**Watch:** the web build needs `NEXT_PUBLIC_*` build args — they are baked into
the client bundle, so a wrong value cannot be corrected at `docker run` (see
[Traps](#traps-that-cost-a-session)). Pass the production URLs.

**Verify:** `docker pull ghcr.io/…@<sha>` and run it; `/v1/ready` and `/en`
answer. Confirm no `.env` in any layer:
`docker history --no-trunc` and `docker run --rm --entrypoint ls <image> -la`.

## WO-35 · Document the env-var contract `[ ]`

**Why:** PKG-08. `.env.example` lists names. It does not say which are
**build-time** (baked, `NEXT_PUBLIC_*`) versus runtime, which host owns each
(Render / Vercel / local), or which must match across hosts.

**Change:** one table in [setup.md](setup.md). `JWT_SECRET` gets a loud row — it
must be **identical** in Render and Vercel or every session breaks, and that is
the single most expensive misconfiguration available here.

---

# Batch K — Code health and product gaps `[ ]`

| ID | Task | Notes |
|---|---|---|
| WO-36 `[ ]` | Web unit tests (CI-04) | Vitest over `lib/documents/*`, `lib/validation/*`, `lib/document-numbers.ts`. Confirmed absent — no vitest in any manifest. These are pure functions with no DB; the cheapest coverage left |
| WO-37 `[ ]` | `golangci-lint` in CI (CI-06) | No config exists. `go vet` alone missed the unused `ValidateToken` and `MaxRequestBodySize` that hid SEC-01 and SEC-07 for months |
| WO-38 `[ ]` | Split `user_repository.go` (RUN-09) | 4.9 k lines, 55% of the Go codebase in one file. Split by domain: members, deposits, loans, reports, support. Do it **after** Batch H — it will conflict with everything |
| WO-39 `[ ]` | Settings key allow-list | `/api/v1/settings` `PUT` upserts **any** key it receives (verified: no allow-list in the file). A typo creates dead config that looks real in the admin UI. Validate against the known `system_config` keys in [data-model.md](data-model.md) |

**Also open, specced in [production-readiness.md](production-readiness.md) rather
than here** — they are policy decisions before they are code: DATA-06 (Cloudinary
asset backup — **the largest remaining data gap**, the nightly dump covers the
database and nothing else), DATA-07 (retention and erasure policy), OBS-05 (log
aggregation), OBS-07 (dashboard), OBS-08 (audit viewer UI, FR-22), OPS-07
(reconciliation job), OPS-08 (48-hour unconfirmed sweep), and the FR gaps in
[tasks.md](tasks.md).

---

# Completed: WO-01 → WO-26

Full narratives lived here until 2026-08-16 and were compressed once every order
was verified. The durable parts are in [Traps](#traps-that-cost-a-session);
decisions are in [decisions.md](decisions.md); *why* each existed is in
[production-readiness.md](production-readiness.md) under its SEC/RUN/CI/DATA/
OBS/PKG id.

| Batch | Orders | Outcome |
|---|---|---|
| **A** Security | WO-01 → WO-05 | SEC-01→05, SEC-07 closed. Token revocation actually revokes; `/v1/dashboard/admin` gated at the router so a new handler is protected by where it is mounted; gallery writes admin-only; one origin-checked CORS helper; `?access_token=` replaced by 60 s single-purpose SSE tickets; request bodies bounded at 1 MB |
| **B** Hardening | WO-06 → WO-09 | RUN-01→06. Real `http.Server` timeouts, drained `SIGTERM` shutdown, `/v1/ready` against the pool, hourly cleanup sweeps, `log/slog` JSON with member emails replaced by user IDs |
| **C** Tests + CI | WO-10 → WO-13 | CI-01/02/03/05/07/08. `internal/money` extracted and table-tested, 17 integration tests on real Postgres, GitHub Actions, gitleaks, Dependabot. **Found: no money method wrote an `audit_logs` row, and the donation-pool waterfall leg was broken two ways** |
| **D** Data safety | WO-14 → WO-16 | DATA-01→05. Encrypted nightly `pg_dump`, a restore *script* rather than a procedure, drilled on every push. `db push` retired for migrations (ADR-014), `pnpm db:seed` |
| **E** Observability | WO-17 → WO-19 | OBS-01→04, OBS-06, RUN-08. Token-gated `/metrics` with business gauges, Sentry both apps, alerting split across UptimeRobot/Sentry/Actions on cost grounds |
| **F** Containers | WO-20 → WO-22 | PKG-01→05, 07. API image 26.9 MB (6.0 MB compressed), web 488 MB (113.8 MB). Verified by **running** them — three defects survived static review, all in [Traps](#traps-that-cost-a-session) |
| **G** Stack | WO-23 → WO-26 | Next 14 → 16.3.1, React 18 → 19.2.8, next-intl 3 → 4.13.6, ESLint 8 → 9, Tailwind 3 → 4.3.3, `middleware.ts` → `proxy.ts`. **`pnpm audit` 41 → 0.** WO-25 had to run before WO-24 — next-intl 3's peers end at Next ^15, so the documented order was backwards |

**Batch G is on branch `wo-23-next15-react19` and is not merged.** What was never
verified: **how any of it looks**, and the authenticated dashboards. The seed has
one SUPER_ADMIN and no member, worker, loan or transaction fixtures, so those
screens were only reachable as far as their role gates. Tailwind 4 also changes
defaults this codebase never names — border colour becomes `currentColor` instead
of `gray-200`, ring width 3px → 1px. Walk the dashboards on the Vercel preview,
both locales, before merging.

---

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

# Recommended order

**Superseded by [go-live.md](go-live.md).** The platform is deployed and holding
fake data, so the question is no longer "what is most urgent" but **"what gets
more expensive once real member data exists"** — a different ordering. Read that
file first.

The short version:

1. **WO-28** — purge git history. Cheap while one person is affected.
2. **Settle the data model** — the legacy `LoanStatus` values, donation fund
   types (FR-15/16), the `audit_logs` trigger ([WO-33](#)), the withdrawal notice
   period (FR-08). Each is a migration today and a migration *plus a backfill*
   after launch.
3. **WO-39, WO-30, WO-31** — settings allow-list, enumeration, HSTS. All small,
   all about members, so they should exist before there are any.
4. **Prove the restore** against the real host while the data is still
   disposable.
5. Then cut over — see [go-live.md](go-live.md) Stage 2.

Done since this list was written: **WO-29** (guarantor approval, verified end to
end) and **Batch G is merged to `main`**.
