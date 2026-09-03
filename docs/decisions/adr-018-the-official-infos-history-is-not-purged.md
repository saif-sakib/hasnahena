# ADR-018 — The `Official Infos/` history is not purged

**Status:** accepted · 2026-08-18 · closes WO-28, supersedes SEC-06 and SEC-10.

`git rev-list` over all refs finds 39 files under `Official Infos/` (~40 MB,
added in `f152f0c`, deleted in `9306120`) with names like
`Hasnahena Member Details.docx` and `Loan Member Detail.docx`, plus three stray
binaries — `react` (24.6 MB), `apps/api/server` (17.5 + 16.4 MB) and
`apps/api/seed` (13.6 MB).

WO-28 treated this as a data incident on the strength of those filenames, and
specified a `git filter-repo` purge plus a force-push of every ref plus a GitHub
Support ticket to garbage-collect the unreachable blobs.

**The repository owner reviewed the contents and determined that none of it is
live member data** — the platform has never held real member records. On that
finding the purge is not warranted: it rewrites every commit hash in the
repository, is irreversible, and its entire justification was the sensitivity of
those files.

**What this decision rests on, stated plainly so it can be revisited:** an
owner's inspection of files a script cannot classify (the largest is an
image-only PDF scan). If that assessment is ever found to be wrong, the runbook
is in this file's history at the commit that removed WO-28 — `git log -- docs/work-orders.md`
— and it gets more expensive with every clone taken.

**Consequences**

- Roughly 100 MB of dead weight stays in history. Clone size is the cost, and
  the repository is private with no other collaborators.
- `.gitignore` carries `Official Infos/` so a re-add is not one `git add -A`
  away, and the binaries are covered by the existing rules.
- **The exemption is for these specific files only.** Real member data
  committed after launch is a different question with a different answer, and
  the cheapest moment to rewrite history is always now rather than later.

---

[← all decisions](../decisions.md)
