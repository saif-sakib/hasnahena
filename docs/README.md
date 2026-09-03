# Documentation

**Read only what the task needs.** Each file has one job and does not repeat
another's — checked, not asserted: there are no duplicated paragraphs anywhere in
this tree.

The **KB** column is there so you can judge what a file costs before opening it.
The three biggest are indexes: opening `decisions.md` or `traps.md` gets you a
catalogue, not the contents.

## Start here

| I want to… | Read | KB |
|---|---|---|
| **change something routine** | [changing-things.md](changing-things.md) — blast radius, files to touch, how to prove nothing broke | 32 |
| **pick up work** | [tasks.md](tasks.md) — the only board. Say `do T-12` | 22 |
| **debug something inexplicable** | [traps.md](traps.md) → the one section that matches | 14 |
| **know why the code contradicts me** | [decisions.md](decisions.md) → the one ADR | 7 |
| **add code without breaking a guard** | [CLAUDE.md](../CLAUDE.md)'s table; the reasoning is [guardrails.md](guardrails.md) | 37 |

## The indexes

Three files were split so that reading one entry costs one entry. Bare links to
the old paths still land on the index, which is the point.

| Index | Holds | Cost to read one entry |
|---|---|---|
| [decisions.md](decisions.md) | 44 ADRs in [`decisions/`](decisions/) | **7 KB index → ~2.5 KB** (was 115 KB) |
| [traps.md](traps.md) | 166 traps in 24 files in [`traps/`](traps/) | **14 KB index → ~5 KB** (was 116 KB) |
| [../CLAUDE.md](../CLAUDE.md) | 94 guards, compressed; full text in [guardrails.md](guardrails.md) | **42 KB** (was 70 KB, loaded every session) |

The traps index lists all 166 trap titles verbatim, so it alone answers "is my
problem already known?" without opening anything.

## The rest

| Document | For | KB |
|---|---|---|
| [product.md](product.md) | What the platform is: roles, money rules, loan and default policy, FR-01…23 | 16 |
| [architecture.md](architecture.md) | How it is built: the two backends and who owns what, auth, request flow, UI tokens | 12 |
| [data-model.md](data-model.md) | Prisma schema map, invariants, `system_config` keys, hand-written-SQL traps | 27 |
| [api.md](api.md) | Every endpoint on both surfaces, response envelopes | 15 |
| [setup.md](setup.md) | Run it locally, every environment variable, troubleshooting | 23 |
| [testing.md](testing.md) | Where a new test goes, the fixture contract, what is deliberately uncovered | 17 |
| [workflow.md](workflow.md) | How a change reaches production safely — which database your laptop talks to, branch → PR → merge, preview deploys | 12 |
| [deployment.md](deployment.md) | Vercel + Render + Neon + Cloudinary + DNS, backups, monitoring, containers | 46 |
| **[scaling.md](scaling.md)** | **When the free tiers actually run out** — which limit binds at which member count, the options compared, the staged plan and the bill. Typeset copy in [pdf/](pdf/) | 21 |
| [runbook.md](runbook.md) | The night something breaks — rollback, a disputed transaction, credential rotation, restore, cadences | 21 |
| [go-live.md](go-live.md) | The cutover procedure. Executed 2026-08-27; kept as the procedure to repeat for a host move | 17 |
| [changelog.md](changelog.md) | **History only.** One line per batch plus the per-defect record. Never read whole — `grep` it | 131 |

## Routes through it

- **New to the project:** [product.md](product.md) → [architecture.md](architecture.md) → [setup.md](setup.md).
- **Changing something:** [changing-things.md](changing-things.md), then [decisions.md](decisions.md) — which will tell you whether an idea was already tried and rejected.
- **Day to day:** [workflow.md](workflow.md) is the only file that says which database your laptop should be talking to, and the answer is not the one it is talking to now.
- **Running it in production:** the cutover happened on 2026-08-27. Day-to-day is [workflow.md](workflow.md); the night something breaks is [runbook.md](runbook.md); **where it goes next is [scaling.md](scaling.md)**. Monitoring has been on since 2026-09-03 — both Sentry DSNs, `METRICS_TOKEN`, UptimeRobot on `/v1/health`, nightly database *and* asset backups copied to R2.
- **Debugging:** [traps.md](traps.md) first. Most of what has gone wrong here has gone wrong before.

## Conventions

**Docs are not a scratchpad.** [changelog.md](changelog.md) is the only file that
keeps history; [traps.md](traps.md) is the only file that keeps lessons.
Everything else describes the present, so a finished item is **deleted** from it
rather than struck through.

Adding to a split index:

- **an ADR** — write `decisions/adr-0NN-<slug>.md` with an `# ADR-0NN — Title`
  heading and a `**Status:**` line, then add its row to `decisions.md`.
- **a trap** — add the bullet to the `traps/` file whose heading matches what you
  have to be touching, then add its bold lead-in to `traps.md`. A new heading
  means a new file and a new section in the index.
- **a guard** — the compressed row goes in [CLAUDE.md](../CLAUDE.md), the full
  account in [guardrails.md](guardrails.md). Both, or the pair drifts.

## What used to be here

`work-orders.md` and `production-readiness.md` were retired on 2026-08-25 — every
block in the first was closed, and the second had become a record of closed
defects. The open items became tasks in [tasks.md](tasks.md), the per-defect
record an appendix in [changelog.md](changelog.md), the monitoring switch and the
host-move plan went to [deployment.md](deployment.md), and the operational
cadences to [runbook.md](runbook.md).

On 2026-09-03 `decisions.md` and `traps.md` were split into directories and the
guardrail table's reasoning moved to [guardrails.md](guardrails.md). Nothing was
deleted; the word counts are unchanged. What changed is that reading one entry no
longer costs the whole file — together those three files were 301 KB and are now
63 KB of index.
