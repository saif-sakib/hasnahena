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
| [tasks.md](tasks.md) | What is done, what is partial, what is broken |
| [production-readiness.md](production-readiness.md) | Operational backlog: security defects, tests, CI, containers, backups, observability, and the path to a VPS/AWS — the *why* |
| [work-orders.md](work-orders.md) | The same backlog as execution specs — exact files, changes and verification. Prompt with `do WO-01` |
| [testing.md](testing.md) | **The staged plan to test the whole codebase**, measured coverage, and what each suite is for. Prompt with `do TEST-01` |

New to the project: [product.md](product.md) → [architecture.md](architecture.md) → [setup.md](setup.md).

Changing something: [changing-things.md](changing-things.md) for the how, then [decisions.md](decisions.md) — which will tell you whether an idea was already tried and rejected.

Going to production: [go-live.md](go-live.md) for the order, [tasks.md](tasks.md) for what is still broken.

Writing tests: [testing.md](testing.md). It measures where coverage actually is — the money arithmetic is at 93%, and the 86 HTTP endpoints in front of it are at **zero**.

[CLAUDE.md](../CLAUDE.md) at the repo root is the compact entry point for AI agents and doubles as a cheat sheet.
