# Documentation

**Read only what the task needs.** Each file has one job and does not repeat
another's.

| Document | For |
|---|---|
| [changing-things.md](changing-things.md) | **"I want to change ___"** — the homepage, a money rule, the schema, the host. Blast radius, files to touch, how to prove nothing broke. **Start here for routine work** |
| [traps.md](traps.md) | **Every failure that cost a session**, grouped by what you have to be touching to hit one. Skim the heading that matches your task |
| [product.md](product.md) | What the platform is: roles, money rules, loan and default policy, registration data, FR-01…22 |
| [architecture.md](architecture.md) | How it is built: the two backends and who owns what, auth, request flow, UI tokens |
| [data-model.md](data-model.md) | Prisma schema map, invariants, `system_config` keys, hand-written-SQL traps |
| [api.md](api.md) | Every endpoint on both surfaces, response envelopes |
| [setup.md](setup.md) | Run it locally, every environment variable, troubleshooting |
| [deployment.md](deployment.md) | Vercel + Render + Neon + Cloudinary + DNS, backups, observability |
| [decisions.md](decisions.md) | **Why the code contradicts an older assumption.** Indexed — read the one row you need |
| [testing.md](testing.md) | Where a new test goes, the fixture contract, how to run each suite, what is deliberately uncovered |
| [tasks.md](tasks.md) | **The status board.** Open product work only — no history |
| [production-readiness.md](production-readiness.md) | Operational backlog and the *why*. The one live defect is at the top |
| [go-live.md](go-live.md) | **The order to do the remaining work in**, ranked by what gets more expensive once real member data exists |
| [work-orders.md](work-orders.md) | Execution specs — `do WO-01`. **None open** |
| [changelog.md](changelog.md) | What is already done, one line per batch. **The only file that keeps history** |

## Routes through it

- **New to the project:** [product.md](product.md) → [architecture.md](architecture.md) → [setup.md](setup.md).
- **Changing something:** [changing-things.md](changing-things.md) for the how, then [decisions.md](decisions.md) — which will tell you whether an idea was already tried and rejected.
- **Going to production:** [go-live.md](go-live.md) for the order. One thing is wrong right now and it is operational: the monitoring is built and switched off ([production-readiness.md](production-readiness.md)).
- **Writing tests:** [testing.md](testing.md). Seventeen suites and one CI check fail the build when the code grows something they do not know about — the table of what each demands is in [CLAUDE.md](../CLAUDE.md).
- **Debugging something inexplicable:** [traps.md](traps.md) first. Most of what has gone wrong here has gone wrong before.

[CLAUDE.md](../CLAUDE.md) at the repo root is the compact entry point for AI
agents and doubles as a cheat sheet.
