# Contributing

This is financial software for a real community fund. Correctness beats speed, and every rule below exists because a mistake here costs someone real money.

Set up first: [docs/setup.md](docs/setup.md). Understand the domain: [docs/product.md](docs/product.md).

## Ground rules

1. **Zero interest, zero fees.** No rate, markup, or processing charge — ever. This is the point of the project.
2. **Money is `BigInt` whole taka.** No paisa, no floats, no ×100 ([ADR-002](docs/decisions.md)).
3. **Balance changes belong in the Go API**, inside one DB transaction, with an `audit_logs` append.
4. **Never modify or delete audit history.** Corrections append new entries.
5. **Never commit secrets.** `.env` and `.env.local` are ignored; keep it that way.

## Workflow

```bash
git checkout -b feature/loan-fairness-cap     # feature/ fix/ docs/ refactor/ chore/
# …work…
pnpm typecheck && pnpm lint
cd apps/api && go build ./...
```

Branch from `main`. Keep changes focused. Update [docs/tasks.md](docs/tasks.md) in the same commit as the work, and add an entry to [docs/decisions.md](docs/decisions.md) when you overturn a documented choice.

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) — `type(scope): subject`, imperative, lowercase, no trailing period, ≤50 chars:

```
feat(loan): add fairness cap to eligibility calculation
fix(auth): reject blacklisted tokens on refresh
docs(api): document withdrawal approval endpoints
```

Types: `feat` `fix` `docs` `style` `refactor` `test` `chore`.

## Code standards

**TypeScript** — strict mode, no `any`. Explicit parameter and return types on exported functions. Named constants over magic numbers. Components PascalCase, utilities camelCase, routes kebab-case. All user-facing copy goes in `apps/web/messages/{en,bn}.json` with both languages filled in — never hardcode a string in a component.

**Go** — wrap errors with context (`fmt.Errorf("finding member: %w", err)`) and never discard one with `_`. Handlers do HTTP shape only; rules and SQL live in the repository layer. Return through `utils.Success` / `utils.Error` so the response envelope stays consistent.

**SQL** — this database was created by Prisma, so table names are snake_case and columns are camelCase and **must be quoted**: `a."savingsBalance"`. Index every foreign key you add. Wrap multi-statement financial writes in `BEGIN … COMMIT`.

## Before opening a PR

- [ ] `pnpm typecheck`, `pnpm lint`, and `go build ./...` all pass
- [ ] Financial changes are transactional and audit-logged
- [ ] New or changed endpoints documented in [docs/api.md](docs/api.md)
- [ ] Both `en.json` and `bn.json` updated for any new copy
- [ ] [docs/tasks.md](docs/tasks.md) reflects the new state
- [ ] No secrets, no debug logging of member data

Describe what changed, why, and how you tested it. For anything touching balances, say explicitly what you verified.

## Questions

Open an issue. For anything Shariah-related, raise it before writing code — the constraint is not negotiable.
