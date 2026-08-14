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

One `.env.local` at the repo root serves both apps — the Go config loader walks up from `apps/api` looking for `.env` / `.env.local`, and Next reads the root file too. Values already present in the real environment always win.

### Required

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | web + api | local: `postgresql://postgres:postgres@localhost:5432/hasnahena_dev` |
| `JWT_SECRET` | web + api | **min 32 chars**, identical in both — the API refuses to boot otherwise |
| `NEXT_PUBLIC_API_URL` | web | `http://localhost:8081` locally |
| `API_PORT` | api | defaults to `8081`; `PORT` also accepted |
| `CORS_ORIGINS` | api | comma-separated, no spaces |

### Optional

| Variable | Effect when unset |
|---|---|
| `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME` | email disabled — approval and reset mails silently skipped (`/v1/health` reports `emailConfigured:false`) |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | document/avatar upload fails; every other flow works |
| `JWT_EXPIRY_SECONDS` | 86400 |
| `DB_MAX_CONNS`, `DB_MIN_CONNS`, `DB_MAX_CONN_IDLE_TIME`, `DB_MAX_CONN_LIFETIME`, `DB_HEALTH_CHECK_PERIOD` | pgx pool defaults (25/2/5m/30m/1m) |

Skip Cloudinary locally unless you are testing uploads; if you do use it, use a separate dev account or a `hasnahena-dev/` folder prefix — never production credentials.

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
