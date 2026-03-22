# Hasnahena (হাসনাহেনা)

> An interest-free cooperative finance platform based on Islamic financial principles (Qard al-Hasan)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Documentation](https://img.shields.io/badge/docs-available-brightgreen.svg)](docs/)

---

## 🌟 About

**Hasnahena** is a community-run, interest-free (সুদমুক্ত) cooperative finance initiative based in Bangladesh. The platform enables community members to:

- 💰 **Deposit** savings without earning interest
- 🤝 **Borrow** funds without paying interest (Qard al-Hasan)
- 🛡️ **Guarantee** loans for other community members
- 🎁 **Donate** to charitable funds (Zakat, Sadaqah)

The software digitizes member onboarding, deposits, withdrawals, loans, donations, and provides complete accountability while preserving Islamic finance principles.

**Motto:** "সুদ ও দারিদ্রমুক্ত সমাজ গড়ি" (Building an interest-free and poverty-free society)

---

## 📋 Features

### For Members
- ✅ Online registration with NID verification
- ✅ Deposit and withdrawal management
- ✅ Loan application and tracking
- ✅ Act as guarantor for other members
- ✅ Donate to various charitable funds
- ✅ Bilingual interface (English/Bengali)

### For Workers (Staff)
- ✅ Process deposit/withdrawal requests
- ✅ Record loan disbursements and repayments
- ✅ Transaction queue management with SLA tracking

### For Administrators
- ✅ Approve/reject member registrations
- ✅ Approve/reject loan applications
- ✅ Configure system parameters
- ✅ Dispute resolution
- ✅ Complete audit trail access

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 14+, React 18, TypeScript, Tailwind CSS, Shadcn UI |
| **Backend (Edge)** | Go (Golang) with Chi/Gin router |
| **Backend (Core)** | Java 17+ with Spring Boot 3 (for financial transactions) |
| **Database** | PostgreSQL 15+ |
| **Cache** | Valkey (Redis alternative) |
| **Authentication** | Clerk / Auth.js → Keycloak (enterprise) |
| **SMS Gateway** | SSL Wireless (Bangladesh) |

---

## 📁 Project Structure

```
hasnahena/
├── README.md                    # This file
├── CONTRIBUTING.md              # Contribution guidelines
├── .gitignore                   # Git ignore rules
├── .env.example                 # Environment variables template
│
├── docs/                        # Documentation
│   ├── README.md                # Documentation index
│   ├── specifications/          # PDF specifications
│   │   ├── Business_Requirements_Document.pdf
│   │   ├── System_Requirements_Specification.pdf
│   │   ├── Functional_Requirements_Document.pdf
│   │   ├── API_Contract_Specification.pdf
│   │   ├── Database_Schema_Design.pdf
│   │   ├── System_Architecture_Design.pdf
│   │   ├── Use_Case_Specification.pdf
│   │   ├── Test_Plan_and_Strategy.pdf
│   │   └── Implementation_Roadmap.pdf
│   ├── latex/                   # LaTeX source files
│   └── references/              # Original reference materials
│
├── apps/                        # Applications (monorepo)
│   ├── web/                     # Next.js frontend
│   └── api/                     # Go API gateway
│
├── packages/                    # Shared packages
│   ├── ui/                      # Shared UI components
│   ├── config/                  # Shared configurations
│   └── types/                   # Shared TypeScript types
│
└── services/                    # Backend microservices
    └── ledger/                  # Java Spring Boot core ledger
```

---

## 🚀 Quick Start

### Prerequisites

- Node.js 20+ and pnpm
- Go 1.21+
- Java 17+ (for ledger service)
- PostgreSQL 15+
- Docker (optional, for local development)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/hasnahena.git
cd hasnahena

# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env.local

# Start development servers
pnpm dev
```

### Environment Variables

See `.env.example` for all required environment variables.

---

## 📖 Documentation

All project documentation is available in the `docs/` directory:

| Document | Description |
|----------|-------------|
| [Business Requirements](docs/specifications/Business_Requirements_Document.pdf) | Business context, objectives, stakeholders |
| [System Requirements](docs/specifications/System_Requirements_Specification.pdf) | Functional and non-functional requirements |
| [Functional Requirements](docs/specifications/Functional_Requirements_Document.pdf) | Detailed feature specifications |
| [API Contract](docs/specifications/API_Contract_Specification.pdf) | REST API endpoints and contracts |
| [Database Schema](docs/specifications/Database_Schema_Design.pdf) | Entity-relationship design |
| [System Architecture](docs/specifications/System_Architecture_Design.pdf) | Technical architecture and infrastructure |
| [Use Cases](docs/specifications/Use_Case_Specification.pdf) | Actor interactions and workflows |
| [Test Plan](docs/specifications/Test_Plan_and_Strategy.pdf) | QA strategy and test coverage |
| [Implementation Roadmap](docs/specifications/Implementation_Roadmap.pdf) | Development phases and milestones |

---

## 🔐 Security

- Role-Based Access Control (RBAC) for all operations
- Immutable audit logs for financial transactions
- Double-entry bookkeeping for ledger integrity
- Data encryption at rest and in transit

---

## 🤝 Contributing

This is currently a solo project by **Md Saif Ahmed**. However, contributions are welcome!

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting pull requests.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 👤 Author

**Md Saif Ahmed**

- GitHub: [@Saif-Sakib](https://github.com/Saif-Sakib)
- Email: saifahmedsakib@gmail.com

---

## 🙏 Acknowledgments

- Hasnahena Foundation, Jessore, Bangladesh
- The open-source community

---

<p align="center">
  <strong>Built with ❤️ for the community</strong><br>
  <em>"সুদ ও দারিদ্রমুক্ত সমাজ গড়ি"</em>
</p>
