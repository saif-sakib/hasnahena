# CLAUDE.md

Interest-free (Qard al-Hasan) cooperative finance platform for Hasnahena Foundation, Jessore, Bangladesh. Members deposit savings, borrow without interest, guarantee each other's loans, and donate. Bilingual EN/BN.

## Stack (what actually exists)

| Part | Reality |
|---|---|
| `apps/web` | Next.js 14 App Router, TypeScript, Tailwind + shadcn/ui, next-intl, Prisma 5 |
| `apps/api` | Go 1.22, chi router, pgx pool, JWT — **owns all dashboard reads/writes** |
| DB | PostgreSQL (Neon in prod, Docker local). Prisma schema is the single source of truth |
| Email | Brevo, backend-only. **No SMS.** |
| Files | Cloudinary |
| Deploy | Vercel (web) + Render (api) + Neon (db) |

There is **no** Java/Spring ledger, no Redis/Valkey, no Clerk/Keycloak, no `packages/`, no `services/`. Older docs claiming otherwise are deleted — do not reintroduce them.

## Commands

```bash
pnpm dev          # api :8081 + web :3000
pnpm build        # next build
pnpm typecheck    # tsc --noEmit  (run before claiming done)
pnpm lint
pnpm db:push      # prisma db push — schema changes (no migration files)
pnpm db:clear     # wipe all but admin + gallery + system config
pnpm db:studio
```

Go API alone: `cd apps/api && go run cmd/server/main.go`. Build check: `go build ./...`.

## Non-negotiable rules

1. **Money is BigInt whole taka.** Never paisa, never float. See [ADR-002](docs/decisions.md).
2. **Financial writes go through the Go API** (`apps/api/internal/repositories/user_repository.go`), inside a DB transaction, and append an `audit_logs` row. Never mutate balances from a Next.js route handler.
3. **Zero interest, zero fees.** Any code introducing a rate, markup, or processing fee is a Shariah violation — stop and flag it.
4. **Request → Process → Confirm** is the transaction lifecycle. Workers never initiate money movement; members confirm every posting.
5. Never edit `apps/web/app/**` UI text directly for copy — strings live in `apps/web/messages/{en,bn}.json`.
6. Never commit `.env`, `.env.local`, or real credentials.

## Where things are

```
apps/web/app/[locale]/…      pages (marketing + dashboard/{member,worker,admin})
apps/web/app/api/v1/…        Next route handlers (registration, gallery, settings, disputes)
apps/web/lib/api.ts          browser → Go API client (apiGet/apiPost/apiPut/apiPatch)
apps/web/lib/server-auth.ts  JWT verify inside Next route handlers
apps/web/prisma/schema.prisma  the data model
apps/api/cmd/server/main.go  every Go route, in one file — read this first
apps/api/internal/repositories/user_repository.go  ~4.8k lines, all SQL lives here
```

## Docs map — read only what the task needs

| File | Read when |
|---|---|
| [docs/product.md](docs/product.md) | domain rules, roles, loan/withdrawal/default policy, FR-01…FR-22 |
| [docs/architecture.md](docs/architecture.md) | request flow, auth, which backend owns an endpoint, UI tokens |
| [docs/data-model.md](docs/data-model.md) | schema, invariants, `system_config` keys |
| [docs/api.md](docs/api.md) | endpoint reference, response envelope |
| [docs/setup.md](docs/setup.md) | local run, env vars |
| [docs/deployment.md](docs/deployment.md) | Vercel/Render/Neon/DNS |
| [docs/decisions.md](docs/decisions.md) | why the code contradicts an old assumption |
| [docs/tasks.md](docs/tasks.md) | what is done vs. open — **update it when you finish work** |

## Conventions

Go: explicit error wrapping (`fmt.Errorf("…: %w", err)`), never `_` an error. TS: strict, no `any`, named constants over magic numbers. SQL identifiers in this DB are camelCase and quoted (`"savingsBalance"`) because Prisma created them. Commits: `type(scope): subject`, imperative, lowercase.
