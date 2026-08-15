# Local Setup

## Prerequisites

Node 20+, pnpm 8+, Go 1.22+, and either Docker or a local PostgreSQL 15+. Nothing else — no Java, no Redis.

## Run it

```bash
pnpm install                      # postinstall runs prisma generate
cp .env.example .env.local        # then fill in the values below
docker compose up -d postgres     # or point DATABASE_URL at your own instance
pnpm db:push                      # creates the schema
pnpm dev                          # web :3000 + api :8081
```

`pnpm dev` runs both apps. To run them separately:

```bash
pnpm dev:web
pnpm dev:api        # or: cd apps/api && go run cmd/server/main.go
```

Verify: `curl localhost:8081/v1/health` → `{"success":true,"data":{"status":"ok",…}}`, then open http://localhost:3000.

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
pnpm test:go     # Go unit tests. Pure arithmetic, no database, fast
pnpm test:e2e    # Playwright. Needs the stack running and a seeded local DB
```

`pnpm test:go` covers `internal/money` (installment splitting, loan caps,
default waterfall), document and member ID formatting, and token-revocation
timing. It is the suite to run after touching anything in
`apps/api/internal/money` — a failure there means money is being miscounted.

`pnpm test:e2e` skips itself unless `E2E_ADMIN_IDENTIFIER` and
`E2E_ADMIN_PASSWORD` are set, so a missing local seed is not a failure. Install
browsers once with `pnpm --filter @hasnahena/web exec playwright install chromium`.

## Database work

```bash
pnpm db:push      # apply schema.prisma  (use the DIRECT Neon URL, not -pooler)
pnpm db:studio    # browse data
pnpm db:clear     # delete everything except admin + gallery + system config
```

There are no migration files by design ([ADR-004](decisions.md)). Editing `schema.prisma` and pushing is the whole workflow.

The first admin user is not seeded. Create one with `pnpm db:studio` (role `ADMIN`, status `ACTIVE`, a bcrypt `passwordHash`) or preserve the existing one across `db:clear` runs.

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
| `relation "users" does not exist` | run `pnpm db:push` |
| Browser "Failed to fetch" | API down, or the origin is missing from `CORS_ORIGINS` |
| 401 on every dashboard call | `JWT_SECRET` differs between web and api |
| `prepared statement already exists` | Neon pooler — keep `QueryExecModeSimpleProtocol` in `main.go` |
| Prisma "could not find your schema" during install | expected in this monorepo; `prisma generate` runs from `apps/web` |
