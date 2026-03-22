# Development Setup Guide

> Complete guide to setting up the Hasnahena development environment

---

## 📋 Prerequisites

### Required Software

| Software | Version | Installation |
|----------|---------|--------------|
| Node.js | 20.x LTS | [nodejs.org](https://nodejs.org/) or `nvm install 20` |
| pnpm | 8.x+ | `npm install -g pnpm` |
| Go | 1.21+ | [go.dev/dl](https://go.dev/dl/) |
| Java | 17+ | [adoptium.net](https://adoptium.net/) |
| PostgreSQL | 15+ | [postgresql.org](https://www.postgresql.org/download/) |
| Docker | Latest | [docker.com](https://www.docker.com/get-started) |
| Git | Latest | [git-scm.com](https://git-scm.com/) |

### Recommended IDE

- **VS Code** with extensions:
  - ESLint
  - Prettier
  - TypeScript and JavaScript Language Features
  - Go
  - Extension Pack for Java
  - Tailwind CSS IntelliSense
  - GitLens

---

## 🚀 Quick Start

### 1. Clone Repository

```bash
git clone https://github.com/yourusername/hasnahena.git
cd hasnahena
```

### 2. Install Dependencies

```bash
# Install Node.js dependencies
pnpm install

# Install Go dependencies
cd apps/api
go mod download
cd ../..

# Install Java dependencies (if ledger service exists)
cd services/ledger
./mvnw dependency:resolve
cd ../..
```

### 3. Set Up Environment

```bash
# Copy environment template
cp .env.example .env.local

# Edit with your local configuration
# At minimum, set DATABASE_URL
```

### 4. Start Database

```bash
# Option A: Using Docker (Recommended)
docker compose up -d postgres

# Option B: Use existing PostgreSQL
# Just ensure DATABASE_URL points to your instance
```

### 5. Run Migrations

```bash
# Apply database migrations
pnpm db:migrate

# Seed development data (optional)
pnpm db:seed
```

### 6. Start Development Servers

```bash
# Start all services
pnpm dev

# Or start individually:
pnpm dev:web   # Frontend on :3000
pnpm dev:api   # Go API on :8080
```

---

## 🗄️ Database Setup

### Using Docker Compose

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    container_name: hasnahena-db
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
      POSTGRES_DB: hasnahena_dev
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: valkey/valkey:7-alpine
    container_name: hasnahena-cache
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

Start services:

```bash
docker compose up -d
```

### Manual PostgreSQL Setup

```bash
# Create database
createdb hasnahena_dev

# Create user (optional)
createuser -P hasnahena_user

# Grant privileges
psql -d hasnahena_dev -c "GRANT ALL PRIVILEGES ON DATABASE hasnahena_dev TO hasnahena_user;"
```

---

## 📁 Recommended Project Structure

When you start coding, use this structure:

```
hasnahena/
├── README.md
├── CONTRIBUTING.md
├── .gitignore
├── .env.example
├── docker-compose.yml
├── package.json                 # Root package.json for monorepo
├── pnpm-workspace.yaml          # pnpm workspace config
├── turbo.json                   # Turborepo config (optional)
│
├── docs/                        # Documentation (already exists)
│
├── apps/
│   ├── web/                     # Next.js Frontend
│   │   ├── package.json
│   │   ├── next.config.js
│   │   ├── tailwind.config.js
│   │   ├── tsconfig.json
│   │   ├── app/                 # App Router
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   ├── (auth)/          # Auth routes group
│   │   │   │   ├── login/
│   │   │   │   └── register/
│   │   │   ├── (dashboard)/     # Dashboard routes group
│   │   │   │   ├── member/
│   │   │   │   ├── worker/
│   │   │   │   └── admin/
│   │   │   └── api/             # API routes (if needed)
│   │   ├── components/
│   │   │   ├── ui/              # Shadcn UI components
│   │   │   ├── forms/           # Form components
│   │   │   ├── tables/          # Table components
│   │   │   └── layouts/         # Layout components
│   │   ├── lib/
│   │   │   ├── api.ts           # API client
│   │   │   ├── utils.ts         # Utility functions
│   │   │   └── validations.ts   # Zod schemas
│   │   ├── hooks/               # Custom hooks
│   │   ├── stores/              # Zustand stores
│   │   ├── styles/              # Global styles
│   │   └── public/              # Static assets
│   │
│   └── api/                     # Go API Gateway
│       ├── go.mod
│       ├── go.sum
│       ├── Dockerfile
│       ├── cmd/
│       │   └── server/
│       │       └── main.go
│       ├── internal/
│       │   ├── config/          # Configuration
│       │   ├── handlers/        # HTTP handlers
│       │   ├── services/        # Business logic
│       │   ├── repositories/    # Data access
│       │   ├── models/          # Domain models
│       │   ├── middleware/      # HTTP middleware
│       │   └── utils/           # Utilities
│       └── pkg/                 # Public packages
│
├── services/
│   └── ledger/                  # Java Spring Boot (Core Banking)
│       ├── pom.xml
│       ├── Dockerfile
│       └── src/
│           ├── main/
│           │   ├── java/com/hasnahena/ledger/
│           │   │   ├── LedgerApplication.java
│           │   │   ├── controller/
│           │   │   ├── service/
│           │   │   ├── repository/
│           │   │   ├── model/
│           │   │   ├── dto/
│           │   │   └── config/
│           │   └── resources/
│           │       └── application.yml
│           └── test/
│
├── packages/                    # Shared packages
│   ├── config/                  # Shared config (ESLint, TypeScript)
│   │   ├── package.json
│   │   ├── eslint-preset.js
│   │   └── tsconfig.base.json
│   ├── types/                   # Shared TypeScript types
│   │   ├── package.json
│   │   └── src/
│   │       ├── member.ts
│   │       ├── transaction.ts
│   │       └── loan.ts
│   └── validators/              # Shared Zod schemas
│       ├── package.json
│       └── src/
│
├── database/
│   ├── migrations/              # SQL migrations
│   │   ├── 001_create_users.sql
│   │   ├── 002_create_nominees.sql
│   │   └── ...
│   └── seeds/                   # Seed data
│       └── development.sql
│
└── scripts/                     # Development scripts
    ├── setup.sh
    ├── db-migrate.sh
    └── db-seed.sh
```

---

## 🔧 Configuration Files

### Root package.json

```json
{
  "name": "hasnahena",
  "private": true,
  "scripts": {
    "dev": "turbo dev",
    "dev:web": "pnpm --filter web dev",
    "dev:api": "cd apps/api && go run cmd/server/main.go",
    "build": "turbo build",
    "test": "turbo test",
    "lint": "turbo lint",
    "db:migrate": "./scripts/db-migrate.sh",
    "db:seed": "./scripts/db-seed.sh"
  },
  "devDependencies": {
    "turbo": "^1.10.0"
  }
}
```

### pnpm-workspace.yaml

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

### turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": [".env.local"],
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {},
    "test": {}
  }
}
```

---

## 📝 First Steps After Setup

### 1. Initialize Next.js App

```bash
cd apps
pnpm create next-app web --typescript --tailwind --eslint --app --src-dir=false
cd web

# Install Shadcn UI
pnpm dlx shadcn-ui@latest init

# Add components as needed
pnpm dlx shadcn-ui@latest add button input form table
```

### 2. Initialize Go API

```bash
mkdir -p apps/api
cd apps/api
go mod init github.com/yourusername/hasnahena/apps/api

# Install dependencies
go get github.com/go-chi/chi/v5
go get github.com/jackc/pgx/v5
go get github.com/golang-jwt/jwt/v5
```

### 3. Create First Database Migration

```sql
-- database/migrations/001_create_users.sql

-- Users table (members, workers, admins)
CREATE TABLE users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role VARCHAR(20) NOT NULL CHECK (role IN ('MEMBER', 'WORKER', 'ADMIN')),
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE,
    nid_number VARCHAR(20) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED')),
    minimum_deposit_met BOOLEAN DEFAULT FALSE,
    must_change_password BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);
```

---

## 🧪 Running Tests

```bash
# All tests
pnpm test

# Frontend tests
pnpm --filter web test

# Go API tests
cd apps/api && go test ./...

# With coverage
cd apps/api && go test -cover ./...
```

---

## 🚢 Building for Production

```bash
# Build all apps
pnpm build

# Build specific app
pnpm --filter web build

# Build Docker images
docker build -t hasnahena-web ./apps/web
docker build -t hasnahena-api ./apps/api
```

---

## 🐛 Troubleshooting

### Database Connection Issues

```bash
# Check if PostgreSQL is running
docker ps | grep postgres

# Check connection
psql -h localhost -U postgres -d hasnahena_dev -c "SELECT 1"
```

### Port Conflicts

```bash
# Check what's using port 3000
lsof -i :3000

# Check what's using port 8080
lsof -i :8080
```

### Clear Caches

```bash
# Clear Next.js cache
rm -rf apps/web/.next

# Clear pnpm cache
pnpm store prune

# Clear Go module cache
go clean -modcache
```

---

## 📚 Useful Commands

```bash
# Database
pnpm db:migrate          # Run migrations
pnpm db:seed             # Seed data
pnpm db:reset            # Reset database

# Development
pnpm dev                 # Start all services
pnpm lint                # Lint all code
pnpm format              # Format all code
pnpm typecheck           # Type check

# Git
git status               # Check changes
git add -p               # Interactive staging
git commit -m "feat: ..." # Commit with message
```

---

*Happy coding! 🚀*
