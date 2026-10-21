# Dependencies

- **Never take a major version through `pnpm update`.** A major is a migration:
  read its guide, do it on a branch, check it by hand. `tailwindcss` 3→4 broke the
  Vercel build that way.
- **After merging any dependency PR, run `pnpm install` and commit the
  regenerated lockfile.** Every such PR rewrites it, and merging two in a row
  leaves a lockfile that resolves neither — a frozen install (CI, and Vercel
  when it disagrees with `package.json`) fails.
  The pre-push hook checks this; `--no-verify` skips it. **A merge on GitHub's
  website skips it too**: merging #17–#19 on 2026-10-21 left two package entries
  duplicated, every CI job died at `pnpm install` (`ERR_PNPM_BROKEN_LOCKFILE …
  duplicated mapping key`) and Dependabot's next run reported the lockfile
  "not parseable" — while Vercel, more lenient, deployed the untested upgrade.
  Merge dependency PRs one at a time, letting CI finish on `main` between them.

---

[← all traps](../traps.md)
