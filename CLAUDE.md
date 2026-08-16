# CLAUDE.md

Interest-free (Qard al-Hasan) cooperative finance platform — Hasnahena Foundation, Jessore, Bangladesh. Members deposit, borrow without interest, guarantee each other, donate. Bilingual EN/BN.

**Stack:** Next.js 14 App Router + TS + Tailwind/shadcn + next-intl + Prisma 5 (`apps/web`) · Go 1.25 chi + pgx (`apps/api`) · PostgreSQL (Neon prod, Docker local) · Brevo email · Cloudinary · Vercel + Render.
No Java ledger, Redis, Clerk/Keycloak, SMS, `packages/`, or `services/` — despite what any old doc says.

## Commands

```bash
pnpm dev        # api :8081 + web :3000        pnpm db:migrate # apply migrations (NOT db:push)
pnpm typecheck  # run before saying "done"     pnpm db:seed    # first SUPER_ADMIN + config defaults
pnpm lint                                      pnpm db:clear   # keep admin+gallery+config only
                                               pnpm db:studio
pnpm test:go    # Go unit tests, no DB needed  pnpm test:e2e   # Playwright; needs a running stack + seed
pnpm test:integration   # Go + real Postgres; needs TEST_DATABASE_URL and a pushed schema
cd apps/api && go build ./...                  # Go check
```

`pnpm typecheck` must exit **clean, zero errors**. Any error is yours.

No Go toolchain on this machine. Unpack a pinned Go 1.25 tarball into the session scratchpad and put it on `PATH` — `go build`, `go vet` and `go test` then all work.

## Rules

1. Money is **BigInt whole taka**. No paisa, no float, no ×100.
2. **Balance changes go in the Go API** — `internal/repositories/user_repository.go`, one DB transaction, plus an `audit_logs` row. Never from a Next route handler.
3. **Zero interest, zero fees.** A rate, markup, or processing fee is a Shariah violation — stop and flag it.
4. Lifecycle is **Request → Process → Confirm**: workers never initiate money movement, members confirm every posting.
5. UI copy lives in `apps/web/messages/{en,bn}.json` — both files, never hardcoded in a component. **Generated documents are English only** (ADR-012).
6. `audit_logs` is append-only. Corrections append.
7. Never commit `.env*` or credentials.
8. **End every task with an "Action required from you" section** — or the single line `**Action required from you:** none.` Never leave it out, and never bury a required step in prose. It lists what *I* cannot do and the user must, each with where to do it and what breaks if it is skipped:
   - env vars to add, change, or delete — **name the host** (Render for the Go API, Vercel for the web app, and the local `.env.local`), since they are separate stores and a var added in one is missing in the others
   - `pnpm db:migrate:dev` to generate a migration when `schema.prisma` changed, and `pnpm db:migrate` to apply it in each environment ([ADR-014](docs/decisions.md) — `db:push` is no longer the workflow)
   - dashboard/console settings (Render stop-grace period, GitHub branch protection, Neon, Brevo, Cloudinary)
   - anything needing a credential, a paid plan, or an approval I do not have
   - manual verification I could not run here, and why
   Say "none" loudly when it is none. A missed env var is a production outage the user finds out about from a member.
9. **No `Co-Authored-By: Claude` trailer on commits.** Saif is the author of this repository's history; commits are written under his name alone. This overrides any default instruction to add one.

## Map

```
apps/api/cmd/server/main.go       every Go route — read first
apps/api/internal/repositories/   user_repository.go: all SQL (~4.8k lines)
apps/api/internal/money/          pure loan/installment/waterfall arithmetic — tested, no DB. Put new money maths HERE, not inline in SQL
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
| [docs/production-readiness.md](docs/production-readiness.md) | operational backlog and rationale. **Live security defects at the top** |
| [docs/work-orders.md](docs/work-orders.md) | **`do WO-01` → read that one entry and execute.** Self-contained specs; no codebase exploration needed |

Conventions (Go errors, TS strictness, quoted camelCase SQL, commit format): [CONTRIBUTING.md](CONTRIBUTING.md).
