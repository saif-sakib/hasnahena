# Work Orders

An execution spec: exact files, exact changes, exact verification, so a session
can act without re-exploring the codebase. Prompt with just the ID — **`do
WO-57`**.

**Nothing is open.** WO-01 → WO-66 all closed; one line per batch in
[changelog.md](changelog.md). New work starts as a row in [tasks.md](tasks.md)
and becomes an order here only when it needs a spec someone can execute without
reading the codebase first.

The traps that outlived these orders moved to [traps.md](traps.md).

## Writing one

Line numbers are anchors, not guarantees — match on quoted code, not the number.
An order states: what is wrong, the files, the change, and how to prove it.

## Standing rules for executing one

- `pnpm typecheck` exits clean, zero errors.
- `pnpm lint` exits 0 with **6 warnings** — 5 pre-existing `@next/next` ones and
  1 `Compilation Skipped` on the registration form, which uses react-hook-form's
  `watch` subscription and cannot be analysed by the React Compiler. That is a
  notice, not a defect. **Do not let the count grow.**
- A regression test must be seen to **fail against the pre-fix code** before it
  is allowed to pass. A test written after the fix proves only that today's code
  passes it. When a test *cannot* be made to fail, say so in the test rather than
  letting it stand as proof.
- Money changes stay in the Go API, one transaction, with an `audit_logs` row
  (CLAUDE.md rules 1, 2, 6).
- Update [tasks.md](tasks.md) in the same commit.

## Two things closed orders left behind

Both tracked in [production-readiness.md](production-readiness.md), because
neither is a code change anyone can make today:

- **DATA-06** — no backup of the Cloudinary assets. The job can only be built
  against a real account with real credentials; [ADR-020](decisions.md) accepts
  the exposure until the first real member document exists and names that
  document as the trigger.
- **RUN-09** — a rate limiter keyed on the member rather than the address. WO-64
  put a per-member limit on the Next side of the support proxy; the Go limiter
  still sees one address for all proxied traffic. Fixing it properly needs
  verified identity in middleware — [ADR-021](decisions.md) explains why
  forwarding a header cannot do it.
