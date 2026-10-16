# PostgreSQL clients

- **`/usr/bin/pg_dump` is not a binary.** On Debian and Ubuntu it is
  `pg_wrapper`, which resolves to the version of the **configured cluster** and
  only falls back to "newest installed" when there is no cluster. GitHub's
  `ubuntu-latest` ships a PostgreSQL 16 *server*, so installing
  `postgresql-client-18` changes nothing and `pg_dump --version` keeps answering
  16 — which is how the nightly backup failed against a 17.11 Neon server with a
  new-enough client already on disk. Resolved by absolute path in
  [scripts/lib/pg-client.sh](../../scripts/lib/pg-client.sh) and on `PATH` by
  [.github/actions/postgres-client](../../.github/actions/postgres-client). **A bare
  container with no cluster does not reproduce this** — the wrapper picks
  correctly there, which is what makes the bug look like a failed install.
- **Two parameters added together are `unknown + unknown`.** pgx's simple
  protocol renders `$2` and `$3` as untyped literals, so
  `make_interval(secs => $2 + $3)` fails at runtime with
  `operator is not unique: unknown + unknown (SQLSTATE 42725)` — and only on the
  branch that runs it, which for a rate-limit lockout is the *fifth* failed
  attempt, not the first. Cast at the call site (`$2::double precision`)
  whenever a parameter appears in arithmetic rather than as a plain value. The
  integration suite pins its connections to simple protocol, so a query that only
  works under the extended protocol fails there and nowhere else.

---

[← all traps](../traps.md)
