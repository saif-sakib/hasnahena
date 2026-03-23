# Hasnahena Free Hosting Deployment Guide

This guide documents a full no-cost deployment setup for:

- Database: Neon (PostgreSQL)
- Frontend: Vercel (Next.js)
- Backend API: Render (Go)
- Files: Cloudinary (free tier)
- Domain/DNS: Namecheap (`hasnahenafoundation.com`)

> Security note: if you ever exposed database credentials in chat/screenshots/commits, rotate them immediately in Neon and update all environment variables.

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
     - Install Command: `cd ../.. && npm install -g pnpm@8.15.4 && pnpm install`
     - Build Command: `cd ../.. && pnpm build`

### 2.2 Environment variables in Vercel

Set these in Project Settings -> Environment Variables:

```dotenv
NEXT_PUBLIC_API_URL=https://api.hasnahenafoundation.com
JWT_SECRET=replace-with-strong-random-secret
DATABASE_URL=postgresql://USER:PASSWORD@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/hasnahena_dev?sslmode=require
```

Notes:

- `NEXT_PUBLIC_API_URL` should point to your Render custom API domain.
- Keep `JWT_SECRET` and `DATABASE_URL` as secret variables.

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
```

Important:

- Use **pooled** Neon URL for runtime apps.
- Ensure `CORS_ORIGINS` includes production domains and temporary Vercel preview domain.

### 3.3 Deploy and verify

After deploy, test:

```bash
curl https://<your-render-service>.onrender.com/v1/health
```

Expected: JSON with `status: ok`.

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

---

## 5) Namecheap DNS Configuration

Open Namecheap -> Domain List -> Manage -> Advanced DNS.

Create/update records:

- `A` record
  - Host: `@`
  - Value: `76.76.21.21`
  - Purpose: apex domain to Vercel
- `CNAME` record
  - Host: `www`
  - Value: `cname.vercel-dns.com`
  - Purpose: www to Vercel
- `CNAME` record
  - Host: `api`
  - Value: `<your-render-service>.onrender.com`
  - Purpose: API subdomain to Render

Then configure custom domains:

- In Vercel: add `hasnahenafoundation.com` and `www.hasnahenafoundation.com`
- In Render: add `api.hasnahenafoundation.com`

Wait for DNS propagation (can take some time).

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
This happens if Vercel uses an old `pnpm` version (v6) instead of the project's required version (v8+).
Fix: Ensure `installCommand` in Vercel settings explicitly installs the correct version: `cd ../.. && npm install -g pnpm@8.15.4 && pnpm install`. This overrides the default environment.
Alternatively, set the environment variable `ENABLE_EXPERIMENTAL_COREPACK=1` in Vercel.

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

