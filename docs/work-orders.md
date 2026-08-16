# Work Orders

Execution specs. [production-readiness.md](production-readiness.md) says *why* a
task exists; this file says *exactly what to change*, so a future session can act
without re-exploring the codebase.

## How to use this

Prompt with just the ID:

> `do WO-28`  ·  `do WO-28 and WO-29`  ·  `do batch H`

Each open order below is self-contained — files, anchors, the change, the
verification command, and the done-when test. Line numbers are anchors, not
guarantees; match on the quoted code, not the number.

Finished batches are compressed to one line each under
[Completed](#completed-wo-01--wo-26). What was *learned* doing them is in
[Traps](#traps-that-cost-a-session) — read that section before any work touching
Docker, Prisma, migrations or the build config. Every entry cost at least one
session to find.

## Batches

| Batch | Orders | Theme | State |
|---|---|---|---|
| A–G | WO-01 → WO-26 | Security, hardening, tests, CI, backups, observability, containers, stack modernisation | **Done** |
| **H** | WO-27 → WO-29 | Live defects found in the 2026-08-16 audit | **WO-29 done · WO-28 open · WO-27 part-done** |
| ~~I~~ | ~~WO-30 → WO-33~~ | ~~Remaining security + hardening~~ | **Done 2026-08-16** |
| ~~J~~ | ~~WO-34 → WO-35~~ | ~~Deployable artifacts~~ | **Done 2026-08-16** |
| K | WO-36 → WO-40 | Code health and product gaps | **WO-36 → WO-39 done · WO-40 open** |
| **L** | WO-41 → WO-45 | Ledger integrity, dead routes, the loan + guarantor UI | **Done 2026-08-17** |

### Standing rules for every order

- `pnpm typecheck` must exit clean, zero errors.
- `pnpm lint` must exit 0. It currently reports **26 warnings** — 20 of them are
  the `set-state-in-effect` findings WO-27 owns, and 6 are pre-existing
  `@next/next` ones. Do not let that count grow.
- Go **is** installed (`go1.26.5`); `go build`, `go vet` and `go test` work
  directly. `golangci-lint` 2.6.1 panics on a 1.26 toolchain — use
  `GOTOOLCHAIN=go1.25.3`, which is what CI pins. Integration tests need a
  database; the command is in [CLAUDE.md](../CLAUDE.md).
- A regression test must be seen to **fail against the pre-fix code** before it
  is allowed to pass. A test written after the fix, never observed red, proves
  only that today's code passes it.
- Money changes stay in the Go API, one transaction, with an `audit_logs` row
  (CLAUDE.md rules 1, 2, 6).
- Update [tasks.md](tasks.md) and tick the order here in the same commit.

---

# Batch L — Ledger integrity `[~]` — WO-41 → WO-44 done 2026-08-17

Found in the 2026-08-17 audit, each reproduced against a real Postgres 17. The
*why* is [Phase −1](production-readiness.md#phase-1--ledger-integrity-defects).

These came before Batch H and before the git-history purge. A history rewrite is
expensive to delay; a wrong balance is expensive to *have*, and one of these was
capable of paying out five times an account's savings.

**Status: complete.** WO-41 → WO-45 are all done. WO-45 was blocked on three
product decisions; all three were answered in favour of what
[product.md](product.md) already specified, so the code moved to the spec rather
than the other way round.

> ### The verification that matters
>
> Each of the seven new tests in
> [`ledger_integrity_integration_test.go`](../apps/api/internal/repositories/ledger_integrity_integration_test.go)
> was run **against the pre-fix code** and confirmed to fail with the exact
> symptom it describes, then run again after. Without that step a regression test
> proves only that the current code passes it.
>
> ```
> balance = 2000, want 20000 — deposits overwrote each other
> 10 withdrawals succeeded, want exactly 2; paid out 50000 against a 10000 balance
> cannot scan NULL into *string   (col: guarantorId)
> both donations got receipt DON-20260816213322
> ```
>
> Integration suite: **17 → 26 tests**, all green. Two more defects surfaced
> while building WO-45's UI — SEC-13 and an always-empty guarantor panel — and
> both got the same treatment.

## WO-41 · Make balance writes race-proof `[x]` — **critical** (LEDGER-01)

**Done 2026-08-17.** All balance writes are now relative (ADR-015), and every
eligibility read happens inside the transaction under `FOR UPDATE OF a`.
`AddMemberWithdrawal` carries its balance test in the `UPDATE … WHERE
"savingsBalance" >= $1` itself, so the check and the debit are one step;
`pgx.ErrNoRows` becomes the existing `insufficient balance` error, so the handler
contract is unchanged.

Two routes were **deleted** rather than fixed, because both were unreachable
duplicates and neither should be re-created:

| Removed | Why |
|---|---|
| `POST /v1/dashboard/worker/deposit` (`ProcessDeposit`) | A second deposit path with no audit row, a receipt number taken from the request body instead of `document_sequences`, and no transaction status. The worker UI has always posted to `/worker/members/{memberId}/deposit` |
| `POST /v1/dashboard/worker/withdrawal` (`ProcessWithdrawal`) | Parsed its request and answered `{"message":"Withdrawal processed successfully"}` having moved nothing and recorded nothing. **A handler that reports success for work it never did** is precisely what OPS-07 exists to catch |

Guards added: `amount <= 0` is rejected on both paths, and the `LEFT JOIN
accounts` became a `JOIN` so a member with no account returns *member not found*
rather than a scan error.

### The original specification, kept for the reasoning



**Files:** `apps/api/internal/repositories/transaction_repository.go`

Three call sites read a balance and write back an absolute total. Two read from
the pool entirely outside the transaction.

| Function | Line | Problem |
|---|---|---|
| `AddMemberDeposit` | ~708 | reads via `r.db.QueryRow` before `Begin`; writes `SET "savingsBalance" = $1` |
| `AddMemberWithdrawal` | ~800 | same, plus the balance/guarantor/active-loan checks are made against the unlocked read |
| `ApproveWithdrawal` (DEPOSIT branch) | ~57 | reads inside the tx but with no `FOR UPDATE` on `accounts` |
| `ProcessDeposit` | ~670 | same as above; also writes **no audit row** and takes its receipt number from the caller instead of `document_sequences` |

**The change.** Write relatively and let Postgres do the arithmetic, returning
the new value — the pattern `loan_repository.go` already uses:

```sql
UPDATE accounts
SET "savingsBalance" = "savingsBalance" + $1, "updatedAt" = NOW()
WHERE id = $2
RETURNING "savingsBalance"::bigint
```

For withdrawals the guard has to move into the statement too, so the check and
the write are one atomic step rather than two:

```sql
UPDATE accounts
SET "savingsBalance" = "savingsBalance" - $1, "updatedAt" = NOW()
WHERE id = $2 AND "savingsBalance" >= $1
RETURNING "savingsBalance"::bigint
```

`pgx.ErrNoRows` from that statement means insufficient funds — return the
existing `errors.New("insufficient balance")` so the handler contract does not
change. The eligibility reads (status, active loan, guarantor) must move inside
the transaction and select `FOR UPDATE OF a`, matching `CreateMemberLoan`.

Do **not** solve this with `SERIALIZABLE` or an advisory lock. The relative
update is one statement, needs no retry loop, and is what the rest of the file
already does.

**Done when** 20 concurrent `AddMemberDeposit` calls of ৳1,000 leave a ৳20,000
balance and a ৳20,000 ledger sum, and 10 concurrent ৳5,000 withdrawals against
৳10,000 leave exactly two successes and a ৳0 balance. Write both as integration
tests — the suite has no concurrency coverage at all today, which is why this
survived 17 green tests.

## WO-42 · Fix the default waterfall for loans with no guarantor `[x]` — **critical** (LEDGER-02)

**Done 2026-08-17.** `"guarantorId"` is coalesced to `''`, which is the value the
guarantor step already tested for, so no other logic changed. The recovery body
moved into `waterfallRecoveryTx(ctx, tx, loanID)`, which runs inside the caller's
transaction: `MarkLoanDefaulted` now writes the status *and* recovers *and*
audits in one transaction, so a failure anywhere leaves the loan un-defaulted
rather than defaulted-and-unsettled. `ProcessWaterfallRecovery` survives as the
standalone wrapper for re-running recovery against an already-defaulted loan.

`FOR UPDATE` added to the loan row and both account reads — recovery reads a
balance, decides what to take, and writes it back, so without the lock two
concurrent defaults could draw the same guarantor's savings twice. Both audit
inserts in this flow were bare `tx.Exec(...)` discarding their error; both are
now checked, which closes 2 of WO-40's 21 real findings.

### The original specification, kept for the reasoning

Two independent bugs in one flow.

**1. The NULL scan.** `ProcessWaterfallRecovery`'s loan query scans
`"guarantorId"` into a `string`. `Loan.guarantorId` is `String?`. Use
`COALESCE("guarantorId", '')` — the code below already treats `""` as "no
guarantor", so nothing else changes. Add `FOR UPDATE` to that query and to both
`accounts` reads while you are there; the waterfall currently takes no locks.

**2. The transaction split.** `MarkLoanDefaulted` commits `status = 'DEFAULTED'`
and *then* calls `ProcessWaterfallRecovery`, which opens its own transaction. A
failure in recovery leaves a loan permanently defaulted with nothing recovered
and no way to retry cleanly.

Merge them: take the `tx` as a parameter so the status change, all three
recovery legs and the audit row commit or roll back together. Keep
`ProcessWaterfallRecovery` exported if anything else calls it, but give it a
`…Tx` variant that does not begin its own transaction.

Also unchecked in this function: `tx.Exec` for the audit insert at ~685 and
~813, both bare `tx.Exec(...)` with no assignment. These are two of the findings
WO-40 counts.

**Done when** defaulting a loan with `guarantorId IS NULL` recovers from the
borrower's savings and returns nil, and a forced failure in the donation-pool
leg leaves the loan **not** defaulted. Add both as integration tests; every
existing waterfall test seeds a guarantor.

## WO-43 · Remove the last ÷100 and fix donation numbering `[x]` — **high** (LEDGER-03/04)

**Done 2026-08-17.** The `/100` is gone from the loan-approved notification; a
sweep confirms the only remaining `/ 100` in the Go API is percentage maths
(`admin_repository.go:121`, `loan_repository.go:520`). `RecordDonation` now
allocates from `document_sequences` via a new `utils.SeriesDonation` (`DON`),
credits the pool relatively, and writes the `DONATION_RECORDED` audit row it
never had — it was the only balance-changing method in the Go API without one.

The collision was not hypothetical: two donations recorded back to back in the
regression test both received `DON-20260816213322` under the old wall-clock
format.

### The original specification, kept for the reasoning

Two small independent changes.

**LEDGER-03.** `loan_repository.go:123` —
`fmt.Sprintf("… BDT %.2f …", float64(principalAmount)/100)`. Drop the `/100`.
Money is whole taka ([ADR-002](decisions.md)); a ৳50,000 loan currently tells
the member "BDT 500.00". Then grep the tree for `/ 100` and `/100` and confirm
the only remaining hits are percentage maths (`admin_repository.go:121`,
`loan_repository.go:520`) and unrelated unit conversions in `apps/web/lib`.

**LEDGER-04.** `RecordDonation` in `transaction_repository.go`:
- replace `fmt.Sprintf("DON-%s", time.Now().Format(…))` with
  `r.nextDocumentNumber(ctx, tx, utils.SeriesDonation)`, adding `SeriesDonation`
  to `internal/utils` alongside the existing four ([ADR-013](decisions.md));
- add the missing `insertAuditLogTx` call. It is the only balance-changing
  method in the Go API without one (CLAUDE.md rule 2).

**Done when** two donations recorded in the same second get distinct sequential
numbers, and `TestEveryBalanceChangeWritesAnAuditRow` is extended to cover
`RecordDonation` — it currently does not, which is why the gap survived.

## WO-44 · Delete the dead Next route handlers `[x]` — **medium**

**Done 2026-08-17.** All five deletions are made. Ten Next route handlers remain,
of which seven have a caller and three are built backends waiting on their UI
(`loans/applications`, `loans/{id}/guarantor-approval`, `admin/audit-logs`) —
kept deliberately, listed in [api.md](api.md).

### The original specification, kept for the reasoning

Seven of thirteen Next route handlers have **no caller anywhere** in
`app/`, `components/`, `lib/`, `hooks/` or `e2e/`. Verified by exhaustive grep
for every `/api/v1/...` literal, including the dynamically-built ones.

**Already deleted in the 2026-08-17 audit** (both mutated balances from Next, in
direct violation of [ADR-001](decisions.md)):

| Route | Why it went |
|---|---|
| `worker/transactions/[id]/process` | **Provably broken** — wrote `processedBy: workerName`, a display name, into a column that is a foreign key to `users.id`. Every call violated `transactions_processedBy_fkey` and 500'd. Also duplicated the Go worker-deposit path |
| `member/transactions/[id]/confirm` | Read the balance and wrote back an absolute total from a Next handler — LEDGER-01's bug, in the backend that is not allowed to hold it |

**Also deleted 2026-08-17:**

| Route | Why |
|---|---|
| `transactions/deposit-requests` | Superseded by Go `POST /v1/dashboard/member/requests/deposit`, which the member deposits page actually calls |
| `transactions/withdrawal-requests` | No withdrawal-request UI exists; when one is built it belongs in Go beside the deposit twin |
| `admin/approvals/registration` | The approvals page calls the Go route of the same name |

**Kept, uncalled, on purpose** — these are built features missing only their UI,
not dead code:

| Route | Why it stays |
|---|---|
| `loans/applications` | FR-10's only implementation — see WO-45 |
| `loans/[id]/guarantor-approval` | FR-11's only implementation; WO-29 fixed it |
| `admin/audit-logs` | OBS-08's backend; the viewer UI is the missing half |

**Done when** the three deletions are gone, `pnpm build` still enumerates every
remaining route, and `docs/api.md` lists exactly what is on disk. Delete
`apps/web/.next` before typechecking — Next caches generated route types and
will report a removed route as a missing module.

## WO-45 · Give FR-10 and FR-11 a user interface `[x]` — **high**

**Done 2026-08-17**, after the three policy questions below were answered. All
three answers chose the option that matches [product.md](product.md), so the
endpoint was corrected to the spec rather than the spec to the endpoint.

| Decision | Answer | Change |
|---|---|---|
| Guarantor always, or above a threshold? | **Threshold** | New `loan.guarantorThresholdAmount` key (default ৳20,000, seeded). `guarantorId` is now optional; below the threshold the loan is created straight into `PENDING_APPROVAL` — there is nobody to wait for. Above it, an application without one is refused with `GUARANTOR_REQUIRED` |
| How does a member nominate one? | **Member ID, name confirmed** | New `GET /api/v1/members/lookup?memberId=` — authenticated, members only, exact full-ID match, returns *name only*, rate limited to 10 per 10 minutes keyed on user id + address |
| Full cover or proportional? | **Proportional** | The `guarantorDeposit >= amount` check is gone; the guarantee is worth whatever the guarantor holds, which is what `ProcessWaterfallRecovery` already takes. Only a guarantor with **zero** savings is refused, now as `GUARANTOR_HAS_NO_SAVINGS` — the old `GUARANTOR_DECLINED` blamed the guarantor for a balance check they never saw |

**Built:** `components/dashboard/loan-application-form.tsx` (amount, installments,
purpose, live installment estimate, guarantor lookup that appears and disappears
as the amount crosses the threshold) and
`components/dashboard/guarantor-requests.tsx` (accept/decline, with the
consequence — *your savings can be drawn on* — stated above the buttons, not
after). Both wired into the member loans page. **41 new keys in each of
`messages/{en,bn}.json`**; parity 239 → 283, still exact.

Two defects were found while wiring it up, each of which alone made the feature
unreachable — see **SEC-13** below and the `PENDING`-vs-`PENDING_GUARANTOR` note
in [tasks.md](tasks.md).

### SEC-13 · `availableGuarantors` leaked every member's savings `[x]` — **high**

`GetMemberLoans` returned, to any signed-in member, the name **and savings
balance** of the 50 wealthiest other members, ordered by balance descending — a
ranked list of who in the village has the most money. [product.md](product.md)
is explicit that a member cannot see another member's data.

No UI ever consumed it, so it was pure disclosure with no feature behind it, and
the obvious way to build this form would have been to render it into a dropdown
— cementing the leak as a feature. Removed; the lookup endpoint above replaces
it and returns no balance at all.

### The original specification, kept for the reasoning

The audit's most surprising finding: **a member cannot apply for a loan, and a
guarantor cannot approve one, from anywhere in the app.**

- `app/[locale]/dashboard/member/loans/page.tsx` posts only to
  `/v1/dashboard/member/requests/loan-repayment`. There is no application form.
- No file under `app/[locale]/` calls `guarantor-approval`. The string
  `guarantor` appears in the member/admin UI only as a *status label* and a
  read-only field.

So loans exist solely because a worker creates one via
`POST /v1/dashboard/worker/members/{id}/loan`, which skips
`PENDING_GUARANTOR` → `PENDING_APPROVAL` entirely and writes `status = 'ACTIVE'`
directly. The documented loan lifecycle is real in the schema and in the Go API
and unreachable from the product.

This is why [tasks.md](tasks.md) marking FR-11 `[x]` was wrong: WO-29 fixed the
endpoint and verified it with curl, which is a true statement about the endpoint
and a false one about the feature.

**Scope:** a member-side application form posting to `/api/v1/loans/applications`,
and a guarantor action on the member dashboard posting to
`/api/v1/loans/{id}/guarantor-approval`.

**Done when** a member can apply, a nominated guarantor sees and approves the
request, and the loan reaches `PENDING_APPROVAL` without anyone touching SQL.

### ⛔ Blocked — three policy decisions, not UI work

Attempting this on 2026-08-17 surfaced that the existing endpoint encodes policy
that **contradicts [product.md](product.md)**. Building a form on top of it would
cement the contradiction in the product rather than reveal it, so the UI is held
until these are answered.

**1. How does a member nominate a guarantor?**
`POST /api/v1/loans/applications` requires `guarantorId` — a `cuid`, the
guarantor's internal user id. A member has no way to obtain one:
[product.md](product.md) says a member **cannot see another member's data**, and
no endpoint lists members to a member. The plausible answer is that the applicant
types the guarantor's human-readable member ID (`ACC-KH-33001`), which needs a
narrow `memberId → userId` resolver — and that resolver is an enumeration surface
of exactly the kind [SEC-08](production-readiness.md) was closed to remove.
Deciding what a member may confirm about another member is a privacy decision.

**2. Is a guarantor always required, or only above a threshold?**
The endpoint requires one **unconditionally** (`guarantorId: z.string().min(1)`).
[product.md](product.md) says *"a guarantor is required above an admin-set
threshold"*. No such threshold key exists in
[`lib/system-config.ts`](../apps/web/lib/system-config.ts), so the policy is
implemented nowhere and contradicted in code. Note this is now the **only** thing
standing between the platform and unguaranteed loans — WO-42 made the default
waterfall handle them correctly, so the schema, the recovery path and the tests
all support a loan with no guarantor. Only this endpoint does not.

**3. Must a guarantor's savings cover the whole loan?**
The endpoint rejects the application with `GUARANTOR_DECLINED` unless
`guarantorDeposit >= amount` — the guarantor must have saved the entire loan
value. [product.md](product.md) describes the guarantee as *proportional*, and
`ProcessWaterfallRecovery` recovers proportionally, taking whatever the guarantor
has. Full cover is a far stricter rule than the recovery model assumes, and at a
5× multiplier it means a guarantor must hold five times what the borrower does —
which would make most guarantees impossible. The error name is also wrong: the
guarantor has not declined anything, they are too poor to qualify.

**Recommended sequence once answered:** correct the endpoint's policy first, add
the threshold config key, *then* build the form against a contract that matches
the spec. The UI is a few hours; agreeing what the product does is the work.

---

# Batch H — Live defects `[~]`

Found by auditing the code on **2026-08-16**, not by reading the docs.

**WO-29 is done** and verified end to end. **WO-27 is 9 of 31** — the rest is
deferred on the reasoning below, not forgotten. **WO-28 is prepared but not run**:
the rewrite is irreversible and changes every commit hash, so it is the owner's
call. The runbook is below and has been dry-checked.

## WO-27 · React Compiler lint cleanup `[~]` — 9 of 31 done

**Update 2026-08-16 — the premise was wrong, and it changes the order.**

**The React Compiler is not enabled.** There is no `experimental.reactCompiler`
in `next.config.js` and no `babel-plugin-react-compiler` in any manifest. These
rules report "this component would bail out of optimisation *if* you turned the
compiler on" — they are not defect reports, and fixing them changes nothing that
runs today. That reframes the work into three very different piles:

| Rule | Count | Verdict |
|---|---|---|
| `static-components` | 4 | **Real bug today. Fixed.** `StatCard` was declared inside `admin/page.tsx`'s body, so React saw a new component *type* every render and unmounted/remounted all four cards on every state change — throwing away the `transition-all` and `animate-in` animations mid-flight. Hoisted to module scope; it closes over nothing |
| `immutability` | 5 | **Zero-risk. Fixed.** A mount `useEffect` placed *above* the `const` loaders it calls. Legal (effects run after the body) but temporal-dead-zone fragile. Effects moved below their declarations in `admin/gallery`, `admin/settings` and `worker/deposits` |
| `set-state-in-effect` | 20 | **Deferred, deliberately — see below** |

**Total went 32 → 26 warnings, not 32 → 23.** Fixing the 5 `immutability`
findings *revealed* 3 new `set-state-in-effect` ones in the same three files: the
compiler bails at the first error per component, so the TDZ errors were masking
them. That is worth knowing before someone reads the count as a regression.

**Why the remaining 20 are deferred.** The dominant shape is a data-loading
`refresh()` whose synchronous prefix calls `setIsLoading(true)` on a state that
already initialises to `true` — a redundant render on mount, not a bug. The
others (`dashboard-layout:402`, `profile-editor:97`) are conditional setState
responding to a URL or prop, which is ordinary React. **None marks a behaviour
change**, and clearing them means restructuring the data-loading of 15 screens
that move members' money, with no fixtures, for no runtime benefit while the
compiler is off.

**Do them as part of enabling the React Compiler, not before it.** At that point
the rules mean something and the risk buys a real optimisation. Doing it now is
the trade this batch was structured to avoid.

**The obvious fix does not work — tried and measured 2026-08-16.** The tempting
transformation is to split each loader into a `fetch*` that writes no state
before its first `await`, and point the mount effect at that:

```ts
const fetchDeposits = async () => {           // no setState before the await
  try { const d = await apiGet(...); setDeposits(d); }
  finally { setIsLoading(false); }
};
useEffect(() => { void fetchDeposits(); }, []);
```

The rule still fires. The compiler follows the call graph into the callee and
cannot prove `apiGet` will not throw *synchronously* into the `finally`, so the
effect is still treated as setting state during render. The attempt also
introduced a fresh `exhaustive-deps` warning, making the count worse.

Clearing these therefore needs the effect body to contain no reachable setState
at all — which means moving these screens onto a data-fetching library (React
Query/SWR) or `use()` with Suspense. That is an architectural change to 13 screens
that move members' money, and it is Stage 4 work in [go-live.md](go-live.md), not
a lint cleanup.

**When you do pick this up** — run `pnpm lint` for the current list; the rules are
configured in [apps/web/eslint.config.mjs](../apps/web/eslint.config.mjs) with the
rationale. Work **screen by screen**, not rule by rule: these files move members'
money and have no fixtures, so a batch rewrite cannot be verified. For each
screen, fix it, then load it against a seeded database and drive the flow it owns.

**Watch:** a `set-state-in-effect` finding usually marks a `useEffect` that should
be derived state or an event handler. Deleting the effect is normally correct;
adding a guard is normally the wrong fix and only hides it from the rule.

**Verify:** `pnpm lint` reaches 6 warnings with no rule silenced, and a manual
walk of every touched screen in both locales.

## WO-28 · Purge member data and binaries from git history `[ ]`

**Why:** SEC-06 and **SEC-10**. This is the highest-value item in the file.

The audit found far more in history than SEC-06 recorded. `git rev-list` over all
refs turns up:

| Path in history | Size | What it is |
|---|---|---|
| `Official Infos/…` — **39 files** | ~40 MB | Added in `f152f0c`, deleted in `9306120`. Includes `Hasnahena Member Details.docx`, `Hasnahena Member Details 01.pdf` (4-page scan), `Loan Member Detail.docx`, three ledger books, check books and the membership forms |
| `react` | 24.6 MB | Stray binary, commit `3ef0a91` |
| `apps/api/server` | 17.5 + 16.4 MB | The Go binary SEC-06 named |
| `apps/api/seed` | 13.6 MB | Second Go binary, never recorded anywhere |

**The `Official Infos/` tree is the reason this is urgent, and it is not a size
problem.** Those filenames describe real member records — names, ledgers, loan
details — for a cooperative holding people's savings. Deleting them in a later
commit removed them from the working tree and from nothing else. They are in
every clone, and recoverable by anyone with read access in one command. SEC-06
framed this as ~59 MB of clone weight; the weight is the least of it.

**Change**
1. **Confirm first, decide second.** Extract
   `Official Infos/Hasnahena/Hasnahena Member Details 01.pdf` from history and
   look at it. It is an image-only scan, so no script can tell you whether it
   holds live member records — a person has to. If it does, this is a data
   incident and the purge is not optional.
2. `git filter-repo --invert-paths` over `Official Infos/`, `react`,
   `apps/api/server`, `apps/api/seed`. Use `filter-repo`, not `filter-branch`.
3. Force-push every ref. **Coordinate**: this rewrites every commit hash.
4. Ask GitHub Support to garbage-collect the unreachable objects — until they do,
   the blobs stay fetchable by SHA on the remote even after a force-push.
5. Add `Official Infos/` to `.gitignore` so a re-add is not one `git add -A` away.

**Runbook.** Prepared and dry-checked on 2026-08-16; the rewrite itself was not
run, because it is irreversible and rewrites every commit hash in the repository.
Run it from a clean tree with everything pushed.

```bash
# 0. Two safety nets. Do not skip; the rewrite cannot be undone.
git bundle create ~/hasnahena-pre-purge.bundle --all
cp -r .git ~/hasnahena-git-backup

# 1. Get filter-repo. It is a single Python script; pacman has it as
#    `git-filter-repo`, or:
curl -sSfL -o /tmp/git-filter-repo \
  https://raw.githubusercontent.com/newren/git-filter-repo/v2.47.0/git-filter-repo
chmod +x /tmp/git-filter-repo

# 2. Drop the pre-coauthor backup branches FIRST. They exist only to preserve the
#    history being discarded, and while they live every purged blob stays
#    reachable — the purge would appear to do nothing.
git branch -D backup/pre-coauthor-rewrite-main backup/pre-coauthor-rewrite-wo23

# 3. The rewrite.
/tmp/git-filter-repo --invert-paths \
  --path 'Official Infos' \
  --path react \
  --path apps/api/server \
  --path apps/api/seed \
  --force

# 4. filter-repo removes `origin` deliberately, so a stale push cannot happen.
git remote add origin https://github.com/Saif-Sakib/hasnahena.git

# 5. Verify BEFORE pushing — see the done-when test below.

# 6. Publish. Every hash changed, so this must be a force-push of everything.
git push --force origin --all
git push --force origin --tags
```

**Then two things that are not optional.** `git gc --prune=now --aggressive`
locally, and **open a GitHub Support ticket asking them to garbage-collect
unreachable objects**. Until they do, every purged blob stays fetchable by SHA on
the remote — the force-push makes them unreferenced, not gone.

**Watch:** the repository has no other collaborators today, which is exactly why
this is cheap now. Anyone holding a clone afterwards must re-clone; `git pull`
will not reconcile a rewritten history and will produce a confusing merge.

**Verify:** `git rev-list --objects --all | git cat-file --batch-check` shows no
blob over 2 MB except `apps/web/assets/brand/logo.mp4`. A fresh clone is under
15 MB. `git log --all --diff-filter=A -- 'Official Infos/*'` returns nothing.

## WO-29 · Guarantor approval is dead — a UUID check against cuid ids `[ ]`

**Why:** FR-11. **Guarantor approval cannot succeed for any loan that has ever
existed**, and guarantors are not a side feature of Qard al-Hasan lending.

✅ *Researched, and the numbers are unambiguous.*
[guarantor-approval/route.ts:18](../apps/web/app/api/v1/loans/[id]/guarantor-approval/route.ts#L18)
validates the loan id against a UUID regex. `schema.prisma` declares
`@default(cuid())` **14 times and `@default(uuid())` zero times** — so the regex
matches nothing the database can produce. Every request 400s with
"Invalid loan ID format" before it reaches the loan lookup.

This is the only place in `apps/web` using that regex, so the blast radius is one
file.

**Change:** delete the regex block at lines 18–21. It buys nothing the code below
does not already do better — `prisma.loan.findUnique` on line 30 returns `null`
for a malformed id and line 36 already answers 404. If a shape check is wanted,
match cuid (`/^c[a-z0-9]{20,30}$/`), but 404-on-lookup is the honest answer and
does not have to be revised when the id strategy next changes.

**Watch:** the WO-23 verification cited this route's "invalid vs valid id"
discrimination as evidence that `await params` worked. That evidence was sound —
it proved `id` was populated — but it was read through a regex that always
rejects real ids, which is how a fully dead endpoint looked healthy in a test
log. When this is fixed, that check no longer discriminates; use a real cuid.

**Verify:** `POST /api/v1/loans/<real cuid>/guarantor-approval` as the loan's
guarantor with `{"accepted":true}` → 200 and the loan moves
`PENDING_GUARANTOR` → `PENDING_APPROVAL`. A junk id → **404**, not 400. Then walk
the guarantor flow end to end: request a loan naming a guarantor, approve as that
guarantor, confirm it reaches admin approval. **No test covers this route** —
integration coverage stops at the Go API — so a manual pass is the only evidence.

---

# Batch I — Remaining security and hardening `[x]`

**Done 2026-08-16.** SEC-08, SEC-09, RUN-07 and DATA-08 are closed; the detail and
the reasoning are in [production-readiness.md](production-readiness.md) under each
id. Three things are worth carrying forward here:

- **chi's `RealIP` is deprecated and spoofable**, and it is still mounted in
  `main.go`. It overwrites `RemoteAddr` with the *leftmost* `X-Forwarded-For`
  entry, which the caller supplies. Nothing else in the codebase keys security
  decisions on the client address today — but anything that starts to must use
  `clientIP` in `internal/middleware/ratelimit.go`, not `r.RemoteAddr`.
- **`TRUSTED_PROXIES=1` must be set on Render.** At the default of 0 the rate
  limiter falls back to `RemoteAddr` and one caller can mint a fresh quota per
  request. The limiter still runs, still logs, still looks fine.
- **The audit trigger has one escape hatch** and it exists for `pnpm db:clear`.
  Anything else that needs to delete an audit row is a design mistake.

The original specs follow, kept because they record why each was worth doing.


## WO-30 · Close the registration-enumeration oracle `[ ]`

**Why:** SEC-08. `GET /api/v1/registrations?email=…`
([route.ts:74](../apps/web/app/api/v1/registrations/route.ts#L74)) answers
whether an address or phone is registered. Unauthenticated and unthrottled —
verified: the file contains **zero** rate-limiting references. For a
religious-finance cooperative in one town, that is a bulk membership-disclosure
oracle, and membership is the sensitive fact.

**Change:** it exists for the signup form's live validation, so it cannot simply
be closed. Rate-limit per IP through the existing `rate_limits` table (the login
path already uses it — copy that shape), and return a uniform response shape and
timing so the two cases are indistinguishable to a caller measuring latency.

**Verify:** 20 rapid lookups from one IP → 429. A registered and an unregistered
address return the same shape.

## WO-31 · Enable HSTS on the Go API `[ ]`

**Why:** SEC-09.
[cors.go:31](../apps/api/internal/middleware/cors.go#L31) has the header written
and **commented out**. Next sends it; the API does not.

**Change:** uncomment behind an `ENABLE_HSTS` env flag — off locally (it would
poison `localhost` in the developer's browser for two years), on in production.
Document the var in [setup.md](setup.md) and both `.env.*.example` files.

**Watch:** required before any VPS move, where you own TLS termination rather
than Render.

**Verify:** `curl -I` with the flag on shows the header; off shows none.
`go build ./...`.

## WO-32 · Global rate limiting `[ ]`

**Why:** RUN-07. Login is throttled; **nothing else is**. Confirmed: `main.go`
references rate limiting only in the cleanup sweep.

**Change:** per-IP limits on all mutating routes via the existing `rate_limits`
table, as chi middleware on the `/v1` router. Money-moving routes should be
tighter than the rest.

**Verify:** a loop against a POST route hits 429. Confirm the SSE stream is
exempt — it is one long-lived connection, not many requests.

## WO-33 · Make `audit_logs` append-only in the database `[ ]`

**Why:** DATA-08. CLAUDE.md rule 6 is enforced by **convention**. Confirmed: no
trigger exists in any migration. The integration tests prove the application
appends; nothing stops an `UPDATE` from a console.

**Change:** a `BEFORE UPDATE OR DELETE ON audit_logs` trigger that
`RAISE EXCEPTION`s, shipped as a Prisma migration. Prisma does not model
triggers, so this is hand-written SQL in a `migrate dev --create-only`
migration — the schema file cannot express it and will not drift because of it.

**Watch:** `prisma migrate diff` will not see the trigger. Say so in a comment in
the migration, or a later `--from-empty` baseline silently drops it.

**Verify:** `UPDATE audit_logs SET action='x' WHERE id=…` raises. The append path
and `pnpm test:integration` still pass. `scripts/restore-check.sh` must still
succeed — confirm the trigger survives a `pg_restore`, and that it does not block
the restore itself.

---

# Batch J — Deployable artifacts `[x]`

**Done 2026-08-16.** [.github/workflows/images.yml](../.github/workflows/images.yml)
publishes both images to GHCR on every push to `main`, tagged with the commit SHA
and `latest`, and the env-var contract is documented in
[setup.md](setup.md#build-time-vs-runtime-pkg-08).

Two things in that workflow are there because of Batch F, and should not be
removed as ceremony:

- **It runs the image it just pushed.** Batch F shipped three defects that a
  green build could not see and only a started container could — a half-traced
  `@swc/helpers`, a missing OpenSSL, and a dangling `.env` symlink. The web job
  waits for `/en` to answer; the api job checks the distroless entrypoint
  resolves at all.
- **It asserts no `.env` file is inside the image.** `.dockerignore` is the
  control that prevents it, and `.dockerignore` has been wrong once already, in a
  way that surfaced only by luck. Both checks were verified against a real image
  *and against a negative control* — a deliberately planted `/app/.env` is caught,
  so the assertion is not silently passing.

**Nothing in production consumes these images yet**; Vercel and Render still
build from source. They exist so the history is already there on the day
something does (INF-06).


## WO-34 · Build and push images in CI `[ ]`

**Why:** PKG-06. The Dockerfiles exist and are proven to run, but nothing builds
them on a commit. **A deployable artifact per commit is what turns a rollback
into one command** — and it is the prerequisite for the host move.

**Change:** a workflow building both images on push to `main`, pushed to GHCR
tagged with the commit SHA and `latest`. Use `docker/build-push-action` with
layer caching; the web image is ~2 minutes cold.

**Watch:** the web build needs `NEXT_PUBLIC_*` build args — they are baked into
the client bundle, so a wrong value cannot be corrected at `docker run` (see
[Traps](#traps-that-cost-a-session)). Pass the production URLs.

**Verify:** `docker pull ghcr.io/…@<sha>` and run it; `/v1/ready` and `/en`
answer. Confirm no `.env` in any layer:
`docker history --no-trunc` and `docker run --rm --entrypoint ls <image> -la`.

## WO-35 · Document the env-var contract `[ ]`

**Why:** PKG-08. `.env.example` lists names. It does not say which are
**build-time** (baked, `NEXT_PUBLIC_*`) versus runtime, which host owns each
(Render / Vercel / local), or which must match across hosts.

**Change:** one table in [setup.md](setup.md). `JWT_SECRET` gets a loud row — it
must be **identical** in Render and Vercel or every session breaks, and that is
the single most expensive misconfiguration available here.

---

# Batch K — Code health and product gaps `[ ]`

| ID | Task | Notes |
|---|---|---|
| WO-36 `[x]` | Web unit tests (CI-04) | **Done 2026-08-16.** Vitest, **32 tests in ~1s**, wired into CI as `pnpm test:unit`. Covers `lib/documents/format.ts` (Indian-system digit grouping, amount-in-words, HTML escaping order), `lib/member-id.ts` (round-trips, and that padding grows past 999 rather than wrapping — a colliding member id is unrecoverable once printed on a passbook) and `lib/validation/registration.ts` (all seven operator prefixes, the three NID lengths, anchoring). `lib/document-numbers.ts` is **not** covered: it imports Prisma at module scope, and its `FormatDocumentNumber` already has a tested Go twin from WO-11 |
| WO-37 `[x]` | `golangci-lint` in CI (CI-06) | **Done 2026-08-16**, staged. `govet`, `ineffassign` and `unused` are enabled and **clean**; `errcheck` and `staticcheck` are configured but not enabled, because they report 44 findings and a pipeline that is red on arrival gets switched off. `unused` is the one CI-06 actually asked for — it names the SEC-01/SEC-07 class of defect. Backlog is WO-40. **Note for anyone running it locally:** golangci-lint 2.6.1 is built with Go 1.25 and *panics* against a Go 1.26 toolchain — use `GOTOOLCHAIN=go1.25.3`, which is what CI pins |
| WO-38 `[x]` | Split `user_repository.go` (RUN-09) | **Done 2026-08-16.** 4,894 lines → nine domain files, largest 1.1k: `repository.go` (type + shared helpers), `transaction_`, `loan_`, `member_`, `worker_`, `admin_`, `auth_`, `support_`, `report_`. Same package, so no import surface changed. **Verified as a pure move, not asserted:** all 91 top-level declarations were extracted from the old and new trees, compared brace-to-brace and hashed — byte-identical, same SHA-256, none missing, none duplicated across files. Then build, vet, golangci-lint, unit tests and all 17 integration tests against a real Postgres 17 |
| WO-39 `[x]` | Settings key allow-list | **Done 2026-08-16.** 20 keys declared in [lib/system-config.ts](../apps/web/lib/system-config.ts); an unrecognised key now 400s with the offending names. The whole request is rejected rather than the bad keys filtered out — a partial save reporting success is the same lie as the original bug. Recorded there: `loan.noticePeriodMonths` is settable and enforced by nothing, because FR-08 is still open |
| WO-40 `[ ]` | Enable `errcheck` and `staticcheck` | The 44 findings WO-37 deferred, measured 2026-08-16. 23 are conventional (`defer tx.Rollback()`, `Close()`) and already excluded in `apps/api/.golangci.yml`. **The other 21 are not noise:** 6 unchecked `CreateAuditLog` (an audit row that silently fails to write is a rule-6 problem), 2 unchecked `tx.Exec` — *the exact shape of the donation-pool waterfall bug that made debt vanish with no ledger row behind it* — 2 unchecked `InvalidateAllUserTokens` (a password change that revokes nothing), and SA1019 on chi's `middleware.RealIP`, which staticcheck independently flags as spoofable. Fix them, then flip the two linters on in the config |

**Also open, specced in [production-readiness.md](production-readiness.md) rather
than here** — they are policy decisions before they are code: DATA-06 (Cloudinary
asset backup — **the largest remaining data gap**, the nightly dump covers the
database and nothing else), DATA-07 (retention and erasure policy), OBS-05 (log
aggregation), OBS-07 (dashboard), OBS-08 (audit viewer UI, FR-22), OPS-07
(reconciliation job), OPS-08 (48-hour unconfirmed sweep), and the FR gaps in
[tasks.md](tasks.md).

---

# Completed: WO-01 → WO-26

Full narratives lived here until 2026-08-16 and were compressed once every order
was verified. The durable parts are in [Traps](#traps-that-cost-a-session);
decisions are in [decisions.md](decisions.md); *why* each existed is in
[production-readiness.md](production-readiness.md) under its SEC/RUN/CI/DATA/
OBS/PKG id.

| Batch | Orders | Outcome |
|---|---|---|
| **A** Security | WO-01 → WO-05 | SEC-01→05, SEC-07 closed. Token revocation actually revokes; `/v1/dashboard/admin` gated at the router so a new handler is protected by where it is mounted; gallery writes admin-only; one origin-checked CORS helper; `?access_token=` replaced by 60 s single-purpose SSE tickets; request bodies bounded at 1 MB |
| **B** Hardening | WO-06 → WO-09 | RUN-01→06. Real `http.Server` timeouts, drained `SIGTERM` shutdown, `/v1/ready` against the pool, hourly cleanup sweeps, `log/slog` JSON with member emails replaced by user IDs |
| **C** Tests + CI | WO-10 → WO-13 | CI-01/02/03/05/07/08. `internal/money` extracted and table-tested, 17 integration tests on real Postgres, GitHub Actions, gitleaks, Dependabot. **Found: no money method wrote an `audit_logs` row, and the donation-pool waterfall leg was broken two ways** |
| **D** Data safety | WO-14 → WO-16 | DATA-01→05. Encrypted nightly `pg_dump`, a restore *script* rather than a procedure, drilled on every push. `db push` retired for migrations (ADR-014), `pnpm db:seed` |
| **E** Observability | WO-17 → WO-19 | OBS-01→04, OBS-06, RUN-08. Token-gated `/metrics` with business gauges, Sentry both apps, alerting split across UptimeRobot/Sentry/Actions on cost grounds |
| **F** Containers | WO-20 → WO-22 | PKG-01→05, 07. API image 26.9 MB (6.0 MB compressed), web 488 MB (113.8 MB). Verified by **running** them — three defects survived static review, all in [Traps](#traps-that-cost-a-session) |
| **G** Stack | WO-23 → WO-26 | Next 14 → 16.3.1, React 18 → 19.2.8, next-intl 3 → 4.13.6, ESLint 8 → 9, Tailwind 3 → 4.3.3, `middleware.ts` → `proxy.ts`. **`pnpm audit` 41 → 0.** WO-25 had to run before WO-24 — next-intl 3's peers end at Next ^15, so the documented order was backwards |

**Batch G is on branch `wo-23-next15-react19` and is not merged.** What was never
verified: **how any of it looks**, and the authenticated dashboards. The seed has
one SUPER_ADMIN and no member, worker, loan or transaction fixtures, so those
screens were only reachable as far as their role gates. Tailwind 4 also changes
defaults this codebase never names — border colour becomes `currentColor` instead
of `gray-200`, ring width 3px → 1px. Walk the dashboards on the Vercel preview,
both locales, before merging.

---

# Traps that cost a session

Each of these was found by something breaking, most of them at runtime rather
than at build time. They are grouped by what you have to be touching to hit them.

### Prisma and migrations

- **`@updatedAt` emits no database default.** Neither `db push` nor a generated
  migration writes one — Prisma applies it client-side. Hand-written SQL in the
  Go API must set both timestamps itself, or the first insert fails a NOT NULL
  check. This broke *all four* money flows once, as a generic 500.
- **`prisma migrate` needs a direct, non-pooled Neon connection.** PgBouncer
  cannot hold the session advisory lock and the failure looks like a **hang**,
  not a wrong-host error. `pnpm db:migrate` derives the direct host and logs it.
- **Timestamps are `timestamp without time zone`.** `NOW()` stores the session's
  wall clock; pgx reads it back as UTC. On a non-UTC server a revocation marker
  reads hours in the future and every new token is born revoked. The pool pins
  `timezone=UTC`. Neon defaults to UTC — a VPS will not.
- **Triggers are invisible to Prisma.** `migrate diff` will not see one, so a
  later `--from-empty` baseline drops it silently (relevant to WO-33).

### PostgreSQL clients

- **`/usr/bin/pg_dump` is not a binary.** On Debian and Ubuntu it is
  `pg_wrapper`, which resolves to the version of the **configured cluster** and
  only falls back to "newest installed" when there is no cluster. GitHub's
  `ubuntu-latest` ships a PostgreSQL 16 *server*, so installing
  `postgresql-client-18` changes nothing and `pg_dump --version` keeps answering
  16 — which is how the nightly backup failed against a 17.11 Neon server with a
  new-enough client already on disk. Resolved by absolute path in
  [scripts/lib/pg-client.sh](../scripts/lib/pg-client.sh) and on `PATH` by
  [.github/actions/postgres-client](../.github/actions/postgres-client). **A bare
  container with no cluster does not reproduce this** — the wrapper picks
  correctly there, which is what makes the bug look like a failed install.

### Docker

- **`.dockerignore` does not use git's matching rules.** Docker matches each
  pattern against the full path from the context root, so a bare `.env` covers
  only the repository root. `apps/web/.env` stayed in the context. Every pattern
  needs an explicit `**/`. This is a **secret-containment** control, not tidiness:
  a file that reaches an image layer is not removed by a later `RM`.
- **`node:*-slim` ships no OpenSSL.** Prisma cannot detect a version, warns, and
  falls back to `openssl-1.1.x` — wrong for bookworm. Install `openssl` in both
  the deps and runtime stages.
- **`@swc/helpers` is only half-traced.** Next 16 resolves it through the
  package's `exports` map at `./esm/*`; the tracer follows the CommonJS entry and
  copies `cjs/` only. The container dies at startup, before serving one request.
  Named explicitly in `outputFileTracingIncludes`.
- **`NEXT_PUBLIC_*` is baked at build time** — including for server-side route
  handlers. A value supplied at `docker run` is too late.
- **`docker compose --env-file` must come before the subcommand.**
  `docker compose --env-file .env.local up`, never `... up --env-file ...`.
- **Compose interpolates the entire file** even for `up -d postgres`, so a `:?`
  default on an unrelated service fails a command that does not use it. Use `:-`.
- **`DATABASE_URL` is hard-coded to the `postgres` service in `docker-compose.yml`
  on purpose.** `.env.local` holds the production Neon URL; interpolating it would
  point the one-shot migrate container at production and run `db:seed` against
  real member data.
- **A Dockerfile that has never been built is a hypothesis.** Static review
  caught none of the three defects above.

### Next, React and the build

- **`outputFileTracingIncludes` must stay top-level.** Next 15 promoted it out of
  `experimental` and only *warns* if you leave it behind — which silently ships an
  image with no Prisma engine that dies on the first query.
- **The Tailwind 4 codemod deletes `tailwind.config.ts` and does not carry
  `plugins:` across.** `tailwindcss-animate` stopped loading and Tailwind compiles
  unknown utilities away without complaint — 81 classes across 17 files, every
  Radix dialog, dropdown, select and toast animation, would have become dead
  strings. Restored with `@plugin` in `globals.css`.
- **Next 16 removed `next lint`** and does not fail usefully: it reads `lint` as a
  directory name and reports "no such directory .../lint".
- **`output: 'standalone'` is gated behind `DOCKER_BUILD=1`** so a Docker concern
  cannot change what `pnpm build` emits for Vercel.

### Go

- **A startup context is not a background context.** `main.go` had a bare `ctx`
  that was a 10-second startup timeout; anything long-lived handed it runs exactly
  once and returns, silently. It froze the new business gauges immediately — and a
  frozen gauge is indistinguishable from a calm system. It is now `startupCtx`
  with a comment.
- **Integer division loses money.** `amount / installments` stored 3,333 for a
  10,000 taka loan over 3 months. The PDF already printed an adjusted final
  installment, so the signed contract and the stored schedule disagreed and the
  loan could never reach zero. `money.InstallmentPlan` returns both figures and
  the "repays principal exactly" invariant is a test.
- **JWT `iat` is whole seconds.** A revocation marker timestamped to the
  microsecond makes a token issued 200 ms later compare as *older* and be born
  revoked. Revocation compares at second precision.

---

# Recommended order

**Superseded by [go-live.md](go-live.md).** The platform is deployed and holding
fake data, so the question is no longer "what is most urgent" but **"what gets
more expensive once real member data exists"** — a different ordering. Read that
file first.

The short version, as revised by the 2026-08-17 audit:

1. **Batch L — WO-41 → WO-43.** The ledger defects. These jumped the queue: a
   history rewrite gets more expensive with time, but a balance that is wrong is
   expensive *now*, and WO-41 can pay out five times an account's savings today.
2. **WO-28** — purge git history. Cheap while one person is affected.
3. **Settle the data model** — the legacy `LoanStatus` values, donation fund
   types (FR-15/16), the withdrawal notice period (FR-08). Each is a migration
   today and a migration *plus a backfill* after launch.
4. **SEC-11** — make the Next handlers honour the token blacklist. Small, and it
   makes a claim the README already makes true.
5. **WO-45** — the loan-application and guarantor UI. The largest gap between
   what the docs describe and what a member can do.
6. **Prove the restore** against the real host while the data is still
   disposable.
7. Then cut over — see [go-live.md](go-live.md) Stage 2.

Done since this list was first written: **WO-29** (guarantor approval endpoint),
**WO-33** (audit trigger), **WO-39** (settings allow-list), **WO-30/31/32**, and
**Batch G is merged to `main`**.
