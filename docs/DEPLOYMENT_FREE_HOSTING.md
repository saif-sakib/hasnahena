# Hasnahena Free Hosting Deployment Guide

This guide documents a full no-cost deployment setup for:

- Database: Neon (PostgreSQL)
- Frontend: Vercel (Next.js)
- Backend API: Render (Go)
- Files: Cloudinary (free tier)
- Domain/DNS: Namecheap (`hasnahenafoundation.com`)

> Security note: if you ever exposed database credentials in chat/screenshots/commits, rotate them immediately in Neon and update all environment variables.

---

## Current Deployment Snapshot (What is done already)

This is the current known state:

- Frontend deployed on Vercel: `https://hasnahena-web.vercel.app`
- Backend deployed on Render: `https://hasnahena-api.onrender.com`
- Domain configured: `hasnahenafoundation.com`
- Database configured on Neon and schema/seed applied
- Cloudinary credentials added in Render environment variables

Items still recommended to complete:

- Create Cloudinary upload preset and enforce restrictions
- Add folder strategy in Cloudinary (or enforce folder path from backend)
- Confirm DNS records use latest Vercel recommended targets
- Keep production and development secrets separated and rotated

---

## Namecheap Migration Runbook (Your Requested Order)

This section is for your current situation:

- You have Namecheap domain + Stellar Plus shared hosting
- Current stack is Vercel (web) + Render (API) + Neon (PostgreSQL) + Cloudinary
- You want migration order: **database -> frontend -> file cloud**

### Important reality before you start

- `apps/api` is a **Go** server. Stellar Plus shared hosting is not suitable for running Go APIs directly.
- `apps/web` is a **Next.js** app with server routes and Prisma usage. Stellar Plus shared hosting is not suitable for running this Next.js runtime directly.
- Best safe path with your current codebase:
  - Keep runtime hosting on Vercel/Render (or move to Namecheap VPS, not shared hosting)
  - Use Namecheap mainly for DNS and domain management

If you still want to move runtime to Namecheap, use a **Namecheap VPS** plan and follow Section **12.4** below.

### 12.1 Database migration first (Neon)

If your DB is already on Neon and working, this is mainly a safe cutover checklist.

1. In Neon, create a new production database/branch (optional but recommended for clean migration).
2. Copy two URLs:
   - Direct URL (no `-pooler`) -> for schema push/seed jobs
   - Pooled URL (`-pooler`) -> for app runtime (`DATABASE_URL`)
3. Apply schema:

```bash
cd /home/sword/Documents/Github/Hasnahena/apps/web
export DATABASE_URL='postgresql://USER:PASSWORD@<direct-host>.neon.tech/hasnahena_dev?sslmode=require'
npx prisma db push
```

4. Seed data:

```bash
cd /home/sword/Documents/Github/Hasnahena/apps/api
export DATABASE_URL='postgresql://USER:PASSWORD@<direct-host>.neon.tech/hasnahena_dev?sslmode=require'
go run cmd/seed/main.go
```

5. Update runtime environments to pooled URL:
   - Render `DATABASE_URL`
   - Vercel `DATABASE_URL` (only because server routes use Prisma)
6. Verify:
   - API health endpoint works
   - Login works
   - Dashboard data loads

### 12.2 Frontend migration second (domain/DNS + Vercel)

You can fully migrate the **domain** side to Namecheap DNS while keeping frontend runtime on Vercel.

1. Namecheap -> Domain List -> Manage -> Advanced DNS
2. Keep/add records:
   - `A @ -> 216.198.79.1` (or current Vercel-recommended A target)
   - `CNAME www -> <your-vercel-target>`
3. In Vercel project Domains, ensure:
   - `hasnahenafoundation.com`
   - `www.hasnahenafoundation.com`
4. In Vercel env vars set:
   - `NEXT_PUBLIC_API_URL=https://api.hasnahenafoundation.com`
5. Redeploy Vercel and verify site open/login flow.

### 12.3 File cloud migration third (Cloudinary)

If you are already on Cloudinary free tier, no platform migration is required; do a safe reconfiguration.

1. Create a dedicated upload preset (example: `hasnahena-docs`).
2. Add/rotate credentials in runtime envs:
   - `CLOUDINARY_CLOUD_NAME`
   - `CLOUDINARY_API_KEY`
   - `CLOUDINARY_API_SECRET`
3. Keep signed uploads and restrictions:
   - allowed formats: `jpg,jpeg,png,pdf`
   - max size: e.g. `5MB`
4. Verify upload + delete flows from app.

### 12.4 Backend migration to Namecheap (only if using VPS)

If you upgrade to Namecheap VPS, backend can be moved from Render to VPS.

1. Build API binary locally:

```bash
cd /home/sword/Documents/Github/Hasnahena/apps/api
go build -o app ./cmd/server
```

2. Copy binary to VPS and set env vars (`DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS`, `API_PORT`/`PORT`).
3. Run app behind reverse proxy (Nginx/Apache) and HTTPS.
4. Point Namecheap `api` DNS record to VPS.
5. Update Vercel `NEXT_PUBLIC_API_URL` to new API domain and redeploy.

Note: API now supports both `API_PORT` and `PORT` env vars for easier compatibility across hosts.

---

## 0) Prerequisites

- GitHub repository is pushed and accessible
- Namecheap domain is active
- Local tools installed: Node 20+, pnpm/npm, Go 1.21+

---

## 1) Neon Database Configuration (First)

### 1.1 Create Neon project

1. Sign in at `https://neon.tech`
2. Create project:
   - Project name: `hasnahena`
   - Database name: `hasnahena_dev`
   - Branch: `main`
   - Region: closest to your users

### 1.2 Get direct vs pooled connection strings

In Neon dashboard, open **Connect** / **Connection Details**:

- **Direct connection** host does **not** include `-pooler`
  - Example: `ep-xxxx.ap-southeast-1.aws.neon.tech`
- **Pooled connection** host includes `-pooler`
  - Example: `ep-xxxx-pooler.ap-southeast-1.aws.neon.tech`

If only one appears, switch the pooling option in the UI and copy both versions.

### 1.3 Apply schema to Neon

This repository currently has no Prisma migration files under `apps/web/prisma/migrations`, so use `db push` to create tables.

```bash
cd /home/sword/Documents/Github/Hasnahena/apps/web
export DATABASE_URL='postgresql://USER:PASSWORD@ep-xxxx.ap-southeast-1.aws.neon.tech/hasnahena_dev?sslmode=require'
npx prisma db push
```

### 1.4 Seed initial data

```bash
cd /home/sword/Documents/Github/Hasnahena/apps/api
export DATABASE_URL='postgresql://USER:PASSWORD@ep-xxxx.ap-southeast-1.aws.neon.tech/hasnahena_dev?sslmode=require'
go run cmd/seed/main.go
```

### 1.5 Verify database

Run API health after backend deploy later, and verify login endpoints return valid responses.

---

## 2) Vercel Frontend Configuration (Second)

### 2.1 Import project

1. Sign in at `https://vercel.com` with GitHub
2. Add New Project -> import this repository
3. Configure:
   - Framework: Next.js (auto-detected)
   - Root Directory: `apps/web` (IMPORTANT: You must set this!)
   - Build & Development Settings (if not auto-detected from vercel.json):
     - Install Command: `cd ../.. && npx --yes pnpm@8.15.4 install`
     - Build Command: `cd ../.. && npx --yes pnpm@8.15.4 build`

### 2.2 Environment variables in Vercel

Set these in Project Settings -> Environment Variables:

```dotenv
NEXT_PUBLIC_API_URL=https://hasnahena-api.onrender.com
JWT_SECRET=replace-with-strong-random-secret
DATABASE_URL=postgresql://USER:PASSWORD@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/hasnahena_dev?sslmode=require
```

Notes:

- `NEXT_PUBLIC_API_URL` should point to your Render custom API domain.
- Keep `JWT_SECRET` and `DATABASE_URL` as secret variables.
- For this Go-backend email flow, set `BREVO_API_KEY` only in Render.
- Set `BREVO_API_KEY`, `EMAIL_FROM`, and `EMAIL_FROM_NAME` in Vercel only if a Next.js server route sends email directly.

### 2.3 Deploy and verify

1. Deploy from Vercel dashboard
2. Open generated Vercel URL
3. Confirm pages load and API calls resolve (after Render is configured)

---

## 3) Render Backend API Configuration (Third)

### 3.1 Create web service

1. Sign in at `https://render.com`
2. New -> Web Service -> connect GitHub repo
3. Configure:
   - Name: `hasnahena-api`
   - Root Directory: `apps/api`
   - Runtime: Go
   - Build Command: `go build -o app ./cmd/server`
   - Start Command: `./app`

### 3.2 Environment variables in Render

Set:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/hasnahena_dev?sslmode=require
JWT_SECRET=replace-with-strong-random-secret
JWT_EXPIRY_SECONDS=86400
API_PORT=10000
CORS_ORIGINS=https://hasnahenafoundation.com,https://www.hasnahenafoundation.com,https://<your-vercel-project>.vercel.app
BREVO_API_KEY=your-brevo-api-key
EMAIL_FROM=info@hasnahenafoundation.com
EMAIL_FROM_NAME=Hasnahena Foundation
NEXT_PUBLIC_APP_URL=https://www.hasnahenafoundation.com
```

Important:
- Do not wrap Render values in quotes. Use `KEY=value`, not `KEY="value"`.
- Generate `BREVO_API_KEY` from Brevo dashboard: SMTP & API -> API Keys.
- In Brevo, verify sender identity/domain for `info@hasnahenafoundation.com` before going live.
- `EMAIL_FROM` must be a Brevo-verified sender email.

Important:

- Use **pooled** Neon URL for runtime apps.
- Ensure `CORS_ORIGINS` includes production domains and your current Vercel domain.

Current working value:

```dotenv
CORS_ORIGINS=https://hasnahenafoundation.com,https://www.hasnahenafoundation.com,https://hasnahena-web.vercel.app
```

### 3.3 Deploy and verify

After deploy, test:

```bash
curl https://<your-render-service>.onrender.com/v1/health
```

Expected: JSON with `status: ok`.

If `emailConfigured` is `false`, approval emails cannot be sent.

---

## 4) Cloudinary File Storage (Optional but Recommended)

If/when file upload is enabled:

1. Create account at `https://cloudinary.com`
2. Copy credentials from dashboard
3. Add env vars where upload logic runs:

```dotenv
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

4. In Cloudinary dashboard -> **Settings -> Upload**:
   - Create an upload preset (recommended name: `hasnahena-docs`)
   - Keep signed uploads for backend-controlled uploads
5. Use folder naming to keep files organized (example: `hasnahena/members`, `hasnahena/nid`, `hasnahena/nominee`)
6. Add the same Cloudinary env vars in:
   - Render (if backend performs uploads)
   - Vercel (only if Next.js server routes handle uploads)

### 4.1 Recommended Cloudinary folder strategy

Cloudinary does not require pre-creating folders. Folders are auto-created when first file is uploaded to that path.

Recommended paths:

- `hasnahena/members/` (member photos)
- `hasnahena/nid/` (NID front/back)
- `hasnahena/nominee/` (nominee documents)
- `hasnahena/misc/` (other documents)

Store both `secure_url` and `public_id` in your database so files can be updated/deleted later.

### 4.2 Recommended upload restrictions

In Cloudinary -> **Settings -> Upload** -> **Upload presets**:

1. Create preset: `hasnahena-docs`
2. Use **Signed** uploads (recommended for backend-controlled security)
3. Set allowed formats:
   - `jpg,jpeg,png,pdf`
4. Set max file size (recommended):
   - `5MB` for images/documents (or your policy)
5. Optionally set:
   - Folder (default path): `hasnahena/misc`
   - Unique filename enabled
   - Overwrite disabled

Enforce the same checks in backend too (MIME type and file size) before upload.

### 4.3 Where to put Cloudinary env vars

- Render: required if Go API uploads files
- Vercel: required only if Next.js server routes upload files
- Local: optional, only if you test uploads locally

If upload code runs only in Go API, keep Cloudinary secrets only in Render/local API env.

---

## 5) Namecheap DNS Configuration

Open Namecheap -> Domain List -> Manage -> Advanced DNS.

Create/update records:

- `A` record
  - Host: `@`
  - Value: `216.198.79.1`
  - Purpose: apex domain to Vercel
- `CNAME` record
  - Host: `www`
  - Value: `291e3aff994166f3.vercel-dns-017.com`
  - Purpose: www to Vercel
- `CNAME` record
  - Host: `api`
  - Value: `hasnahena-api.onrender.com`
  - Purpose: API subdomain to Render

Then configure custom domains:

- In Vercel: add `hasnahenafoundation.com` and `www.hasnahenafoundation.com`
- In Render: add `api.hasnahenafoundation.com`

Wait for DNS propagation (can take some time).

### 5.1 Namecheap click-by-click steps

1. Namecheap -> **Domain List** -> **Manage** (for `hasnahenafoundation.com`)
2. Open **Advanced DNS**
3. In **Host Records**, add/edit:
   - `A Record`, Host `@`, Value `216.198.79.1`, TTL `Automatic`
   - `CNAME Record`, Host `www`, Value `291e3aff994166f3.vercel-dns-017.com`, TTL `Automatic`
   - `CNAME Record`, Host `api`, Value `hasnahena-api.onrender.com`, TTL `Automatic`
4. Remove conflicting old records for `@`, `www`, or `api`
5. Save all changes
6. In Vercel -> Project -> Domains, add:
   - `hasnahenafoundation.com`
   - `www.hasnahenafoundation.com`
7. In Render -> Service -> Settings -> Custom Domains, add:
   - `api.hasnahenafoundation.com`
8. After SSL is issued, update frontend env in Vercel:
   - `NEXT_PUBLIC_API_URL=https://api.hasnahenafoundation.com`
   - Redeploy Vercel

Note: older Vercel targets (`76.76.21.21` and `cname.vercel-dns.com`) can still work, but using the latest recommended values is preferred.

---

## 6) End-to-end Verification Checklist

1. `https://hasnahenafoundation.com` opens frontend
2. `https://www.hasnahenafoundation.com` redirects/loads correctly
3. `https://api.hasnahenafoundation.com/v1/health` returns healthy status
4. Login works from frontend (no CORS errors)
5. Seed users exist and dashboard loads data

---

## 7) Troubleshooting

### Error: `ERR_PNPM_UNSUPPORTED_ENGINE`
This happens if Vercel uses an old `pnpm` version (v6).
Fix: The updated `vercel.json` uses `npx --yes pnpm@8.15.4` to bypass local versions.
Optimization: Set environment variable `ENABLE_EXPERIMENTAL_COREPACK=1` in Vercel to use the native Node.js package manager manager.

### Error: Build fails silently or with Prisma client error
Fix: Ensure `prisma generate` is run after installation. The updated configuration includes this in the install command.
Note: You may see a warning during install: `prisma:warn We could not find your Prisma schema`. This is expected in a monorepo setup and is harmless because we explicitly run `prisma generate` in the subsequent step.

### Error: `relation "users" does not exist`

Cause: database schema not created.

Fix:

```bash
cd apps/web
export DATABASE_URL='postgresql://...direct-host-without-pooler...'
npx prisma db push
```

Then rerun seed from `apps/api`.

### Error: hostname resolving `...direct...`

Cause: placeholder string used instead of real host.

Fix: replace full URL with real Neon connection string.

### `No migration found in prisma/migrations`

This is expected in current repo state. Use `npx prisma db push` to create schema.

### CORS errors from frontend to backend

Add all required frontend domains in Render `CORS_ORIGINS`, separated by commas.

### Render service sleeps

Render free tier may sleep when idle; first request can be slow (cold start).

---

## 8) Security and Operations Notes

- Rotate secrets immediately if exposed
- Never commit `.env`, `.env.local`, or raw credentials
- Use different credentials for development and production
- Back up database regularly (e.g., `pg_dump`)
- Monitor free-tier limits on Neon, Vercel, Render, and Cloudinary

---

## 9) Final Environment Variables (Recommended)

Use these as final templates.

### 9.1 Vercel (Frontend) - Production

```dotenv
NEXT_PUBLIC_API_URL=https://api.hasnahenafoundation.com
JWT_SECRET=<same-strong-secret-used-for-web-routes>
DATABASE_URL=postgresql://USER:PASSWORD@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/hasnahena_dev?sslmode=require

# Add when Cloudinary is used by web server routes:
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

### 9.2 Render (Backend API) - Production

```dotenv
API_PORT=10000
DATABASE_URL=postgresql://USER:PASSWORD@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/hasnahena_dev?sslmode=require
JWT_SECRET=<same-strong-secret-as-needed-by-your-auth-flow>
JWT_EXPIRY_SECONDS=86400
CORS_ORIGINS=https://hasnahenafoundation.com,https://www.hasnahenafoundation.com,https://hasnahena-web.vercel.app,https://api.hasnahenafoundation.com

# Add when backend performs uploads:
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

### 9.3 Local `.env.local` (Development)

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:8080
JWT_SECRET=<dev-secret>

# Use direct Neon URL for schema push/seed OR local postgres URL
DATABASE_URL=postgresql://USER:PASSWORD@ep-xxxx.ap-southeast-1.aws.neon.tech/hasnahena_dev?sslmode=require

API_PORT=8080
JWT_EXPIRY_SECONDS=86400
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
```

---

## 10) Environment Variables: Local vs Production

### 10.1 Why they are different

- **Local env**: for your machine only (development/testing)
- **Vercel env**: for frontend deployment runtime/build
- **Render env**: for backend API runtime

They are isolated from each other. Updating one does not update others.

### 10.2 Management rules

1. Never commit real secrets to git (`.env`, `.env.local`, screenshots, chat)
2. Keep separate secrets per environment:
   - local/dev secrets
   - production secrets
3. Rotate secrets if exposed
4. Maintain a safe template in `.env.example` only (no real values)
5. Update Vercel/Render env in their dashboards, then redeploy

### 10.3 Should you use everything locally?

Recommended local-first workflow:

- Database: local PostgreSQL for daily development
- API + Web: run locally
- Cloudinary: either use a separate dev Cloudinary account/preset, or skip upload testing until needed

Use Neon mostly for shared/staging/production data.

---

## 11) Full Local Development Setup

### 11.1 Local PostgreSQL (recommended for daily coding)

This repo already includes Docker Compose for Postgres:

```bash
cd /home/sword/Documents/Github/Hasnahena
docker compose up -d postgres
```

Use local DB URL:

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hasnahena_dev
```

Then create schema and seed:

```bash
cd apps/web
npx prisma db push

cd ../api
go run cmd/seed/main.go
```

### 11.2 Run app locally

From repository root:

```bash
pnpm dev
```

Expected:

- Frontend: `http://localhost:3000`
- API: `http://localhost:8080`

### 11.3 Cloudinary for local development

Cloudinary has no full local emulator. Best practice:

1. Create a separate Cloudinary account or separate dev preset
2. Put dev Cloudinary credentials in local `.env.local`
3. Use a dev-only folder prefix, e.g. `hasnahena-dev/...`
4. Never reuse production Cloudinary secrets locally

Optional shortcut: if you are not testing uploads, leave Cloudinary vars unset locally and test non-upload features only.
