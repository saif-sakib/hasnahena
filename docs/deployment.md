# Deployment

Free-tier production topology, currently live.

| Piece | Host | Address |
|---|---|---|
| Web | Vercel | hasnahenafoundation.com, www |
| API | Render | api.hasnahenafoundation.com |
| DB | Neon PostgreSQL | — |
| Files | Cloudinary | — |
| DNS | **Cloudflare** (registrar: Namecheap) | proxied — apex, `www` and `api` |

Shared hosting (Namecheap Stellar) cannot run either app — Go and the Next.js server runtime both need a real process. Namecheap is the **registrar only**; DNS moved to Cloudflare, and all three hostnames are proxied through it, which is why Cloudflare's TLS and WAF settings reach the API as well as the site.

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
NEXT_PUBLIC_SENTRY_DSN=…
CRON_SECRET=<a long random string, Vercel only>
```

No Brevo keys here — email is backend-only. Cloudinary keys are Vercel-only too: the Go API contains no Cloudinary code.

### The functions run in Singapore, beside the database

`apps/web/vercel.json` pins `"regions": ["sin1"]`. This is not a preference —
it is the single largest thing affecting how fast the signed-in half of this
site feels.

Neon is in `ap-southeast-1` (Singapore); the connection host says so. Vercel's
default function region is `iad1`, Washington DC. With no `regions` set, every
Prisma query in a Next route handler crossed the Pacific and back — on the order
of **220 ms each**, against a query that takes well under a millisecond to run.
A screen making four or five round trips spent a second doing nothing but
waiting for light to travel, and no amount of indexing could have shown up in a
profile as the cause.

Co-located, the same round trip is a few milliseconds. It also happens to put
the functions much closer to the members, who are in Jessore.

This affects **dynamic routes only**. The twenty marketing pages are prerendered
and served from the CDN edge worldwide (WO-73), so they were never paying it.

Two things to know if this is ever changed:

- **Change it with the database, not on its own.** The rule is that the
  functions sit in the same region as Neon. Moving one without the other is
  worse than either choice made consistently.
- Region selection needs a paid plan on Vercel. If the deploy warns that the
  region was ignored, the setting silently reverts to `iad1` and everything gets
  a second slower with nothing in any log saying why — check the deployment's
  Functions tab, which names the region it actually used.

### `CRON_SECRET` and the nightly retention sweep

`apps/web/vercel.json` declares one cron job: a `GET` to
`/api/v1/admin/retention` at 19:00 UTC, which is 01:00 in Dhaka. Vercel attaches
`Authorization: Bearer $CRON_SECRET` to it automatically, so setting the variable
is the whole configuration — there is nothing to wire.

**Without it the sweep never runs, and nothing says so.** The route answers `401`
to a caller it cannot authenticate, and an unset `CRON_SECRET` authenticates
nobody on purpose: treating a missing variable as "no check configured" would
turn an erasure endpoint into an open one. So the failure is silent by design at
the endpoint and must not be silent here.

What it does, nightly ([ADR-038](decisions.md)): deletes the identity
photographs of refused applications the approvals screen did not manage to clear
at the moment of the decision, and removes audit entries past their retention
tier. Both are reported in the response body and in the Vercel cron log; a night
with nothing to do reports zeroes rather than staying quiet.

It is **one** database wake per day, which is the budget ADR-035 sets for a
background job. Do not add a second cron without counting it against that.

**`CSP_ENFORCE` is deliberately not in that list.** The Content-Security-Policy
ships **report-only** until it is set to `1`, so a policy that turns out to be
too tight logs to the console instead of breaking the dashboard. Turn it on as a
separate change, after `pnpm test:e2e` — which includes `e2e/csp.spec.ts` — has
reported zero violations against the deployed build. See
[ADR-024](decisions.md).

## Render

Root Directory `apps/api`, runtime Go, build `go build -o app ./cmd/server`, start `./app`.

```dotenv
# Do NOT set API_PORT — Render injects PORT and config.go falls back to it.
# Setting it overrides Render's choice for no benefit.
DATABASE_URL=<pooled Neon URL>
JWT_SECRET=<same secret as Vercel>
JWT_EXPIRY_SECONDS=86400
CORS_ORIGINS=https://hasnahenafoundation.com,https://www.hasnahenafoundation.com,https://<project>.vercel.app
BREVO_API_KEY=…
EMAIL_FROM=info@hasnahenafoundation.com
EMAIL_FROM_NAME=Hasnahena Foundation
NEXT_PUBLIC_APP_URL=https://www.hasnahenafoundation.com
METRICS_TOKEN=<long random string, same value as the GitHub secret>
SENTRY_DSN=…
ENVIRONMENT=production
```

Do not quote Render values — `KEY=value`, never `KEY="value"`. The `EMAIL_FROM` address must be a Brevo-verified sender. Free instances sleep, so the first request after idle is slow.

## Cloudinary

Signed uploads through a `hasnahena-docs` preset: formats `jpg,jpeg,png,pdf`, max 5 MB, unique filenames, overwrite off. Enforce the same MIME and size limits server-side — the preset is not a security boundary. Folders: `hasnahena/{members,nid,nominee,misc}`. Store both `secure_url` and `public_id` so files can be replaced or deleted later.

## DNS (Cloudflare)

The domain was moved to Cloudflare's nameservers (`suzanne`/`venkat.ns.cloudflare.com`) and **all three hostnames are proxied** — apex, `www` and `api` all resolve to Cloudflare addresses and answer with `server: cloudflare` and a `cf-ray`. Verified 2026-09-03.

| Type | Host | Points at | Proxied |
|---|---|---|---|
| A/CNAME | `@` | Vercel | ✅ orange |
| CNAME | `www` | Vercel | ✅ orange |
| CNAME | `api` | `hasnahena-api.onrender.com` | ✅ orange |
| MX | `@` | `route1-3.mx.cloudflare.net` (Email Routing) | — |

That is three consequences, not one:

1. **Cloudflare's TLS, WAF and bot settings now apply to the API as well as the site.** Anything enabled account-wide reaches `api.` too — which is why Bot Fight Mode is not simply switched on: it would challenge the uptime monitor and the Vercel functions that call the API server-to-server.
2. **There is now an extra proxy in front of the Go API** — see below.
3. Cloudflare terminates TLS, so the minimum-TLS setting there is what browsers actually negotiate. It is set to 1.2; TLS 1.1 is refused and 1.2 answers 200.

### The proxy count changed when the API went behind Cloudflare

`TRUSTED_PROXIES` counts the reverse proxies in front of the Go API, and `ClientIP` reads `X-Forwarded-For` from the trusted end ([ADR-019](decisions.md), [ADR-021](decisions.md)). The chain used to be `client → Render`, so the answer was **1**. It is now `client → Cloudflare → Render`, so the answer is **2**.

Both ways of getting this wrong are silent, and four things read it: the rate limiter, the login lockout, the access log and every audit row. Left at 1, `ClientIP` returns **Cloudflare's edge address** rather than the member's — so every member behind the same edge shares one rate-limit bucket and one lockout, and the audit log answers "who did this" with a Cloudflare IP.

**Verify rather than assume the number.** It took two measurements on 2026-09-03 to land on **3**, and both are worth keeping because they are what the answer rests on.

At `TRUSTED_PROXIES=2`, a *direct* request:

```json
{"path":"/v1/dashboard/notifications","ip":"104.23.175.71","peer":"::1"}
```

`104.23.175.71` is inside Cloudflare's published `104.16.0.0/13` — the **edge**, not the member. At `3`, a *support* request:

```json
{"path":"/v1/dashboard/support/threads","ip":"52.221.235.153","peer":"::1"}
```

`52.221.235.153` is AWS `ap-southeast-1` — **Vercel's `sin1`**, where this project's functions are pinned. That is not a fault: `/v1/dashboard/support/*` is the one path the browser reaches through a same-origin Next proxy, so the API's caller genuinely *is* Vercel, and [ADR-021](decisions.md) says so and puts the per-member limit on the Next side instead.

And at `3`, a *direct* request — `/v1/dashboard/admin` — resolved to a **Bangladeshi ISP address** (APNIC, country `BD`), in neither Cloudflare's nor AWS's published ranges. That is the caller, and it is the reading that actually settles the question: every earlier measurement that came out right was on the support route, where Vercel is the expected answer and a wrong count can hide.

*(The address itself is deliberately not written down here. Cloudflare's and Vercel's are infrastructure; a person's is not, and this project keeps addresses out of documents for the same reason the access log identifies people by `userId` rather than by email — RUN-05.)*

Together the three readings say `X-Forwarded-For` arrives with **three entries** — the origin, Cloudflare, and Render's own hop — so `parts[len-3]` is the origin: the member on a direct call, Vercel on a support call. `peer` is `::1` on all of them because Render hands the request to the process over loopback, which is why the header is the only source of truth there is.

**Counting from the right end is what makes this safe.** A caller who prepends entries of their own lengthens the list and shifts every index left, so the arithmetic still lands on the same trusted position — which is why `ClientIP` never reads from the left ([ADR-019](decisions.md)).

**Since 2026-09-03 the count is the fallback, not the answer.** `TRUST_CLOUDFLARE_CLIENT_IP=true` makes `ClientIP` prefer **`CF-Connecting-IP`**, which Cloudflare sets to the address it accepted the connection from and strips from any caller-supplied header ([ADR-019](decisions.md)). One value, no index, unmoved when a hop is added in front — which matters because the count was wrong twice in one week and `hasnahena-api.onrender.com` is a second entry point, fronted by *Render's* Cloudflare rather than this zone's, whose depth is not guaranteed to match.

Live in production since 2026-09-03. The flag defaults to **off** and must stay off unless every route to the process passes through your own Cloudflare zone: nothing about the header proves a request came that way, so a process reachable another way would be believing a value anyone can type. The header is also *parsed* rather than merely checked for emptiness — it becomes a rate-limit key and an audit row, and neither should be able to hold arbitrary text. `TRUSTED_PROXIES` stays at `3` and answers whenever the header is absent.

Remove conflicting old records, add both apex and www in Vercel, add `api.hasnahenafoundation.com` in Render, wait for SSL, then confirm `NEXT_PUBLIC_API_URL` points at the custom API domain and redeploy.

### Email authentication: SPF does not cover Brevo

Checked over DNS on 2026-09-03. The domain is on Cloudflare (Email Routing holds the MX records), and the outbound side is **half configured**:

| Record | State |
|---|---|
| DKIM (`brevo1`/`brevo2._domainkey`) | ✅ present and resolving to Brevo's keys |
| DMARC (`_dmarc`) | ✅ present — `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` |
| SPF (`@` TXT) | ✅ `v=spf1 include:spf.brevo.com include:_spf.mx.cloudflare.net ~all` — fixed 2026-09-03 |

All three now align. The application sends every registration, approval and rejection email through Brevo as `info@hasnahenafoundation.com`, and SPF authorizes both Brevo and Cloudflare Email Routing from **one** record — never two TXT records beginning `v=spf1` on the same name, which is a permanent error rather than a merge.

Before the fix, SPF named only Cloudflare Email Routing. Mail still delivered, because DMARC passes on *either* aligned SPF or aligned DKIM and the DKIM half was correct — so the gap was invisible in exactly the way that matters: one rotated key or dropped selector CNAME away from every message failing at once, with members not receiving approvals as the first symptom.

**What is left is enforcement.** `p=none` means DMARC only *reports*, and aggregate reports now go to Cloudflare's DMARC management as well as Brevo's. Read a few weeks of them, confirm nothing legitimate is failing, then move to `p=quarantine`. Going to enforcement before reading the reports is how a foundation stops being able to email its own members.

### The API has two hostnames. Use the custom one.

`api.hasnahenafoundation.com` and `hasnahena-api.onrender.com` reach the **same
Render service, the same process and the same database**. Verified identical:
both return `{"status":"ready"}` with a `x-render-origin-server: Render` header.
The difference is only what sits in front.

| | `hasnahena-api.onrender.com` | `api.hasnahenafoundation.com` |
|---|---|---|
| Owner | Render | You |
| Survives a host move | No — it dies with the Render service | Yes — repoint the CNAME |
| Survives a service rename | No | Yes |
| Behind your Cloudflare | No | Yes |

Use the custom domain everywhere: `NEXT_PUBLIC_API_URL`, uptime checks, the
monitor workflow, and the `/metrics` scrape. The Render subdomain is a fallback
for exactly one situation — diagnosing whether a problem is DNS/Cloudflare or
the application. If the custom domain fails and the `onrender.com` one works,
the app is fine and the problem is in front of it.

**Know this about the Render hostname:** it stays publicly reachable and it
bypasses Cloudflare. Any rate limiting, WAF rule or bot protection added at
Cloudflare can be sidestepped by an attacker who addresses the origin directly —
and the `onrender.com` name is guessable from the service name. Render's free
tier has no origin-locking, so the fix, if it ever matters, is in the
application: reject requests whose `Host` header is not the custom domain.
Not urgent while the platform is small; do not forget it exists.

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

## Container images

**Nothing in production uses these yet.** Vercel and Render both build from
source and ignore the Dockerfiles. They exist so that a host move is a
configuration change rather than a project, and so the stack can be reproduced
on any machine — see [setup.md](setup.md#run-it-in-containers) for how to run
them.

| File | Produces | Base |
|---|---|---|
| `apps/api/Dockerfile` | Go API — 26.9 MB on disk, 6.0 MB compressed | `gcr.io/distroless/static-debian12:nonroot` |
| `apps/web/Dockerfile` | Next standalone — 488 MB on disk, 113.8 MB compressed | `node:24-bookworm-slim` |
| `docker-compose.yml` | Postgres + migrate + api + web | — |
| `.dockerignore` | Governs both build contexts | — |

Two properties worth keeping when someone edits them:

**`.dockerignore` is a secret control, not a speed tweak.** Next's file tracer
copies whatever it finds beside the app into `.next/standalone/`, and it was
observed pulling `.env.local` and the `apps/web/.env` symlink straight in. Those
would land in an image layer — readable by anyone who can pull the image, and
still readable after a later layer deletes them. The env rules at the top of
`.dockerignore` are what prevents that. Do not weaken them.

**`output: 'standalone'` is gated behind `DOCKER_BUILD=1`.** Vercel builds its
own output and does not need it, and two Vercel deploys have already been broken
this month by build-config changes. The Docker build opts in; every other build
is byte-for-byte what it was before.

CI builds and pushes both images to GHCR tagged by commit SHA, so an image
*is* a deployable artifact per commit — nothing consumes them yet, which is the
only reason this is not the deployment path.

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

### A migration that drops a column has no overlap window

Most migrations are additive, so the order of "migrate" and "deploy" does not
matter: old code ignores a new column and new code tolerates its absence for the
minute before the migration lands. **A migration that drops one is different.**
Old code selects a column that is gone; new code omits a column that is still
`NOT NULL`. There is no ordering in which both versions work, so there is a
window, and the only choice is which failure happens during it.

`20260901120000_ids_are_the_numbers` is the first of these
([ADR-044](decisions.md)). The order to take, in one sitting and outside office
hours:

1. **Run the backup workflow by hand and wait for the artifact.** Not the
   nightly one from last night — this migration drops columns and rewrites audit
   rows, and neither is reversible by re-running anything.
2. **Rehearse on a Neon branch.** Branch production, point `DATABASE_URL` at the
   branch, `pnpm db:migrate`, then `pnpm db:migrate:check`. The migration raises
   rather than guesses on data it cannot safely convert, so this is where a
   surprise in the foundation's own rows shows up — cheaply, and on a copy.
3. **Migrate production, then deploy both apps.** Migrating first means the
   window is *reads* failing on staff ledger screens; deploying first means
   *writes* failing on a NOT NULL column. Both are plain errors and neither
   half-writes anything, because every posting is one transaction — but a member
   being told a deposit failed is worse than an admin seeing a screen error, so
   migrate first.
4. **`pnpm db:migrate:check`** against production afterwards: it must say *No
   difference detected*.

## Backups

`.github/workflows/backup.yml` runs nightly at 19:00 UTC (01:00 Dhaka), plus monthly. Each run dumps the database with `pg_dump -Fc`, encrypts it with AES256, and keeps it as a GitHub artifact for 30 days (90 for the monthly). Set `BACKUP_S3_BUCKET` and AWS credentials to also copy it to S3/B2/R2.

Two secrets are mandatory and the job fails loudly without them: `BACKUP_DATABASE_URL` (the **direct** Neon string) and `BACKUP_PASSPHRASE`.

**Keep `BACKUP_PASSPHRASE` somewhere that survives losing this GitHub account.** It is not recoverable, and without it every backup is a file of noise.

Two things that make scheduled backups quietly stop:

- GitHub disables scheduled workflows in a repository with **60 days of no commit activity**. It emails first. Re-enable it on the Actions tab.
- Artifacts expire on the retention window above. That is the whole retention policy until the S3 copy is configured; 30 days is short if nobody looks.

### The Cloudinary assets

The dump above covers the database and **nothing else**. Every member's NID scan, photograph and signature lives in Cloudinary, which has no export feature, and none of it can be reconstructed from the paper passbook — the passbook records money, not photographs.

The `assets` job in the same workflow runs `apps/web/scripts/cloudinary-backup.mjs`, which lists every asset under `hasnahena/`, downloads it, verifies each file against the byte length Cloudinary reported, and writes one encrypted archive beside the database dump:

```
backups/hasnahena-assets-<UTC stamp>.tar.gz.gpg
    files/hasnahena/people/ACC-KH-33001/nid-front.jpg   … mirroring every public id
    manifest.json                                       … folder, format, bytes, created date
```

Same passphrase, same retention, same optional S3 copy. It needs `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` as repository secrets — set 2026-09-03 — and **fails rather than skips** without them, deliberately: an asset backup that skips quietly is indistinguishable from one that works.

Two properties are worth keeping if this is ever rewritten. It never writes to Cloudinary — repairing the asset tree is `cloudinary-reconcile.mjs`, and the script you reach for when something has gone wrong should not be able to make it worse. And it uses the Admin API over `fetch` with no SDK and no `node_modules`, so recovery needs only node and a copy of the file.

Restore by decrypting and unpacking; the public id names the person, so the tree is readable without the database:

```bash
gpg --decrypt hasnahena-assets-<stamp>.tar.gz.gpg > assets.tar.gz && tar -xzf assets.tar.gz
```

Re-uploading a member's documents afterwards is a manual `uploader.upload` per file with the `public_id` from the manifest — there is no bulk import, which is a reason to treat losing the account as serious rather than routine.

### Keeping a copy off GitHub

Everything is currently in one GitHub account: the code, both archives, and the secrets that decrypt them. That account being lost, suspended or compromised loses all of it at the same moment — which is the one scenario a backup exists for. Artifacts also expire on the retention window, so a problem noticed in month three has nothing to restore from.

Both jobs already copy to any S3-compatible store when `BACKUP_S3_BUCKET` is set. **No code change is needed** — only secrets.

| | Free tier | Notes |
|---|---|---|
| **Cloudflare R2** | 10 GB, zero egress fees | Recommended. Egress is what makes a restore expensive elsewhere, and a backup you hesitate to download is not a backup |
| **Backblaze B2** | 10 GB, 1 GB/day free egress | Equivalent for this volume; the fallback if R2's signup asks for something you would rather not give |

Whichever, the setup is the same:

1. Create the bucket — one bucket, private, region nearest Dhaka.
2. Create an API token scoped to **that bucket only**, with object read *and* write. Nothing here needs account-wide access, and a leaked token that can only touch one backup bucket is a much smaller problem.
3. Add five repository secrets:

   | Secret | Value |
   |---|---|
   | `BACKUP_S3_BUCKET` | `s3://hasnahena-backups` |
   | `BACKUP_S3_ENDPOINT` | R2: `https://<account-id>.r2.cloudflarestorage.com` · B2: `https://s3.<region>.backblazeb2.com` |
   | `AWS_ACCESS_KEY_ID` | from the token |
   | `AWS_SECRET_ACCESS_KEY` | from the token |
   | `AWS_DEFAULT_REGION` | **`auto`** for R2; the bucket's region for B2 |

   `AWS_DEFAULT_REGION` is not optional on R2 — the workflow's `us-east-1` default is rejected.

4. **Actions → Backup → Run workflow**, then look in the bucket. Two objects: `hasnahena-<stamp>.dump.gpg` and `hasnahena-assets-<stamp>.tar.gz.gpg`.
5. Set **two** lifecycle rules, which is why the two jobs upload under different prefixes:

   | Prefix | Keep | Why |
   |---|---|---|
   | `database/` | 365 days | The dump is ~63 KB. A year of them is ~23 MB — keeping it long costs nothing and buys a lot |
   | `assets/` | 60 days | ~4.8 MB a night and **grows with the membership**. Sixty days is ~290 MB |

   Together that is roughly **310 MB against a 10 GB free tier** — about 3%.

**What it would take to be charged, concretely.** R2's free tier is 10 GB stored, 1M Class A operations (writes) and 10M Class B (reads) a month, and **egress is always free** — so the classic object-storage horror story, a hotlinked bucket producing a bandwidth bill, cannot happen here. This backup performs about **4 writes a day**, or 0.01% of the Class A allowance. On storage, even with the lifecycle rules switched off entirely, six members' worth of nightly archives would take **years** to reach 10 GB. The number that changes that is membership: at a hundred members the asset archive is nearer 80 MB a night, and *without* the `assets/` rule the free tier would be gone in about four months. The rule is what makes it safe to stop thinking about, so set it now rather than when the account is larger.

The archives are already encrypted with `BACKUP_PASSPHRASE` before they leave the runner, so the storage provider holds ciphertext and never sees a member's NID. That is what makes a third-party bucket an acceptable place for this at all.

### What the free GitHub plan actually covers, measured

A **private** repository on GitHub Free gets **2,000 Actions minutes** and **500 MB of storage** a month, storage shared between Actions artifacts and GHCR packages.

The August 2026 usage export settles what that means here, and it is not what an estimate would have guessed:

| Workflow | Minutes, 15–31 Aug | Share |
|---|---|---|
| `ci.yml` | 1,744 | **85.8 %** |
| `images.yml` | 217 | 10.7 % |
| dependabot | 33 | 1.6 % |
| `monitor.yml` | 23 | 1.1 % |
| `backup.yml` | 16 | 0.8 % |
| **Total** | **2,033** | in **17 days** |

Two conclusions, one of which is a live incident.

**The month's allowance was spent in seventeen days.** `backup.yml` and `monitor.yml` stop appearing in the export after 27 August, and 28–31 August record **no workflow runs at all** — only storage. GitHub Free carries a default spending limit of **\$0**, so exhausting the included minutes does not produce a bill; it stops Actions. Every row in the export is `net_amount 0`, which is the same fact from the other side.

So **the cost risk on GitHub is nil and the availability risk is real**: CI spent the budget and the *nightly backup* went down with it for the rest of the month. Nothing reported this, because a backup that never starts writes no failure — the exact shape this repository keeps finding. **A backup starved by CI is the drill eating the thing it protects.**

**Storage is comfortable**: 131–268 MB against 500 MB. The asset archive is the only part that grows with membership, which is why its artifact retention is 7 days rather than 30 while R2 keeps the long tail.

What was done about the minutes:

- `images.yml` moved from per-push to **tags only** (2026-08-27), which removed most of its 217 minutes, and its cron from weekly to **monthly** — nothing deploys those images; Vercel and Render build their own, and the registry copy is for the VPS move ([T-30](tasks.md)).
- The **restore drill** now runs only when something it actually proves has changed — `scripts/`, the Prisma schema and migrations, or the two workflows — instead of on every code commit.
- **The largest remaining lever is behavioural.** `ci.yml` triggers on `pull_request` and on `push` to `main` only, so **commits pushed to a feature branch cost nothing at all** until a pull request exists. Ten pushes straight to `main` is ten full CI runs; ten pushes to a branch and one PR is one. On 18 and 19 August that difference was 351 and 468 minutes. This is the strongest argument in [workflow.md](workflow.md) §2 and it is a billing argument, not only a safety one.

Check **Settings → Billing and licensing → Usage** monthly. If minutes run out again, the first thing to verify is that last night's backup ran.

### The PostgreSQL client version

`pg_dump` refuses to dump a server newer than itself, and Neon upgrades Postgres on its own schedule — so this **will** drift again. It already has once: the job failed with `server version: 17.11; pg_dump version: 16.14`.

The cause is not what it looks like. `/usr/bin/pg_dump` on Debian and Ubuntu is `pg_wrapper`, which resolves to the version of the **configured cluster**; GitHub's `ubuntu-latest` image ships a PostgreSQL 16 *server*, so installing a newer client changes nothing and `pg_dump --version` keeps answering 16.

Two layers handle it, and either alone is enough:

- [`.github/actions/postgres-client`](../.github/actions/postgres-client) installs the newest client PGDG publishes and puts its real binary directory ahead of `/usr/bin` on `PATH`. Used by both the Backup workflow and the CI restore drill.
- [`scripts/lib/pg-client.sh`](../scripts/lib/pg-client.sh) resolves the newest `pg_dump`, `pg_restore` and `psql` by absolute path, so the scripts are correct wherever they run — including on your laptop. It prints which binary it chose, and `backup.sh` refuses to start if the client is older than the server, naming the package to install.

Override with `PG_DUMP` / `PG_RESTORE` / `PSQL` if you are on an unusual layout.

**When Neon moves to a major PGDG has not published yet**, the composite action fails with `resolved PostgreSQL client is N, need at least M`. Raise the loop in the action; there is nothing else to change.

Run either by hand at any time from **Actions → Backup → Run workflow**, or locally with `pnpm db:backup` (database) and `pnpm backup:assets` (Cloudinary). Both need `BACKUP_PASSPHRASE` in the environment; the database one also needs the direct connection string, under either `DIRECT_DATABASE_URL` or `BACKUP_DATABASE_URL` — **one value with two names**, because the script reads the first and the GitHub secret is called the second, and the workflow maps one onto the other.

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

## Observability

Three signals, deliberately split by what each is good at — and all on free tiers.

| Question | Answered by | Cost |
|---|---|---|
| Is the API up? | UptimeRobot on **`/v1/health`** | free, 1-minute checks |
| Can it reach the database? | UptimeRobot on `/v1/ready`, **every 30–60 minutes** | free |
| Did something throw? | Sentry, both apps | free tier |
| Is a member waiting on money? | `/metrics` + the Monitor workflow | ~60 Actions minutes/month |

### The endpoint the uptime check must use

**`/v1/health`, not `/v1/ready`** — and this is a billing decision, not a
preference.

`/v1/health` deliberately touches nothing: it answers whether the process is up,
which is what an uptime check is for, and it is what keeps a sleeping Render
instance awake so a member's first request is not a fifty-second cold start.

`/v1/ready` calls `dbPool.Ping()`. Pointed at it once a minute, an uptime check
becomes a query a minute against a database that **suspends when idle and bills
for the time it is awake** — so the monitor by itself pins the compute at a 100%
duty cycle, for ever, including every night nobody is using the platform. That
was live, and it cost roughly 182 compute-hours a month against an allowance of
100.

Keep a second, slow check on `/v1/ready` if you want the database covered:
half-hourly is plenty for a fault you would otherwise hear about from Sentry
within seconds of the first real request. `/v1/ready` remains the right probe for
a load balancer, which is what it was written for — it is only an uptime *robot*
that should not be holding it open.

The third is the one nothing else can see. A transaction sitting unconfirmed for three days throws no exception and returns no error status — every technical monitor reports green while a member waits on their own savings. That is what `hasnahena_transactions_unconfirmed_over_48h` exists for.

### `/metrics`

Prometheus exposition, **behind a bearer token** (`METRICS_TOKEN` on Render). With no token set the endpoint returns 404 rather than 401, so a scanner cannot even confirm it exists.

It is gated because the exposition is business data: how many members are waiting, how many disputes are open, how many loans are outstanding. For a village cooperative that is commercially and personally sensitive.

```bash
curl -H "Authorization: Bearer $METRICS_TOKEN" https://api.hasnahenafoundation.com/metrics
```

Route labels are chi **route templates** (`/v1/dashboard/worker/members/{memberUserId}/deposit`), never resolved paths — one series per endpoint rather than one per member, which is both a cardinality and a privacy decision.

Business gauges are recomputed **when the endpoint is scraped**, and at most once per `METRICS_REFRESH_INTERVAL` (default 10m). The floor is what stops database load depending on how often somebody else's scraper runs — a Prometheus set to five seconds gets cached numbers rather than a hammered ledger. It was a one-minute ticker until 2026-08-27, which issued around 43,000 aggregate queries a month to answer the 60 scrapes this deployment actually makes, and was on its own enough to stop the database ever suspending. `hasnahena_business_metrics_last_refresh_timestamp_seconds` tells you the numbers are live — a frozen gauge otherwise looks exactly like a calm system.

To graph it, point **Grafana Cloud** (free tier) at the endpoint with bearer auth. Nothing here requires that; the Monitor workflow reads the same endpoint directly.

### Sentry

Set `SENTRY_DSN` on Render and `NEXT_PUBLIC_SENTRY_DSN` on Vercel. Both apps are inert without one, and **a missing or invalid DSN never stops the API booting** — losing error reporting must not become losing the service.

PII is off by everything: `sendDefaultPii: false`, cookies/headers/query strings stripped before send, and Session Replay explicitly disabled — it would otherwise record a member's dashboard, balances and name, and ship it to a third party.

Releases are tagged from `RENDER_GIT_COMMIT` and `VERCEL_GIT_COMMIT_SHA` automatically, so an error spike points at a deploy rather than at a day.

### UptimeRobot

Two monitors, both free:

1. `https://api.hasnahenafoundation.com/v1/ready` — 1 minute, alert after 2 failures.
2. `https://hasnahenafoundation.com` — 5 minutes.

Use `/v1/ready`, not `/v1/health`: readiness pings Postgres, so it catches "the process is alive but cannot reach the database", which is the failure that actually hurts. Render free instances sleep, so expect cold starts in the response-time graph — that is information, not a fault.

### Alerts

`.github/workflows/monitor.yml` runs twice daily and opens a **GitHub issue** when a threshold trips, updating the same issue while the problem persists rather than sending a fresh email every run. GitHub emails you on issue activity, so this needs no third-party service and no secret beyond `METRICS_TOKEN`.

Thresholds are repository *variables*, changeable without editing the workflow:

| Variable | Default | Trips when |
|---|---|---|
| `MONITOR_MAX_UNCONFIRMED` | 5 | postings unconfirmed > 48 h |
| `MONITOR_MAX_DISPUTES` | 3 | open disputes |
| `MONITOR_MAX_POOL_UTILISATION` | 80 | % of the pgx pool in use |

**Uptime is deliberately not checked here.** A private repository gets 2,000 Actions minutes a month and every run bills a whole minute; a 5-minute uptime check is 8,640 runs — four times the free allowance, to do worse what UptimeRobot does free at 1-minute intervals.

---

## The monitoring, and how to tell whether it is actually on

This came from outside: Sentry emailed to say a Next.js project had been created
and **no errors had ever arrived**. That was accurate at the time, and it was
never a Sentry setup problem.

The integration is complete and correct on both surfaces, and every piece is
deliberately inert without a credential — *a missing DSN must never fail a build,
and a financial API must never refuse to boot because error reporting is
misconfigured.* The cost of that design is the thing to keep in mind here:
**the system is silent in the same way whether it is healthy or unwatched.**
Which is why the checks below probe for the switch rather than trusting a note
in a document — the note said all of this was off, and by 2026-08-25 half of it
was on.

| Piece | Where | With no credential |
|---|---|---|
| Sentry, Next server + edge + browser | `sentry.*.config.ts`, `instrumentation*.ts` | inert, no error |
| Sentry, Go API | `internal/observability/sentry.go` | logs `error tracking disabled…`, no-op flush |
| `/metrics` | `internal/metrics/handler.go` | logs `metrics endpoint disabled…` and 404s |
| Business alerting | `.github/workflows/monitor.yml` | **exits 1** — fails twice a day rather than passing silently |

**The code is done and the switch is now fully thrown**, as of 2026-09-03.

Two of these were confirmed **on** by probing the live site on 2026-08-25, which
is worth knowing how to repeat, because both can be checked without any
credential:

- `curl -o /dev/null -w '%{http_code}' https://api.hasnahenafoundation.com/metrics`
  → **401** means `METRICS_TOKEN` is set; **404** means it is not. The endpoint
  hides rather than challenges when unconfigured, so the two are the whole test.
- `curl -s https://hasnahenafoundation.com | grep -o 'sentry-environment=[a-z]*'`
  → a hit means `NEXT_PUBLIC_SENTRY_DSN` is set on Vercel and the client is
  instrumented. The same `<meta name="baggage">` carries `sentry-release`, so it
  also tells you *which deploy* is reporting.

Neither says anything about the **Go API's** Sentry, which has no outside
signal at all — the only evidence is the boot log line, or an error arriving in
the project.

| | To enable | Where |
|---|---|---|
| `[x]` | `SENTRY_DSN` | **Render** (Go API) — set by the owner. Note that a DSN alone reported nothing until 2026-09-03: `CaptureError` was dead code and the only path to Sentry was a panic, which this API does not do. `observability.Init` now installs a `slog` bridge, so every Error-level record is an event |
| `[x]` | `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | **Vercel** — confirmed live 2026-08-25 (`sentry-environment=production`). `NEXT_PUBLIC_*` is baked at build time, so changing it needs a **redeploy**, not a restart |
| `[ ]` | `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | **Vercel** — optional; without them the build succeeds with minified stack traces |
| `[x]` | `METRICS_TOKEN`, same value in both places | **Render** (confirmed 2026-08-25, `/metrics` answers 401) **and** as a GitHub Actions secret, which is what `monitor.yml` scrapes with — set 2026-09-03 |
| `[x]` | An UptimeRobot monitor on **`/v1/health`** | Set 2026-09-03, on the correct endpoint. UptimeRobot free tier — deliberately not Actions, on cost grounds (see `monitor.yml`). **Not `/v1/ready`**, which this row named until 2026-09-03 while the section above explained at length why that is a 100% database duty cycle and 182 compute-hours against an allowance of 100. A checklist that contradicts its own rule is worse than one that omits it, because the checklist is what gets followed |

**Deliberately staying off:** tracing (`tracesSampleRate: 0`) and session replay.
Tracing burns the free-tier quota that should hold actual exceptions, and replay
would record a member's dashboard — balance, loan, name — and ship it to a third
party. PII scrubbing is on in both apps.

**Then prove each one**, rather than assuming a DSN that is set is a DSN that
works — the checklist is Stage 2, launch day, in [go-live.md](go-live.md).

---

---

## Phase 6 — VPS or AWS

T-30 in [tasks.md](tasks.md). Only start once everything else is quiet. Moving an unmonitored system onto
infrastructure you now also have to patch makes things worse.

**Recommended target: a single VPS** (Hetzner/DigitalOcean, 4 GB), not AWS. One
machine, Docker Compose, Caddy for TLS, managed Postgres or a well-backed-up
local one. Roughly $10–25/month, one thing to understand, no surprise bills. Full
AWS (ECS/RDS/ALB) is 5–10× the cost and complexity for this workload — take it
only if a funder or regulator requires it.

| ID | Task | Notes |
|---|---|---|
| INF-01 | Choose the target and write it down as an ADR | Decide *with numbers* — cost, who administers it, what happens when that person is unavailable |
| INF-02 | Provision as code | Terraform or a documented shell script. "I clicked around and it works" is not a recoverable state |
| INF-03 | Base-image hardening | SSH keys only, no root login, `ufw` default-deny, `fail2ban`, unattended security upgrades |
| INF-04 | Reverse proxy + TLS | Caddy (automatic Let's Encrypt) or nginx + certbot. Terminate TLS, forward to both containers, set HSTS |
| INF-05 | Decide the database's home | Staying on Neon is legitimate and keeps DATA-01 simpler. Self-hosting means you own backups, tuning, upgrades and failover |
| INF-06 | Deployment pipeline | CI already builds and pushes to GHCR → pull and restart on the host. Rollback = redeploy the previous SHA |
| INF-07 | Zero-downtime deploys | Two containers behind the proxy, health-gated cutover |
| INF-08 | Log shipping off the box | A dead disk must not take the audit trail with it |
| INF-09 | Secrets management | Docker secrets or SOPS-encrypted files. Not a `.env` on the host with world-read permissions |
| INF-10 | Staging environment | A second compose stack, separate database. First real use of the restore script |
| INF-11 | Cutover runbook | Freeze window, final dump, DNS TTL lowered in advance, restore, verify, switch, **rollback plan**. Rehearse against staging |
| INF-12 | Cost + capacity review | Set a monthly budget alarm before, not after, the first bill |

**Cutover order.** DNS TTL to 300 s a day ahead → announce a maintenance window →
stand up the new stack and restore a dump → run the release checklist in
[deployment.md](deployment.md) against a temporary hostname → freeze writes →
final dump and restore → switch DNS → watch for an hour → keep the old stack warm
for 48 h.

The environment contract the app needs from any host is in
[changing-things.md](changing-things.md#i-want-to-move-off-vercel-and-render-onto-a-vps).
