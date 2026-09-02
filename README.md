# Hasnahena (হাসনাহেনা)

> An interest-free cooperative finance platform built on Qard al-Hasan principles.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Hasnahena Foundation is a community-run, interest-free (সুদমুক্ত) cooperative in Jessore, Bangladesh. This platform digitises its passbook: members deposit savings that earn no interest, borrow with no interest and no fees, guarantee each other's loans, and donate — with every taka traceable to a member request and a member confirmation.

**সুদ ও দারিদ্রমুক্ত সমাজ গড়ি** — "Building an interest-free and poverty-free society"

## What it does

**Members** register online with NID and nominee details, track deposits and withdrawals, request deposits and repayments, donate, and confirm or dispute every posting on their account. **Workers** process pending member requests and record disbursements and installments — they never move money on their own initiative. **Admins** approve registrations and loans, resolve disputes, configure policy, and run default settlement. Everything is bilingual English/Bengali.

> **Status: live.** Serving real members since the cutover on 2026-08-27 — the database holds real people, real balances and real identity documents. Treat every environment accordingly: [docs/workflow.md](docs/workflow.md) is how a change reaches them safely, [docs/runbook.md](docs/runbook.md) is the night something breaks, and [docs/tasks.md](docs/tasks.md) is what is still outstanding.

## Stack

Next.js 16 (App Router, TypeScript, Tailwind 4, shadcn/ui, next-intl 4, React 19) · Go 1.25 (chi, pgx) · PostgreSQL via Prisma 5 · Brevo email · Cloudinary · deployed on Vercel + Render + Neon.

The Go API owns everything that moves a balance; Next.js route handlers cover registration intake, content, and settings. See [docs/architecture.md](docs/architecture.md).

## Quick start

```bash
pnpm install
cp .env.example .env.local     # set DATABASE_URL and a 32+ char JWT_SECRET
docker compose up -d postgres
pnpm db:migrate                # NOT db:push — see ADR-014
pnpm db:seed                   # first admin + config defaults
pnpm dev                       # web :3000 · api :8081
```

Full instructions, environment variables, and troubleshooting: [docs/setup.md](docs/setup.md).

## Layout

```
apps/web     Next.js frontend + Prisma schema + content APIs
apps/api     Go API — auth, dashboards, all financial writes
docs/        product, architecture, data model, API, setup, deployment, decisions, tasks, traps
scripts/     test stack, backup, restore drill, PostgreSQL client resolution
```

## Documentation

[docs/README.md](docs/README.md) is the index. Start with [product.md](docs/product.md) for the domain, [architecture.md](docs/architecture.md) for the system, [tasks.md](docs/tasks.md) for current status.

## Security

Role-based access control on every protected endpoint, bcrypt password hashing, JWT with server-side revocation checked by **both** backends, rate limiting and lockout keyed on one address resolver, audit logs made append-only by a database trigger, and single-transaction atomicity for all financial writes.

Security review is continuous: CI runs `gitleaks` over full history, `golangci-lint`, the integration suite under `-race`, and a backup/restore drill on every push. Everything still outstanding is listed in [docs/tasks.md](docs/tasks.md) rather than hidden.

## Contributing

Solo project by **Md Saif Ahmed**, contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).

---

<p align="center"><em>Built for the community · হাসনাহেনা ফাউন্ডেশন, যশোর</em></p>
