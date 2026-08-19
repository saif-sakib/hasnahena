# Work Orders

An execution spec: exact files, exact changes, exact verification, so a session
can act without re-exploring the codebase.

**Prompt with the ID — `do WO-67` — or with a whole block — `do block S`.**

Line numbers are anchors, not guarantees: match on quoted code. The traps that
outlived earlier orders are in [traps.md](traps.md); WO-01 → WO-66 are closed and
compressed in [changelog.md](changelog.md).

---

## The plan, in the order to do it

Six blocks. **The order is not arbitrary** — each is ordered by what it costs to
do later, the same principle as [go-live.md](go-live.md).

| Block | What | Orders | Why here |
|---|---|---|---|
| ~~**R**~~ | ~~Live defects~~ | WO-67 | **Done 2026-08-19** |
| ~~**S**~~ | ~~Database — correctness, constraints, redundancy~~ | WO-68 → 72 | **Done 2026-08-19** |
| ~~**T**~~ | ~~Performance~~ | WO-73 → 75 | **Done 2026-08-19** |
| ~~**U**~~ | ~~Security~~ | WO-76 → 78 | **Done 2026-08-19** |
| ~~**V**~~ | ~~SEO~~ | WO-79 → 81 | **Done 2026-08-19** |
| ~~**W**~~ | ~~Future-proof~~ | WO-82 → 84 | **Done 2026-08-19** |

**Every block in this plan is closed.** What remains is in
[production-readiness.md](production-readiness.md) and
[go-live.md](go-live.md) — and one item in this file's last section that needs a
credential rather than a session.

### Standing rules for every order

- `pnpm typecheck` exits clean, zero errors.
- `pnpm lint` exits 0 with **2 warnings**. **Do not let the count grow.**
  (Was 6 until WO-75 converted the last four raw `<img>` tags. The two left are
  the React compiler skipping the registration form — `watch` from
  react-hook-form is not analysable — and one `window.location.href` in
  `header.tsx`.)
- A regression test must be seen to **fail against the pre-fix code** before it
  is allowed to pass. When a test *cannot* be made to fail, say so in the test.
- Money changes stay in the Go API, one transaction, with an `audit_logs` row.
- Update [tasks.md](tasks.md) and tick the order here in the same commit.

---

# Blocks R and S — closed 2026-08-19

WO-67 → WO-72 are done. What they contained is one row in
[changelog.md](changelog.md); what they *taught* is in [traps.md](traps.md). Two
things are worth repeating here, because both were found by the work rather than
specified by it:

- **The census found more than the order predicted.** WO-67 was written about
  four undeclared `bank.*` keys. The test that closed it walks every
  `settings['…']` read in `app/` and `components/`, and named **seven** — the
  other three were `contact.email`/`phone`/`address` on the public `/contact`
  page, which showed `contact@example.com` as the foundation's address. Those
  were not declared *or* added: `org.email`/`org.phone`/`org.address` already
  existed, seeded with the real details and printed on every generated document,
  so the fix was to delete the duplicate rather than legitimise it.
- **Two definitions of one table disagreed in exactly the predicted way.** WO-70
  asked for the bootstrap DDL and the migration to be compared before removing
  either. `document_sequences."updatedAt"` was `NOT NULL DEFAULT NOW()` in the
  bootstrap and `NOT NULL` with no default in the migration — the divergence that
  once broke all four money flows at once. And
  `idx_support_messages_thread_created_desc` was a covering index in one and a
  plain one in the other, so the covering variant had **never existed anywhere**:
  same name plus `IF NOT EXISTS` means the second creator is a silent no-op.

---

# Blocks T and U — closed 2026-08-19

WO-73 → WO-78 are done. What they contained is one row in
[changelog.md](changelog.md); what they *taught* is in [traps.md](traps.md).
Four things are worth repeating here, because all four were found by the work
rather than specified by it:

- **A nonce-based CSP and static rendering cannot both be had.** WO-76 asked for
  a nonce policy; WO-73 had just made ten routes static. Next injects a nonce
  while *rendering a request*, so a prerendered page has none and a nonce policy
  blocks its own hydration. `experimental.sri`, which the Next docs offer as the
  escape hatch, was tried and measured: it adds `integrity` to 8 of 14 external
  scripts and leaves all **6 inline RSC payload scripts** untouched — and those
  are exactly what a strict `script-src` blocks. The resolution is two policies
  chosen per route, argued in full in `apps/web/lib/csp.ts`.

- **Every census in these orders was low.** WO-73 said "the cause is one line" —
  it was eight files plus two `galleryItem` reads. WO-75 said "the one remaining
  raw `<img>`, in `dashboard/admin/gallery`" — there were **four**, in
  `dashboard/admin/approvals` and `dashboard/admin/members/[id]`, and none in
  gallery. Lint went 6 → 2, not 6 → 5. Count before quoting a number.

- **`unstable_cache` serialises, so a `Date` comes back a string.** Typed as
  `Date`, it compiled and then failed the build with
  `item.date.toISOString is not a function` — on a cache *hit*, never a miss, so
  the first render of anything always looked fine. Normalise at the boundary.

- **The pool size is not a correctness constraint, and now that is known rather
  than assumed.** WO-75 asked whether `DB_MAX_CONNS=25` is compatible with Neon.
  The whole integration suite — including the 20-way concurrent-deposit test —
  passes with `pool_max_conns=2`. It can only do that because no repository call
  holds two connections at once, which is the property [ADR-017](decisions.md)
  exists to preserve, so that run is the cheapest available check that it still
  holds.

---

# Blocks V and W — closed 2026-08-19

WO-79 → WO-84 are done. What they contained is one row in
[changelog.md](changelog.md); what they *taught* is in [traps.md](traps.md).
Five things are worth repeating here, because all five were found by the work
rather than specified by it:

- **WO-73 broke the Docker image build, and no test noticed for a day.**
  Prerendering moved the marketing pages' database reads from request time to
  *build* time, and `apps/web/Dockerfile` builds with `DATABASE_URL` pointing at
  a placeholder database that does not exist — deliberately, because
  `prisma generate` parses the URL and never connects. Six of the eight pages had
  no `try` of their own. The contract is now on the accessor
  ([ADR-028](decisions.md)), and the `catch` sits *outside* `unstable_cache`,
  because a cache stores resolved values and never rejections — catching inside
  would pin every public page to its fallback copy for the whole revalidate hour
  after one Neon blip.

- **A test can pass without ever reaching the thing it tests.** The first version
  of `public-content-fallback.test.ts` went green with `findMany` called **zero**
  times: called outside a Next server, `unstable_cache` throws
  `Invariant: incrementalCache missing`, and the very `catch` under test
  swallowed it. Assert that the mock was *used*, not only that the result was
  right.

- **`x-default` is not `defaultLocale`.** This project's default locale is `bn`,
  because its members are Bengali. `x-default` answers the opposite question —
  what to serve someone the site was *not* built for — and the answer there is
  `/en`. Writing `defaultLocale` reads as the tidier version of the same line and
  sends every unmatched reader in the world to a page they cannot read.

- **The reconciliation job found two live defects before it ever ran in
  production.** `waterfallRecoveryTx` inserted its three recovery rows with **no
  status**, so they took the column default of `PENDING` while the savings had
  already been deducted in the same transaction — every status-filtered aggregate
  under-counted a recovery that had happened. And it never reduced
  `accounts."loanBalance"`, so a member whose savings were taken to settle a
  default still saw the whole debt on their dashboard, permanently, because
  nothing else recomputes that column. Neither failed any existing test. This is
  the argument for OPS-07 in one paragraph.

- **A dispute is not a reversal.** Disputing a `CONFIRMED` posting flips it to
  `DISPUTED` and moves no money, so a reconciliation that counted `CONFIRMED`
  alone would raise drift on every open dispute — an alarm that is always firing.
  [ADR-026](decisions.md) writes the refinement down beside ADR-016 rather than
  quietly widening it.

---

# Two things closed orders left behind

Both tracked in [production-readiness.md](production-readiness.md), neither a
code change anyone can make today:

- **DATA-06** — no backup of the Cloudinary assets. Buildable only against a real
  account with real credentials; [ADR-020](decisions.md) accepts the exposure
  until the first real member document exists and names that document as the
  trigger.
- **CI-09** — branch protection on `main`. Needs a paid plan on a private repo;
  `.githooks/pre-push` is the free stand-in and is active.
- **WO-84's rehearsal.** [runbook.md](runbook.md) is written and every command in
  it has been run, except one: the restore has never been performed against a
  Neon branch with a real archive. That needs the Neon account and the
  `BACKUP_PASSPHRASE` secret. A restore you have not performed is a rumour, so
  the runbook says "Last rehearsed: **Never**" until somebody does it and dates
  the line.
