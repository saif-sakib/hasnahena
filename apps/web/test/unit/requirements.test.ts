import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// TEST-20 — one entry per FR-01…22, checked against the documentation.
//
// The plan asks for "one test per requirement, named for the requirement, so
// the doc and the suite cannot drift". A file of 22 hand-written tests would
// satisfy the letter of that and none of the intent: it drifts the moment a
// requirement is added, renamed, or quietly implemented.
//
// So the enumeration comes from `docs/product.md`, the status from
// `docs/tasks.md`, and this file supplies one row per FR saying either *where*
// it is covered or *what is still missing*. Three things then have to agree —
// the specification, the status board, and the code — and any two disagreeing
// fails here.
//
// The sharpest part is the gap assertions. A requirement marked `[~]` claims
// something is absent; each such row proves it is *still* absent by searching
// the source. Implement the notice period without updating tasks.md and this
// test fails — which is the only mechanism that has ever kept a status board
// honest.

const REPO = resolve(process.cwd(), '..', '..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');

// ---------------------------------------------------------------------------
// Reading the documentation
// ---------------------------------------------------------------------------

type DocRequirement = { id: string; title: string };

/** The FR table in product.md: `| FR-01 | Login … | High |`. */
function requirementsFromProduct(): DocRequirement[] {
  const rows = [...read('docs/product.md').matchAll(/^\|\s*(FR-\d{2})\s*\|\s*([^|]+?)\s*\|/gm)];
  return rows.map((m) => ({ id: m[1], title: m[2] }));
}

/** The status table in tasks.md: `| FR-01 | … | `[x]` | … |`. */
function statusesFromTasks(): Map<string, string> {
  const rows = [
    ...read('docs/tasks.md').matchAll(/^\|\s*(FR-\d{2})\s*\|[^|]*\|\s*`(\[[x~ !]\])`\s*\|/gm),
  ];
  return new Map(rows.map((m) => [m[1], m[2]]));
}

/** Every tracked source file, for the gap searches below. */
function sourceFiles(): string[] {
  const roots = ['apps/api/internal', 'apps/api/cmd', 'apps/web/app', 'apps/web/lib', 'apps/web/components', 'apps/web/prisma'];
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.next') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(go|ts|tsx|prisma|mjs)$/.test(entry) && !/_test\.go$|\.test\.tsx?$/.test(entry)) {
        out.push(full);
      }
    }
  };
  for (const root of roots) walk(join(REPO, root));
  return out;
}

const SOURCES = sourceFiles();

/**
 * Source with comments removed.
 *
 * A rule that forbids the word "markup" has to search code, not prose — the
 * header of `loan_repository.go` says "Nothing here may compute a rate, a
 * markup or a fee", and the first run of this test flagged that comment as a
 * Shariah violation. A detector that fires on its own rule being written down
 * trains people to delete the documentation.
 */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Files whose *code* matches a pattern — the evidence a gap is or is not real.
 * `within` narrows the search to a surface, for gaps where the thing exists in
 * one place and is missing from another.
 */
function filesMatching(pattern: RegExp, within?: RegExp): string[] {
  return SOURCES.filter((file) => (within ? within.test(file) : true))
    .filter((file) => pattern.test(codeOf(file)))
    .map((file) => file.slice(REPO.length + 1));
}

// ---------------------------------------------------------------------------
// The contract: one row per requirement
// ---------------------------------------------------------------------------

type Coverage =
  /** Implemented, and this names the suite that proves it. */
  | { covered: string }
  /**
   * Not implemented, or only partly. `absent` is a pattern that must match
   * nothing: it is the proof the gap is still a gap.
   */
  | { gap: string; absent?: RegExp; absentIn?: RegExp };

const REQUIREMENTS: Record<string, Coverage> = {
  'FR-01': { covered: 'apps/api/cmd/server/routes_integration_test.go — POST /v1/auth/login is public and reachable' },
  'FR-02': { covered: 'apps/api/internal/repositories/auth_repository.go first-login token; e2e/admin-dashboard.spec.ts' },
  'FR-03': { covered: 'routes_integration_test.go + apps/web/test/routes/routes.contract.test.ts — every route, every role' },
  'FR-04': { covered: 'apps/web/lib/validation/registration.test.ts + e2e/registration.spec.ts' },
  'FR-05': { covered: 'apps/api/internal/repositories/admin_repository.go ApproveRegistration/RejectRegistration' },
  'FR-06': {
    gap: 'captured at signup only; nothing updates a nominee afterwards',
    // A route or repository method that writes to the nominee table would match.
    absent: /nominee\.update|UPDATE\s+nominees|updateNominee/i,
  },
  'FR-07': { covered: 'lifecycle_integration_test.go — only a PENDING request can be approved or rejected' },
  // Rewritten 2026-08-24 (ADR-030). FR-08 was "withdrawal request with
  // notice-period validation" and was implemented as exactly that: the member's
  // request was a binding notice, and both payout paths refused until it
  // matured. The owner removed the rule — a member asks a field worker, and
  // staff pay at the desk — so the requirement now describes the act rather
  // than the gate, and the tests that cover it assert an ABSENCE of refusal.
  'FR-08': {
    covered:
      'apps/api/internal/repositories/policy_enforcement_integration_test.go — paid with no request behind it, paid on the day one is filed, and an outstanding request settled rather than duplicated',
  },
  'FR-09': {
    gap: 'active-loan block exists; a guarantor’s outstanding obligation is not checked',
    // TestWithdrawalBlockedWhileGuaranteeingAnotherLoan covers the active-loan
    // half; nothing computes a guarantor's committed amount.
    absent: /guarantorObligation|committedAsGuarantor|guaranteedAmount/i,
  },
  'FR-10': {
    gap: 'personal cap enforced; fairness and solvency caps against the pool are missing',
    absent: /solvencyCap|fairnessCap|poolLiquidity/i,
  },
  'FR-11': { covered: 'apps/web/test/routes/routes.contract.test.ts — POST /loans/[id]/guarantor-approval is MEMBER-only' },
  'FR-12': {
    gap: 'the worker path writes status ACTIVE directly, skipping PENDING_GUARANTOR → PENDING_APPROVAL',
    // Deliberately no `absent`: the lifecycle *is* implemented, just bypassable.
    // lifecycle_integration_test.go pins the admin path; the bypass is a
    // product decision, recorded in tasks.md, not a missing identifier.
  },
  'FR-13': {
    gap: 'installments are recorded; there is no late-fee logic at all',
    // And under rule 3 there must not be one without an explicit decision:
    // a penalty accruing to the lender is riba on most readings.
    absent: /lateFee|latePenalty|overdueCharge/i,
  },
  'FR-14': { covered: 'replay_integration_test.go TestWaterfallTable — twelve source combinations' },
  'FR-15': {
    gap: 'donations post as untyped DONATION; no Operating/Lending/Zakat split',
    absent: /fundType|donationCategory|zakatFund/i,
  },
  'FR-16': {
    gap: 'the pool is not withdrawable, but there is no separate pool accounting',
    // The pool account exists (owned by system_donation_fund) and the waterfall depletes it;
    // what is missing is per-fund accounting, which FR-15 gates.
  },
  'FR-17': {
    // Was [!] from 2026-08-18 until WO-57 landed the same day. The endpoint had
    // always authorised correctly, frozen the transaction and written the audit
    // row — and then answered 500, because it returned the raw Prisma row and
    // `NextResponse.json` cannot serialise a BigInt. The member was told their
    // dispute failed while it succeeded.
    //
    // The contract suite drove this route with a non-existent id, so it only
    // ever exercised the 404. That is the finding this row now guards: a
    // requirement is not proven by a test of its refusals.
    covered: 'test/routes/success-paths.test.ts — a successful dispute answers 200 with a serialised body, and the audit row is there',
  },
  'FR-18': {
    // The freeze and the notification both work — routes.contract.test.ts
    // drives the endpoint. What is missing is the admin's correction flow,
    // which is done by hand today.
    gap: 'the transaction freezes and admins are notified; the correction flow is manual',
  },
  'FR-19': { covered: 'money_paths_integration_test.go — exactly one audit row per posting, none on a refusal' },
  'FR-20': { covered: 'member_repository.go read paths; routes_integration_test.go role matrix' },
  'FR-21': {
    gap: 'the queues exist and are gated to staff; SLA colouring (green <24h, red >48h) is missing',
    absent: /slaColou?r|SLA_THRESHOLD|slaBucket/i,
  },
  'FR-22': {
    gap: 'approvals, reports, settings and support are done; no audit-viewer UI and no liquidity alerts',
    // The audit *data* is complete and the API serves it; nobody can read it
    // without SQL. OBS-08.
    absent: /AuditViewer|liquidityAlert|LiquidityAlert/,
  },
  // WO-93 / ADR-033, added 2026-08-25 from the owner review. Two halves and two
  // backends: the admin-triggered erasure is a Next route, because it has to
  // delete the Cloudinary assets; the rejected-application sweep is a Go
  // background loop, because it has to run unattended and needs no Cloudinary.
  'FR-23': {
    covered:
      'apps/web/test/routes/identity-integrity.test.ts (anonymise vs delete, the refusals, the audit row that names nothing it erased) + apps/api/internal/repositories/retention_integration_test.go (the window, what it must not touch) + cmd/server/wiring_test.go (the loop is actually started)',
  },
};

// ---------------------------------------------------------------------------
// The three-way agreement
// ---------------------------------------------------------------------------

describe('TEST-20 — requirements, status board and code agree', () => {
  const docRequirements = requirementsFromProduct();
  const statuses = statusesFromTasks();

  it('product.md lists the requirements this suite expects', () => {
    // A sanity floor: if the parse breaks, everything below passes vacuously.
    expect(docRequirements.length).toBeGreaterThanOrEqual(22);
    expect(docRequirements[0].id).toBe('FR-01');
  });

  it('every requirement in product.md has a status in tasks.md', () => {
    const missing = docRequirements.filter((r) => !statuses.has(r.id)).map((r) => r.id);
    expect(missing, `these are specified but not tracked: ${missing.join(', ')}`).toEqual([]);
  });

  it('every requirement in product.md has a row here', () => {
    const missing = docRequirements.filter((r) => !REQUIREMENTS[r.id]).map((r) => r.id);
    expect(
      missing,
      `add a row to REQUIREMENTS saying where each is covered or what is missing: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('has no row for a requirement that no longer exists', () => {
    const known = new Set(docRequirements.map((r) => r.id));
    const phantom = Object.keys(REQUIREMENTS).filter((id) => !known.has(id));
    expect(phantom, `these were removed from product.md: ${phantom.join(', ')}`).toEqual([]);
  });

  it('tasks.md tracks nothing that product.md does not specify', () => {
    const known = new Set(docRequirements.map((r) => r.id));
    const extra = [...statuses.keys()].filter((id) => !known.has(id));
    expect(extra, `tracked but unspecified: ${extra.join(', ')}`).toEqual([]);
  });
});

describe('TEST-20 — a requirement marked done claims a covering suite', () => {
  const statuses = statusesFromTasks();

  for (const [id, coverage] of Object.entries(REQUIREMENTS)) {
    const status = statuses.get(id);
    if (status !== '[x]') continue;

    it(`${id} is marked [x] and names where it is proven`, () => {
      expect(
        'covered' in coverage,
        `${id} is [x] in tasks.md but this file records it as a gap — one of the two is wrong`,
      ).toBe(true);
      if ('covered' in coverage) {
        expect(coverage.covered.length).toBeGreaterThan(20);
      }
    });
  }
});

describe('TEST-20 — a requirement marked incomplete is still incomplete', () => {
  const statuses = statusesFromTasks();

  for (const [id, coverage] of Object.entries(REQUIREMENTS)) {
    const status = statuses.get(id);
    if (status === '[x]') continue;

    it(`${id} is marked ${status} and this file agrees`, () => {
      expect(
        'gap' in coverage,
        `${id} is ${status} in tasks.md but this file claims it is covered`,
      ).toBe(true);
    });

    if ('gap' in coverage && coverage.absent) {
      it(`${id}: the missing piece is genuinely still missing`, () => {
        // The anti-drift assertion. If someone implements this and forgets the
        // status board, the search starts matching and this fails — naming the
        // file that now implements it.
        const found = filesMatching(coverage.absent!, coverage.absentIn);
        expect(
          found,
          `${id} is marked ${status} ("${coverage.gap}"), but ${coverage.absent} now matches:\n  ` +
            `${found.join('\n  ')}\nIf this is implemented, update docs/tasks.md and move the row to { covered }.`,
        ).toEqual([]);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// TEST-21 — the Shariah invariant, statically
// ---------------------------------------------------------------------------

describe('TEST-21 — no interest, markup or fee is reachable from a money path', () => {
  // Rule 3 is not a preference. A rate, a markup or a processing fee is a
  // Shariah violation, so the useful test is not "is the rate zero" but "is
  // there anywhere a rate could be set at all".
  const MONEY_PATHS = SOURCES.filter((file) =>
    /apps\/api\/internal\/(repositories|money)\/|apps\/web\/app\/api\/v1\/loans\//.test(file),
  );

  it('finds the money paths it is meant to be searching', () => {
    expect(MONEY_PATHS.length).toBeGreaterThan(8);
  });

  it.each([
    ['an interest rate', /\binterestRate\b|\bInterestRate\b|\brateOfInterest\b/],
    ['a markup', /\bmarkup\b|\bMarkup\b|\bprofitRate\b/],
    ['a processing or service fee being computed', /\bprocessingFee\b|\bserviceCharge\b|\badminFee\b/],
    ['a late fee or penalty', /\blateFee\b|\bpenaltyAmount\b|\boverdueCharge\b/],
    ['a compounding calculation', /\bcompound\w*\(|\bAPR\b|\bannualRate\b/],
  ])('no money path defines %s', (_what, pattern) => {
    const found = MONEY_PATHS.filter((file) => pattern.test(codeOf(file)))
      .map((file) => file.slice(REPO.length + 1));
    expect(
      found,
      `${pattern} appears in a money path. Under Qard al-Hasan this is a Shariah violation, ` +
        `not a feature — stop and flag it (CLAUDE.md rule 3):\n  ${found.join('\n  ')}`,
    ).toEqual([]);
  });

  it('the only fee-shaped column in the schema still defaults to zero', () => {
    const schema = read('apps/web/prisma/schema.prisma');
    expect(schema).toMatch(/applicationFee\s+BigInt\s+@default\(0\)/);
  });

  it('the one place that writes applicationFee writes zero', () => {
    const writers = filesMatching(/applicationFee\s*:/);
    // api-utils.ts serialises it for display; the loan route sets it.
    for (const file of writers) {
      const text = read(file);
      for (const m of text.matchAll(/applicationFee:\s*([^,\n]+)/g)) {
        const value = m[1].trim();
        const isSerialisation = value.startsWith('loan.applicationFee');
        expect(
          isSerialisation || value === 'BigInt(0)',
          `${file} writes applicationFee: ${value} — Qard al-Hasan permits no fee (rule 3)`,
        ).toBe(true);
      }
    }
  });

  it('the loan agreement states the rate rather than leaving it implied', () => {
    // A zero-interest contract that does not say so proves nothing at a counter.
    const agreement = read('apps/web/lib/documents/builders/loan-agreement.ts');
    expect(agreement).toContain("'0% — Qard al-Hasan'");
    expect(agreement).toContain("label: 'Processing fee', value: 'None'");
  });

  it('the late-fee term the agreement reserves is still not implemented anywhere', () => {
    // FLAGGED, not fixed. The printed agreement says:
    //
    //   "Late payment may attract a fixed, interest-free late fee as set by
    //    foundation policy."
    //
    // and FR-13 asks for late-fee flags "per policy" — but no policy document
    // says what the fee is or, more importantly, *who keeps it*. That last
    // question is the whole question: a penalty retained by the lender is riba
    // on the mainstream reading, while one paid entirely to charity is the
    // form scholars permit. Rule 3 says to stop and flag rather than pick.
    //
    // So this test pins the tension instead of resolving it. The member signs a
    // term reserving a fee; the system charges none. That is the safe direction
    // to be wrong in, and it must not change by accident — implementing the fee
    // fails this test, and removing the term fails the first assertion.
    const agreement = read('apps/web/lib/documents/builders/loan-agreement.ts');
    expect(
      agreement,
      'the agreement no longer reserves a late fee — if that was deliberate, delete this test and the FR-13 row',
    ).toContain('interest-free late fee');

    const implementations = filesMatching(/lateFee|latePenalty|overdueCharge|penaltyAmount/i);
    expect(
      implementations,
      'a late fee is now implemented. Under Qard al-Hasan this needs an explicit ruling on who ' +
        'receives it before it ships — see CLAUDE.md rule 3:\n  ' + implementations.join('\n  '),
    ).toEqual([]);
  });
});
