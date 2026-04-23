# Contributing to Hasnahena

Thank you for your interest in contributing to Hasnahena! This document provides guidelines and standards for contributing to this project.

---

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Project Structure](#project-structure)

---

## 📜 Code of Conduct

This project is built on Islamic financial principles. Please ensure all contributions:

- Respect the interest-free (Riba-free) nature of the platform
- Maintain financial integrity and transparency
- Follow ethical coding practices
- Be respectful and professional in all communications

---

## 🚀 Getting Started

### Prerequisites

```bash
# Required tools
node --version    # v20.0.0 or higher
pnpm --version    # v8.0.0 or higher
go version        # go1.21 or higher
java --version    # 17 or higher
psql --version    # 15 or higher
```

### Local Development Setup

```bash
# 1. Fork and clone the repository
git clone https://github.com/YOUR_USERNAME/hasnahena.git
cd hasnahena

# 2. Add upstream remote
git remote add upstream https://github.com/ORIGINAL_OWNER/hasnahena.git

# 3. Install dependencies
pnpm install

# 4. Set up environment variables
cp .env.example .env.local
# Edit .env.local with your local configuration

# 5. Start the database (Docker)
docker compose up -d postgres

# 6. Run database migrations
pnpm db:migrate

# 7. Optional: clear existing data (keeps admin, gallery, system info)
pnpm db:clear

# 8. Start development servers
pnpm dev
```

---

## 🔄 Development Workflow

### Branch Strategy

We use a simplified Git Flow:

```
main            → Production-ready code
├── develop     → Integration branch for features
├── feature/*   → New features
├── fix/*       → Bug fixes
├── docs/*      → Documentation updates
└── refactor/*  → Code refactoring
```

### Creating a Branch

```bash
# Always start from develop
git checkout develop
git pull upstream develop

# Create feature branch
git checkout -b feature/your-feature-name

# Create fix branch
git checkout -b fix/issue-number-description
```

### Branch Naming Convention

```
feature/add-loan-calculator
feature/member-dashboard
fix/123-withdrawal-validation
docs/update-api-documentation
refactor/transaction-service
```

---

## 📏 Coding Standards

### TypeScript/JavaScript (Frontend)

```typescript
// ✅ Good: Use TypeScript strict mode
// tsconfig.json: "strict": true

// ✅ Good: Explicit types for function parameters and returns
function calculateLoanEligibility(deposit: number): LoanEligibility {
  // ...
}

// ✅ Good: Use interfaces for object shapes
interface Member {
  id: string;
  fullName: string;
  phone: string;
  email?: string;
}

// ✅ Good: Use const for constants
const MINIMUM_DEPOSIT = 8000;
const LOAN_MULTIPLIER = 5;

// ❌ Bad: Avoid any type
function processData(data: any) { } // Don't do this

// ❌ Bad: Avoid magic numbers
if (deposit > 8000) { } // Use named constants instead
```

### Go (Backend API)

```go
// ✅ Good: Use descriptive variable names
func (s *TransactionService) ProcessDeposit(ctx context.Context, req DepositRequest) error {
    // ...
}

// ✅ Good: Handle errors explicitly
result, err := s.repo.FindByID(ctx, id)
if err != nil {
    return fmt.Errorf("finding member: %w", err)
}

// ✅ Good: Use structured logging
s.logger.Info("deposit processed",
    "memberID", req.MemberID,
    "amount", req.Amount,
)

// ❌ Bad: Don't ignore errors
result, _ := s.repo.FindByID(ctx, id) // Don't do this
```

### Java (Ledger Service)

```java
// ✅ Good: Use Optional for nullable returns
public Optional<Transaction> findById(UUID id) {
    return transactionRepository.findById(id);
}

// ✅ Good: Use @Transactional for financial operations
@Transactional(isolation = Isolation.SERIALIZABLE)
public void processLoanDisbursement(LoanDisbursementRequest request) {
    // ...
}

// ✅ Good: Validate inputs
public void createDeposit(@Valid @NotNull DepositRequest request) {
    // ...
}
```

### SQL/Database

```sql
-- ✅ Good: Use lowercase for SQL keywords (consistency)
select * from users where status = 'ACTIVE';

-- ✅ Good: Use snake_case for column names
created_at, updated_at, member_id

-- ✅ Good: Always include indexes for foreign keys
create index idx_transactions_member_id on transactions(member_id);

-- ✅ Good: Use transactions for financial operations
begin;
  update accounts set balance = balance - 1000 where id = 'member_1';
  update accounts set balance = balance + 1000 where id = 'pool';
commit;
```

### File Naming

```
# Components (PascalCase)
MemberDashboard.tsx
LoanCalculator.tsx

# Utilities (camelCase)
formatCurrency.ts
calculateEligibility.ts

# API routes (kebab-case)
/api/loan-applications
/api/member-profile

# Database migrations (timestamp_snake_case)
20240101120000_create_users_table.sql
20240101120001_create_transactions_table.sql
```

---

## 📝 Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/):

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, missing semicolons, etc. |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding missing tests |
| `chore` | Maintenance tasks |

### Examples

```bash
# Feature
git commit -m "feat(loan): add loan eligibility calculator"

# Bug fix
git commit -m "fix(auth): resolve session timeout issue"

# Documentation
git commit -m "docs(api): update API contract for deposits"

# With body
git commit -m "feat(member): add nominee management

- Add nominee form component
- Add API endpoint for nominee updates
- Add database migration for nominee fields

Closes #123"
```

### Rules

1. Use imperative mood: "add" not "added" or "adds"
2. Don't capitalize the first letter
3. No period at the end of the subject line
4. Limit subject line to 50 characters
5. Wrap body at 72 characters

---

## 🔀 Pull Request Process

### Before Submitting

- [ ] Code follows project coding standards
- [ ] All tests pass locally (`pnpm test`)
- [ ] Linting passes (`pnpm lint`)
- [ ] Types check (`pnpm typecheck`)
- [ ] Documentation updated if needed
- [ ] Commits follow conventional commit format

### PR Title Format

Same as commit messages:
```
feat(loan): add loan eligibility calculator
fix(auth): resolve session timeout issue
```

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
Describe how you tested the changes

## Checklist
- [ ] My code follows the project's coding standards
- [ ] I have performed a self-review
- [ ] I have commented my code where necessary
- [ ] I have updated the documentation
- [ ] My changes generate no new warnings
- [ ] I have added tests that prove my fix/feature works
- [ ] All tests pass locally
```

### Review Process

1. Submit PR to `develop` branch
2. Automated checks run (lint, test, build)
3. Code review by maintainer
4. Address feedback
5. Merge when approved

---

## 📁 Project Structure

```
hasnahena/
├── apps/
│   ├── web/                     # Next.js frontend
│   │   ├── app/                 # App router pages
│   │   ├── components/          # React components
│   │   │   ├── ui/              # Base UI components
│   │   │   ├── features/        # Feature-specific components
│   │   │   └── layouts/         # Layout components
│   │   ├── lib/                 # Utility functions
│   │   ├── hooks/               # Custom React hooks
│   │   ├── stores/              # State management
│   │   └── styles/              # Global styles
│   │
│   └── api/                     # Go API gateway
│       ├── cmd/                 # Application entry points
│       ├── internal/
│       │   ├── handlers/        # HTTP handlers
│       │   ├── services/        # Business logic
│       │   ├── repositories/    # Data access
│       │   └── middleware/      # HTTP middleware
│       └── pkg/                 # Public packages
│
├── services/
│   └── ledger/                  # Java Spring Boot
│       ├── src/main/java/
│       │   └── com/hasnahena/ledger/
│       │       ├── controller/  # REST controllers
│       │       ├── service/     # Business logic
│       │       ├── repository/  # Data access
│       │       ├── model/       # Domain models
│       │       └── dto/         # Data transfer objects
│       └── src/test/java/       # Tests
│
├── packages/
│   ├── ui/                      # Shared UI components
│   ├── config/                  # Shared configuration
│   ├── types/                   # Shared TypeScript types
│   └── validators/              # Shared validation logic
│
└── docs/                        # Documentation
```

---

## 💡 Tips for Contributors

1. **Start Small:** Begin with documentation fixes or small bug fixes
2. **Ask Questions:** Open an issue to discuss before major changes
3. **Test Thoroughly:** Financial software requires extra testing rigor
4. **Document:** Update docs when changing user-facing features
5. **Be Patient:** Reviews may take time for a solo maintainer

---

## 📞 Need Help?

- 📖 Check existing [documentation](docs/)
- 🔍 Search [existing issues](https://github.com/yourusername/hasnahena/issues)
- 💬 Open a new issue with the question label

---

Thank you for contributing to Hasnahena! 🙏
