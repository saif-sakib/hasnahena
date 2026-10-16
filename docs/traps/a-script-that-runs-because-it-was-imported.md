# A script that runs because it was imported

- **Importing a module executes it, and `main()` at the bottom of a file is a
  module that works.** On 2026-09-01 a loop checked four DB scripts still
  imported (`node -e "await import('./scripts/$f')" >/dev/null 2>&1`).
  `db-clear-preserve-core.mjs` ended in `main().catch(...)`, resolved
  `DATABASE_URL` from `apps/web/.env` — **production** — and deleted every
  member, posting, loan, document and the audit log. The loop printed `ok`. One
  guard each now: every script ends in `runAsScript(import.meta.url, main)`
  (`script-safety.test.ts` enumerates the directory); destructive scripts are dry
  runs without `--confirm`; `refuseRemoteTarget` refuses a non-local host without
  `ALLOW_REMOTE_DATABASE=yes`.
- **Output sent to `/dev/null` is evidence destroyed before it is read.** The
  redirect swallowed the script's own "cleanup completed" banner and counts, and
  a successful wipe exits 0. An exit code answers the question the program was
  asked, not yours.
- **A backup taken after an incident captures the incident.** Recovery was a Neon
  point-in-time restore to five minutes before the wipe; the nightly artifact
  taken later that hour held the wiped state.

---

[← all traps](../traps.md)
