# Documentation

**Read only what the task needs.** Each file has one job and does not repeat
another's.

| Document | For |
|---|---|
| [tasks.md](tasks.md) | **Everything left to do**, numbered, ordered, with a session estimate each. Say `do T-12`. The only board — no history |
| [changing-things.md](changing-things.md) | **"I want to change ___"** — the homepage, a money rule, the schema, the host. Blast radius, files to touch, how to prove nothing broke. **Start here for routine work** |
| [traps.md](traps.md) | **Every failure that cost a session**, grouped by what you have to be touching to hit one. Skim the heading that matches your task |
| [product.md](product.md) | What the platform is: roles, money rules, loan and default policy, registration data, FR-01…23 |
| [architecture.md](architecture.md) | How it is built: the two backends and who owns what, auth, request flow, UI tokens |
| [data-model.md](data-model.md) | Prisma schema map, invariants, `system_config` keys, hand-written-SQL traps |
| [api.md](api.md) | Every endpoint on both surfaces, response envelopes |
| [setup.md](setup.md) | Run it locally, every environment variable, troubleshooting |
| [workflow.md](workflow.md) | **How a change reaches production safely** — separating the development database from the live one, branch → pull request → merge, preview deploys, and the backup layers that do and do not exist |
| [deployment.md](deployment.md) | Vercel + Render + Neon + Cloudinary + DNS, backups, **how to switch the monitoring on**, and the host-move plan |
| [decisions.md](decisions.md) | **Why the code contradicts an older assumption.** Indexed — read the one row you need |
| [testing.md](testing.md) | Where a new test goes, the fixture contract, how to run each suite, what is deliberately uncovered |
| [runbook.md](runbook.md) | **The night something breaks** — rollback, a disputed transaction, credential rotation, restore, and the steady-state cadences |
| [go-live.md](go-live.md) | **The cutover procedure**: freeze, clear, rotate, first real admin, launch day |
| [changelog.md](changelog.md) | What is already done, one line per batch, plus the per-defect record. **The only file that keeps history** |

## Routes through it

- **New to the project:** [product.md](product.md) → [architecture.md](architecture.md) → [setup.md](setup.md).
- **Picking up work:** [tasks.md](tasks.md). Every task is written so it can be executed without first re-reading the codebase to find out what was meant.
- **Changing something:** [changing-things.md](changing-things.md) for the how, then [decisions.md](decisions.md) — which will tell you whether an idea was already tried and rejected.
- **Working on it day to day:** [workflow.md](workflow.md) — it is the only file that says which database your laptop should be talking to, and the answer is not the one it is talking to now.
- **Going to production:** [tasks.md](tasks.md) Phases 0–3 first, then [go-live.md](go-live.md) for the cutover. The monitoring is **half on** — `METRICS_TOKEN` and the web app's Sentry were confirmed live on 2026-08-25; the Go API's own Sentry DSN, the GitHub secret and the UptimeRobot monitors are not ([deployment.md](deployment.md#the-monitoring-and-how-to-tell-whether-it-is-actually-on)).
- **Writing tests:** [testing.md](testing.md). The suites and CI checks that fail the build when the code grows something they do not know about are tabulated in [CLAUDE.md](../CLAUDE.md).
- **Debugging something inexplicable:** [traps.md](traps.md) first. Most of what has gone wrong here has gone wrong before.

## What used to be here

`work-orders.md` and `production-readiness.md` were retired on 2026-08-25. Every
block in the first was closed, and the second had become mostly a record of
closed defects — two files describing work that no longer needed doing, beside
two more that described the work that did. What each held is not lost: the open
items are tasks in [tasks.md](tasks.md), the per-defect record is an appendix in
[changelog.md](changelog.md), the monitoring switch and the host-move plan are in
[deployment.md](deployment.md), and the operational cadences are in
[runbook.md](runbook.md).

[CLAUDE.md](../CLAUDE.md) at the repo root is the compact entry point for AI
agents and doubles as a cheat sheet.
