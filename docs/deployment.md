# Deployment

Free-tier production topology, currently live.

| Piece | Host | Address |
|---|---|---|
| Web | Vercel | hasnahenafoundation.com, www |
| API | Render | api.hasnahenafoundation.com |
| DB | Neon PostgreSQL | — |
| Files | Cloudinary | — |
| DNS | Namecheap | — |

Shared hosting (Namecheap Stellar) cannot run either app — Go and the Next.js server runtime both need a real process. Use Namecheap for DNS only, or a VPS if you ever move off Vercel/Render.

## Neon

Two connection strings, and the difference matters:

- **Direct** (host without `-pooler`) → migrations and `pg_dump` only.
- **Pooled** (host with `-pooler`) → every runtime `DATABASE_URL`.

The pooled endpoint is PgBouncer in transaction mode. It cannot hold the session-level advisory lock `prisma migrate` takes, and it drops the session `SET` statements `pg_dump` relies on — and both fail confusingly rather than obviously. `pnpm db:migrate` derives the direct host automatically and says so; set `DIRECT_DATABASE_URL` to be explicit.

```bash
DATABASE_URL='postgresql://…@ep-xxx-pooler.<region>.aws.neon.tech/hasnahena?sslmode=require' pnpm db:migrate
```

## Vercel

Root Directory **must** be `apps/web`. If build settings are not picked up from `vercel.json`:

- Install: `cd ../.. && npx --yes pnpm@8.15.4 install`
- Build: `cd ../.. && npx --yes pnpm@8.15.4 build`

Environment:

```dotenv
NEXT_PUBLIC_API_URL=https://api.hasnahenafoundation.com
JWT_SECRET=<same secret as Render>
DATABASE_URL=<pooled Neon URL>
CLOUDINARY_CLOUD_NAME=…
CLOUDINARY_API_KEY=…
CLOUDINARY_API_SECRET=…
```

No Brevo keys here — email is backend-only.

## Render

Root Directory `apps/api`, runtime Go, build `go build -o app ./cmd/server`, start `./app`.

```dotenv
API_PORT=10000
DATABASE_URL=<pooled Neon URL>
JWT_SECRET=<same secret as Vercel>
JWT_EXPIRY_SECONDS=86400
CORS_ORIGINS=https://hasnahenafoundation.com,https://www.hasnahenafoundation.com,https://<project>.vercel.app
BREVO_API_KEY=…
EMAIL_FROM=info@hasnahenafoundation.com
EMAIL_FROM_NAME=Hasnahena Foundation
NEXT_PUBLIC_APP_URL=https://www.hasnahenafoundation.com
```

Do not quote Render values — `KEY=value`, never `KEY="value"`. The `EMAIL_FROM` address must be a Brevo-verified sender. Free instances sleep, so the first request after idle is slow.

## Cloudinary

Signed uploads through a `hasnahena-docs` preset: formats `jpg,jpeg,png,pdf`, max 5 MB, unique filenames, overwrite off. Enforce the same MIME and size limits server-side — the preset is not a security boundary. Folders: `hasnahena/{members,nid,nominee,misc}`. Store both `secure_url` and `public_id` so files can be replaced or deleted later.

## DNS (Namecheap → Advanced DNS)

| Type | Host | Value |
|---|---|---|
| A | `@` | current Vercel apex IP (`216.198.79.1`) |
| CNAME | `www` | your Vercel DNS target |
| CNAME | `api` | `hasnahena-api.onrender.com` |

Remove conflicting old records, add both apex and www in Vercel, add `api.hasnahenafoundation.com` in Render, wait for SSL, then confirm `NEXT_PUBLIC_API_URL` points at the custom API domain and redeploy.

## Environment

Render and Vercel are **separate stores that share nothing automatically**. Copy
values from the templates, one per host:

| Host | Runs | Template |
|---|---|---|
| Render | Go API (`apps/api`) | [.env.render.example](../.env.render.example) |
| Vercel | Next web app (`apps/web`) | [.env.vercel.example](../.env.vercel.example) |

Only `DATABASE_URL` and `JWT_SECRET` exist on both, and they must be
byte-identical. A mismatched `JWT_SECRET` makes every login succeed and every
subsequent request 401 — it presents as a session bug, not a config bug.

Full reference, including which variables are optional: [setup.md](setup.md#environment).

## Release checklist

1. `https://hasnahenafoundation.com` loads; `www` resolves.
2. `https://api.hasnahenafoundation.com/v1/health` → `status: ok` **and** `emailConfigured: true`.
3. `https://api.hasnahenafoundation.com/v1/ready` → `status: ready`. This one pings the database — a 503 here with a 200 on `/v1/health` means the process is alive but cannot reach Postgres, so do not roll forward.
4. Login works from the deployed frontend with no CORS errors.
5. Admin dashboard renders live figures.
6. A test registration triggers its approval email.
7. Logs are arriving as JSON (`{"time":…,"level":…,"msg":"http_request",…}`). If they are plain text, `LOG_LEVEL` or the deploy is running an old build.

## Operations

Point the host's health check at `/v1/health` and its load-balancer check at `/v1/ready` — restarting a process because the database blinked makes an outage worse.

Deploys are drained, not killed: the API catches `SIGTERM`, stops accepting new connections, and gives in-flight requests up to `SERVER_SHUTDOWN_TIMEOUT` (default 30 s) to finish, so a deploy no longer lands mid money-movement. Give the platform a stop-timeout **longer** than that value, or it will `SIGKILL` during the drain and defeat the point. Render's default grace period is 30 s, so either lower `SERVER_SHUTDOWN_TIMEOUT` to ~25 s there or raise the platform's.

Rotate any secret that has ever appeared in a screenshot, chat, or commit — in Neon, Vercel, and Render together, since they are isolated stores. Keep dev and production credentials separate. Watch free-tier limits on all four services.

## Schema changes

Migrations, not `db push` — see [ADR-014](decisions.md#adr-014--prisma-migrate-supersedes-db-push).

```bash
pnpm db:migrate:dev      # local: edit schema.prisma, then generate a migration
pnpm db:migrate          # any environment: apply what is pending
pnpm db:migrate:status   # what is applied and what is not
```

`pnpm db:push` still exists for throwaway databases. Do not point it at production: it writes schema without recording history, and the next `db:migrate` then sees drift it cannot reconcile.

**A database created before migrations existed needs baselining once**, or `db:migrate` will try to `CREATE TABLE` over tables that are already there:

```bash
pnpm db:migrate:status     # expect: "1 migration have not yet been applied"
pnpm db:migrate:baseline   # records 0_init as applied, runs nothing
pnpm db:migrate:status     # expect: "Database schema is up to date!"
```

Do it on a Neon branch first if the database holds real member data.

## Backups

`.github/workflows/backup.yml` runs nightly at 19:00 UTC (01:00 Dhaka), plus monthly. Each run dumps the database with `pg_dump -Fc`, encrypts it with AES256, and keeps it as a GitHub artifact for 30 days (90 for the monthly). Set `BACKUP_S3_BUCKET` and AWS credentials to also copy it to S3/B2/R2.

Two secrets are mandatory and the job fails loudly without them: `BACKUP_DATABASE_URL` (the **direct** Neon string) and `BACKUP_PASSPHRASE`.

**Keep `BACKUP_PASSPHRASE` somewhere that survives losing this GitHub account.** It is not recoverable, and without it every backup is a file of noise.

Two things that make scheduled backups quietly stop:

- GitHub disables scheduled workflows in a repository with **60 days of no commit activity**. It emails first. Re-enable it on the Actions tab.
- Artifacts expire on the retention window above. That is the whole retention policy until the S3 copy is configured; 30 days is short if nobody looks.

Run one by hand any time from **Actions → Backup → Run workflow**.

### Restoring

`scripts/restore-check.sh` is the procedure. It is not a document that describes a restore — it performs one, and CI runs it on every push, so it cannot rot between the day it was written and the day it is needed.

```bash
# 1. Get the archive: Actions → Backup → the run → download the artifact, or
#    aws s3 cp s3://…/hasnahena-<stamp>.dump.gpg .

# 2. Create somewhere to restore into. A Neon *branch*, never the primary.
#    Locally: createdb hasnahena_restore

# 3. Restore and verify.
BACKUP_PASSPHRASE='…' scripts/restore-check.sh hasnahena-<stamp>.dump.gpg \
  postgresql://…/hasnahena_restore
```

It decrypts, drops and recreates `public`, restores, prints every table's row count, and then asserts the things a silently-corrupt restore would break: required tables present, no negative savings or loan balance, no transaction pointing at a missing account, no loan pointing at a missing borrower. It prints total savings and total loan balance — **compare those two numbers against what the application reported before the incident.** They are the check that matters.

Restoring onto a `neon.tech` host requires `ALLOW_NEON_TARGET=yes`, so a copy-pasted command cannot overwrite production by accident.

To promote a verified restore: point `DATABASE_URL` at it in Render and Vercel (both — separate stores), redeploy, and confirm the release checklist above.

### RPO and RTO

| | Value | Basis |
|---|---|---|
| **RPO** — data that can be lost | **24 hours** | One scheduled dump per day. A crash at 18:00 UTC loses everything since 19:00 the previous day. |
| **RTO** — time to serve again | **under 1 hour** | Restore is minutes; the rest is a human noticing, fetching the artifact, and redeploying. |

Measured on 2026-08-16 against a 58 MB database (20,041 users, 200,008 transactions — well beyond the real member count): dump 1 s, restore and verify 2 s on local disk. Network transfer to and from Neon dominates in practice, not the database work.

**A 24-hour RPO means a member's deposit can be lost.** That is a deliberate trade against the cost of continuous archiving, and it is only acceptable because the paper passbook is the reconciling record ([product.md](product.md)) — a lost posting can be re-entered from it. If the passbook ever stops being maintained, this number has to change. Neon's own point-in-time restore covers a shorter window on the free plan and dies with the account, so it narrows the gap but does not replace this.
