# Hasnahena (হাসনাহেনা)

> An interest-free cooperative finance platform built on Qard al-Hasan principles.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Hasnahena Foundation is a community-run, interest-free (সুদমুক্ত) cooperative in Jessore, Bangladesh. This platform digitises its passbook: members deposit savings that earn no interest, borrow with no interest and no fees, guarantee each other's loans, and donate — with every taka traceable to a member request and a member confirmation.

**সুদ ও দারিদ্রমুক্ত সমাজ গড়ি** — "Building an interest-free and poverty-free society"

## What it does

**Members** register online with NID and nominee details, track deposits and withdrawals, apply for loans, stand as guarantor for others, donate, and confirm or dispute every posting on their account. **Workers** process pending member requests and record disbursements and installments — they never move money on their own initiative. **Admins** approve registrations and loans, resolve disputes, configure policy, and run default settlement. Everything is bilingual English/Bengali.

## Stack

Next.js 14 (App Router, TypeScript, Tailwind, shadcn/ui, next-intl) · Go 1.22 (chi, pgx) · PostgreSQL via Prisma · Brevo email · Cloudinary · deployed on Vercel + Render + Neon.

The Go API owns everything that moves a balance; Next.js route handlers cover registration intake, content, and settings. See [docs/architecture.md](docs/architecture.md).

## Quick start

```bash
pnpm install
cp .env.example .env.local     # set DATABASE_URL and a 32+ char JWT_SECRET
docker compose up -d postgres
pnpm db:push
pnpm dev                       # web :3000 · api :8081
```

Full instructions, environment variables, and troubleshooting: [docs/setup.md](docs/setup.md).

## Layout

```
apps/web     Next.js frontend + Prisma schema + content APIs
apps/api     Go API — auth, dashboards, all financial writes
docs/        product, architecture, data model, API, setup, deployment, decisions, tasks
scripts/     one-off SQL utilities
```

## Documentation

[docs/README.md](docs/README.md) is the index. Start with [product.md](docs/product.md) for the domain, [architecture.md](docs/architecture.md) for the system, [tasks.md](docs/tasks.md) for current status.

## Security

Role-based access control on every protected endpoint, bcrypt password hashing, JWT with server-side revocation, rate limiting and lockout, append-only audit logs, and single-transaction atomicity for all financial writes.

## Contributing

Solo project by **Md Saif Ahmed**, contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).

---

<p align="center"><em>Built for the community · হাসনাহেনা ফাউন্ডেশন, যশোর</em></p>
