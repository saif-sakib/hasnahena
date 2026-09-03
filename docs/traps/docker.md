# Docker

- **`.dockerignore` does not use git's matching rules.** Docker matches each
  pattern against the full path from the context root, so a bare `.env` covers
  only the repository root and `apps/web/.env` stayed in the context. Every
  pattern needs an explicit `**/`. This is a **secret-containment** control, not
  tidiness: a file that reaches an image layer is not removed by a later `RM`.
- **`node:*-slim` ships no OpenSSL.** Prisma cannot detect a version, warns, and
  falls back to `openssl-1.1.x` — wrong for bookworm. Install `openssl` in both
  the deps and runtime stages.
- **`@swc/helpers` is only half-traced.** Next 16 resolves it through the
  package's `exports` map at `./esm/*`; the tracer follows the CommonJS entry and
  copies `cjs/` only. The container dies at startup, before serving one request.
  Named explicitly in `outputFileTracingIncludes`.
- **`NEXT_PUBLIC_*` is baked at build time** — including for server-side route
  handlers. A value supplied at `docker run` is too late; in Docker it is a
  `--build-arg` that `-e` cannot override.
- **`docker compose --env-file` must come before the subcommand**, and Compose
  interpolates the *entire* file even for `up -d postgres` — so a `:?` default on
  an unrelated service fails a command that does not use it. Use `:-`.
- **`DATABASE_URL` is hard-coded to the `postgres` service in
  `docker-compose.yml` on purpose.** `.env.local` holds the production Neon URL;
  interpolating it would point the one-shot migrate container at production and
  run `db:seed` against real member data.
- **A Dockerfile that has never been built is a hypothesis.** Static review
  caught none of the three defects above.

**Making a page static moves its database reads into the build.** WO-73
prerendered the marketing pages; `apps/web/Dockerfile` builds with
`DATABASE_URL` pointing at a placeholder database that does not exist, on purpose
— `prisma generate` parses the URL and never connects. The next image build died
with `Export encountered an error on /[locale]/donate/page` and exit code 1. Two
of the eight pages had their own `try` and survived, which made it look like a
bug in the other six. **A page that can be prerendered must render without a
database** — [ADR-028](../decisions.md).

---

[← all traps](../traps.md)
