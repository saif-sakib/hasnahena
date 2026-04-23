# Hasnahena Documentation

> Comprehensive documentation for the Hasnahena cooperative finance platform

---

## 📚 Documentation Index

### Specification Documents (PDF)

These are the formal specification documents that define what to build:

| Document | Description | Status |
|----------|-------------|--------|
| [Business Requirements](specifications/Business_Requirements_Document.pdf) | Business context, objectives, stakeholders, and success criteria | ✅ Complete |
| [System Requirements](specifications/System_Requirements_Specification.pdf) | Functional and non-functional requirements | ✅ Complete |
| [Functional Requirements](specifications/Functional_Requirements_Document.pdf) | Detailed feature specifications with requirement IDs | ✅ Complete |
| [API Contract](specifications/API_Contract_Specification.pdf) | REST API endpoints, request/response formats | ✅ Complete |
| [Database Schema](specifications/Database_Schema_Design.pdf) | Entity-relationship design, table definitions | ✅ Complete |
| [System Architecture](specifications/System_Architecture_Design.pdf) | Technical architecture, infrastructure, tech stack | ✅ Complete |
| [Use Cases](specifications/Use_Case_Specification.pdf) | Actor interactions, workflows, scenarios | ✅ Complete |
| [Test Plan](specifications/Test_Plan_and_Strategy.pdf) | QA strategy, test coverage, priorities | ✅ Complete |
| [Implementation Roadmap](specifications/Implementation_Roadmap.pdf) | Development phases, milestones, readiness checklist | ✅ Complete |

### Reference Materials

Original source materials and organized specifications:

| Document | Description |
|----------|-------------|
| [Registration Form](references/registration-form.md) | Member registration form field specification |
| [Passbook Specification](references/passbook-specification.md) | Savings and loan passbook structure |
| [Requirements.txt](references/Requirements.txt) | Original requirements notes |

### Setup & Deployment Guides

| Document | Description |
|----------|-------------|
| [Quick Start](../QUICKSTART.md) | Local run, database cleanup, and API smoke-test flow |
| [Free Hosting Deployment Guide](DEPLOYMENT_FREE_HOSTING.md) | Step-by-step setup for Neon, Vercel, Render, Cloudinary, and Namecheap DNS |

### LaTeX Source Files

All specification documents are written in LaTeX for professional formatting. Source files are in `latex/` directory.

---

## 🗂️ Directory Structure

```
docs/
├── README.md                    # This file
├── specifications/              # PDF specification documents
│   ├── Business_Requirements_Document.pdf
│   ├── System_Requirements_Specification.pdf
│   ├── Functional_Requirements_Document.pdf
│   ├── API_Contract_Specification.pdf
│   ├── Database_Schema_Design.pdf
│   ├── System_Architecture_Design.pdf
│   ├── Use_Case_Specification.pdf
│   ├── Test_Plan_and_Strategy.pdf
│   └── Implementation_Roadmap.pdf
├── latex/                       # LaTeX source files
│   └── *.tex
└── references/                  # Original reference materials
    ├── registration-form.md
    ├── passbook-specification.md
    └── *.txt
```

---

## 📖 Reading Order for New Developers

If you're new to the project, read the documents in this order:

1. **[Business Requirements](specifications/Business_Requirements_Document.pdf)** - Understand what problem we're solving
2. **[System Requirements](specifications/System_Requirements_Specification.pdf)** - Understand the technical requirements
3. **[System Architecture](specifications/System_Architecture_Design.pdf)** - Understand how the system is structured
4. **[Database Schema](specifications/Database_Schema_Design.pdf)** - Understand the data model
5. **[API Contract](specifications/API_Contract_Specification.pdf)** - Understand the API interfaces
6. **[Use Cases](specifications/Use_Case_Specification.pdf)** - Understand user workflows
7. **[Functional Requirements](specifications/Functional_Requirements_Document.pdf)** - Detailed feature requirements
8. **[Implementation Roadmap](specifications/Implementation_Roadmap.pdf)** - Development plan
9. **[Test Plan](specifications/Test_Plan_and_Strategy.pdf)** - QA approach

---

## 🔄 Document Updates

### Regenerating PDFs

To regenerate PDFs from LaTeX sources:

```bash
cd docs/latex
for f in *.tex; do
  pdflatex -output-directory=../specifications "$f"
  pdflatex -output-directory=../specifications "$f"  # Run twice for TOC
done
```

### Version Control

- All documents are version 1.0 (initial release)
- Version history is tracked in each document's "Document Control" section
- Major changes require version increment and changelog entry

---

## 📝 Contributing to Documentation

1. Edit the LaTeX source files in `latex/`
2. Regenerate the PDF
3. Update this README if adding new documents
4. Submit PR with both `.tex` and `.pdf` changes

---

## 🔗 Quick Links

- [Main README](../README.md) - Project overview
- [Contributing Guide](../CONTRIBUTING.md) - How to contribute
- [Environment Setup](../.env.example) - Environment variables

---

*Last updated: March 2026*
