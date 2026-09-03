# A script that runs because it was imported

**Importing a module executes it, and `main()` at the bottom of a file is a
module that works.** On 2026-09-01, checking that four database scripts still
imported cleanly after a refactor of their env loader:

```
for f in migrate.mjs seed.mjs go-live-purge.mjs db-clear-preserve-core.mjs; do
  node --input-type=module -e "await import('./scripts/$f')" >/dev/null 2>&1 \
    && echo "$f ok" || echo "$f ok (guarded exit)"
done
```

`db-clear-preserve-core.mjs` ended in `main().catch(...)`. The import resolved
`DATABASE_URL` from `apps/web/.env` — the **production** database — and deleted
every member, every posting, every loan, every document and the whole audit log.
The loop printed `ok` four times, because `>/dev/null 2>&1` swallowed the
script's own "Database cleanup completed" banner and its before→after counts,
and a successful wipe exits 0.

Three independent things had to be true, and one guard each would have stopped
it:

1. **the module ran on import** — every script now ends in
   `runAsScript(import.meta.url, main)` from `scripts/lib/guard.mjs`, so an
   import yields the exports and does nothing. `script-safety.test.ts`
   enumerates the directory and fails on the next bare `main()`.
2. **it destroyed data with no confirmation** — `db:clear` is a dry run that
   prints what it would remove; `--confirm` applies it, matching
   `go-live-purge.mjs`, which had that from the start and was therefore harmless
   in the very same loop.
3. **it did so against a managed host** — `refuseRemoteTarget` refuses anything
   that is not localhost without `ALLOW_REMOTE_DATABASE=yes`. The normal target
   of a development reset is Docker; the one time it was not, it cost the
   foundation's data.

The wider lesson is about the redirect, not the script. **Output sent to
`/dev/null` is evidence destroyed before it is read.** The command was written to
answer "does this still parse", and the answer it printed was true; what it did
not print was the only thing that mattered. Send output somewhere you will look
at it, and treat an exit code as an answer to the question the program was
asked, not to yours.

Recovery was a Neon point-in-time restore to a timestamp five minutes before the
wipe. The nightly backup artifact taken later that hour contained the *wiped*
state — a backup is a copy of whatever was true when it ran, and running one
after an incident captures the incident.

---

[← all traps](../traps.md)
