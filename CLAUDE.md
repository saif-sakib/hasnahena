# CLAUDE.md

Interest-free (Qard al-Hasan) cooperative finance platform — Hasnahena Foundation, Jessore, Bangladesh. Members deposit, borrow without interest, guarantee each other, donate. Bilingual EN/BN.

**Stack:** Next.js 14 App Router + TS + Tailwind/shadcn + next-intl + Prisma 5 (`apps/web`) · Go 1.22 chi + pgx (`apps/api`) · PostgreSQL (Neon prod, Docker local) · Brevo email · Cloudinary · Vercel + Render.
No Java ledger, Redis, Clerk/Keycloak, SMS, `packages/`, or `services/` — despite what any old doc says.

## Commands

```bash
pnpm dev        # api :8081 + web :3000        pnpm db:push    # apply schema.prisma
pnpm typecheck  # run before saying "done"     pnpm db:clear   # keep admin+gallery+config only
pnpm lint                                      pnpm db:studio
cd apps/api && go build ./...                  # Go check
```

`pnpm typecheck` reports 2 pre-existing errors in `e2e/admin-dashboard.spec.ts` (Playwright not installed). Anything else is yours.

## Rules

1. Money is **BigInt whole taka**. No paisa, no float, no ×100.
2. **Balance changes go in the Go API** — `internal/repositories/user_repository.go`, one DB transaction, plus an `audit_logs` row. Never from a Next route handler.
3. **Zero interest, zero fees.** A rate, markup, or processing fee is a Shariah violation — stop and flag it.
4. Lifecycle is **Request → Process → Confirm**: workers never initiate money movement, members confirm every posting.
5. UI copy lives in `apps/web/messages/{en,bn}.json` — both files, never hardcoded in a component. **Generated documents are English only** (ADR-012).
6. `audit_logs` is append-only. Corrections append.
7. Never commit `.env*` or credentials.

## Map

```
apps/api/cmd/server/main.go       every Go route — read first
apps/api/internal/repositories/   user_repository.go: all SQL + calculations (~4.8k lines)
apps/web/app/[locale]/            pages: (marketing) (auth) dashboard/{member,worker,admin}
apps/web/app/api/v1/              Next handlers: registration, gallery, settings, confirm/dispute
apps/web/lib/api.ts               browser → Go client (apiGet/apiPost/apiPut/apiPatch)
apps/web/lib/server-auth.ts       JWT verify in Next handlers (same JWT_SECRET as Go)
apps/web/lib/documents/           statement, receipt, loan, certificate — English only, vector PDF
apps/web/prisma/schema.prisma     the data model
apps/web/public/images/logo/      logo.png lockup · -mark square · -og social · -print PDF
```

## Docs — read only what the task needs

| File | For |
|---|---|
| [docs/product.md](docs/product.md) | domain rules, roles, loan/withdrawal/default policy, FR-01…22 |
| [docs/architecture.md](docs/architecture.md) | request flow, auth, which backend owns an endpoint, UI tokens |
| [docs/data-model.md](docs/data-model.md) | schema, invariants, `system_config` keys |
| [docs/api.md](docs/api.md) | endpoint reference |
| [docs/setup.md](docs/setup.md) · [deployment.md](docs/deployment.md) | env vars, hosting |
| [docs/decisions.md](docs/decisions.md) | why the code contradicts an old assumption — check before "fixing" one |
| [docs/tasks.md](docs/tasks.md) | done vs. open — **update when you finish work** |

Conventions (Go errors, TS strictness, quoted camelCase SQL, commit format): [CONTRIBUTING.md](CONTRIBUTING.md).
