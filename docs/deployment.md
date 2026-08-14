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

- **Direct** (host without `-pooler`) → schema pushes only.
- **Pooled** (host with `-pooler`) → every runtime `DATABASE_URL`.

```bash
cd apps/web
DATABASE_URL='postgresql://…@ep-xxx.<region>.aws.neon.tech/hasnahena_dev?sslmode=require' npx prisma db push
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

## Release checklist

1. `https://hasnahenafoundation.com` loads; `www` resolves.
2. `https://api.hasnahenafoundation.com/v1/health` → `status: ok` **and** `emailConfigured: true`.
3. Login works from the deployed frontend with no CORS errors.
4. Admin dashboard renders live figures.
5. A test registration triggers its approval email.

## Operations

Rotate any secret that has ever appeared in a screenshot, chat, or commit — in Neon, Vercel, and Render together, since they are isolated stores. Keep dev and production credentials separate. Back up with `pg_dump` on a schedule; Neon branches are not a backup policy. Watch free-tier limits on all four services.
