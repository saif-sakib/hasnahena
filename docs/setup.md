# Local Setup

## Prerequisites

Node 24+, pnpm 8+, Go 1.25+ (pgx v5.10 requires it), and either Docker or a local PostgreSQL 15+. Nothing else — no Java, no Redis.

## Run it

```bash
pnpm install                      # postinstall runs prisma generate
cp .env.example .env.local        # then fill in the values below
docker compose up -d postgres     # or point DATABASE_URL at your own instance
pnpm db:migrate                   # creates the schema
pnpm db:seed                      # first admin — see "First admin" below
pnpm dev                          # web :3000 + api :8081
```

`pnpm dev` runs both apps. To run them separately:

```bash
pnpm dev:web
pnpm dev:api        # or: cd apps/api && go run cmd/server/main.go
```

Verify: `curl localhost:8081/v1/health` → `{"success":true,"data":{"status":"ok",…}}`, then open http://localhost:3000.

## Run it in containers

The pnpm workflow above is the fast one and stays the default for day-to-day
work. The container path exists for a clean-machine reproduction, for onboarding
someone without a Go or Node toolchain, and as the thing that makes a host
migration boring rather than exciting.

```bash
docker compose --env-file .env.local up --build
```

That builds three images and starts four services: Postgres, a one-shot
`migrate` container that applies migrations and seeds the first admin, then the
Go API on :8081 and the web app on :3000. The API waits for `migrate` to
*complete*, so the app never starts against a schema that is not there yet.

**`--env-file .env.local` is not optional.** Compose reads a file called `.env`
by default, and this repo does not have one at the root — the local file is
`.env.local`. Without the flag, `SEED_ADMIN_PASSWORD` arrives empty and the
`migrate` container stops with "refusing to invent an admin password", which is
the seed script doing its job. Every service in the file also has a working
default for local use, so the only variable you genuinely must supply is that
password.

Compose services connect to Postgres on the hostname `postgres`, not
`localhost` — the value in `.env.local` is overridden per service in
`docker-compose.yml` for exactly that reason, so pointing your local
`DATABASE_URL` at Neon does not make the containers talk to production.

`docker compose up -d postgres` still does only what it always did — nothing in
this file requires you to run the whole stack.

| Image | Base | On disk | Compressed |
|---|---|---|---|
| `apps/api/Dockerfile` | `gcr.io/distroless/static-debian12:nonroot` | 26.9 MB | 6.0 MB |
| `apps/web/Dockerfile` | `node:24-bookworm-slim` | 488 MB | 113.8 MB |

Both columns are real, measured from built images. `docker images` reports the
uncompressed on-disk size; what actually crosses the network on a push or pull
is the compressed figure. WO-20's "<20 MB" target is met on the wire and missed
on disk — the gap is almost entirely the 15 MB Go binary, which compresses well.

Three things about these images that are easy to get wrong:

- **Both build from the repository root**, not from `apps/*`. The pnpm lockfile
  and workspace manifest live at the root, and `--frozen-lockfile` needs them:
  `docker build -f apps/web/Dockerfile -t hasnahena-web .`
- **`NEXT_PUBLIC_*` values are build arguments, not runtime environment.** They
  are compiled into the browser bundle. Changing the API URL means rebuilding
  the web image, not restarting it.
- **The web image must stay on a glibc base.** Prisma loads a query engine
  matched to the runtime's libc; on bookworm that is
  `debian-openssl-3.0.x`, which is what the build traces in. Moving to Alpine
  needs `binaryTargets = ["linux-musl-openssl-3.0.x"]` in `schema.prisma`, or
  the container starts cleanly and then fails on the first query.

Base images are pinned by digest, not by tag, so a rebuild six months from now
produces the same image. Refresh them deliberately — roughly quarterly, or when
an advisory lands:

```bash
docker pull node:24-bookworm-slim && docker inspect --format='{{index .RepoDigests 0}}' node:24-bookworm-slim
```

Paste the new digest into the Dockerfile, rebuild, and check the app still boots.

## Environment

**Three places, and they share almost nothing.** This is the single most common
source of "it works locally but not in production".

| Where | File / store | Who reads it |
|---|---|---|
| Local dev | `.env.local` at the repo root | **both** apps — the Go loader walks up from `apps/api`, and `apps/web/.env` is a **symlink** to it |
| Go API in production | Render → Environment tab | Go API only |
| Web app in production | Vercel → Environment Variables | Next app only |

Templates, one per destination — copy the values, never the file:

- [.env.example](../.env.example) → copy to `.env.local` for local work
- [.env.render.example](../.env.render.example) → paste into Render
- [.env.vercel.example](../.env.vercel.example) → paste into Vercel

### The two that must match

Render and Vercel are isolated stores. Exactly **two** values exist in both and
must be byte-identical:

| Variable | Why a mismatch hurts |
|---|---|
| `JWT_SECRET` | The Next route handlers verify tokens the Go API signed. Mismatched, every login *succeeds* and then every following request 401s — which looks like a session bug, not a config bug |
| `DATABASE_URL` | Otherwise the two halves of the app are looking at different data |

Everything else belongs to one host only. Setting a Render variable on Vercel
does nothing, and vice versa.

### Local: one file, one symlink

`apps/web/.env` is a symlink to the root `.env.local`, so there is one file to
edit and no chance of the two drifting apart. If it goes missing — fresh clone,
or a filesystem without symlinks — recreate it:

```bash
ln -s ../../.env.local apps/web/.env
```

### Required

| Variable | Local | Render | Vercel |
|---|:--:|:--:|:--:|
| `DATABASE_URL` | ✅ | ✅ | ✅ |
| `JWT_SECRET` (min 32 chars) | ✅ | ✅ | ✅ |
| `NEXT_PUBLIC_API_URL` | ✅ | — | ✅ |
| `NEXT_PUBLIC_APP_URL` | ✅ | ✅ | ✅ |
| `CORS_ORIGINS` | ✅ | ✅ | ✅ |
| `API_PORT` | ✅ | — (Render injects `PORT`) | — |

`CORS_ORIGINS` is on **both** hosts: the Go API checks it, and so do the Next
handlers `/api/v1/gallery` and `/api/v1/settings` since the wildcard was
removed.

### Optional — all have working defaults

| Variable | Host | Effect when unset |
|---|---|---|
| `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME` | Render | email disabled — approval and reset mails silently skipped (`/v1/health` reports `emailConfigured:false`) |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Vercel | document/avatar upload fails; every other flow works |
| `NEXT_PUBLIC_SITE_URL` | Vercel | falls back to `NEXT_PUBLIC_APP_URL` for SEO metadata |
| `JWT_EXPIRY_SECONDS` | Render | 86400 |
| `DB_MAX_CONNS`, `DB_MIN_CONNS`, `DB_MAX_CONN_IDLE_TIME`, `DB_MAX_CONN_LIFETIME`, `DB_HEALTH_CHECK_PERIOD` | Render | pgx pool defaults (25/2/5m/30m/1m) |
| `LOG_LEVEL` | Render | `info`. Accepts `debug`, `info`, `warn`, `error`. The API logs JSON to stdout |
| `SERVER_READ_HEADER_TIMEOUT`, `SERVER_READ_TIMEOUT`, `SERVER_WRITE_TIMEOUT`, `SERVER_IDLE_TIMEOUT` | Render | 10s / 30s / 60s / 120s. Raise `SERVER_WRITE_TIMEOUT` if a report endpoint starts timing out; the SSE stream opts out of it already |
| `SERVER_SHUTDOWN_TIMEOUT` | Render | 30s. Must be **shorter** than Render's stop grace period (also 30s by default) or Render `SIGKILL`s mid-drain |
| `CLEANUP_INTERVAL` | Render | 1h. How often expired `token_blacklist` and `rate_limits` rows are swept. `0` disables |
| `ENABLE_HSTS` | Render | **off** locally, **on** in production (SEC-09). A browser remembers HSTS for the full `max-age` — sending it from a plain-HTTP localhost API pins `localhost` to HTTPS for two years, in every project on that machine |
| `TRUSTED_PROXIES` | Render | `0` locally, **`1` on Render**. How many reverse proxies sit in front. This picks which `X-Forwarded-For` entry the rate limiter trusts; set it to `0` in production and the limiter keys on a value the caller chooses, which makes it decorative |
| `RATE_LIMIT_REQUESTS`, `RATE_LIMIT_WINDOW` | Render | 60 per 1m per client, on mutating methods only (RUN-07). `GET`/`HEAD`/`OPTIONS`, `/v1/health`, `/v1/ready` and `/metrics` are exempt |
| `KEEP_ADMIN_EMAIL` | local | which admin `pnpm db:clear` preserves |
| `E2E_BASE_URL`, `E2E_ADMIN_IDENTIFIER`, `E2E_ADMIN_PASSWORD` | local | `pnpm test:e2e` skips every spec unless the last two are set. Seeded **local** database only — the specs move money |

### The public-URL aliases

The Go API accepts about fourteen different variable names for the public site
URL (`APP_URL`, `FRONTEND_URL`, `SITE_URL`, `WEB_URL`, `PUBLIC_URL`, …). They
are a fallback chain, not separate settings.

**Set `NEXT_PUBLIC_APP_URL` and ignore the rest.** Setting several is worse than
setting one: the resolver takes the first non-empty name in its own order, which
is not the order you would guess. With none set it falls back to
`https://www.hasnahenafoundation.com`.

The same applies to email: `BREVO_SENDER_EMAIL`, `EMAIL_SENDER` and `FROM_EMAIL`
are aliases for `EMAIL_FROM`; `SENDINBLUE_API_KEY` is an alias for
`BREVO_API_KEY`.

### Things that are not variables any more

If you see these in an old `.env`, delete them — no code reads them. They are
left over from an architecture this project does not have (see CLAUDE.md):
Clerk (`CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`), Redis
(`REDIS_URL`, `REDIS_PASSWORD`), the Java ledger (`SPRING_DATASOURCE_*`,
`LEDGER_SERVICE_*`), SMS (`SMS_*`), NID verification (`PORICHOY_*`), and a set
of settings that were never wired up (`SESSION_SECRET`, `SESSION_MAX_AGE`,
`JWT_EXPIRY`, `JWT_REFRESH_EXPIRY`, `RATE_LIMIT_*`, `FEATURE_*`, `LOG_FORMAT`,
`APP_NAME`, `DATABASE_POOL_SIZE`, `SEED_DATABASE`, `DISABLE_HTTPS_REDIRECT`,
`ENABLE_DEBUG_ENDPOINTS`).

## Tests

```bash
pnpm test:go           # Go unit tests. Pure arithmetic, no database, fast
pnpm test:integration  # Go against a real Postgres. Needs TEST_DATABASE_URL
pnpm test:e2e          # Playwright. Needs the stack running and a seeded local DB
```

### Integration tests

These are the financial-integrity tests: the money lifecycle, loan caps, the
default waterfall, withdrawal blocking, and the append-only audit trail. They
need their own database — they truncate every table between tests, so **never
point `TEST_DATABASE_URL` at a database you care about**.

```bash
docker compose up -d db
createdb hasnahena_test    # or: psql -c 'CREATE DATABASE hasnahena_test'

export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hasnahena_test
DATABASE_URL=$TEST_DATABASE_URL pnpm db:migrate
pnpm test:integration
```

The migrate step is not optional and not incidental: these tests run against
the schema that actually deploys, including the column defaults Prisma strips.
That is what makes them catch the class of bug described in
[data-model.md](data-model.md#writing-sql-by-hand--two-traps).

With `TEST_DATABASE_URL` unset the suite exits cleanly rather than failing, so
`go test ./...` stays green for anyone without a database.

`pnpm test:go` covers `internal/money` (installment splitting, loan caps,
default waterfall), document and member ID formatting, and token-revocation
timing. It is the suite to run after touching anything in
`apps/api/internal/money` — a failure there means money is being miscounted.

`pnpm test:e2e` skips itself unless `E2E_ADMIN_IDENTIFIER` and
`E2E_ADMIN_PASSWORD` are set, so a missing local seed is not a failure. Install
browsers once with `pnpm --filter @hasnahena/web exec playwright install chromium`.

## Database work

```bash
pnpm db:migrate           # apply pending migrations
pnpm db:migrate:dev       # after editing schema.prisma: generate a migration
pnpm db:migrate:status    # what is applied and what is not
pnpm db:seed              # first SUPER_ADMIN + system_config defaults
pnpm db:studio            # browse data
pnpm db:clear             # delete everything except admin + gallery + system config
```

Schema changes ship as migration files ([ADR-014](decisions.md)). `pnpm db:push`
still exists for a throwaway database, but do not point it at anything shared —
it writes schema without recording history, and the next `db:migrate` then sees
drift it cannot reconcile. A database created before migrations existed needs
`pnpm db:migrate:baseline` once; see [deployment.md](deployment.md#schema-changes).

Migrations need a direct (non-pooled) connection. `pnpm db:migrate` strips
`-pooler` from a Neon URL automatically and logs that it did; set
`DIRECT_DATABASE_URL` to be explicit.

### First admin

```bash
SEED_ADMIN_EMAIL=admin@hasnahena.local \
SEED_ADMIN_PASSWORD='choose-something-long' \
pnpm db:seed
```

Creates one `SUPER_ADMIN` and the `system_config` rows the loan rules read
(`loan.minDepositForLoan`, `loan.maxLoanMultiplier`, …). It is idempotent: run
it again and it changes nothing, and in particular it will **not** reset an
existing admin's password. It refuses to invent a password, and rejects one
under 12 characters.

Optional: `SEED_ADMIN_PHONE` (default `01700000000`), `SEED_ADMIN_NAME`.

## Checks before you call something done

```bash
pnpm typecheck
pnpm lint
cd apps/api && go build ./...
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| API exits: `JWT_SECRET must be at least 32 characters` | set a longer secret in `.env.local` |
| `port 8081 already in use` | `API_PORT=8082 pnpm dev` and update `NEXT_PUBLIC_API_URL` |
| `relation "users" does not exist` | run `pnpm db:migrate` |
| Browser "Failed to fetch" | API down, or the origin is missing from `CORS_ORIGINS` |
| 401 on every dashboard call | `JWT_SECRET` differs between web and api |
| `prepared statement already exists` | Neon pooler — keep `QueryExecModeSimpleProtocol` in `main.go` |
| `db:clear` fails with "Transaction already closed … 5000 ms" | pre-existing: it deletes everything in one interactive transaction, which exceeds Prisma's 5 s limit on a large database. Fine at real member volume; only bites on a load-test dataset |
| `migrate` hangs or fails P1002 | it reached the Neon *pooler*; set `DIRECT_DATABASE_URL` to the host without `-pooler` |
| `Following migration have not yet been applied` on an existing database | it predates migrations — run `pnpm db:migrate:baseline` once |
| Prisma "could not find your schema" during install | expected in this monorepo; `prisma generate` runs from `apps/web` |

## Which env file is which

A recurring confusion, so plainly:

| Where | What reads it | How it gets there |
|---|---|---|
| `.env.local` (repo root) | **local development only** — both apps | you edit it; it is gitignored and never deployed |
| `apps/web/.env` | same file — it is a **symlink** to `../../.env.local` | exists only because Prisma looks there |
| Render dashboard | the deployed Go API | you type them into Render → Environment |
| Vercel dashboard | the deployed web app | you type them into Vercel → Settings → Environment Variables |

**Nothing in the repo is read by Render or Vercel.** Every `.env*` file is
gitignored, so it is not in the push and not in the build. The `.env.*.example`
files are checklists for what to type into each dashboard, nothing more.

The three stores are independent: a variable added to one is missing from the
other two. `DATABASE_URL` and `JWT_SECRET` must match byte for byte across all
three, or logins fail with a valid password.

## Keeping dependencies current

Run `pnpm audit` before a release. The policy behind the numbers it prints:

**Dependabot does not track application dependencies.** It tracks GitHub
Actions and nothing else. The reasoning is in `.github/dependabot.yml`: one
month of automated npm and Go PRs produced two production incidents and zero
fixed vulnerabilities. What replaces it:

- **GitHub's Dependabot _security_ updates stay on.** That is a repository
  setting (Settings → Advanced Security), not the config file, and it only opens
  a PR when there is a real advisory.
- **CI runs `pnpm audit` on every push**, so a new advisory is a visible check
  rather than a PR in a list.
- **Routine updates are done by hand**, below.

**After merging any dependency PR, run `pnpm install` and commit the
regenerated `pnpm-lock.yaml`.** Every such PR rewrites the lockfile, and merging
two in a row leaves a lockfile that resolves neither. Vercel installs frozen and
fails with `ERR_PNPM_LOCKFILE_MISSING_DEPENDENCY`. The pre-push hook checks this
for you; `git push --no-verify` skips the check and the protection with it.

To update deliberately:

```bash
pnpm outdated              # what has moved
pnpm update --latest       # minors and patches only, by default
pnpm install               # regenerate the lockfile
pnpm typecheck && pnpm build && pnpm test:go
```

**Never take a major version this way.** A major is a migration: read its guide,
do it on a branch, and check it by hand. That is how `tailwindcss` 3→4 broke the
Vercel build — v4 moves configuration into CSS and needs a different PostCSS
plugin, which no version bump can do for you. The outstanding majors are scoped
as Batch G in [work-orders.md](work-orders.md).

**Transitive vulnerabilities are pinned in `pnpm.overrides`** in the root
`package.json`. When a dependency-of-a-dependency has an advisory and its parent
has not updated, an override forces the patched version without waiting. Check
whether an override is still needed when its parent updates; a stale one silently
holds a package back.

