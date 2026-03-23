# Seed Data Guide

This project has two seed entry points:

- **Primary (full dataset):** `apps/api/cmd/seed/main.go`
- **Secondary (web-only fallback):** `apps/web/prisma/seed.js`

Use the **primary seed** by default so API and dashboard flows have consistent demo data.

## Recommended command

From repository root:

```bash
pnpm db:seed
```

This runs the API seed (`apps/api/cmd/seed/main.go`).  
The seed loader now reads env from:

- existing exported env vars (highest priority)
- `apps/api/.env` and `apps/api/.env.local`
- repo root `.env` and `.env.local`

## Optional commands

```bash
# Full API-oriented seed (same as pnpm db:seed)
pnpm db:seed:api

# Clear app tables, then reseed (recommended for stale/broken data)
pnpm db:seed:reset

# Web/Prisma fallback seed (minimal but consistent identities)
pnpm db:seed:web
```

## What gets seeded

Primary seed (`db:seed` / `db:seed:api`) creates:

- Login users:
  - `admin@hasnahena.local / Admin@12345`
  - `staff@hasnahena.local / Staff@12345`
  - `member@hasnahena.local / Member@12345`
- Additional members with mixed statuses (`ACTIVE`, `PENDING`, `SUSPENDED`)
- Accounts with balances and eligibility values
- Loans across multiple states (`ACTIVE`, `COMPLETED`, `DEFAULTED`, `PENDING`)
- Deposit, repayment, and donation transactions
- Addresses and nominee records

Web fallback seed (`db:seed:web`) now also includes:

- Same 3 login users and aligned member IDs (`HN-A-001`, `HN-W-001`, `HN-M-001`)
- Accounts, addresses, nominee, and representative transactions
- Loan workflow states used by web APIs (`PENDING_GUARANTOR`, `PENDING_APPROVAL`)
- Baseline `branches` and `system_config` records

## When to use which

- Use **`pnpm db:seed`** for normal local development and API verification.
- Use **`pnpm db:seed:web`** only if you are running a web-only Prisma workflow and do not need full API demo coverage.

## Important consistency rule

Do **not** treat both seeds as equivalent. They target different depth:

- API seed = comprehensive scenario data
- Web seed = lighter fallback

If your local data looks inconsistent, reset your local DB and run:

```bash
pnpm db:seed:reset
```

## Neon reset + seed

If `DATABASE_URL` points to your Neon branch, the same command works:

```bash
pnpm db:seed:reset
```

That will:

1. connect to Neon using `DATABASE_URL`
2. truncate app tables (`users`, `accounts`, `loans`, `transactions`, etc.)
3. insert fresh seed data

If you only want to verify env loading before seeding:

```bash
cd apps/api
go run cmd/seed/main.go --check-env
```
