# Test stacks and stale processes

- **Never run `pnpm test:integration` while `pnpm test:e2e` is running.** The Go
  suites truncate every table between tests, by design, and the browser suite
  reads the same database — so the integration run empties `system_config` and
  `users` out from under a browser suite mid-flight. What that looks like is not
  "the database is empty": it looks like **four unrelated specs failing on their
  own subject matter.** `locale-content.spec.ts` reported the foundation's own
  settings value as Bengali hardcoded in a component, because the endpoint it
  strips admin data with returned `{}` and it silently became a check on
  database content. That spec now fails loudly when the settings endpoint
  answers with nothing, which is the general shape of the fix: **a fixture that
  can come back empty must say so, rather than making every assertion after it
  mean something else.**
- **`sr-only` is a 1x1 clipping box, so a clipped-text detector reports it as
  clipped text.** `matrix.spec.ts` flagged four screen-reader labels the moment
  the hero's counting figures put the first `sr-only` on a public page. The
  technique *is* the thing being detected; exempt `clip: rect(0,0,0,0)` rather
  than removing the label, which is the accessible half of the component.

- **A test stack can hand `next dev` the right `DATABASE_URL` and have Next
  overwrite it from `apps/web/.env` before any of your code runs.** `@next/env`
  re-applies the `.env` files over `process.env` when it loads, so a value
  inherited from the parent shell loses to a file on disk.
  `/proc/<pid>/environ` showed the throwaway database; the app read the
  developer's Neon dev one. The Go API obeyed, so the **API half and the web
  half of the same browser run were on two different databases** — every
  assertion about a public page was made against whatever that developer's
  database happened to contain, three `entry-path` specs failed because the row
  the test process had just seeded was in the other database, and
  `public-content.spec.ts`, which PUTs settings through a Next route, was
  **writing to it**. CI never showed any of it, because CI has no `.env`. It was
  found by noticing that a home page served by the test stack listed ten members
  and four gallery photographs from a database holding one member and none.
  The fix is a name no `.env` in this repo defines — `TEST_DATABASE_URL`, which
  the route harness already keys on — so there is nothing to override it with;
  both halves are pinned by `test/unit/test-stack-database.test.ts`, because
  either alone is silently useless. **The general form: a variable your rig
  passes in is only as authoritative as the framework lets it be. Verify what
  the app read, not what you exported.**
- **A rig that does not export the credentials it seeded makes its own specs
  look broken.** `test-stack.sh` seeded `admin@hasnahena.test` and said nothing
  about it, so `public-content.spec.ts` failed locally with "Set
  E2E_ADMIN_IDENTIFIER and E2E_ADMIN_PASSWORD" — which reads like a defective
  spec and is a rig that did not finish introducing itself. `test-stack.sh env`
  exports them now, from the same two constants the seed uses.

- **`test-stack.sh up --serve` will not replace a server that is already
  answering.** It polls `/v1/health` and moves on, so an API left running by an
  earlier session keeps serving — and a full green browser run then proves
  nothing about the code you just wrote. `down` first, or check the process start
  time against when you made your changes.
- **`next dev` hot-reloads, `go run` does not.** So the web half of a stale stack
  is usually current and the API half is usually not, which makes the symptom
  look like a frontend/backend contract bug rather than a stale binary.
- **`down` used to leave the API running and say it had not.** `go run` compiles
  to a temp binary and execs it as a **child**, so the recorded pid was the
  wrapper's and `pkill -f "cmd/server/main.go"` matched nothing either — the
  child's command line is `/tmp/go-buildNNN/b001/exe/main`. Fixed 2026-08-19: the
  script builds to `$RUNDIR/api-bin` and runs that directly, and `stop_servers`
  sweeps anything still holding either port, because a pid file only knows about
  processes this script started.

---

[← all traps](../traps.md)
