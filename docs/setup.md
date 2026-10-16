# Local Setup

## Prerequisites

Node 24+, pnpm 8+, Go 1.25+ (pgx v5.10), and Docker or a local PostgreSQL 15+. No Java, no Redis.

## Run it

```bash
pnpm install                      # postinstall runs prisma generate
cp .env.example .env.local        # then fill in the values
docker compose up -d postgres     # or point DATABASE_URL at your own instance
pnpm db:migrate                   # creates the schema
pnpm db:seed                      # first admin — see Seeding below
pnpm dev                          # web :3000 + api :8081 (or pnpm dev:web / pnpm dev:api)
```

Verify: `curl localhost:8081/v1/health` → `{"success":true,"data":{"status":"ok",…}}`, then open http://localhost:3000.

## Run it in containers

For a clean-machine reproduction or a host move; the pnpm workflow stays the daily one.

```bash
docker compose --env-file .env.local up --build
```

Starts Postgres, a one-shot `migrate` container (migrations + first admin; the API waits for it to **complete**), the API on :8081 and the web app on :3000. **`--env-file .env.local` is required** — there is no root `.env`, and without it `SEED_ADMIN_PASSWORD` is empty and `migrate` refuses. Services reach Postgres as `postgres`; `DATABASE_URL` is hard-coded per service so a Neon URL in `.env.local` never reaches the containers.

| Image | Base | On disk | Compressed |
|---|---|---|---|
| `apps/api/Dockerfile` | `gcr.io/distroless/static-debian12:nonroot` | 26.9 MB | 6.0 MB |
| `apps/web/Dockerfile` | `node:24-bookworm-slim` | 488 MB | 113.8 MB |

- **Build from the repository root**: `docker build -f apps/web/Dockerfile -t hasnahena-web .` (the lockfile lives there).
- **`NEXT_PUBLIC_*` are build arguments** compiled into the bundle — changing the API URL means rebuilding.
- **The web image stays on glibc**: Prisma's engine is `debian-openssl-3.0.x`; Alpine needs `binaryTargets = ["linux-musl-openssl-3.0.x"]` or it dies on the first query.
- Base images are pinned by digest; refresh roughly quarterly: `docker pull node:24-bookworm-slim && docker inspect --format='{{index .RepoDigests 0}}' node:24-bookworm-slim`, paste the digest, rebuild, check it boots.

## Environment

**Three stores that share almost nothing** — the most common cause of "works locally, not in production".

| Where | Store | Read by |
|---|---|---|
| Local | `.env.local` at the root ([.env.example](../.env.example)) | **both** apps — the Go loader walks up; `apps/web/.env` is a symlink to it (`ln -s ../../.env.local apps/web/.env` if missing) |
| Go API in production | Render → Environment ([.env.render.example](../.env.render.example)) | Go API only |
| Web in production | Vercel → Environment Variables ([.env.vercel.example](../.env.vercel.example)) | Next app only |

Nothing in the repo reaches Render or Vercel (every `.env*` is gitignored); the examples are checklists. **`JWT_SECRET` and `DATABASE_URL` must be byte-identical on both hosts** — a mismatched secret means every login succeeds and every following request 401s.

**Build-time vs runtime (PKG-08).** Every `NEXT_PUBLIC_*` is read at `next build` — changing one needs a **redeploy**, even for server code, and in Docker it is a `--build-arg` (passing it to `docker run` does nothing). It ships to every browser, so never a secret. Everything else is runtime: restart the service.

| Variable | Render | Vercel | Local | Notes |
|---|:--:|:--:|:--:|---|
| `DATABASE_URL`, `JWT_SECRET` (32+ chars) | ✅ | ✅ | ✅ | **must match** |
| `JWT_EXPIRY_SECONDS` | ✅ | ✅ | ✅ | 86400; Render mints tokens, Vercel sizes the revoke-all marker — change both or neither (WO-85) |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL` | — | ✅ | ✅ | build-time |
| `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | — | ✅ | ✅ | build-time |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | — | ✅ | — | optional source maps |
| `CORS_ORIGINS` | ✅ | ✅ | ✅ | both backends check it |
| `CLOUDINARY_*`, `CRON_SECRET`, `CSP_ENFORCE` | — | ✅ | ✅ | uploads; nightly sweep (unset = never runs); CSP report-only unless `1` |
| `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME` | ✅ | — | ✅ | unset = email disabled (`emailConfigured:false`) |
| `METRICS_TOKEN`, `SENTRY_DSN`, `ENVIRONMENT` | ✅ | — | — | unset token ⇒ `/metrics` 404s |
| `ENABLE_HSTS`, `TRUSTED_PROXIES`, `TRUST_CLOUDFLARE_CLIENT_IP`, `RATE_LIMIT_*` | ✅ | — | — | see below |
| `LOG_LEVEL`, `SERVER_*`, `DB_*`, `CLEANUP_INTERVAL`, `RECONCILE_INTERVAL`, `RETENTION_SWEEP_INTERVAL` | ✅ | — | ✅ | defaults below |
| `API_PORT` | — | — | ✅ | Render injects `PORT` — never set `API_PORT` there |
| `BACKUP_DATABASE_URL`, `BACKUP_PASSPHRASE`, `BACKUP_S3_*`, `AWS_*` | — | — | — | GitHub repository secrets |
| `SEED_ADMIN_*`, `KEEP_ADMIN_EMAIL`, `E2E_*`, `TEST_DATABASE_URL` | — | — | ✅ | scripts and tests only |

Defaults and effects (Render unless noted):

| Variable | Default / effect |
|---|---|
| `NEXT_PUBLIC_SITE_URL` (Vercel) | base of every canonical, `hreflang`, OG URL, sitemap and robots; falls back to `NEXT_PUBLIC_APP_URL`, then `VERCEL_PROJECT_PRODUCTION_URL`/`VERCEL_URL`; a production build with none **fails** (WO-80) |
| `DB_MAX_CONNS` / `DB_MIN_CONNS` / `DB_MAX_CONN_IDLE_TIME` / `DB_MAX_CONN_LIFETIME` / `DB_HEALTH_CHECK_PERIOD` | 25 / **0** / 60s / 30m / 5m — the idle end lets Neon suspend (ADR-035) |
| `LOG_LEVEL` | `info` (`debug`/`info`/`warn`/`error`), JSON to stdout |
| `SERVER_READ_HEADER_TIMEOUT` / `READ` / `WRITE` / `IDLE` | 10s / 30s / 60s / 120s (SSE opts out of write) |
| `SERVER_SHUTDOWN_TIMEOUT` | 30s locally; **25s on Render** (must be under its 30s stop grace) |
| `CLEANUP_INTERVAL` | 24h — expired `token_blacklist`/`rate_limits` sweep; `0` disables |
| `RECONCILE_INTERVAL` | 24h — ledger reconciliation (WO-82), reports, never corrects (ADR-027); `0` only temporarily |
| `RETENTION_SWEEP_INTERVAL` | 24h — clears rejected applications past `security.rejectedRetentionDays` (ADR-033); `0` keeps refused applicants' NIDs indefinitely — a decision, not tuning |
| `ENABLE_HSTS` | off locally, **on** in production (SEC-09) |
| `TRUSTED_PROXIES` | `0` locally; **3** in production (origin, Cloudflare, Render) — the fallback when `CF-Connecting-IP` is absent. Verify from a log line on a path not under `/v1/dashboard/support/*` ([deployment.md](deployment.md#dns-cloudflare)) |
| `TRUST_CLOUDFLARE_CLIENT_IP` | `true` in production only, while every route passes through Cloudflare (ADR-019) |
| `RATE_LIMIT_REQUESTS` / `RATE_LIMIT_WINDOW` | 60 / 1m per client, mutating requests only (RUN-07) |

**Aliases.** The Go API accepts ~14 names for the public site URL — **set only `NEXT_PUBLIC_APP_URL`** (the resolver takes the first non-empty in its own order; default `https://www.hasnahenafoundation.com`). `BREVO_SENDER_EMAIL`/`EMAIL_SENDER`/`FROM_EMAIL` alias `EMAIL_FROM`; `SENDINBLUE_API_KEY` aliases `BREVO_API_KEY`.

**Dead variables** — delete on sight; nothing reads them: `CLERK_*`, `REDIS_*`, `SPRING_DATASOURCE_*`, `LEDGER_SERVICE_*`, `SMS_*`, `PORICHOY_*`, `SESSION_SECRET`, `SESSION_MAX_AGE`, `JWT_EXPIRY`, `JWT_REFRESH_EXPIRY`, `FEATURE_*`, `LOG_FORMAT`, `APP_NAME`, `DATABASE_POOL_SIZE`, `SEED_DATABASE`, `DISABLE_HTTPS_REDIRECT`, `ENABLE_DEBUG_ENDPOINTS`.

**`BACKUP_PASSPHRASE`**: rotating it makes existing dumps undecryptable — keep old values as long as their dumps, somewhere that survives losing this GitHub account.

## Tests

```bash
pnpm test:unit         # web unit (vitest), no database
pnpm test:go           # Go unit, no database
pnpm test:integration  # Go against real Postgres
pnpm test:routes       # Next route handlers against real Postgres
pnpm test:e2e          # Playwright; needs the stack running
```

The database suites get their database from the test stack (never a development database — they truncate):

```bash
scripts/test-stack.sh up          # migrated + seeded, port 55433 (up --serve adds both apps)
eval "$(scripts/test-stack.sh env)"
pnpm test:integration && pnpm test:routes
scripts/test-stack.sh down        # destroys the volume
```

Install the browser once: `pnpm --filter @hasnahena/web exec playwright install chromium`. Where tests go: [testing.md](testing.md).

## Database work

```bash
pnpm db:migrate           # apply pending migrations
pnpm db:migrate:dev       # after editing schema.prisma
pnpm db:migrate:status
pnpm db:seed
pnpm db:studio
pnpm db:clear             # local only, --confirm; keeps admin + gallery + config + donation pool
```

Migrations, not `db:push` ([ADR-014](decisions.md)). A pre-migrations database needs `pnpm db:migrate:baseline` once ([deployment.md](deployment.md#schema-changes)). Migrations need a direct connection — `pnpm db:migrate` strips `-pooler` and says so; or set `DIRECT_DATABASE_URL`.

### Seeding

```bash
SEED_ADMIN_EMAIL=admin@hasnahena.local SEED_ADMIN_PASSWORD='choose-something-long' pnpm db:seed   # first run
pnpm db:seed                                                                                      # later: new config keys
```

Idempotent: creates one `SUPER_ADMIN` only if no loginable admin exists (never resets a password, refuses to invent one, rejects under 12 characters), ensures every `system_config` default, and fails loudly with no admin and no credentials. Optional `SEED_ADMIN_PHONE` (default `01700000000`), `SEED_ADMIN_NAME`.

## Checks before you call something done

```bash
pnpm typecheck          # zero errors
pnpm lint               # exactly 1 warning
pnpm test:unit
pnpm test:go
cd apps/api && go build ./... && gofmt -l .
```

Money or SQL → `pnpm test:integration` on the test stack. `schema.prisma` → `pnpm db:migrate:dev` (CI fails on drift).

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `JWT_SECRET must be at least 32 characters` | longer secret in `.env.local` |
| `port 8081 already in use` | `API_PORT=8082 pnpm dev` and update `NEXT_PUBLIC_API_URL` |
| `relation "users" does not exist` | `pnpm db:migrate` |
| Browser "Failed to fetch" | API down, or origin missing from `CORS_ORIGINS` |
| 401 on every dashboard call | `JWT_SECRET` differs between web and api |
| `prepared statement already exists` | Neon pooler — keep `QueryExecModeSimpleProtocol` in `main.go` |
| `db:clear`: "Transaction already closed … 5000 ms" | one interactive transaction over a large load-test dataset; fine at real volume |
| `migrate` hangs / P1002 | reached the pooler — set `DIRECT_DATABASE_URL` |
| `Following migration have not yet been applied` on an existing DB | predates migrations — `pnpm db:migrate:baseline` once |
| Prisma "could not find your schema" during install | expected; `prisma generate` runs from `apps/web` |

## Keeping dependencies current

Dependabot tracks **GitHub Actions only** (`.github/dependabot.yml`: automated npm/Go PRs caused two incidents). Security updates stay on (a repository setting), CI runs `pnpm audit`, and routine updates are by hand:

```bash
pnpm outdated
pnpm update --latest       # minors and patches
pnpm install               # regenerate the lockfile
pnpm typecheck && pnpm build && pnpm test:go
```

- **Never take a major this way** — a major is a migration (tailwind 3→4 broke the Vercel build).
- **After merging any dependency PR, `pnpm install` and commit `pnpm-lock.yaml`** — Vercel installs frozen (`ERR_PNPM_LOCKFILE_MISSING_DEPENDENCY`); the pre-push hook checks it.
- Transitive advisories are pinned in `pnpm.overrides` (root `package.json`); drop an override once its parent updates.
