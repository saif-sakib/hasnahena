# Deployment

Free-tier production topology, live.

| Piece | Host | Address |
|---|---|---|
| Web | Vercel | hasnahenafoundation.com, www |
| API | Render | api.hasnahenafoundation.com |
| DB | Neon PostgreSQL (`ap-southeast-1`) | — |
| Files | Cloudinary | — |
| DNS | **Cloudflare** (registrar: Namecheap) | proxied — apex, `www` and `api` |

Shared hosting cannot run either app (both need a real process); Namecheap is registrar only.

## Neon

- **Direct** host (no `-pooler`) → migrations and `pg_dump` only.
- **Pooled** host (`-pooler`, PgBouncer transaction mode) → every runtime `DATABASE_URL`.

The pooler cannot hold `prisma migrate`'s session advisory lock or `pg_dump`'s session `SET`s, and both fail confusingly. `pnpm db:migrate` derives the direct host and says so; set `DIRECT_DATABASE_URL` to be explicit.

```bash
DATABASE_URL='postgresql://…@ep-xxx-pooler.<region>.aws.neon.tech/hasnahena?sslmode=require' pnpm db:migrate
```

## Vercel

Root Directory **must** be `apps/web`. If `vercel.json` build settings are not picked up: install `cd ../.. && npx --yes pnpm@8.15.4 install`, build `cd ../.. && npx --yes pnpm@8.15.4 build`. Variables: [.env.vercel.example](../.env.vercel.example). No Brevo keys (email is Go-only); Cloudinary keys are Vercel-only (the Go API has no Cloudinary code).

**Functions run in `sin1`, beside Neon** (`apps/web/vercel.json` `"regions"`). Vercel's default `iad1` made every Prisma query cross the Pacific (~220 ms each). Only dynamic routes pay this; the marketing pages are prerendered at the edge. Change the region **with** the database, never alone. Region selection needs a paid plan — if a deploy warns it was ignored, it silently reverts to `iad1`; the deployment's Functions tab names the region used.

**`CRON_SECRET` and the nightly retention sweep.** `vercel.json` declares one cron: `GET /api/v1/admin/retention` at 19:00 UTC (01:00 Dhaka); Vercel attaches `Authorization: Bearer $CRON_SECRET` itself. **Unset, the sweep never runs and nothing says so** — the route accepts nobody without it, by design. Nightly it deletes refused applicants' ID photos the approvals screen missed and expires audit rows past their tier (ADR-038), reporting counts (zeroes on a quiet night). One database wake per day is the ADR-035 budget — do not add a second cron without counting it.

**`CSP_ENFORCE`** stays unset (report-only) until `pnpm test:e2e`, including `e2e/csp.spec.ts`, reports zero violations against the deployed build ([ADR-024](decisions.md)).

## Render

Root Directory `apps/api`, runtime Go, build `go build -o app ./cmd/server`, start `./app`. Variables: [.env.render.example](../.env.render.example). Never set `API_PORT` (Render injects `PORT`). Never quote values (`KEY=value`). `EMAIL_FROM` must be a Brevo-verified sender. Free instances sleep — the first request after idle is slow.

## Cloudinary

Uploads are server-side (Next route handlers and server actions), compressed in the browser first (`IMAGE_PRESETS`) and validated server-side again. Assets live under `hasnahena/`: `people/<accountNo>/` (avatar and filed documents), `applications/<APP-number>/` (documents before admission), `gallery/`, `settings/`. The account is in **dynamic folder mode** — move assets with `moveAsset`, which also sets `asset_folder` ([ADR-040](decisions.md)).

## DNS (Cloudflare)

Nameservers `suzanne`/`venkat.ns.cloudflare.com`; all three hostnames proxied (verified 2026-09-03).

| Type | Host | Points at | Proxied |
|---|---|---|---|
| A/CNAME | `@` | Vercel | ✅ |
| CNAME | `www` | Vercel | ✅ |
| CNAME | `api` | `hasnahena-api.onrender.com` | ✅ |
| MX | `@` | `route1-3.mx.cloudflare.net` (Email Routing) | — |

Consequences: Cloudflare's TLS/WAF/bot settings reach the API too (so Bot Fight Mode stays off — it would challenge the uptime monitor and Vercel's server-to-server calls); minimum TLS is 1.2; and there is an extra proxy hop in front of the API.

**Client addresses** (ADR-019, ADR-021). `TRUST_CLOUDFLARE_CLIENT_IP=true` makes `ClientIP` prefer `CF-Connecting-IP` (set by Cloudflare, caller copies stripped; parsed, not trusted for presence). Keep it on **only** while every route to the process passes through this zone. `TRUSTED_PROXIES=3` is the fallback: `X-Forwarded-For` arrives as origin, Cloudflare, Render, so `parts[len-3]` is the caller — verified 2026-09-03 (a direct request resolved to a Bangladeshi ISP; support requests resolve to Vercel `sin1`, as ADR-021 expects). Counting from the right is what makes caller-prepended entries harmless. Both wrong directions are silent: too low and every member behind one edge shares a rate-limit bucket and lockout; too high and forged entries are believed. Verify on a path **not** under `/v1/dashboard/support/*`.

**Email authentication** — all three aligned (2026-09-03): DKIM `brevo1`/`brevo2._domainkey` → Brevo; DMARC `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com`; SPF `v=spf1 include:spf.brevo.com include:_spf.mx.cloudflare.net ~all` — **one** SPF record, never two. Remaining: read a few weeks of DMARC reports, then move to `p=quarantine` (never before reading them).

**Use the custom API hostname** everywhere (`NEXT_PUBLIC_API_URL`, uptime checks, the monitor, `/metrics`). `hasnahena-api.onrender.com` is the same service but dies with the Render service, is not behind your Cloudflare, and bypasses any WAF/rate rule there. Use it only to tell a DNS/Cloudflare fault from an app fault. If origin bypass ever matters, the fix is in the app: reject a `Host` other than the custom domain.

New hostnames: remove conflicting records, add apex and www in Vercel and `api.` in Render, wait for SSL, confirm `NEXT_PUBLIC_API_URL`, redeploy.

## Environment

Render and Vercel are **separate stores**; only `DATABASE_URL` and `JWT_SECRET` exist on both, byte-identical (a mismatched `JWT_SECRET` = every login succeeds, then every request 401s). `JWT_EXPIRY_SECONDS` must match too if changed. Templates: [.env.render.example](../.env.render.example), [.env.vercel.example](../.env.vercel.example); full reference [setup.md](setup.md#environment).

## Release checklist

1. `https://hasnahenafoundation.com` loads; `www` resolves.
2. `/v1/health` → `status: ok` **and** `emailConfigured: true`.
3. `/v1/ready` → `status: ready` (pings the DB; 503 here with 200 on health = cannot reach Postgres — do not roll forward).
4. Login works from the deployed frontend, no CORS errors.
5. The admin dashboard renders live figures.
6. A test registration triggers its email.
7. Logs arrive as JSON (`{"time":…,"level":…,"msg":"http_request",…}`); plain text means an old build or wrong `LOG_LEVEL`.

## Operations

Host health check → `/v1/health`; load-balancer check → `/v1/ready`. Deploys are drained: on `SIGTERM` in-flight requests get `SERVER_SHUTDOWN_TIMEOUT` to finish — keep it **below** the platform's stop grace (Render 30 s → 25 s). Rotate any secret that ever appeared in a screenshot, chat or commit, in every store that holds it ([runbook.md §3](runbook.md)).

## Container images

Nothing in production uses them yet (Vercel and Render build from source); they make a host move a configuration change. Run them: [setup.md](setup.md#run-it-in-containers).

| File | Produces | Base |
|---|---|---|
| `apps/api/Dockerfile` | Go API — 26.9 MB, 6.0 MB compressed | `gcr.io/distroless/static-debian12:nonroot` |
| `apps/web/Dockerfile` | Next standalone — 488 MB, 113.8 MB compressed | `node:24-bookworm-slim` |
| `docker-compose.yml` | Postgres + migrate + api + web | — |

`.dockerignore` is a **secret control**: Next's tracer was seen copying `.env.local` and the `apps/web/.env` symlink into the standalone output (an image layer keeps them forever) — never weaken its env rules. `output: 'standalone'` is gated on `DOCKER_BUILD=1`. `images.yml` publishes both images to GHCR by SHA on tags, manual runs and a monthly cron.

## Schema changes

Migrations, not `db push` ([ADR-014](decisions/adr-014-prisma-migrate-supersedes-db-push.md)): `pnpm db:migrate:dev` (create), `pnpm db:migrate` (apply), `pnpm db:migrate:status`. `db:push` is for throwaway databases only — on production it writes schema without history and the next migrate sees unreconcilable drift. A pre-migrations database needs `pnpm db:migrate:baseline` once (records `0_init`, runs nothing; do it on a Neon branch first).

**A migration that drops a column has no overlap window** (old code selects it; new code omits a NOT NULL column). In one sitting, outside office hours: (1) run the Backup workflow by hand and wait for it to finish (the archive lands in R2); (2) rehearse on a Neon branch — `pnpm db:migrate` then `pnpm db:migrate:check`; (3) migrate production **first**, then deploy both apps (reads failing on staff screens beats a member's deposit failing); (4) `pnpm db:migrate:check` against production must say *No difference detected*.

## Backups

`.github/workflows/backup.yml`, nightly 19:00 UTC (01:00 Dhaka) plus monthly. Mandatory secrets (the job fails loudly without them): `BACKUP_DATABASE_URL` (**direct** string), `BACKUP_PASSPHRASE` and `BACKUP_S3_BUCKET` with its `AWS_*` credentials — keep the passphrase somewhere that survives losing this GitHub account; without it every backup is noise.

- **Database**: `pg_dump -Fc`, AES256-encrypted, to the bucket's `database/`.
- **Assets** (`assets` job, `cloudinary-backup.mjs`): every asset under `hasnahena/` downloaded, verified against Cloudinary's byte length, one encrypted archive `hasnahena-assets-<stamp>.tar.gz.gpg` (`files/` mirroring public ids + `manifest.json`), to the bucket's `assets/`. Needs the three `CLOUDINARY_*` repository secrets and fails, never skips, without them. Read-only by construction; no SDK, so recovery needs only node. Restore: `gpg --decrypt … > assets.tar.gz && tar -xzf assets.tar.gz`; re-uploading is a manual `uploader.upload` per file with the manifest's `public_id`.
- Silent stoppers: GitHub disables schedules after **60 days without a commit** (it emails first).
- By hand: Actions → Backup → Run workflow, or `pnpm db:backup` / `pnpm backup:assets` locally (both need `BACKUP_PASSPHRASE`; the database one takes the direct URL as `DIRECT_DATABASE_URL` or `BACKUP_DATABASE_URL`).

**The bucket (live since 2026-09-03, Cloudflare R2) is the only copy.** Nothing is kept as a workflow artifact: the repository is public, and a public repository's artifacts are downloadable by any signed-in GitHub user. Any S3-compatible bucket works — secrets only, no code. Setup: one private bucket near Dhaka; a token scoped to that bucket (read+write); secrets `BACKUP_S3_BUCKET` (`s3://hasnahena-backups`), `BACKUP_S3_ENDPOINT` (R2 `https://<account-id>.r2.cloudflarestorage.com`, B2 `https://s3.<region>.backblazeb2.com`), `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION` (**`auto`** on R2 — required). Lifecycle rules: `database/` 365 days (~63 KB/night), `assets/` 60 days (~4.8 MB/night and growing with membership — this rule is what keeps the 10 GB free tier safe). R2 egress is free and the archives are encrypted before upload, so the provider only holds ciphertext.

**Actions minutes.** GitHub Free's 2,000 minutes have a **$0 spending limit**: running out stops Actions, the nightly backup included, with no failure to report ([trap](traps/a-safety-job-that-spends-the-budget-the-safety-job-needs.md)). In place: `images.yml` tags/monthly, the restore drill gated on its inputs, CI only on PRs and `main` ([workflow.md](workflow.md) §2). Check Settings → Billing → Usage monthly; if minutes run out, first check last night's backup ran.

**PostgreSQL client version.** `pg_dump` refuses a newer server, and Neon upgrades on its own schedule. On Ubuntu runners `/usr/bin/pg_dump` is `pg_wrapper`, pinned to the image's PG16 cluster, so installing a newer client changes nothing. Handled twice: [`.github/actions/postgres-client`](../.github/actions/postgres-client) (newest PGDG client first on `PATH`) and [`scripts/lib/pg-client.sh`](../scripts/lib/pg-client.sh) (newest binaries by absolute path; `backup.sh` refuses an older client, naming the package). Override with `PG_DUMP`/`PG_RESTORE`/`PSQL`. When Neon moves to a major PGDG lacks, raise the loop in the action.

### Restoring

`scripts/restore-check.sh` performs the restore (CI runs it, so it cannot rot):

```bash
# 1. Archive: aws s3 cp s3://…/hasnahena-<stamp>.dump.gpg .
# 2. Target: a Neon *branch*, never the primary (locally: createdb hasnahena_restore)
BACKUP_PASSPHRASE='…' scripts/restore-check.sh hasnahena-<stamp>.dump.gpg postgresql://…/hasnahena_restore
```

It decrypts, recreates `public`, restores, prints row counts, and asserts required tables, no negative balances, no orphaned transactions or loans. **Compare the printed total savings and loan balance against what the application reported before the incident.** A `neon.tech` target needs `ALLOW_NEON_TARGET=yes`. To promote: point `DATABASE_URL` at it on Render **and** Vercel, redeploy, run the release checklist.

**RPO 24 h, RTO under 1 h.** One dump a day; restore takes minutes (58 MB / 200k transactions: dump 1 s, restore + verify 2 s). A 24-hour RPO can lose a deposit — acceptable only because the paper passbook is the reconciling record ([product.md](product.md)); if the passbook lapses, this must change.

## Observability

All free tier, all on since 2026-09-03.

| Question | Answered by |
|---|---|
| Is the API up? | UptimeRobot on **`/v1/health`**, 1 minute (+ the site, 5 minutes) |
| Can it reach the database? | Sentry on the first real request; optionally a half-hourly `/v1/ready` check |
| Did something throw? | Sentry, both apps |
| Is a member waiting on money? | `/metrics` + the Monitor workflow |

**The uptime check uses `/v1/health`, never a frequent `/v1/ready`** — `/v1/ready` pings the pool, and a minutely check pins a scale-to-zero database awake (~182 compute-hours/month against 100, ADR-035). `/v1/health` touches nothing and keeps a sleeping Render instance warm.

**`/metrics`** — Prometheus exposition behind `METRICS_TOKEN` (404 when unset, so a scanner cannot confirm it exists). Route labels are chi templates, never resolved paths (cardinality and privacy). Business gauges recompute lazily on scrape, at most once per `METRICS_REFRESH_INTERVAL` (10m); `hasnahena_business_metrics_last_refresh_timestamp_seconds` shows they are live. `hasnahena_transactions_unconfirmed_over_48h` is the signal nothing else can give.

```bash
curl -H "Authorization: Bearer $METRICS_TOKEN" https://api.hasnahenafoundation.com/metrics
```

**Sentry** — `SENTRY_DSN` (Render), `NEXT_PUBLIC_SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_ENVIRONMENT` (Vercel; baked at build — redeploy to change). A missing DSN never stops the API booting. The Go API reports every Error-level `slog` record via a bridge. PII off everywhere; tracing (`tracesSampleRate: 0`) and session replay deliberately off. Releases tagged from `RENDER_GIT_COMMIT` / `VERCEL_GIT_COMMIT_SHA`. Optional `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` for readable stack traces.

**Alerts** — `.github/workflows/monitor.yml`, twice daily (~60 runs/month), opens or updates one GitHub issue when a threshold trips; needs only the `METRICS_TOKEN` GitHub secret and **exits 1** without it. Thresholds are repository variables: `MONITOR_MAX_UNCONFIRMED` (5, postings unconfirmed > 48 h), `MONITOR_MAX_DISPUTES` (3), `MONITOR_MAX_POOL_UTILISATION` (80 %). Uptime is not checked here (it would cost 4× the free minutes).

**Is it actually on?** Every piece is inert without its credential, so silent looks the same healthy or unwatched. Without credentials: `curl -o /dev/null -w '%{http_code}' https://api.hasnahenafoundation.com/metrics` → 401 means `METRICS_TOKEN` is set, 404 not; `curl -s https://hasnahenafoundation.com | grep -o 'sentry-environment=[a-z]*'` → a hit means the web DSN is live (`sentry-release` in the same baggage names the deploy). The Go API's Sentry has no outside signal — check the boot log or a test error. Prove each on launch day ([runbook.md §7.3](runbook.md#73-launch-day-checks)).

## Getting off the free tiers

**[scaling.md](scaling.md) is the plan** (priced, staged, triggered): the first wall is Neon's 0.5 GB at ~6,000 members ($7 to pass); the host move is for ~10,000; Fly.io Singapore preferred over a VPS; Postgres stays on Neon; full AWS only if a funder requires it. Its Stage 2 breakdown ([T-30](tasks.md)):

| ID | Task | Notes |
|---|---|---|
| INF-01 | Choose the target, as an ADR | With numbers: cost, who administers it, what happens when they are unavailable |
| INF-02 | Provision as code | Terraform or a documented script |
| INF-03 | Base-image hardening | SSH keys only, no root login, `ufw` default-deny, `fail2ban`, unattended upgrades |
| INF-04 | Reverse proxy + TLS | Caddy or nginx + certbot; HSTS |
| INF-05 | Database home | **Decided: Neon** (keeps the host stateless) |
| INF-06 | Deployment pipeline | Pull the GHCR image by SHA and restart; rollback = previous SHA |
| INF-07 | Zero-downtime deploys | Two containers, health-gated cutover |
| INF-08 | Log shipping off the box | A dead disk must not take the audit trail |
| INF-09 | Secrets management | Docker secrets or SOPS — not a world-readable `.env` |
| INF-10 | Staging environment | Second compose stack, separate database |
| INF-11 | Cutover runbook | Rehearsed against staging, with a rollback plan |
| INF-12 | Cost + capacity review | Budget alarm before the first bill |

**Cutover order:** DNS TTL to 300 s a day ahead → announce a window → stand up the new stack and restore a dump → release checklist on a temporary hostname → freeze writes → final dump and restore → switch DNS → watch an hour → keep the old stack warm 48 h. The procedure for the data is [runbook.md §7](runbook.md); the environment contract is in [changing-things.md](changing-things.md#i-want-to-move-off-vercel-and-render-onto-a-vps).
