# Documentation

**Read only what the task needs.** Each file has one job; KB is the cost of opening it. `decisions.md` and `traps.md` are indexes — open the index, then one entry.

| I want to… | Read | KB |
|---|---|---|
| change something routine | [changing-things.md](changing-things.md) — blast radius, files, how to prove nothing broke | 16 |
| pick up work | [tasks.md](tasks.md) — the only board; `do T-12` | 16 |
| debug something inexplicable | [traps.md](traps.md) — every trap title, grouped by what you are touching; entries in [`traps/`](traps/) | 18 |
| know why the code contradicts me | [decisions.md](decisions.md) — 45 ADRs, one file each in [`decisions/`](decisions/) | 8 |
| know why a guard fired | [guardrails.md](guardrails.md) — the defect behind each guard | 38 |
| understand the product | [product.md](product.md) — roles, money rules, loan/default policy, FR register | 12 |
| understand the build | [architecture.md](architecture.md) — backends and ownership, auth, request flow, UI tokens | 8 |
| touch the schema | [data-model.md](data-model.md) — schema map, invariants, `system_config` keys, hand-written SQL | 13 |
| find an endpoint | [api.md](api.md) — both surfaces, envelopes | 10 |
| run it locally | [setup.md](setup.md) — environment variables, containers, troubleshooting | 12 |
| write a test | [testing.md](testing.md) — suites, where a test goes, fixture contract | 9 |
| ship a change safely | [workflow.md](workflow.md) — which database, branch → PR → merge, previews, backups | 8 |
| deploy or configure hosting | [deployment.md](deployment.md) — Vercel, Render, Neon, Cloudinary, DNS, monitoring | 18 |
| plan for growth | [scaling.md](scaling.md) — which free tier binds at which member count; 2026-09-03 typeset report in [pdf/](pdf/) | 8 |
| handle an incident | [runbook.md](runbook.md) — rollback, disputes, rotation, restore, go-live/host move (§7), cadences | 17 |
| find what was done | [changelog.md](changelog.md) — history only; `grep` it, never read whole | 147 |

**Routes:** new → product → architecture → setup. Debugging → traps first.

## Conventions

**Docs are not a scratchpad.** `changelog.md` keeps history and `traps.md` keeps lessons; everything else describes the present, so a finished item is deleted, not struck through.

- **ADR** — `decisions/adr-0NN-<slug>.md` with `# ADR-0NN — Title` and a `**Status:**` line, plus its row in `decisions.md`.
- **Trap** — a `- **Title.** body` bullet in the matching `traps/` file plus its title, verbatim, in `traps.md` (a new heading = new file + new index section). `docs-indexes.test.ts` checks both indexes.
- **Guard** — a row in [guardrails.md](guardrails.md) with the test that fires and the defect behind it.
- **Code comments** say what the code cannot: the constraint, the incident, the ADR. History and rationale longer than a few lines belong here, linked by ADR or trap.
