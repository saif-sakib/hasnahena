# Dependencies

- **Never take a major version through `pnpm update`.** A major is a migration:
  read its guide, do it on a branch, check it by hand. `tailwindcss` 3→4 broke the
  Vercel build that way.
- **After merging any dependency PR, run `pnpm install` and commit the
  regenerated lockfile.** Every such PR rewrites it, and merging two in a row
  leaves a lockfile that resolves neither — Vercel installs frozen and fails.
  The pre-push hook checks this; `--no-verify` skips it.

---

[← all traps](../traps.md)
