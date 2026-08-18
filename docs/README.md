# Documentation

| Document | Contents |
|---|---|
| [changing-things.md](changing-things.md) | **"I want to change ___"** — the homepage, a money rule, the schema, the host. Blast radius, files to touch, how to prove nothing broke. Start here for routine work |
| [product.md](product.md) | What the platform is: roles, money rules, loan and default policy, registration data, FR-01…FR-22 |
| [architecture.md](architecture.md) | How it is built: the two backends and who owns what, auth, request flow, UI tokens |
| [data-model.md](data-model.md) | Prisma schema map, invariants, `system_config` keys |
| [api.md](api.md) | Every endpoint on both surfaces, response envelopes |
| [setup.md](setup.md) | Run it locally, environment variables, troubleshooting |
| [deployment.md](deployment.md) | Vercel + Render + Neon + Cloudinary + DNS |
| [decisions.md](decisions.md) | Why the code contradicts an older assumption |
| [tasks.md](tasks.md) | **The status board.** What is partial, what is broken, and what the test suites do not cover. Holds no history — see the changelog |
| [production-readiness.md](production-readiness.md) | Operational backlog and the *why*: the open security defect, the monitoring that is built and switched off, and the path to a VPS/AWS. Completed phases are compressed to one line each |
| [work-orders.md](work-orders.md) | **Open** orders as execution specs — exact files, changes and verification. Prompt with `do WO-51`. Nine are open. Also holds the traps that each cost a session to find |
| [testing.md](testing.md) | The testing guide: where a new test goes, the fixture contract, how to run each suite, what all eight phases found — and **Phase 9, the surfaces they still do not reach** |
| [changelog.md](changelog.md) | What is already done, one line per batch — WO-01 → WO-50 and TEST-01 → TEST-43. **The only file that keeps history** |

New to the project: [product.md](product.md) → [architecture.md](architecture.md) → [setup.md](setup.md).

Changing something: [changing-things.md](changing-things.md) for the how, then [decisions.md](decisions.md) — which will tell you whether an idea was already tried and rejected.

Going to production: [go-live.md](go-live.md) for the order, [tasks.md](tasks.md) for what is still broken. Two things are wrong right now and they are different in kind — member records in git history, and monitoring that is built and switched off. Both are stated in [production-readiness.md](production-readiness.md).

Writing tests: [testing.md](testing.md) — start at **Working in the suites**, which says where a new test goes and what the fixtures guarantee. Four suites fail the build when the code grows a route, a balance writer or a requirement they do not know about; that is deliberate, and CLAUDE.md lists them.

[CLAUDE.md](../CLAUDE.md) at the repo root is the compact entry point for AI agents and doubles as a cheat sheet.
